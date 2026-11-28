import { validCompletedModels } from '../llm/checkpoint-models.ts';
import { decodeKb02StructuredOutput, kb02StructuredOutput } from '../llm/openai-structured.ts';
import { LlmError } from '../llm/provider.ts';
import { validateSchema, type JsonSchemaNode } from '../llm/schema-validator.ts';
import { validPdfInput } from '../wiki/pdf-input.ts';
import {
  LONG_REVISION,
  DIRECTORY_REVISION,
  PROMPT_REVISION,
  FRAGMENT_REVISION,
  PRESENTATION_REVISION,
  type Decision,
  type Assignment,
  type ShapeStage,
  type Job,
  completedBlocks,
  cleanupFingerprint,
  type ShapeRequest,
  isObject,
  titleOk,
  topicIssue,
  finalTitleIssue,
  CleanupError,
} from './pdf-cleanup-types.ts';

export const topicName = { type: 'string', minLength: 1, maxLength: 100 } as const;

export const decisionSchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'decision', 'reason'],
  properties: {
    id: { type: 'string' },
    decision: { type: 'string', enum: ['keep', 'merge', 'skip'] },
    reason: { type: 'string', minLength: 1, maxLength: 400 },
    topic: topicName,
    mergedInto: { type: 'string' },
    table: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'role'],
      properties: { title: topicName, role: { type: 'string', enum: ['header', 'row', 'note'] } },
    },
  },
};

export const assignmentSchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'title'],
  properties: { topic: topicName, title: topicName },
};

export const keyedDecisionSchema: JsonSchemaNode = {
  ...decisionSchema,
  required: ['decision', 'reason'],
  properties: Object.fromEntries(Object.entries(decisionSchema.properties!).filter(([key]) => key !== 'id')),
};

export const presentationEntry: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['representativeId', 'reason'],
  properties: {
    representativeId: { type: ['string', 'null'] },
    reason: { type: 'string', minLength: 1, maxLength: 400 },
  },
};

export const responseSchemas: Record<'pdf_cleanup' | 'pdf_topic_index', JsonSchemaNode> = {
  pdf_cleanup: {
    type: 'object',
    additionalProperties: false,
    required: ['decisions'],
    properties: { decisions: { type: 'array', items: decisionSchema } },
  },
  pdf_topic_index: {
    type: 'object',
    additionalProperties: false,
    required: ['assignments'],
    properties: { assignments: { type: 'array', items: assignmentSchema } },
  },
};

export const issueReasons: Record<string, string> = {
  invalid_type: '字段类型无效',
  invalid_enum: '字段取值不在允许范围',
  invalid_length: '字段长度超出范围',
  missing_field: '缺少必需字段',
  unknown_field: '对象含未声明字段',
  invalid_shape: '字段结构无效',
  blank_reason: '处置理由不能为空白',
  invalid_title: '主题或表名不符合命名规则',
  blank_label: '名称不能为空白',
  multiline_label: '名称必须为单行',
  surrounding_whitespace: '正式标题不能有首尾空白',
  unsafe_title_characters: '正式标题含会影响链接或显示的字符',
  required_for_action: '此处置需要该字段',
  forbidden_for_action: '此处置不能填写该字段',
  duplicate_topic: '同一主题被分配多次',
  unknown_topic: '不是本次输入主题',
  missing_topic: '缺少本次输入主题的分配',
  missing_input_key: '缺少本批输入对应的键',
  unknown_input_key: '包含本批输入之外的键',
  duplicate_input_key: '同一输入键出现多次',
  invalid_representative: '代表必须是本批同主题的独立单元',
};

export function shapeError(stage: ShapeStage, path: string, reason: string) {
  const [code, label] =
    stage === 'pdf_cleanup'
      ? ['PDF_CLEANUP_SCHEMA', '清理决策']
      : stage === 'pdf_topic_index'
        ? ['PDF_CLEANUP_INDEX', '主题索引']
        : stage === 'pdf_topic_directory'
          ? ['PDF_CLEANUP_INDEX', '全局目录']
          : ['PDF_CLEANUP_PRESENTATION', '主题展示'];
  return new CleanupError(code, label + '结构无效（' + path + '，' + issueReasons[reason] + '）。', 502, {
    stage,
    path,
    reason,
  });
}

/** Shared validator messages may contain provider values and unrecognized property names. */
export function checkedSchemaError(stage: ShapeStage, message: string, root = '$') {
  const match =
    /^(\$(?:\.(?:decisions|assignments|presentation|id|decision|reason|topic|mergedInto|table|title|role|representativeId)|\[\d+\])*): /u.exec(
      message,
    );
  const at = root + (match?.[1].slice(1) ?? '');
  const error = match ? message.slice(match[0].length) : '';
  const required =
    /^缺少必需字段 (decisions|assignments|presentation|id|decision|reason|topic|mergedInto|table|title|role|representativeId)$/u.exec(
      error,
    );
  if (required) return shapeError(stage, at + '.' + required[1], 'missing_field');
  if (error.startsWith('存在未允许的字段 ')) return shapeError(stage, at, 'unknown_field');
  if (error.startsWith('期望 ')) return shapeError(stage, at, 'invalid_type');
  if (error.startsWith('值 ')) return shapeError(stage, at, 'invalid_enum');
  if (error.startsWith('字符串长度 ')) return shapeError(stage, at, 'invalid_length');
  return shapeError(stage, at, 'invalid_shape');
}

