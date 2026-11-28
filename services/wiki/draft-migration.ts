import { RawStore } from '../raw/store.ts';
import { createHash } from 'node:crypto';
import {
  assertReviewStructure,
  newHumanReview,
  type HumanReview,
  type ReviewBasis,
  type ReviewUnit,
} from './human-review.ts';
import { ExtractionCheckpointStore } from '../llm/checkpoints.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../llm/rules.ts';
import {
  DraftError,
  type DraftRecord,
  type KnowledgeDraftRecord,
  type DraftPage,
  type DraftEvidence,
} from './draft-types.ts';

export type DraftMigrationContext = {
  root: string;
  reviewFromBasis: typeof reviewFromBasis;
  legacyReview: typeof buildLegacyReview;
};

export function reviewFromBasis(record: DraftRecord, basis: ReviewBasis): HumanReview {
  if (basis.pageUnitIds.length !== record.pages.length)
    throw new DraftError('REVIEW_BASIS_INVALID', '审查页与来源目录不一致。', 409);
  const refs = basis.pageUnitIds.flat();
  if (
    refs.length !== basis.units.length ||
    new Set(refs).size !== refs.length ||
    basis.units.some((u) => !refs.includes(u.id))
  )
    throw new DraftError('REVIEW_BASIS_INVALID', '审查 unit 必须完整且唯一归属。', 409);
  return newHumanReview(
    basis.units,
    Object.fromEntries(basis.pageUnitIds.flatMap((ids, i) => ids.map((id) => [id, record.pages[i].pageId]))),
  );
}

export function buildLegacyReview(record: DraftRecord): HumanReview {
  const units: ReviewUnit[] = [],
    owners: Record<string, string> = {};
  for (const page of record.pages)
    for (const kind of ['fact', 'question'] as const) {
      const entries =
        kind === 'fact'
          ? page.source_facts.map((f) => ({ text: f.text, evidenceIds: f.evidenceIds }))
          : page.open_questions.map((text) => ({ text, evidenceIds: [] as string[] }));
      entries.forEach((entry, i) => {
        const id = `legacy-${page.pageId}-${kind}-${i + 1}`;
        units.push({
          id,
          kind,
          origin: 'legacy',
          text: entry.text,
          memberIds: [],
          records: [{ id, text: entry.text, evidenceIds: [...entry.evidenceIds] }],
          evidence: page.source_evidence.filter((e) => entry.evidenceIds.includes(e.id)).map((e) => ({ ...e })),
          sourceLabel: kind === 'question' ? '旧记录无原文定位' : '旧草稿原有事实，非原模型 fact ID',
        });
        owners[id] = page.pageId;
      });
    }
  return newHumanReview(units, owners);
}

export async function migrateDraftReview(
  ctx: DraftMigrationContext,
  record: DraftRecord,
  body: string,
  rulesDir: string,
): Promise<HumanReview> {
  const cp = await new ExtractionCheckpointStore(ctx.root).get(record.jobId);
  if (
    cp &&
    cp.rawId === record.rawId &&
    cp.rawSha256 === record.rawSha256 &&
    cp.jobId === record.jobId &&
    cp.draftId === record.id &&
    cp.plan &&
    cp.stage === 'done' &&
    cp.attempts === record.extraction.callCount
  ) {
    const bundle = await loadExtractionRules(rulesDir);
    const provider = {
      ...record.provider,
      complete: async () => {
        throw new DraftError('MIGRATION_OUTBOUND_FORBIDDEN', '旧草稿迁移不得调用模型。', 500);
      },
    };
    const rawStore = new RawStore(ctx.root);
    const raw = cp.mediaInputSha256 ? await rawStore.get(record.rawId) : undefined;
    const content = raw ? await rawStore.buildMediaInput(raw) : undefined;
    const args = {
      raw: { ...record.rawMeta, id: record.rawId, tags: [] },
      body: content?.body ?? body,
      content,
      bodySha256: record.rawSha256,
      provider,
      rulesDir,
      checkpoint: { ...cp, rulesVersion: bundle.rulesVersion },
    };
    await validateKnowledgeCheckpoint(args, {
      rulesVersion: record.rulesVersion,
      callCount: record.extraction.callCount,
    });
    const result = await runKnowledgePipeline({
      ...args,
      beforeCall: async () => {
        throw new DraftError('MIGRATION_OUTBOUND_FORBIDDEN', '旧草稿迁移不得调用模型。', 500);
      },
      saveCheckpoint: async (value) => ({ ...value, integrity: cp.integrity }),
    });
    const projection = (
      p: Pick<DraftPage, 'title' | 'type' | 'category' | 'source_facts' | 'open_questions' | 'source_evidence'>,
    ) => ({
      title: p.title,
      type: p.type,
      category: p.category,
      source_facts: p.source_facts,
      open_questions: p.open_questions,
      source_evidence: p.source_evidence.map(({ id, rawId, quote, start, end, chunkIndex, media }) => ({
        id,
        rawId,
        quote,
        start,
        end,
        chunkIndex,
        ...(media ? { media } : {}),
      })),
    });
    if (
      JSON.stringify(result.outcome.pages.map(projection)) === JSON.stringify(record.pages.map(projection)) &&
      result.outcome.reviewBasis
    )
      return ctx.reviewFromBasis(record, result.outcome.reviewBasis);
  }
  return ctx.legacyReview(record);
}

