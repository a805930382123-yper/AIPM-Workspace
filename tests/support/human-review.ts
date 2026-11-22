import { DraftStore } from '../../services/wiki/drafts.ts';
import type { KnowledgeWorkflowStore } from '../../services/wiki/knowledge-workflows.ts';
import type { WikiCommitService } from '../../services/wiki/commits.ts';
import type { RawStore } from '../../services/raw/store.ts';
import { randomUUID } from 'node:crypto';

/** Explicit per-page test actions, never a production bulk approval API. */
export async function approveDraft(store: DraftStore, id: string, body: string) {
  let draft = (await store.get(id))!;
  draft = await store.reviewOperation(
    id,
    { action: 'start', baseRevision: draft.revision },
    { body, rulesDir: 'rules' },
  );
  for (const page of draft.pages)
    draft = await store.reviewOperation(
      id,
      {
        action: 'page',
        baseRevision: draft.revision,
        pageId: page.pageId,
        reviewContentDigest: store.contentDigest(draft),
        confirmed: true,
      },
      { body, rulesDir: 'rules' },
    );
  return draft;
}
export async function approveWorkflow(store: KnowledgeWorkflowStore, id: string) {
  let record = (await store.get(id))!;
  record = await store.reviewOperation(id, { action: 'start', baseRevision: record.revision });
  return store.reviewOperation(id, {
    action: 'page',
    baseRevision: record.revision,
    pageId: id,
    reviewContentDigest: store.contentDigest(record),
    confirmed: true,
  });
}

/** Old business tests still exercise their original transaction assertions after performing
 * the newly required user actions. New HUMAN tests use the unwrapped production service. */
export function addLegacyReviewPrecondition(commits: WikiCommitService, drafts: DraftStore, raws: RawStore) {
  const original = commits.confirm.bind(commits);
  commits.confirm = async (input) => {
    const record = await drafts.get(input.draftId);
    if (
      record?.status === 'pending_confirmation' &&
      record.revision === input.baseRevision &&
      input.selectedPageIds.length &&
      input.selectedPageIds.every((id) => record.pages.some((p) => p.pageId === id))
    ) {
      const raw = await raws.get(record.rawId);
      if (raw && raw.bodySha256 === record.rawSha256) {
        const reviewed = await approveDraft(drafts, record.id, raw.body);
        input = { ...input, baseRevision: reviewed.revision };
      }
    }
    return original(input);
  };
}
/** Replace a former simplified update fixture with a real persisted, individually reviewed
 * draft. It retains each fixture's exact facts, repeated evidence positions and questions. */
export async function persistedUpdateInput(root: string, raw: any, input: any) {
  const store = new DraftStore(root);
  await store.initialize();
  const old = await store.get(input.id);
  if (old) return approveDraft(store, old.id, raw.body);
  const schema = await import('../../services/llm/rules.ts').then((m) => m.loadExtractionRules('rules'));
  const pages = input.pages.map((page: any) => ({
    title: page.title ?? raw.title,
    type: page.type ?? 'metric',
    category: page.category ?? 'metric',
    one_line_definition: page.one_line_definition ?? page.title ?? raw.title,
    source_facts: page.source_facts,
    source_evidence: page.source_evidence.map((e: any) => ({ ...e, chunkIndex: e.chunkIndex ?? -1, occurrences: 1 })),
    open_questions: page.open_questions ?? [],
    ai_organized: page.ai_organized ?? [],
    ai_inferences: page.ai_inferences ?? [],
    related_pages: page.related_pages ?? [],
    provenance: page.provenance ?? [],
  }));
  const draft = await store.create({
    raw,
    body: raw.body,
    jobId: randomUUID(),
    rules: {
      types: schema.fmcg.types.map((t) => t.id),
      categories: schema.fmcg.categories.map((c) => c.id),
      ...schema.fmcg.enums,
    } as any,
    outcome: {
      document: { title: raw.title, main_topic: raw.title, summary: raw.title },
      pages,
      rulesVersion: 'legacy-test-fixture',
      provider: { name: 'fake', model: 'fixture' },
      callCount: 0,
      chunkCount: 1,
      chunkCoverage: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
    },
  });
  return approveDraft(store, draft.id, raw.body);
}
