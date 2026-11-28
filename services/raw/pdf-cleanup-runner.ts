import { completedModel, continuationInstruction, recordCompletedModels } from '../llm/checkpoint-models.ts';
import { assertNoKnownSecret, LlmError, type LlmProvider } from '../llm/provider.ts';
import { validateSchema } from '../llm/schema-validator.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { pdfPageUnits, type PdfUnit } from '../wiki/pdf-input.ts';
import {
  adjacentPdfTextLines,
  confirmedPdfPageLabels,
  longWritingBatches,
  PdfWritingError,
  pdfWritingLayout,
  readWriting,
  writingFormat,
  type WritingRequest,
  type WritingResult,
} from './pdf-topic-writing.ts';
import {
  LONG_REVISION,
  DIRECTORY_REVISION,
  PROMPT_REVISION,
  MAX_TOPICS,
  DIRECTORY_EXCERPT_CHARS,
  DIRECTORY_BYTES,
  type Decision,
  type Assignment,
  type Job,
  completedBlocks,
  type CleanupInput,
  type WireUnit,
  type IndexBasis,
  type ShapeRequest,
  type PresentationMapping,
  isObject,
  topicIssue,
  finalTitleIssue,
  nameKey,
  CleanupError,
  type PdfCleanupRunnerContext,
} from './pdf-cleanup-types.ts';
import {
  DIRECTORY_SYSTEM,
  DIRECTORY_WRITING_NUMBERS,
  CLEANUP_SYSTEM,
  LONG_INDEX_SYSTEM,
  SHORT_INDEX_SYSTEM,
  LONG_WRITING_SYSTEM,
  SHORT_WRITING_SYSTEM,
  PRESENTATION_SYSTEM,
} from './pdf-cleanup-prompts.ts';
import {
  responseSchemas,
  shapeError,
  checkedSchemaError,
  keyedResponse,
  decodeKeyed,
  unknownFieldPath,
  decisionIssue,
  assertUniqueSlots,
} from './pdf-cleanup-schemas.ts';
import {
  validateBatch,
  decisionsFor,
  writingPlan,
  displayFor,
  indexRequest,
  presentationBatches,
  checkedPresentation,
  verifyPresentation,
} from './pdf-cleanup-planner.ts';

