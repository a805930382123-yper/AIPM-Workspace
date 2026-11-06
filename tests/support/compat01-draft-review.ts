import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DraftRecord, DraftStore } from '../../services/wiki/drafts.ts';
import { maintenanceDigest } from '../../services/wiki/maintenance.ts';

/** Act on the fixture's explicit selection through the same per-item commands as the UI. */
export async function reviewSelectedChanges(store: DraftStore, draft: DraftRecord, pageIds: string[]) {
  assert(draft.maintenance);
  const chosen = draft.maintenance.changes.filter(change => pageIds.includes(draft.pages[change.pageIndex].pageId));
  assert.equal(chosen.length, pageIds.length);
  let reviewed = draft;
  for (const { changeId } of chosen) {
    reviewed = await store.reviewChange(draft.id, { baseRevision: reviewed.revision, changeId, decision: 'accept' });
    reviewed = await store.reviewChange(draft.id, { baseRevision: reviewed.revision, changeId, confirmed: true, digest: maintenanceDigest(reviewed, changeId) });
  }
  return reviewed;
}

/** Seed the historical persisted shape for tests of legacy-only merge or Source reuse behavior. */
export async function historicalB04Draft(root: string, draft: DraftRecord): Promise<DraftRecord> {
  const { maintenance, ...historical } = draft;
  assert(maintenance);
  await writeFile(path.join(root, 'drafts', draft.id + '.json'), JSON.stringify(historical));
  return historical;
}
