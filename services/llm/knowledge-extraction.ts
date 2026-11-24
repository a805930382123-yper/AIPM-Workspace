import {
  buildKnowledgePlanningInput,
  buildKnowledgePlanningWire,
  KNOWLEDGE_PLANNING_CONTEXT_INSTRUCTION,
  expandKnowledgePlan,
  projectKnowledgePlan,
  KNOWLEDGE_PLANNING_INSTRUCTION,
  KNOWLEDGE_TEMPLATE_FIELD_INSTRUCTION,
  type KnowledgeWirePlan,
} from './knowledge-planning.ts';
import type { TemplateFields, TemplateFieldKey } from '../wiki/template-fields.ts';
import { buildKnowledgeAtoms, coverageDiagnostic, hasCoverageErrors } from './knowledge-atoms.ts';
import { chunkText } from './chunk.ts';
import { buildEvidenceLocatorCatalog } from './locators.ts';
import { loadExtractionRules, FROZEN_BUDGETS } from './rules.ts';
import { assertNoKnownSecret, describeUnparsable, LlmError, type LlmProvider } from './provider.ts';
import { validateSchema, type JsonSchemaNode } from './schema-validator.ts';
import { kb02StructuredOutput, decodeKb02StructuredOutput } from './openai-structured.ts';
import type { ExtractOutcome, ExtractProgress, ExtractRawInput } from './service.ts';
import type { CheckpointChunk, ExtractionCheckpoint } from './checkpoints.ts';
import { evidenceSourceId, sourceRange, type RawAiContent } from '../raw/media-context.ts';

const exact = (value: unknown, schema: object, label: string) => {
  const issues = validateSchema(value, schema as never);
  if (issues.length)
    throw new LlmError('LLM_SCHEMA_INVALID', `${label}未通过严格结构校验（${issues.length}项）。`, 502, {
      errors: issues.slice(0, 20),
    });
};
const parse = (text: string, provider: LlmProvider, label: string) => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LlmError(
      'LLM_INVALID_JSON',
      `${label}不是合法 JSON，未修补返回。`,
      502,
      describeUnparsable(text, provider.secrets ?? []),
    );
  }
  assertNoKnownSecret(value, provider.secrets ?? []);
  return value;
};
const normalizeText = (value: string) => value.normalize('NFKC').trim();
function sourceSummary(facts: string[]) {
  const selected: string[] = [];
  let length = 0;
  for (const fact of facts) {
    if (length + fact.length + 1 > 3700) break;
    selected.push(fact);
    length += fact.length + 1;
  }
  return (
    '来源事实：\n' +
    selected.join('\n') +
    (selected.length < facts.length ? `\n其余${facts.length - selected.length}条来源事实见各知识页。` : '')
  );
}
export type KnowledgeRunInput = {
  raw: ExtractRawInput;
  body: string;
  bodySha256: string;
  content?: RawAiContent;
  provider: LlmProvider;
  rulesDir: string;
  checkpoint: ExtractionCheckpoint;
  beforePlanning?: (checkpoint: ExtractionCheckpoint) => Promise<ExtractionCheckpoint>;
  planningRetry?: boolean;
  signal?: AbortSignal;
  beforeCall: (stage: 'extracting' | 'planning') => Promise<ExtractionCheckpoint>;
  saveCheckpoint: (value: Omit<ExtractionCheckpoint, 'integrity'>) => Promise<ExtractionCheckpoint>;
  onProgress?: (value: ExtractProgress) => void;
};

function planningFieldInstruction(bundle: Awaited<ReturnType<typeof loadExtractionRules>>): string {
  const page = bundle.kb02PlanningSchema.properties?.pages?.items?.properties;
  const typeIds = page?.type?.enum;
  const categoryIds = page?.category?.enum;
  if (!Array.isArray(typeIds) || !Array.isArray(categoryIds))
    throw new LlmError('LLM_RULES_INVALID', 'KB02规划schema缺少type/category枚举。', 500);
  const typeLabels = typeIds.map((id) => {
    const definition = bundle.fmcg.types.find((item) => item.id === id);
    if (!definition) throw new LlmError('LLM_RULES_INVALID', `FMCG schema缺少可提取type定义：${String(id)}`, 500);
    return `${id}（${definition.label}：${definition.description}）`;
  });
  const categoryLabels = categoryIds.map((id) => {
    const definition = bundle.fmcg.categories.find((item) => item.id === id);
    if (!definition) throw new LlmError('LLM_RULES_INVALID', `FMCG schema缺少category定义：${String(id)}`, 500);
    return `${id}（${definition.label}）`;
  });
  const examples = [
    { type: 'metric', category: 'metric', meaning: '形态为业务指标，主题为数据指标' },
    { type: 'concept', category: 'ai_application', meaning: '形态为概念，主题为AI应用' },
  ].filter((example) => typeIds.includes(example.type) && categoryIds.includes(example.category));
  if (!examples.length)
    throw new LlmError('LLM_RULES_INVALID', '当前规划schema无法提供合法type/category配对示例。', 500);
  return [
    '字段职责：type表示知识页的知识形态，category表示该页涉及的快消业务主题；二者是独立维度。type应回答“这是什么形态的知识”，category应回答“它涉及什么业务主题”。',
    `type仅可取当前schema/FMCG定义中的可提取形态：${typeLabels.join('；')}。`,
    `category仅可取当前schema/FMCG定义中的业务主题：${categoryLabels.join('；')}。`,
    '每页分别根据其实际内容判断两个字段；schema允许的type与category组合均可使用。同一值可出现在两个字段中，也可使用不同值。示例仅解释字段职责，不是默认值或主题分类规则；不要因为主题涉及AI就一律选择concept。',
    `合法配对示例（当前schema枚举校验通过）：${JSON.stringify(examples.map(({ type, category, meaning }) => ({ type, category, meaning })))}`,
  ].join('\n');
}

