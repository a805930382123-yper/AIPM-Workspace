import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MAINTENANCE_LIMITS } from '../../llm/knowledge-maintenance.ts';
import type { KnowledgeInspection, KnowledgeInspectionService } from '../../llm/knowledge-inspections.ts';
import { SourcePolicyError } from '../../meeting/source-policy.ts';
import type { RawStore } from '../../raw/store.ts';
import { readJsonRecord, StorageError } from '../../storage/files.ts';
import { assertWikiSourcesAllowed } from '../../wiki/source-lineage.ts';
import type { WikiRecord, WikiStore } from '../../wiki/store.ts';
import { runIdPattern } from '../ledger.ts';
import { AutomationCheckError, type TaskDefinition } from '../scheduler.ts';

export const wikiInspectType = 'wiki.inspect';
type InspectionBaseline = Pick<KnowledgeInspection, 'createdAt' | 'readWiki'>;
type SkippedPage = KnowledgeInspection['scope']['skipped'][number];

export function selectInspectionPages(eligiblePages: WikiRecord[], prior: InspectionBaseline | undefined, changedSources: ReadonlySet<string>) {
  const priorPages = new Map(prior?.readWiki.map(page => [page.id, page.revision]));
  const ranked = eligiblePages.map(page => {
    const revision = priorPages.get(page.id);
    const changed = prior && (revision !== undefined ? revision !== page.revision : page.updated > prior.createdAt);
    return { page, priority: changedSources.has(page.id) ? 0 : changed ? 1 : 2 };
  }).sort((a, b) => a.priority - b.priority || b.page.updated.localeCompare(a.page.updated) || a.page.id.localeCompare(b.page.id));

  const selected: WikiRecord[] = [], skipped: SkippedPage[] = [];
  for (const { page } of ranked) {
    if (selected.length >= MAINTENANCE_LIMITS.pages) skipped.push({ id: page.id, reason: '已达到 8 页上限' });
    else if (JSON.stringify([...selected, page]).length > MAINTENANCE_LIMITS.characters) skipped.push({ id: page.id, reason: '超出 48,000 JSON 字符上限' });
    else selected.push(page);
  }
  return { wikiIds: selected.map(page => page.id), skipped };
}

type SourceSnapshot = { readWiki: Array<Pick<WikiRecord, 'id' | 'revision'>> };
function isSourceSnapshot(value: unknown): value is SourceSnapshot {
  return !!value && typeof value === 'object' && 'readWiki' in value && Array.isArray(value.readWiki)
    && value.readWiki.every(page => page && typeof page.id === 'string' && Number.isInteger(page.revision));
}

async function sourceChanges(root: string, eligible: WikiRecord[], all: WikiRecord[], prior: InspectionBaseline | undefined, signal: AbortSignal) {
  const current = new Map(all.map(page => [page.id, page.revision]));
  const last = new Map(prior?.readWiki.map(page => [page.id, page.revision]));
  const snapshots = new Map<string, SourceSnapshot | undefined>();
  const changed = new Set<string>();
  for (const page of eligible) {
    signal.throwIfAborted();
    const refs = [
      ...(page.answerDerivations ?? []).map(item => ({ dir: 'knowledge-answers', id: item.answerId, wikiIds: item.wikiIds })),
      ...(page.inspectionDerivations ?? []).map(item => ({ dir: 'knowledge-inspections', id: item.inspectionId, wikiIds: item.wikiIds })),
    ];
    for (const ref of refs) {
      if (!runIdPattern.test(ref.id)) continue;
      const file = path.join(root, 'state', ref.dir, `${ref.id}.json`);
      if (!snapshots.has(file)) {
        snapshots.set(file, await readJsonRecord(root, file, isSourceSnapshot).catch(error => {
          if (error instanceof StorageError) return undefined;
          throw error;
        }));
      }
      if (snapshots.get(file)?.readWiki.some(source => {
        const revision = current.get(source.id);
        const previousRevision = last.get(source.id) ?? source.revision;
        return source.id !== page.id && ref.wikiIds.includes(source.id) && revision !== undefined && revision !== previousRevision;
      })) {
        changed.add(page.id);
        break;
      }
    }
  }
  return changed;
}

export function createWikiInspect(wiki: WikiStore, raws: RawStore, inspections: KnowledgeInspectionService): TaskDefinition {
  return {
    type: wikiInspectType, name: '知识库主动巡检',
    defaultPlan: { kind: 'weekly', weekday: 1, time: '08:30', timezone: 'Asia/Shanghai' }, allowsCatchUp: true, mayCallModel: true,
    async execute({ signal, provider, step, link }) {
      let wikiIds: string[] = [];
      const skipped: SkippedPage[] = [];
      const gaps: string[] = [];
      await step('选择主动巡检范围', async () => {
        const pages = await wiki.allRecords();
        const topics = pages.filter(page => page.type !== 'source');
        const eligible: WikiRecord[] = [];
        for (const page of topics) {
          signal.throwIfAborted();
          try {
            await assertWikiSourcesAllowed(wiki, raws, page);
            eligible.push(page);
          } catch (error) {
            const reason = error instanceof SourcePolicyError ? '会议来源受限' : error instanceof Error && 'code' in error
              && error.code === 'KNOWLEDGE_SOURCE_MISSING' ? '底源或依据页缺失' : '来源无法核验';
            skipped.push({ id: page.id, reason });
          }
        }
        if (eligible.length) {
          const prior = await inspections.latestCompleted();
          const changed = await sourceChanges(wiki.root, eligible, pages, prior, signal);
          const selection = selectInspectionPages(eligible, prior, changed);
          wikiIds = selection.wikiIds;
          skipped.push(...selection.skipped);
        }
        const reasons = new Map<string, number>();
        for (const item of skipped) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
        if (pages.length > topics.length) gaps.push(`${pages.length - topics.length} 页为 Source 页，不在主动巡检范围。`);
        for (const [reason, total] of reasons) gaps.push(`${total} 个主题页因${reason}跳过。`);
        if (!wikiIds.length) return `${!pages.length ? '知识库为空。' : '没有合格的主题页。'}${gaps.join('')}模型请求 0 次。`;
        return `选中 ${wikiIds.length} 个主题页，跳过 ${skipped.length} 个主题页。${gaps.join('')}`;
      });
      if (!wikiIds.length) return;
      await step('执行主动知识检查', async () => {
        const model = provider();
        if (!model) throw new AutomationCheckError('未配置主动检查模型，请先在设置中配置 Provider。');
        const requestId = randomUUID();
        await inspections.start({ requestId, wikiIds, includeRelated: true }, { provider: model, signal, skipped, gaps });
        const result = await inspections.wait(requestId);
        signal.throwIfAborted();
        if (result) await link({ inspectionIds: [result.id] });
        if (!result || (result.status !== 'completed' && result.status !== 'partial')) {
          const code = result?.error?.code;
          const label = code && /^[A-Z0-9_]{1,80}$/u.test(code) ? `（${code}）` : '';
          throw new AutomationCheckError(`主动检查失败${label}，请查看检查记录。`);
        }
        const pending = result.findings.filter(finding => finding.status === 'pending').length;
        return `实读 ${result.readWiki.length} 页，跳过 ${result.scope.skipped.length} 个主题页，待核 ${pending} 项，复用已处理 ${result.findings.length - pending} 项。`;
      });
    },
  };
}