export function deriveReviewPages(record: KnowledgeDraftRecord, rebindFields = false) {
  if (!record.humanReview) return;
  assertReviewStructure(
    record.humanReview,
    record.pages.map((p) => p.pageId),
  );
  for (const page of record.pages) {
    const units = record.humanReview.units.filter((u) => record.humanReview!.assignments[u.id] === page.pageId);
    const facts = units.filter((u) => u.kind === 'fact'),
      questions = units.filter((u) => u.kind === 'question');
    const evidence: DraftEvidence[] = [],
      aliases = new Map<string, Map<string, string>>();
    for (const unit of units) {
      const map = new Map<string, string>();
      for (const item of unit.evidence) {
        let id = item.id;
        const old = evidence.find((e) => e.id === id);
        if (
          old &&
          (old.rawId !== item.rawId || old.start !== item.start || old.end !== item.end || old.quote !== item.quote)
        )
          id = `${id.slice(0, 44)}-review-${createHash('sha256')
            .update(JSON.stringify([item.rawId, item.start, item.end, item.quote]))
            .digest('hex')
            .slice(0, 12)}`;
        map.set(item.id, id);
        if (!evidence.some((e) => e.id === id)) evidence.push({ ...item, id });
      }
      aliases.set(unit.id, map);
    }
    page.source_facts = facts.flatMap((u) =>
      u.records.map((r) => ({
        text: r.text,
        evidenceIds: r.evidenceIds.map((id) => aliases.get(u.id)?.get(id) ?? id),
      })),
    );
    page.open_questions = [
      ...questions.flatMap((u) => u.records.map((r) => r.text)),
      ...facts
        .filter((u) => u.factKind === 'ambiguous')
        .flatMap((u) => u.records.map((r) => '原文口径或边界待确认：' + r.text)),
      ...facts.filter((u) => record.humanQuestionUnitIds?.includes(u.id)).map((u) => '人工标记待确认：' + u.text),
    ];
    const previousEvidence = page.source_evidence;
    page.source_evidence = evidence;
    for (const field of Object.values(page.templateFields ?? {})) {
      if (rebindFields)
        field.evidenceIds = field.evidenceIds.map((id) => {
          const old = previousEvidence.find((e) => e.id === id);
          return old
            ? (evidence.find(
                (e) => e.rawId === old.rawId && e.start === old.start && e.end === old.end && e.quote === old.quote,
              )?.id ?? id)
            : id;
        });
      const ai = field.aiContent;
      if (!ai) continue;
      const references = ai.factIds.map((id) => {
        const unit = facts.find((u) => u.records.some((r) => r.id === id));
        return unit
          ? unit.records.find((r) => r.id === id)!.evidenceIds.map((ref) => aliases.get(unit.id)?.get(ref) ?? ref)
          : undefined;
      });
      if (references.every((ids): ids is string[] => ids !== undefined))
        ai.evidenceIds = [...new Set(references.flat())];
    }
  }
}