export function knowledgePlanCallMinimum(
  checkpoint: Pick<ExtractionCheckpoint, 'rulesVersion' | 'completedChunks' | 'plan'>,
): number {
  return (
    checkpoint.completedChunks.length +
    (checkpoint.plan ? (checkpoint.rulesVersion.includes('-kb02-atoms-planning-12-') ? 2 : 1) : 0)
  );
}

export async function validateKnowledgeCheckpoint(
  input: Pick<KnowledgeRunInput, 'raw' | 'body' | 'bodySha256' | 'content' | 'provider' | 'rulesDir' | 'checkpoint'>,
  completedDraft?: { rulesVersion: string; callCount: number },
) {
  const bundle = await loadExtractionRules(input.rulesDir);
  const chunks = chunkText(input.body, {
    maxChunkChars: FROZEN_BUDGETS.maxChunkChars,
    overlap: FROZEN_BUDGETS.chunkOverlap,
    maxRawChars: FROZEN_BUDGETS.maxRawChars,
  });
  if (!chunks.length) throw new LlmError('LLM_EMPTY_RESULT', '这条原文没有可分析的正文，无法提取知识。', 422);
  const descriptors = chunks.map(({ index, start, end }) => ({ index, start, end }));
  const current = input.checkpoint;
  // Scan every AI-bearing key/value, including saved errors and diagnostics. Program-owned
  // cache metadata is not AI output (e.g. a one-character key must not match "kb02-2").
  const aiCheckpointValues = [
    ...current.completedChunks,
    ...(current.plan ? [current.plan] : []),
    ...(current.lastError ? [current.lastError] : []),
  ];
  try {
    assertNoKnownSecret(aiCheckpointValues, input.provider.secrets ?? []);
  } catch {
    throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点包含当前已知秘密，已拒绝恢复。', 409);
  }
  if (
    current.rawId !== input.raw.id ||
    current.rawSha256 !== input.bodySha256 ||
    current.mediaInputSha256 !== input.content?.digest ||
    !['kb02-2', 'kb03-1'].includes(current.pipelineVersion) ||
    current.rulesVersion !== bundle.rulesVersion ||
    JSON.stringify(current.chunks) !== JSON.stringify(descriptors)
  )
    throw new LlmError('LLM_CHECKPOINT_INCOMPATIBLE', '原文、规则或分块版本已变化；检查点保留，请明确重新生成。', 409);
  const catalogByChunk = new Map<number, ReturnType<typeof buildEvidenceLocatorCatalog>>();
  const sourceBoundaries = input.content?.spans.map(({ start }) => start);
  for (const chunk of chunks)
    catalogByChunk.set(chunk.index, buildEvidenceLocatorCatalog(input.body, chunk, { sourceBoundaries }));
  // Only storage reconciliation with an already-associated completed draft may use its
  // original revision's call floor. Pipeline/resume callers never pass this argument.
  const countRulesVersion =
    completedDraft && completedDraft.callCount === current.attempts
      ? completedDraft.rulesVersion
      : current.rulesVersion;
  if (
    current.attempts < knowledgePlanCallMinimum({ ...current, rulesVersion: countRulesVersion }) ||
    current.completedChunks.reduce((sum, part) => sum + part.facts.length, 0) > 256 ||
    current.completedChunks.reduce((sum, part) => sum + part.questions.length, 0) > 128
  )
    throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点事实、问题或累计调用计数不一致，已拒绝恢复。', 409);
  const validatedChunkIds = new Set<number>();
  const factIdsSeen = new Set<string>();
  const questionIdsSeen = new Set<string>();
  for (const saved of current.completedChunks) {
    const source = chunks[saved.index];
    const catalog = catalogByChunk.get(saved.index);
    if (
      !source ||
      !catalog ||
      saved.start !== source.start ||
      saved.end !== source.end ||
      validatedChunkIds.has(saved.index) ||
      saved.facts.length > 32 ||
      saved.questions.length > 16
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点分块覆盖或数量不合法，已拒绝恢复。', 409);
    validatedChunkIds.add(saved.index);
    const locatorMap = new Map(catalog.map((item) => [item.id, item]));
    for (const item of [...saved.facts, ...saved.questions]) {
      const seenIds = item.id.startsWith('f-') ? factIdsSeen : questionIdsSeen;
      const expectedPrefix = item.id.startsWith('f-') ? `f-c${saved.index + 1}-` : `q-c${saved.index + 1}-`;
      if (!item.id.startsWith(expectedPrefix) || seenIds.has(item.id))
        throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点事实/问题ID重复或未绑定其原始分块。', 409);
      seenIds.add(item.id);
      if (
        item.chunkIndex !== saved.index ||
        !item.text.trim() ||
        item.text.length > (item.id.startsWith('q-') ? 1000 : 2000) ||
        new Set(item.locatorIds).size !== item.locatorIds.length ||
        item.locatorIds.length === 0 ||
        item.locatorIds.some((id) => !locatorMap.has(id)) ||
        (item.id.startsWith('f-') ? !/^f-c\d+-\d+$/u.test(item.id) : !/^q-c\d+-\d+$/u.test(item.id))
      )
        throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点中的事实/问题locator无效，已拒绝恢复。', 409);
    }
    const atoms = new Map(buildKnowledgeAtoms(input.body, catalog).map((atom) => [atom.id, atom]));
    for (const items of [saved.facts, saved.questions, saved.sourceNotes ?? []])
      if (new Set(items.map((item) => item.atomId)).size !== items.length)
        throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点同一分栏出现重复原子陈述。', 409);
    if (
      (saved.sourceNotes ?? []).some((note) =>
        [...saved.facts, ...saved.questions].some((item) => item.atomId === note.atomId),
      )
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点来源声明与事实/问题分类冲突。', 409);
    for (const item of [...saved.facts, ...saved.questions, ...(saved.sourceNotes ?? [])]) {
      const atom = item.atomId ? atoms.get(item.atomId) : undefined;
      if (
        !atom ||
        (input.content && !sourceRange(input.content, atom.start, atom.end)) ||
        item.text !== atom.text ||
        JSON.stringify(item.locatorIds) !== JSON.stringify(atom.locatorIds) ||
        ('kind' in item && atom.fragment && item.kind !== 'ambiguous')
      )
        throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点原子陈述与当前Raw不一致。', 409);
    }
    const expectedEvidence = new Set(
      [...saved.facts, ...saved.questions, ...(saved.sourceNotes ?? [])].flatMap((item) => item.locatorIds),
    );
    const savedEvidenceIds = saved.evidence.map((item) => item.id);
    if (
      savedEvidenceIds.length !== expectedEvidence.size ||
      new Set(savedEvidenceIds).size !== expectedEvidence.size ||
      savedEvidenceIds.some((id) => !expectedEvidence.has(id)) ||
      saved.evidence.some((item) => {
        const locator = locatorMap.get(item.id);
        return (
          !locator ||
          !expectedEvidence.has(item.id) ||
          item.rawId !== input.raw.id ||
          item.chunkIndex !== saved.index ||
          item.start !== locator.start ||
          item.end !== locator.end ||
          item.quote !== locator.text ||
          (input.content && !sourceRange(input.content, locator.start, locator.end))
        );
      })
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点派生证据与当前Raw不一致，已拒绝恢复。', 409);
    try {
      assertNoKnownSecret(saved, input.provider.secrets ?? []);
    } catch {
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点包含当前已知秘密，已拒绝恢复。', 409);
    }
  }
  if (current.plan) {
    if (
      current.completedChunks.length !== chunks.length ||
      current.completedChunks.some((part, index) => part.index !== index)
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '已保存规划但未覆盖全部原文分块，已拒绝恢复。', 409);
    const factIds = current.completedChunks.flatMap((part) => part.facts.map((item) => item.id));
    const questionIds = current.completedChunks.flatMap((part) => part.questions.map((item) => item.id));
    const legacyDocument = !!completedDraft && current.plan.document.source_level === undefined;
    if (
      Object.keys(current.plan.document).sort().join(',') !==
      (legacyDocument ? 'main_topic,summary,title' : 'main_topic,source_level,summary,title')
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点文档结构不合法，已拒绝恢复。', 409);
    // The stored plan keeps original IDs; it is not a v3 Provider response.
    const pagesSchema = bundle.kb02PlanningSchema.properties!.pages!,
      unitPage = pagesSchema.items!;
    const { factUnitIds, questionUnitIds, templateFields, ...pageMetadata } = unitPage.properties!;
    const storedFields = {
      ...templateFields,
      properties: Object.fromEntries(
        Object.entries(templateFields.properties!).map(([key, schema]) => {
          const { factUnitIds: refs, ...properties } = schema.properties!;
          return [key, { ...schema, required: ['text', 'factIds'], properties: { ...properties, factIds: refs } }];
        }),
      ),
    };
    const storedSchema: JsonSchemaNode = {
      ...bundle.kb02PlanningSchema,
      properties: {
        ...bundle.kb02PlanningSchema.properties,
        version: { type: 'integer', enum: [2] },
        pages: {
          ...pagesSchema,
          items: {
            ...unitPage,
            required: unitPage.required!.map((key) =>
              key === 'factUnitIds' ? 'factIds' : key === 'questionUnitIds' ? 'questionIds' : key,
            ),
            properties: {
              ...pageMetadata,
              factIds: factUnitIds,
              questionIds: questionUnitIds,
              templateFields: storedFields,
            },
          },
        },
      },
    };
    const documentSchema = storedSchema.properties!.document!;
    if (legacyDocument)
      storedSchema.properties!.document = {
        ...documentSchema,
        required: documentSchema.required!.filter((key) => key !== 'source_level'),
      };
    const { summary: _summary, ...document } = current.plan.document;
    try {
      exact({ version: 2, ...current.plan, document }, storedSchema, '检查点原ID规划');
    } catch {
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点原ID规划不符合严格结构，已拒绝恢复。', 409);
    }
    if (
      current.plan.document.summary !==
      sourceSummary(current.completedChunks.flatMap((part) => part.facts.map((item) => item.text)))
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '规划摘要与原始事实不一致。', 409);
    const assignedFacts = current.plan.pages.flatMap((page) => page.factIds);
    const assignedQuestions = current.plan.pages.flatMap((page) => page.questionIds);
    if (
      !current.plan.pages.length ||
      current.plan.pages.length > 50 ||
      current.plan.pages.some((page) => !page.factIds.length) ||
      new Set(current.plan.pages.map((page) => normalizeText(page.title).toLowerCase())).size !==
        current.plan.pages.length ||
      factIds.some((id) => assignedFacts.filter((item) => item === id).length !== 1) ||
      assignedFacts.some((id) => !factIds.includes(id)) ||
      questionIds.some((id) => assignedQuestions.filter((item) => item === id).length !== 1) ||
      assignedQuestions.some((id) => !questionIds.includes(id))
    )
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点规划引用或覆盖不完整，已拒绝恢复。', 409);
    const planningInput = buildKnowledgePlanningInput(input.body, current.completedChunks, catalogByChunk);
    try {
      exact(
        projectKnowledgePlan(current.plan, planningInput),
        legacyDocument
          ? {
              ...bundle.kb02PlanningSchema,
              properties: { ...bundle.kb02PlanningSchema.properties, document: storedSchema.properties!.document },
            }
          : bundle.kb02PlanningSchema,
        '检查点整篇主题规划',
      );
    } catch {
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点规划结构或等价记录归属不合法，已拒绝恢复。', 409);
    }
    try {
      assertNoKnownSecret(current.plan, input.provider.secrets ?? []);
    } catch {
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点规划包含当前已知秘密，已拒绝恢复。', 409);
    }
  }
  return { bundle, chunks, catalogByChunk };
}
export async function runKnowledgePipeline(
  input: KnowledgeRunInput,
): Promise<{ outcome: ExtractOutcome; checkpoint: ExtractionCheckpoint }> {
  const { bundle, chunks, catalogByChunk } = await validateKnowledgeCheckpoint(input);
  const checkpoint = input.checkpoint;
  const mediaRange = (start: number, end: number) => {
    if (!input.content) return { start, end };
    const range = sourceRange(input.content, start, end);
    if (!range) throw new LlmError('LLM_EVIDENCE_INVALID_SOURCE', '图片说明分隔符不能作为来源证据。', 422);
    return range;
  };
  const deadline = Date.now() + FROZEN_BUDGETS.totalDeadlineMs;
  let current = checkpoint;
  const emit = (stage: ExtractProgress['stage'], pagesFound: number) =>
    input.onProgress?.({ stage, chunksTotal: chunks.length, chunksDone: current.completedChunks.length, pagesFound });
  const guard = () => {
    if (input.signal?.aborted) throw new LlmError('LLM_CANCELLED', '提取已被取消。', 409);
    if (Date.now() >= deadline)
      throw new LlmError('LLM_DEADLINE_EXCEEDED', '提取超过本批总期限，已保存已验证检查点。', 504);
  };
  if (!current.plan) {
    for (const chunk of chunks) {
      if (current.completedChunks.some((done) => done.index === chunk.index)) continue;
      guard();
      emit('extracting', current.completedChunks.length);
      const locators = catalogByChunk.get(chunk.index)!;
      current = await input.beforeCall('extracting');
      const atoms = buildKnowledgeAtoms(input.body, locators).filter(
        (atom) => !input.content || sourceRange(input.content, atom.start, atom.end),
      );
      const fields = bundle.kb02FactsSchema.properties!;
      const prompt = [
        '只选择原文atom ID；每条为一个机械原文切片，不得拼写、补写主体/维度/数值。分类顺序：先判断业务陈述或非业务来源声明，再判断业务陈述的完整性/歧义。fragment只是原文切片完整性标记，不决定业务相关性；非业务标题、排版或来源说明即使fragment=true也不能进入facts/questions，可选入sourceNotes或不选。仅对选入facts的业务陈述：跨主体、维度省略、条件不确定或fragment=true时kind必须ambiguous。业务否定、未知、未上线、AI仅用于未来建议是合法业务边界，不能归为来源声明。questions仅选择原文明示的业务未知，禁止自行提出问题或因非业务片段截断而生成问题。按实际内容判断，不能只凭标题形式、编号或“虚构/说明/未来”等词排除业务陈述。',
        '业务陈述含疑似错字、语句不通、转录含糊或关键含义不能确认时，保留原文atom并将kind标为ambiguous，不凭常识纠正或补写。原文指出图表未提供、内容来自摘录/转载等材料边界，可选入sourceNotes保留；非业务声明不能因此进入facts或questions。',
        '目录仅含非空候选；纯空白分隔符不可选入任何分栏。所选非空片段的首尾空白属于原文，必须原样保留。',
        'atom是机械原文切片，可能包含多个相邻片段，不保证语义完整。截断的排版说明与下一标题拼接，或多个非业务片段相连，仍是非业务；即使fragment=false、语法混合、结尾缺失或无法补全，也不能因此成为ambiguous业务事实。业务歧义必须先存在业务陈述。不要猜测截断后可能出现的业务内容；按当前可见内容判定。相反，片段中实际陈述的经营数值、业务否定、未知、未上线或未来业务建议必须保留，不因邻接标题、排版或“说明/虚构”字样被丢弃。',
        `来源标题：${input.raw.title}；类型：${input.raw.sourceType}；来源：${input.raw.sourceName}; Raw ID：${input.raw.id}`,
        `原文全局区间 [${chunk.start},${chunk.end})。定位目录覆盖此 chunk，atom只可选当前目录。`,
        `完整输出契约与服务端严格校验使用同一JSON Schema：${JSON.stringify(bundle.kb02FactsSchema)}`,
        `顶层仅含version、facts、questions、sourceNotes且全部必填。kind仅位于facts对象，枚举为${JSON.stringify(fields.facts.items?.properties?.kind.enum)}；歧义也是facts中的对象，不能新增顶层ambiguous。facts最多${fields.facts.maxItems}条、questions最多${fields.questions.maxItems}条、sourceNotes最多${fields.sourceNotes.maxItems}条。所有对象禁止额外字段；questions/sourceNotes的每项只能是{atomId}对象，不能是字符串或带kind。`,
        '合法非空结构示意（以下示意ID不是目录ID，禁止照抄；实际只选择下方当前目录的ID，不存在对应类别时使用空数组）：{"version":2,"facts":[{"atomId":"示例事实ID","kind":"fact"},{"atomId":"示例歧义ID","kind":"ambiguous"}],"questions":[{"atomId":"示例未知ID"}],"sourceNotes":[{"atomId":"示例声明ID"}]}',
        '分类优先级示例（示意ID不是目录ID，禁止照抄；只解释分类，不替代下方当前目录）：' +
          JSON.stringify({
            atoms: [
              { id: '示例标题片段', text: '【资料附页，虚构】\n', fragment: true },
              { id: '示例完整标题', text: '【资料附页，虚构】\n', fragment: false },
              { id: '示例排版截断', text: '排版说明：此段仅用于阅读排版，不补充经营指', fragment: true },
              { id: '示例业务片段', text: '在售门店20家，统计范围尚', fragment: true },
              { id: '示例业务边界', text: '虚构区域尚未上线AI，仅用于未来分析建议。', fragment: false },
              { id: '示例业务未知', text: '异常审批负责人未知。', fragment: false },
            ],
            output: {
              version: 2,
              facts: [
                { atomId: '示例业务片段', kind: 'ambiguous' },
                { atomId: '示例业务边界', kind: 'fact' },
              ],
              questions: [{ atomId: '示例业务未知' }],
              sourceNotes: [{ atomId: '示例标题片段' }, { atomId: '示例完整标题' }, { atomId: '示例排版截断' }],
            },
          }),
        '拼接成对示例（示意ID不是目录ID，禁止照抄；判断实际陈述，不使用编号、固定字词或fragment值作业务过滤条件）：' +
          JSON.stringify({
            atoms: [
              {
                id: '示例非业务拼接',
                text: '排版说明：此页用于长文显示，不补充任何【补充资料，虚构】\n',
                fragment: false,
              },
              { id: '示例非业务拼接截断', text: '阅读排版用途，不增加经营内容【下一节】', fragment: true },
              { id: '示例含数值拼接', text: '说明：虚构渠道在售门店28家，统计口径尚【补充资料】\n', fragment: true },
              { id: '示例含否定拼接', text: '虚构业务说明：本渠道未开展促销【补充资料】\n', fragment: false },
              {
                id: '示例含未来拼接',
                text: '说明：本渠道AI未上线，仅建议未来用于补货分析【补充资料】\n',
                fragment: false,
              },
              { id: '示例含未知拼接', text: '说明：本渠道异常审批负责人未知【补充资料】\n', fragment: false },
            ],
            output: {
              version: 2,
              facts: [
                { atomId: '示例含数值拼接', kind: 'ambiguous' },
                { atomId: '示例含否定拼接', kind: 'fact' },
                { atomId: '示例含未来拼接', kind: 'fact' },
              ],
              questions: [{ atomId: '示例含未知拼接' }],
              sourceNotes: [{ atomId: '示例非业务拼接' }, { atomId: '示例非业务拼接截断' }],
            },
          }),
        `sourceNotes仅可选虚构/验收免责声明、排版或来源说明等非业务声明，可为空；按需选择代表性声明即可，不要求穷举、重复列举全部排版说明，最多${fields.sourceNotes.maxItems}条。未选择的声明不应转入facts/questions；选中的声明也不能同时归入facts/questions。来源声明独立存为检查点元数据，不进入业务事实或标准整篇业务规划；深度笔记独立承载已选来源和材料边界。每个分栏内atomId不得重复。`,
        '输入 locator 目录（每项是精确连续原文，不要复述目录）：',
        JSON.stringify(
          atoms
            .filter((atom) => atom.text.trim().length > 0)
            .map(({ id, text, fragment, start, end }) => {
              const media = input.content ? sourceRange(input.content, start, end)?.media : undefined;
              return { id, text, fragment, ...(media ? { source_image: media.imageIndex } : {}) };
            }),
        ),
      ].join('\n');
      const factsOutput = kb02StructuredOutput('kb02_facts', bundle.kb02FactsSchema);
      const completion = await input.provider.complete({
        structuredOutput: factsOutput,
        system:
          '你是严格的原文陈述分类器。只选择给定atom ID并区分业务事实、歧义、原文明示未知与来源声明。保留否定和业务限制，不补维度，不改写原文。只返回JSON object。',
        user: prompt,
        purpose: 'knowledge',
        timeoutMs: Math.min(FROZEN_BUDGETS.callTimeoutMs, Math.max(1000, deadline - Date.now())),
        maxOutputBytes: FROZEN_BUDGETS.maxOutputBytesPerCall,
        signal: input.signal,
      });
      guard();
      if (completion.finishReason === 'length')
        throw new LlmError('LLM_OUTPUT_TRUNCATED', `第${chunk.index + 1}段精简事实响应被截断，未保存该段。`, 502);
      const original = parse(completion.text, input.provider, `第${chunk.index + 1}段精简事实`);
      const parsed = completion.structuredOutputApplied
        ? decodeKb02StructuredOutput(original, bundle.kb02FactsSchema, factsOutput)
        : original;
      exact(parsed, bundle.kb02FactsSchema, `第${chunk.index + 1}段精简事实`);
      const value = parsed as {
        facts: Array<{ atomId: string; kind: 'fact' | 'ambiguous' }>;
        questions: Array<{ atomId: string }>;
        sourceNotes: Array<{ atomId: string }>;
      };
      const byAtom = new Map(atoms.map((atom) => [atom.id, atom]));
      const check = <T extends { atomId: string; kind?: 'fact' | 'ambiguous' }>(items: T[]) => {
        if (new Set(items.map((item) => item.atomId)).size !== items.length)
          throw new LlmError('LLM_SCHEMA_INVALID', '同一分栏出现重复原子陈述。', 502);
        return items.map((item) => {
          const atom = byAtom.get(item.atomId);
          if (atom && !atom.text.trim()) throw new LlmError('LLM_SCHEMA_INVALID', '不能将空白分隔符选择为陈述。', 502);
          if (!atom) throw new LlmError('LLM_EVIDENCE_UNKNOWN_LOCATOR', '原子陈述ID未知或跨块。', 422);
          return {
            text: atom.text,
            locatorIds: atom.locatorIds,
            atomId: atom.id,
            ...(item.kind ? { kind: atom.fragment ? ('ambiguous' as const) : item.kind } : {}),
          };
        });
      };
      if (
        value.sourceNotes.some(
          (note) =>
            value.facts.some((fact) => fact.atomId === note.atomId) ||
            value.questions.some((question) => question.atomId === note.atomId),
        )
      )
        throw new LlmError('LLM_SCHEMA_INVALID', '来源声明与事实/问题分类冲突。', 502);
      const sourceNotes = check(value.sourceNotes).map((note) => ({ ...note, chunkIndex: chunk.index }));
      const evidenceSignature = (
        item: { text: string; locatorIds: string[]; atomId?: string },
        lookup: Map<string, { start: number; end: number }>,
      ) =>
        `${normalizeText(item.text)}|${item.atomId ?? ''}|${JSON.stringify(
          item.locatorIds
            .map((id) => {
              const locator = lookup.get(id);
              return locator ? [locator.start, locator.end] : null;
            })
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        )}`;
      const existingEvidence = new Map(
        current.completedChunks.flatMap((part) => part.evidence.map((item) => [item.id, item] as const)),
      );
      const oldFacts = new Set(
        current.completedChunks.flatMap((part) => part.facts.map((item) => evidenceSignature(item, existingEvidence))),
      );
      const oldQuestions = new Set(
        current.completedChunks.flatMap((part) =>
          part.questions.map((item) => evidenceSignature(item, existingEvidence)),
        ),
      );
      const seenFacts = new Set<string>();
      const seenQuestions = new Set<string>();
      const factLookup = new Map(locators.map((locator) => [locator.id, locator]));
      const facts = check(value.facts)
        .map((fact, index) => ({ ...fact, id: `f-c${chunk.index + 1}-${index + 1}`, chunkIndex: chunk.index }))
        .filter((item) => {
          const sig = evidenceSignature(item, factLookup);
          if (oldFacts.has(sig) || seenFacts.has(sig)) return false;
          seenFacts.add(sig);
          return true;
        });
      const questions = check(value.questions)
        .map((question, index) => ({ ...question, id: `q-c${chunk.index + 1}-${index + 1}`, chunkIndex: chunk.index }))
        .filter((item) => {
          const sig = evidenceSignature(item, factLookup);
          if (oldQuestions.has(sig) || seenQuestions.has(sig)) return false;
          seenQuestions.add(sig);
          return true;
        });
      const evidence = locators
        .filter((locator) =>
          [...facts, ...questions, ...sourceNotes].some((item) => item.locatorIds.includes(locator.id)),
        )
        .map((locator) => ({
          id: locator.id,
          rawId: input.raw.id,
          quote: locator.text,
          start: locator.start,
          end: locator.end,
          chunkIndex: chunk.index,
        }));
      assertNoKnownSecret({ facts, questions, sourceNotes, evidence }, input.provider.secrets ?? []);
      const nextChunks = [
        ...current.completedChunks,
        {
          index: chunk.index,
          start: chunk.start,
          end: chunk.end,
          facts,
          questions,
          sourceNotes,
          evidence,
        } satisfies CheckpointChunk,
      ].sort((a, b) => a.index - b.index);
      if (
        nextChunks.reduce((sum, part) => sum + part.facts.length, 0) > 256 ||
        nextChunks.reduce((sum, part) => sum + part.questions.length, 0) > 128
      )
        throw new LlmError('LLM_TOO_MANY_FACTS', '整篇超过256条事实或128条待确认问题上限；已保存已有检查点。', 422);
      current = await input.saveCheckpoint({
        ...current,
        completedChunks: nextChunks,
        stage: 'extracting',
        lastError: undefined,
      });
      emit('extracting', nextChunks.length);
    }
    if (input.beforePlanning && !current.maintenance) current = await input.beforePlanning(current);
    const allFacts = current.completedChunks.flatMap((part) => part.facts);
    const allQuestions = current.completedChunks.flatMap((part) => part.questions);
    if (!allFacts.length) throw new LlmError('LLM_EMPTY_RESULT', '整篇没有可规划的已验证事实（EMPTY_RESULT）。', 422);
    guard();
    const planningInput = buildKnowledgePlanningInput(input.body, current.completedChunks, catalogByChunk);
    const feedback = input.planningRetry ? current.lastError?.diagnostic : undefined;
    const planningPayload = {
      ...(current.maintenance
        ? { wikiContext: current.maintenance.wikiRetrieval?.context ?? current.maintenance.context }
        : {}),
      ...buildKnowledgePlanningWire(input.body, planningInput),
      source: {
        id: input.raw.id,
        title: input.raw.title,
        sourceType: input.raw.sourceType,
        sourceName: input.raw.sourceName,
        author: input.raw.author,
        publishedAt: input.raw.publishedAt,
        url: input.raw.url,
        tags: input.raw.tags,
      },
      sourcePolicy: bundle.sourcePolicy,
      ...(feedback ? { coverageFeedback: feedback } : {}),
    };
    assertNoKnownSecret(planningPayload, input.provider.secrets ?? []);
    const planningJson = JSON.stringify(planningPayload);
    if (Buffer.byteLength(planningJson, 'utf8') > 192 * 1024)
      throw new LlmError(
        'LLM_PLANNING_TOO_LARGE',
        '整篇事实规划输入超过192KiB；检查点已保存，请缩短资料后显式重新生成。',
        422,
      );
    const plannerSchema = bundle.kb02PlanningSchema;
    const planningSystem = `你是整篇知识主题规划器。document.source_level必须按source原始元数据与sourcePolicy给出A/B/C/D来源等级初判；来源未知或无可判断身份为D，不能把URL、文件类型或自称权威当作外部核验。初判可人工修改，不代表内容已核实。仅为有业务价值的事实主题建立知识页；不得因排版说明、目录、页眉页脚、免责声明或泛化待确认问题创建页面。相同业务主题跨chunk合并；保留不同主体、时间、条件和口径。输入的全部事实和问题必须分别且恰好归属一个页面；不得遗漏、重复、添加未知ID，不能只挑选部分事实。待确认问题只能来自输入中的原文明示未知，不得新写。不得新写事实或问题。文档主题概述只能总结事实。${planningFieldInstruction(bundle)}\n${KNOWLEDGE_PLANNING_INSTRUCTION}\n${KNOWLEDGE_PLANNING_CONTEXT_INSTRUCTION}\n${KNOWLEDGE_TEMPLATE_FIELD_INSTRUCTION}\n严格遵守schema：${JSON.stringify(plannerSchema)}`;
    assertNoKnownSecret(planningSystem, input.provider.secrets ?? []);
    current = await input.saveCheckpoint({ ...current, stage: 'planning', lastError: undefined });
    emit('planning', allFacts.length);
    current = await input.beforeCall('planning');
    const planningOutput = kb02StructuredOutput('kb02_planning', plannerSchema);
    const result = await input.provider.complete({
      structuredOutput: planningOutput,
      system: planningSystem,
      user: `请对下列全部已验证事实规划知识页，只输出JSON。\n${planningJson}`,
      purpose: 'knowledge',
      timeoutMs: Math.min(FROZEN_BUDGETS.callTimeoutMs, Math.max(1000, deadline - Date.now())),
      maxOutputBytes: FROZEN_BUDGETS.maxOutputBytesPerCall,
      signal: input.signal,
    });
    guard();
    if (result.finishReason === 'length')
      throw new LlmError('LLM_OUTPUT_TRUNCATED', '整篇主题规划响应被截断，未保存规划。', 502);
    const original = parse(result.text, input.provider, '整篇主题规划');
    const parsed = result.structuredOutputApplied
      ? decodeKb02StructuredOutput(original, plannerSchema, planningOutput)
      : original;
    exact(parsed, plannerSchema, '整篇主题规划');
    const wirePlan = parsed as KnowledgeWirePlan;
    const factIds = allFacts.map((item) => item.id);
    const questionIds = allQuestions.map((item) => item.id);
    if (
      wirePlan.pages.some((page) =>
        [...page.factUnitIds, ...page.questionUnitIds].some((id) => !/^[a-z0-9-]{1,64}$/u.test(id)),
      )
    )
      throw new LlmError('LLM_SCHEMA_INVALID', '规划包含不符合ID语法的引用，未持久化错误载荷。', 502);
    const diagnostic = coverageDiagnostic(
      planningInput.factUnits.map((unit) => unit.id),
      planningInput.questionUnits.map((unit) => unit.id),
      wirePlan.pages.map((page) => ({
        title: page.title,
        factIds: page.factUnitIds,
        questionIds: page.questionUnitIds,
      })),
    );
    if (hasCoverageErrors(diagnostic)) {
      current = await input.saveCheckpoint({
        ...current,
        stage: 'planning',
        lastError: {
          code: 'LLM_PLAN_COVERAGE_INVALID',
          message: '主题规划覆盖不完整或重复；可显式仅重新规划。',
          at: new Date().toISOString(),
          diagnostic,
        },
      });
      throw new LlmError('LLM_PLAN_COVERAGE_INVALID', '主题规划覆盖不完整或重复，未组装草稿。', 502, diagnostic);
    }
    const rawPlan = { document: wirePlan.document, pages: expandKnowledgePlan(wirePlan, planningInput) };
    if (hasCoverageErrors(coverageDiagnostic(factIds, questionIds, rawPlan.pages)))
      throw new LlmError('LLM_PLAN_COVERAGE_INVALID', '分配单元与原记录覆盖不一致，未组装草稿。', 502);
    assertNoKnownSecret(rawPlan, input.provider.secrets ?? []);
    // Revision13 publishes mechanically valid candidates for mandatory human review.
    // Historical model semantic decisions are not an approval token.
    guard();
    current = await input.saveCheckpoint({
      ...current,
      plan: {
        document: { ...rawPlan.document, summary: sourceSummary(allFacts.map((item) => item.text)) },
        pages: rawPlan.pages,
      },
      stage: 'assembling',
      lastError: undefined,
    });
  }

  current = await input.saveCheckpoint({ ...current, stage: 'assembling', lastError: undefined });
  emit(
    'assembling',
    current.completedChunks.reduce((sum, part) => sum + part.facts.length, 0),
  );
  if (!current.plan) throw new LlmError('LLM_CHECKPOINT_CORRUPT', '规划检查点缺失，已拒绝组装。', 409);
  const facts = current.completedChunks.flatMap((part) => part.facts);
  const questions = current.completedChunks.flatMap((part) => part.questions);
  const evidenceById = new Map(
    current.completedChunks.flatMap((part) => part.evidence).map((evidence) => [evidence.id, evidence]),
  );
  const pages = current.plan.pages.map((planned) => {
    const pageFacts = planned.factIds.map((id) => facts.find((item) => item.id === id)!).filter(Boolean);
    const templateFields: TemplateFields = {};
    for (const [key, field] of Object.entries(planned.templateFields ?? {})) {
      templateFields[key as TemplateFieldKey] = {
        evidenceIds: [],
        aiContent: {
          text: field.text,
          factIds: [...field.factIds],
          evidenceIds: [
            ...new Set(field.factIds.flatMap((id) => pageFacts.find((fact) => fact.id === id)!.locatorIds)),
          ],
        },
      };
    }
    const usedLocatorIds = [...new Set(pageFacts.flatMap((item) => item.locatorIds))];
    const evidence = usedLocatorIds
      .map((id) => evidenceById.get(id)!)
      .filter(Boolean)
      .map((item) => ({
        id: item.id,
        rawId: item.rawId,
        quote: item.quote,
        ...mediaRange(item.start, item.end),
        chunkIndex: item.chunkIndex,
        occurrences: 1,
      }));
    const questionsText = planned.questionIds
      .map((id) => questions.find((item) => item.id === id)?.text)
      .filter((item): item is string => !!item);
    return {
      title: planned.title,
      type: planned.type,
      category: planned.category,
      one_line_definition: planned.title,
      ...(planned.templateFields !== undefined ? { templateFields } : {}),
      source_facts: pageFacts.map((item) => ({ text: item.text, evidenceIds: item.locatorIds })),
      ai_organized: [],
      ai_inferences: [],
      related_pages: [],
      open_questions: [
        ...questionsText,
        ...pageFacts.filter((item) => item.kind === 'ambiguous').map((item) => '原文口径或边界待确认：' + item.text),
      ],
      source_evidence: evidence,
      provenance: [
        ...new Map(
          pageFacts.map((item) => {
            const part = chunks[item.chunkIndex]!;
            return [item.chunkIndex, { chunkIndex: item.chunkIndex, start: part.start, end: part.end }];
          }),
        ).values(),
      ],
    };
  });
  if (!pages.length || pages.some((page) => !page.source_facts.length))
    throw new LlmError('LLM_PLAN_COVERAGE_INVALID', '组装主题缺少来源事实，未生成草稿。', 502);
  const outcome: ExtractOutcome = {
    document: current.plan.document,
    pages,
    provider: { name: input.provider.name, model: input.provider.model },
    rulesVersion: `${bundle.rulesVersion}-${checkpoint.pipelineVersion}`,
    callCount: current.attempts,
    chunkCount: chunks.length,
    chunkCoverage: chunks.map(({ index, start, end }) => ({ index, start, end })),
    usage: { promptTokens: 0, completionTokens: 0 },
    warnings: [
      '本草稿由 kb02-2 精简事实与整篇规划程序组装；模板字段中的AI整理/分析建议需逐页核对，来源事实与证据保持原文。',
    ],
  };
  const basisInput = buildKnowledgePlanningInput(input.body, current.completedChunks, catalogByChunk);
  const unitPlan = projectKnowledgePlan(current.plan, basisInput);
  outcome.reviewBasis = {
    units: [
      ...basisInput.factUnits.map((unit) => ({ unit, kind: 'fact' as const })),
      ...basisInput.questionUnits.map((unit) => ({ unit, kind: 'question' as const })),
    ].map(({ unit, kind }) => {
      const records = (kind === 'fact' ? facts : questions).filter((record) => unit.memberIds.includes(record.id));
      const context = basisInput.sourceContexts.find((c) => c.id === unit.sourceId)!;
      const range = mediaRange(context.start, context.end);
      return {
        id: unit.id,
        kind,
        origin: 'kb02' as const,
        text: unit.text,
        memberIds: [...unit.memberIds],
        sourceId: evidenceSourceId(range.start, range.end, range.media),
        ...range,
        ...(unit.kind ? { factKind: unit.kind } : {}),
        records: records.map((r) => ({ id: r.id, text: r.text, evidenceIds: [...r.locatorIds] })),
        evidence: [...new Set(records.flatMap((r) => r.locatorIds))].map((id) => {
          const evidence = evidenceById.get(id)!;
          return { ...evidence, ...mediaRange(evidence.start, evidence.end) };
        }),
      };
    }),
    pageUnitIds: unitPlan.pages.map((p) => [...p.factUnitIds, ...p.questionUnitIds]),
  };
  assertNoKnownSecret(outcome, input.provider.secrets ?? []);
  return { outcome, checkpoint: current };
}