export function keyedResponse(payload: ShapeRequest) {
  const field =
    payload.stage === 'pdf_cleanup'
      ? 'decisions'
      : payload.stage === 'pdf_presentation'
        ? 'presentation'
        : 'assignments';
  const keys =
    payload.stage === 'pdf_topic_index'
      ? payload.topics
      : payload.stage === 'pdf_topic_directory'
        ? payload.topics.map((topic) => topic.id)
        : payload.units.map((unit) => unit.id);
  const entry =
    payload.stage === 'pdf_cleanup'
      ? keyedDecisionSchema
      : payload.stage === 'pdf_presentation'
        ? presentationEntry
        : topicName;
  const schema: JsonSchemaNode = {
    type: 'object',
    additionalProperties: false,
    required: [field],
    properties: {
      [field]: {
        type: 'object',
        additionalProperties: false,
        required: keys,
        properties: Object.fromEntries(keys.map((key) => [key, entry])),
      },
    },
  };
  return { field, keys, entry, wire: kb02StructuredOutput(payload.stage, schema) };
}

export function decodeKeyed(
  stage: ShapeStage,
  value: unknown,
  format: ReturnType<typeof keyedResponse>,
  strict: boolean,
) {
  const { field, keys, entry, wire } = format;
  const groupPath = '$.' + field;
  if (!isObject(value)) throw shapeError(stage, '$', 'invalid_type');
  if (!Object.hasOwn(value, field)) throw shapeError(stage, groupPath, 'missing_field');
  if (Object.keys(value).length !== 1) throw shapeError(stage, '$', 'unknown_field');
  const group = value[field];
  if (!isObject(group)) throw shapeError(stage, groupPath, 'invalid_type');
  const allowed = new Set(keys);
  if (Object.keys(group).some((key) => !allowed.has(key))) throw shapeError(stage, groupPath, 'unknown_input_key');
  const firstMissing = keys.findIndex((key) => !Object.hasOwn(group, key));
  if (firstMissing >= 0) throw shapeError(stage, groupPath + '[' + firstMissing + ']', 'missing_input_key');
  return {
    [field]: keys.map((key, i) => {
      const at = groupPath + '[' + i + ']' + (field === 'assignments' ? '.title' : '');
      let decoded = group[key];
      const extra = unknownFieldPath(decoded, entry, at);
      if (extra) throw shapeError(stage, extra, 'unknown_field');
      if (strict) {
        const entryWire = wire.schema.properties![field].properties![key];
        try {
          decoded = decodeKb02StructuredOutput(decoded, entry, { name: wire.name, schema: entryWire });
        } catch (error) {
          if (!(error instanceof LlmError) || error.code !== 'LLM_SCHEMA_INVALID') throw error;
          const messages = (error.details as { errors: string[] }).errors;
          throw checkedSchemaError(stage, messages[0], at);
        }
      }
      const [issue] = validateSchema(decoded, entry);
      if (issue) throw checkedSchemaError(stage, issue, at);
      return field === 'assignments' ? { topic: key, title: decoded as string } : { ...(decoded as object), id: key };
    }),
  };
}

export function unknownFieldPath(value: unknown, schema: JsonSchemaNode, at = '$'): string | undefined {
  if (schema.properties && isObject(value)) {
    if (Object.keys(value).some((key) => !Object.hasOwn(schema.properties!, key))) return at;
    for (const [key, child] of Object.entries(schema.properties)) {
      const unknown = unknownFieldPath(value[key], child, at + '.' + key);
      if (unknown) return unknown;
    }
  } else if (schema.items && Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const unknown = unknownFieldPath(item, schema.items, at + '[' + index + ']');
      if (unknown) return unknown;
    }
  }
}

export function decisionIssue(value: Decision): [field: string, reason: string] | undefined {
  if (!value.reason.trim()) return ['reason', 'blank_reason'];
  if (value.decision === 'skip') {
    const extra = (['topic', 'mergedInto', 'table'] as const).find((key) => value[key] !== undefined);
    return extra ? [extra, 'forbidden_for_action'] : undefined;
  }
  if (value.topic === undefined) return ['topic', 'required_for_action'];
  const issue = topicIssue(value.topic);
  if (issue) return ['topic', issue];
  if (value.table && !titleOk(value.table.title)) return ['table.title', 'invalid_title'];
  if (value.decision === 'merge' && value.mergedInto === undefined) return ['mergedInto', 'required_for_action'];
  if (value.decision === 'keep' && value.mergedInto !== undefined) return ['mergedInto', 'forbidden_for_action'];
}