export async function runPdfCleanupJob(
  ctx: PdfCleanupRunnerContext,
  input: CleanupInput,
  job: Job,
  batches: WireUnit[][],
  provider: LlmProvider,
  controller: AbortController,
): Promise<void> {
  const rawId = input.raw.id;
  const signal = controller.signal;
  const long = (job.promptRevision ?? 1) >= LONG_REVISION;
  const directory = job.promptRevision === DIRECTORY_REVISION;
  const continuing = completedBlocks(job).length > 0;
  let pageLabels: ReturnType<typeof confirmedPdfPageLabels> | undefined;
  let nextTextLine: ReturnType<typeof adjacentPdfTextLines> | undefined;
  let layout: ReturnType<typeof pdfWritingLayout> | undefined;
  let writingMembers: ReturnType<typeof longWritingBatches>['members'] | undefined;
  const request = async <T>(system: string, payload: ShapeRequest | WritingRequest) => {
    const format = payload.stage === 'pdf_topic_write' ? undefined : keyedResponse(payload);
    if (directory && payload.stage === 'pdf_topic_write') system += DIRECTORY_WRITING_NUMBERS;
    if (continuing) system += continuationInstruction;
    const user = JSON.stringify(payload);
    if (
      payload.stage === 'pdf_topic_directory' &&
      Buffer.byteLength(
        JSON.stringify({
          model: provider.model,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: { ...format!.wire, strict: true } },
        }),
      ) > DIRECTORY_BYTES
    ) {
      throw new CleanupError('PDF_CLEANUP_DIRECTORY_LIMIT', '全部标签及导航超出全局目录请求容量。', 422);
    }
    assertNoKnownSecret(payload, provider.secrets);
    await ctx.queue.run(async () => {
      signal.throwIfAborted();
      const raw = await ctx.deps.raws.get(rawId);
      assertRawNotMeeting(raw);
      if (!raw || raw.bodySha256 !== input.raw.bodySha256 || raw.assetSha256 !== input.binding.assetSha256) {
        throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '整理期间原件或原文已变化。');
      }
      job.status = 'running';
      job.attempts++;
      await ctx.save(rawId, job);
    });
    signal.throwIfAborted();
    const structuredOutput = payload.stage === 'pdf_topic_write' ? writingFormat(payload, long) : format!.wire;
    const result = await provider.complete({
      purpose: 'knowledge',
      system,
      user,
      structuredOutput,
      timeoutMs: payload.stage === 'pdf_cleanup' ? 120_000 : 60_000,
      maxOutputBytes: 128 * 1024,
      signal,
    });
    signal.throwIfAborted();
    if (result.finishReason === 'length') throw new CleanupError('PDF_CLEANUP_TRUNCATED', '整理模型结果被截断。', 502);
    assertNoKnownSecret(result.text, provider.secrets);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new CleanupError('PDF_CLEANUP_JSON', '整理模型未返回有效 JSON。', 502);
    }
    assertNoKnownSecret(parsed, provider.secrets);
    const { stage } = payload;
    const withModel = (value: unknown) => ({ value: value as T, model: completedModel(provider, result) });
    if (stage === 'pdf_topic_write')
      return withModel(
        readWriting(payload, parsed, result.text, pageLabels, nextTextLine, writingMembers, layout, directory),
      );
    const keyed = format!;
    if (stage === 'pdf_presentation' || stage === 'pdf_topic_directory') {
      const decoded = decodeKeyed(stage, parsed, keyed, result.structuredOutputApplied === true);
      assertUniqueSlots(stage, keyed.field, result.text);
      return withModel(decoded);
    }
    if (result.structuredOutputApplied || !isObject(parsed) || !Array.isArray(parsed[keyed.field])) {
      return withModel(decodeKeyed(stage, parsed, keyed, result.structuredOutputApplied === true));
    }
    // Providers without strict support may still return the earlier business array.
    const schema = responseSchemas[stage];
    const unknown = unknownFieldPath(parsed, schema);
    if (unknown) throw shapeError(stage, unknown, 'unknown_field');
    const [issue] = validateSchema(parsed, schema);
    if (issue) throw checkedSchemaError(stage, issue);
    return withModel(parsed);
  };
  try {
    for (const units of batches.slice(job.batches.length)) {
      const { value, model } = await request<{ decisions: Decision[] }>(CLEANUP_SYSTEM, {
        stage: 'pdf_cleanup',
        units,
      });
      for (const [i, item] of value.decisions.entries()) {
        const issue = decisionIssue(item);
        if (issue) throw shapeError('pdf_cleanup', '$.decisions[' + i + '].' + issue[0], issue[1]);
        if (item.topic !== undefined) item.topic = item.topic.trim();
      }
      const checked = validateBatch(units, value.decisions, 'provider');
      const byId = new Map(checked.map((item) => [item.id, item]));
      const decisions = units.map((unit) => byId.get(unit.id)!);
      await ctx.queue.run(async () => {
        signal.throwIfAborted();
        job.completedModels = recordCompletedModels(job.completedModels, `cleanup-${job.batches.length}`, [model]);
        job.batches.push(decisions);
        await ctx.save(rawId, job);
      });
    }
    job.stage = 'indexing';
    const units = batches.flat();
    const display = long ? undefined : displayFor(job, units);
    if (display && !job.fragments) {
      await ctx.queue.run(async () => {
        signal.throwIfAborted();
        job.fragments = display.locations;
        await ctx.save(rawId, job);
      });
    }
    const indexItems =
      display?.items ?? decisionsFor({ ...job, index: [] }, units).map((item) => ({ ...item, indexKey: item.topic }));
    const labels = [...new Set(indexItems.flatMap((item) => (item.indexKey ? [item.indexKey] : [])))];
    const samples = new Map<string, IndexBasis>();
    const pageRanges = new Map<string, { startPage: number; endPage: number }>();
    const substantive = (sample: WireUnit) => ['content', 'visuals'].includes(sample.kind);
    for (const { id, page, text, origin, kind, unitId, start, end, indexKey, topic, decision } of indexItems) {
      if (!indexKey) continue;
      if (directory) {
        const range = pageRanges.get(indexKey);
        if (range) {
          range.startPage = Math.min(range.startPage, page);
          range.endPage = Math.max(range.endPage, page);
        } else pageRanges.set(indexKey, { startPage: page, endPage: page });
      }
      if (decision !== 'keep') continue;
      const sample: WireUnit = { id, page, text, origin, kind, ...(unitId ? { unitId, start, end } : {}) };
      const current = samples.get(indexKey)?.samples[0];
      if (
        !current ||
        (substantive(sample) && !substantive(current)) ||
        (substantive(sample) === substantive(current) && text.length > current.text.length)
      ) {
        samples.set(indexKey, { topic: indexKey, samples: [sample], ...(unitId ? { suggestedTopic: topic } : {}) });
      }
    }
    if (
      job.index.some((item, i) => item.topic !== labels[i]) ||
      (((directory && job.index.length > 0) || job.reusedIndexEntries !== undefined) &&
        job.index.length !== labels.length)
    ) {
      throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '主题检查点与整理批次不匹配。');
    }
    while (job.index.length < labels.length) {
      const payload: Extract<ShapeRequest, { stage: 'pdf_topic_directory' | 'pdf_topic_index' }> = directory
        ? {
            stage: 'pdf_topic_directory',
            topics: labels.map((label, i) => {
              const { page, origin, kind, text } = samples.get(label)!.samples[0];
              return {
                id: 't' + (i + 1),
                label,
                ...pageRanges.get(label)!,
                sample: { page, origin, kind, excerpt: Array.from(text).slice(0, DIRECTORY_EXCERPT_CHARS).join('') },
              };
            }),
          }
        : indexRequest(labels, job.index.length, job.index, samples);
      const { stage } = payload;
      const topics = stage === 'pdf_topic_directory' ? payload.topics.map((topic) => topic.id) : payload.topics;
      const { value, model } = await request<{ assignments: Assignment[] }>(
        directory ? DIRECTORY_SYSTEM : long ? LONG_INDEX_SYSTEM : SHORT_INDEX_SYSTEM,
        payload,
      );
      const lookup = new Map<string, string>();
      for (const [i, { topic: inputTopic, title }] of value.assignments.entries()) {
        const field = '$.assignments[' + i + ']';
        const labelError = topicIssue(inputTopic);
        if (labelError) throw shapeError(stage, field + '.topic', labelError);
        const titleError = finalTitleIssue(title);
        if (titleError) throw shapeError(stage, field + '.title', titleError);
        const topic = inputTopic.trim();
        if (!topics.includes(topic)) throw shapeError(stage, field + '.topic', 'unknown_topic');
        if (lookup.has(topic)) throw shapeError(stage, field + '.topic', 'duplicate_topic');
        lookup.set(topic, title);
      }
      if (lookup.size !== topics.length) throw shapeError(stage, '$.assignments', 'missing_topic');
      const names = new Map(job.index.map(({ title }) => [nameKey(title), title]));
      const indexed = topics.map((id, i) => {
        const proposed = lookup.get(id)!;
        const key = nameKey(proposed);
        const title = names.get(key) ?? proposed;
        names.set(key, title);
        return { topic: stage === 'pdf_topic_directory' ? payload.topics[i].label : id, title };
      });
      if (names.size > MAX_TOPICS)
        throw new CleanupError('PDF_CLEANUP_TOPIC_LIMIT', '本范围主题数超过现有草稿容量，请选择较小页范围。', 422);
      await ctx.queue.run(async () => {
        signal.throwIfAborted();
        Object.assign(
          (job.completedModels ??= {}),
          Object.fromEntries(indexed.map((_, index) => [`index-${job.index.length + index}`, [model]])),
        );
        job.index.push(...indexed);
        await ctx.save(rawId, job);
      });
    }
    job.stage = 'assembling';
    const items = long ? decisionsFor(job, units) : displayFor(job, units).items;
    if (long || job.promptRevision === PROMPT_REVISION) {
      pageLabels = confirmedPdfPageLabels(items);
      layout = long ? pdfWritingLayout(items) : undefined;
      nextTextLine = adjacentPdfTextLines(pdfPageUnits(input), input.raw.body);
      const { requests, members } = writingPlan(job, items);
      writingMembers = members;
      const results = (job.writing ??= []);
      if (results.length > requests.length) throw new PdfWritingError('checkpoint_mismatch');
      results.forEach((result, index) =>
        readWriting(requests[index], result, undefined, pageLabels, nextTextLine, members, layout, directory),
      );
      for (const payload of requests.slice(results.length)) {
        const { value, model } = await request<WritingResult>(
          long ? LONG_WRITING_SYSTEM : SHORT_WRITING_SYSTEM,
          payload,
        );
        await ctx.queue.run(async () => {
          signal.throwIfAborted();
          job.completedModels = recordCompletedModels(job.completedModels, `writing-${results.length}`, [model]);
          results.push(value);
          await ctx.save(rawId, job);
        });
      }
    } else {
      const displayBatches = presentationBatches(items);
      verifyPresentation(job, displayBatches);
      const presentation = (job.presentation ??= { completedBatches: 0, groups: [], parallel: [] });
      const rawUnits = new Map(
        pdfPageUnits(input)
          .filter((unit): unit is PdfUnit & { kind: 'text' } => unit.kind === 'text')
          .map((unit) => [unit.unitId, unit]),
      );
      for (const batch of displayBatches.slice(presentation.completedBatches)) {
        const { value, model } = await request<{ presentation: PresentationMapping[] }>(PRESENTATION_SYSTEM, {
          stage: 'pdf_presentation',
          units: batch,
        });
        const { groups, parallel } = checkedPresentation(batch, value.presentation, input.raw.body, rawUnits);
        await ctx.queue.run(async () => {
          signal.throwIfAborted();
          job.completedModels = recordCompletedModels(
            job.completedModels,
            `presentation-${presentation.completedBatches}`,
            [model],
          );
          presentation.groups.push(...groups);
          presentation.parallel.push(...parallel);
          presentation.completedBatches++;
          await ctx.save(rawId, job);
        });
      }
    }
    const current = await ctx.deps.pdf.cleanupInput(rawId, input.binding.startPage, input.binding.endPage);
    ctx.assertBasis(current, job);
    await ctx.queue.run(async () => {
      signal.throwIfAborted();
      job.status = 'completed';
      job.stage = 'done';
      await ctx.save(rawId, job);
    });
  } catch (error) {
    if (signal.aborted) return;
    await ctx.queue.run(async () => {
      if (signal.aborted) return;
      job.status = 'failed';
      job.error =
        error instanceof CleanupError
          ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
          : error instanceof PdfWritingError
            ? {
                code: error.code,
                message: error.message,
                details: { stage: 'pdf_topic_write', path: '$.topics', reason: error.reason },
              }
            : error instanceof LlmError
              ? { code: error.code, message: '模型请求失败，已保存此前完成的批次。' }
              : { code: 'PDF_CLEANUP_FAILED', message: '整理未完成，已保存此前完成的批次。' };
      await ctx.save(rawId, job);
    });
  }
}
