import { randomUUID } from 'node:crypto';
import { deepFixture } from './kb03-deep-fixture.ts';
import { approveDraft } from './human-review.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { WikiCommitService } from '../../services/wiki/commits.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import type { DraftRecord } from '../../services/wiki/drafts.ts';
export async function confirmFixture() {
  const f = await deepFixture();
  const original = f.provider.complete;
  f.provider.complete = async (request) => {
    const result = await original(request);
    if (request.user.includes('请对下列全部已验证事实规划知识页')) {
      const v = JSON.parse(result.text),
        p = v.pages[0];
      v.document.title = '虚构业务来源';
      v.pages = [
        { ...p, title: '门店范围', factUnitIds: p.factUnitIds.slice(0, 1) },
        { ...p, title: '在售口径', factUnitIds: p.factUnitIds.slice(1), questionUnitIds: [] },
      ];
      return { ...result, text: JSON.stringify(v) };
    }
    return result;
  };
  const started = await f.start(),
    runtime = await f.wait(started.json.jobId);
  if (runtime.job?.status !== 'completed') throw Error(JSON.stringify(runtime));
  const wiki = new WikiStore(f.root, f.rawStore);
  await wiki.initialize();
  const commits = new WikiCommitService({
    root: f.root,
    wikiStore: wiki,
    drafts: f.drafts,
    rawStates: f.rawStates,
    rawStore: f.rawStore,
  });
  await commits.initialize();
  const d = (await f.drafts.get(runtime.job.draftId!))!,
    b = await loadExtractionRules('rules');
  const rules = { types: ['metric'], categories: ['metric', 'other'], ...b.fmcg.enums } as any;
  const input = (draft: DraftRecord) => ({
    draftId: draft.id,
    baseRevision: draft.revision,
    selectedPageIds: draft.pages.filter((p) => p.selected).map((p) => p.pageId),
    idempotencyKey: randomUUID(),
    operationId: randomUUID(),
    now: new Date().toISOString(),
  });
  const review = async (selected: number[] = []) => {
    let current = (await f.drafts.get(d.id))!;
    current = await f.drafts.patch(
      current.id,
      {
        baseRevision: current.revision,
        pages: current.pages.map((p, i) => ({ pageId: p.pageId, selected: selected.includes(i) })),
      },
      { body: f.raw.body, rules },
    );
    current = await approveDraft(f.drafts, current.id, f.raw.body);
    return f.drafts.reviewStructuredNote(
      current.id,
      {
        baseRevision: current.revision,
        reviewContentDigest: f.drafts.contentDigest(current),
        warningsAcknowledged: true,
        historicalReportAcknowledged: true,
      },
      f.raw.body,
    );
  };
  return { ...f, d, wiki, commits, rules, input, review };
}