export function validDecision(value: unknown): value is Decision {
  if (unknownFieldPath(value, decisionSchema) || validateSchema(value, decisionSchema).length) return false;
  const decision = value as Decision;
  return !decisionIssue(decision) && (decision.topic === undefined || decision.topic === decision.topic.trim());
}

export function validAssignment(value: unknown): value is Assignment {
  if (unknownFieldPath(value, assignmentSchema) || validateSchema(value, assignmentSchema).length) return false;
  const { topic, title } = value as Assignment;
  return !topicIssue(topic) && topic === topic.trim() && !finalTitleIssue(title);
}

export function validJob(value: unknown): value is Job {
  if (!isObject(value)) return false;
  const job = value as Job;
  const revision = job.promptRevision ?? 1;
  return (
    Number.isSafeInteger(job.version) &&
    validPdfInput(job.binding) &&
    (job.promptRevision === undefined ||
      [2, PRESENTATION_REVISION, FRAGMENT_REVISION, PROMPT_REVISION, LONG_REVISION, DIRECTORY_REVISION].includes(
        revision,
      )) &&
    ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status) &&
    ['cleaning', 'indexing', 'assembling', 'done'].includes(job.stage) &&
    typeof job.provider?.name === 'string' &&
    typeof job.provider.model === 'string' &&
    /^[a-f0-9]{64}$/u.test(job.identity) &&
    Number.isSafeInteger(job.attempts) &&
    Number.isSafeInteger(job.totalBatches) &&
    job.totalBatches >= 0 &&
    Array.isArray(job.batches) &&
    job.batches.length <= job.totalBatches &&
    job.batches.every((batch) => Array.isArray(batch) && batch.every(validDecision)) &&
    Array.isArray(job.index) &&
    job.index.every(validAssignment) &&
    (job.reusedCleanupBatches === undefined ||
      (revision >= LONG_REVISION
        ? Number.isSafeInteger(job.reusedCleanupBatches) &&
          job.reusedCleanupBatches >= 0 &&
          job.reusedCleanupBatches <= job.batches.length
        : revision >= FRAGMENT_REVISION &&
          job.reusedCleanupBatches === job.totalBatches &&
          job.batches.length === job.totalBatches)) &&
    (job.reusedIndexEntries === undefined ||
      (revision === PROMPT_REVISION &&
        job.reusedIndexEntries === job.index.length &&
        job.reusedCleanupBatches !== undefined)) &&
    job.attempts >= job.batches.length - (revision >= LONG_REVISION ? 0 : (job.reusedCleanupBatches ?? 0)) &&
    (job.fragments === undefined
      ? revision >= LONG_REVISION || revision < FRAGMENT_REVISION || job.status !== 'completed'
      : revision >= FRAGMENT_REVISION && revision < LONG_REVISION && Array.isArray(job.fragments)) &&
    (job.status !== 'completed' || job.stage === 'done') &&
    (job.presentation === undefined
      ? revision < PRESENTATION_REVISION || revision >= PROMPT_REVISION || job.status !== 'completed'
      : revision >= PRESENTATION_REVISION &&
        revision < PROMPT_REVISION &&
        !!job.presentation &&
        Number.isSafeInteger(job.presentation.completedBatches) &&
        job.presentation.completedBatches >= 0 &&
        [job.presentation.groups, job.presentation.parallel].every(
          (groups) =>
            Array.isArray(groups) &&
            groups.every(
              (group) =>
                typeof group?.representativeId === 'string' &&
                Array.isArray(group.memberIds) &&
                group.memberIds.length > 0 &&
                group.memberIds.every((id: unknown) => typeof id === 'string') &&
                typeof group.reason === 'string' &&
                !!group.reason.trim(),
            ),
        )) &&
    (job.writing === undefined
      ? revision < PROMPT_REVISION || job.status !== 'completed'
      : revision >= PROMPT_REVISION && Array.isArray(job.writing) && job.attempts >= job.writing.length) &&
    (job.draftId === undefined || /^[a-f0-9-]{36}$/iu.test(job.draftId)) &&
    (job.taskFingerprint === undefined || job.taskFingerprint === cleanupFingerprint(job)) &&
    (job.completedModels === undefined || validCompletedModels(job.completedModels, completedBlocks(job)))
  );
}

export function assertUniqueSlots(stage: 'pdf_presentation' | 'pdf_topic_directory', field: string, text: string) {
  // JSON.parse has already checked syntax, but would silently keep the last occurrence of a repeated key.
  const seen = new Set<string>();
  let depth = 0;
  for (const [token, name, colon] of text.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}]/gsu)) {
    if (token === '{') depth++;
    else if (token === '}') depth--;
    else if ((depth === 1 || depth === 2) && colon) {
      const key = depth + ':' + (JSON.parse(name) as string);
      if (seen.has(key)) throw shapeError(stage, '$.' + field, 'duplicate_input_key');
      seen.add(key);
    }
  }
}
