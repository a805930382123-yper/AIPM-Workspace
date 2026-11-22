import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type { WikiRecord, WikiStore } from './store.ts';
export async function assertWikiSourcesAllowed(
  wiki: Pick<WikiStore, 'get'>,
  raws: { get(id: string): Promise<unknown> },
  page: WikiRecord,
  seen = new Set<string>(),
): Promise<void> {
  if (seen.has(page.id)) return;
  seen.add(page.id);
  for (const id of knowledgeRoots(page).rawIds) {
    const raw = await raws.get(id);
    if (!raw) throw Object.assign(Error('底层原始来源已缺失。'), { code: 'KNOWLEDGE_SOURCE_MISSING', status: 409 });
    assertRawNotMeeting(raw);
  }
  for (const id of new Set(
    [...(page.answerDerivations ?? []), ...(page.inspectionDerivations ?? [])].flatMap((d) => d.wikiIds),
  )) {
    const source = await wiki.get(id);
    if (!source)
      throw Object.assign(Error('派生知识的依据页不存在，已拒绝问答处理。'), {
        code: 'KNOWLEDGE_SOURCE_MISSING',
        status: 409,
      });
    await assertWikiSourcesAllowed(wiki, raws, source, seen);
  }
}
export function knowledgeRoots(page: WikiRecord): { rawIds: string[]; manualWikiIds: string[] } {
  const rawIds = [
    ...new Set([
      ...page.sources,
      ...(page.pdfDerivations ?? []).map((item) => item.rawId),
      ...[...(page.answerDerivations ?? []), ...(page.inspectionDerivations ?? [])].flatMap((item) => item.rawIds),
    ]),
  ];
  const manualWikiIds =
    page.answerDerivations?.length || page.inspectionDerivations?.length
      ? [
          ...new Set(
            [...(page.answerDerivations ?? []), ...(page.inspectionDerivations ?? [])].flatMap(
              (item) => item.manualWikiIds,
            ),
          ),
        ]
      : rawIds.length
        ? []
        : [page.id];
  return { rawIds, manualWikiIds };
}
