import path from 'node:path';
import { createHash } from 'node:crypto';
import { scanJsonRecords } from '../storage/files.ts';
import { isRawState, isJob, isExtractionDraft, isWorkflow, isUuid } from '../storage/record-validators.ts';
import type { RawState } from '../raw/state.ts';
import type { ExtractionJob, ExtractionRunner } from '../llm/jobs.ts';
import { ExtractionCheckpointStore } from '../llm/checkpoints.ts';
import { isQuestionDraft, type DraftRecord, type KnowledgeDraftRecord } from '../wiki/drafts.ts';
import { pendingRawCommit, scanWikiCommits } from '../wiki/commits.ts';
import type { KnowledgeWorkflow } from '../wiki/knowledge-workflows.ts';
import type { Audit } from '../audit/service.ts';
import type { RawStore } from '../raw/store.ts';
import type { WikiStore } from '../wiki/store.ts';

export type HomeKind = 'raw-task' | 'draft' | 'workflow' | 'audit';
type HomeTaskStatus = 'running' | 'failed' | 'recovery' | 'review' | 'partial' | 'commit-recovery' | 'deferred';
export type HomeAction = {
  kind: HomeKind;
  id: string;
  title: string;
  problem: string;
  result: string;
  action: string;
  updatedAt: string;
  priority: number;
  status?: HomeTaskStatus;
  target: {
    rawId?: string;
    jobId?: string;
    draftId?: string;
    workflowId?: string;
    wikiId?: string;
    auditId?: string;
    revision?: number;
    wikiRevision?: number;
    missing?: boolean;
  };
  versionToken: string;
};
type Source = 'raw-task' | 'draft' | 'workflow' | 'audit';
const token = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validAudit = (v: unknown, file: string): v is Audit => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const x = v as Record<string, unknown>;
  return (
    isUuid(x.id) &&
    x.id === path.basename(file, '.json') &&
    isUuid(x.wikiId) &&
    typeof x.comment === 'string' &&
    typeof x.status === 'string' &&
    ['open', 'resolved'].includes(x.status) &&
    Number.isInteger(x.revision) &&
    Number(x.revision) > 0 &&
    typeof x.updatedAt === 'string'
  );
};
export async function homeActions(deps: { root: string; raws: RawStore; wiki: WikiStore; runner: ExtractionRunner }) {
  const { root, raws, wiki, runner } = deps;
  const items: HomeAction[] = [];
  const sources = {} as Record<Source, { status: 'ok' | 'error'; message?: string }>;
  const scan = async <T>(dir: string, validate: (v: unknown, file: string) => v is T) => {
    const result = await scanJsonRecords<T>(path.join(root, dir), validate, root);
    if (result.issues.length || result.partial || result.overflow) throw Error('incomplete');
    return result.records.map((x) => x.value);
  };
  const collect = async (source: Source, fn: () => Promise<HomeAction[]>) => {
    try {
      const found = await fn();
      items.push(...found);
      sources[source] = { status: 'ok' };
    } catch {
      sources[source] = { status: 'error', message: '读取失败，无法确认是否还有待办。' };
    }
  };
  const entry = (value: Omit<HomeAction, 'versionToken'>, version: unknown): HomeAction => ({
    ...value,
    versionToken: token(version),
  });
  const stateScan = scanJsonRecords<RawState>(
    path.join(root, 'state/raw-processing'),
    (v, f): v is RawState => isRawState(v, path.basename(f, '.json')),
    root,
  );
  const jobScan = scanJsonRecords<ExtractionJob>(
    path.join(root, 'state/extraction-jobs'),
    (v, f): v is ExtractionJob => isJob(v, path.basename(f, '.json')),
    root,
  );
  const currentTasks = new Map<string, { rawId: string; draftId: string }>();
  const rawTasks = collect('raw-task', async () => {
    const [statesResult, jobsResult] = await Promise.all([stateScan, jobScan]);
    if ([statesResult, jobsResult].some((result) => result.issues.length || result.partial || result.overflow))
      throw Error('incomplete');
    const states = new Map(statesResult.records.map(({ value }) => [value.rawId, value]));
    const jobs = new Map(jobsResult.records.map(({ value }) => [value.id, value]));
    const checkpoints = new ExtractionCheckpointStore(root);
    const pending = new Map(runner.recoveryJobs().map((recovery) => [recovery.rawId, recovery.jobId]));
    for (const [rawId, jobId] of pending) {
      if (!states.has(rawId))
        states.set(rawId, {
          rawId,
          status: 'processing',
          updatedAt: jobs.get(jobId)?.updatedAt ?? new Date(0).toISOString(),
          history: [],
        });
    }
    const found: HomeAction[] = [];
    let commitScan: ReturnType<typeof scanWikiCommits> | undefined;
    for (const state of states.values()) {
      const recoveryId = pending.get(state.rawId);
      if (!recoveryId && !['processing', 'failed', 'pending_confirmation'].includes(state.status)) continue;
      const id = recoveryId ?? state.jobId;
      const stored = id ? jobs.get(id) : undefined;
      const job = stored?.rawId === state.rawId ? stored : undefined;
      const view = job ? await runner.readJob(job.id) : undefined;
      const live = view?.job ?? job;
      const missingJob = (!!id || state.status === 'processing') && !job;
      const blocked = !!view?.recovery || !!recoveryId;
      const running = view?.execution === 'running' && live?.status === 'running';
      if (state.status !== 'failed' && !blocked && !running && !missingJob) continue;
      const raw = await raws.get(state.rawId);
      if (!raw) continue;
      const missing = missingJob;
      const status = missing || blocked ? 'recovery' : running ? 'running' : 'failed';
      if (status === 'failed' && state.generatedWikiIds?.length) {
        let confirmedIds = state.generatedWikiIds;
        if ((raw.bodyRevision ?? 0) !== 0 || raw.bodyEditedAt) {
          const commits = await (commitScan ??= scanWikiCommits(root));
          if (commits.issues.length || commits.partial || commits.overflow) throw Error('incomplete commits');
          confirmedIds = commits.records.flatMap(({ value }) =>
            value.status === 'completed' && value.rawId === raw.id && value.rawSha256 === raw.bodySha256
              ? value.writtenWikiIds.filter((id) => confirmedIds.includes(id))
              : [],
          );
        }
        const pages = await Promise.all(confirmedIds.map((id) => wiki.get(id)));
        if (pages.length && pages.every((page) => page?.sources.includes(raw.id))) continue;
      }
      let draftId =
        view?.pendingDraftId ??
        live?.draftId ??
        (state.jobId === job?.id && state.status === 'pending_confirmation' ? state.draftId : undefined);
      if (!draftId && job && blocked) {
        // A restart may leave the checkpoint as the only persisted link to the draft.
        const checkpoint = await checkpoints.get(job.id).catch(() => undefined);
        if (checkpoint?.rawId === job.rawId && checkpoint.rawSha256 === raw?.bodySha256) draftId = checkpoint.draftId;
      }
      if (job && draftId) currentTasks.set(job.id, { rawId: job.rawId, draftId });
      const jobVersion =
        status === 'running' && live
          ? { id: live.id, rawId: live.rawId, status: live.status, cancelRequested: live.cancelRequested }
          : live;
      found.push(
        entry(
          {
            kind: 'raw-task',
            id: id ?? state.rawId,
            title: raw.title,
            status,
            problem: missing
              ? '关联资料或任务不存在'
              : blocked
                ? '状态保存待恢复'
                : running
                  ? '正在准备整理成果'
                  : (state.lastError?.message ?? '整理失败'),
            result: live?.checkpoint
              ? `已验证 ${live.checkpoint.validatedChunks}/${live.checkpoint.totalChunks} 提取段`
              : '暂无可确认的已保存结果',
            action: running && !blocked && !missing ? '查看整理进度' : '查看整理状态',
            updatedAt: live?.updatedAt ?? state.updatedAt,
            priority: status === 'running' ? 1 : 0,
            target: { rawId: state.rawId, ...(id ? { jobId: id } : {}), ...(missing ? { missing: true } : {}) },
          },
          { state, job: jobVersion, draftId, execution: view?.execution, recovery: view?.recovery },
        ),
      );
    }
    return found;
  });
  await Promise.all([
    rawTasks,
    collect('draft', async () => {
      const [records, states, jobs] = await Promise.all([
        scan<KnowledgeDraftRecord>('drafts', (v, f): v is KnowledgeDraftRecord =>
          isExtractionDraft(v, path.basename(f, '.json')),
        ),
        stateScan,
        jobScan,
        rawTasks,
      ]);
      const drafts = new Map(records.map((draft) => [draft.id, draft]));
      const jobsById = new Map(jobs.records.map(({ value }) => [value.id, value]));
      if (!states.issues.length)
        for (const { value: state } of states.records) {
          if (state.status !== 'pending_confirmation') continue;
          const job = state.jobId ? jobsById.get(state.jobId) : undefined;
          const draftId = state.draftId ?? job?.draftId;
          const draft = draftId ? drafts.get(draftId) : undefined;
          if (
            !draft ||
            isQuestionDraft(draft) ||
            draft.rawId !== state.rawId ||
            (state.jobId && draft.jobId !== state.jobId) ||
            (job && (job.rawId !== state.rawId || (job.draftId && job.draftId !== draft.id)))
          )
            throw Error('invalid referenced draft');
        }
      const rawDrafts: DraftRecord[] = [];
      const found: HomeAction[] = [];
      for (const draft of records) {
        if (isQuestionDraft(draft)) {
          if (draft.status === 'pending_confirmation')
            found.push(
              entry(
                {
                  kind: 'draft',
                  id: draft.id,
                  title: draft.document.title,
                  problem: '待审核',
                  result: '草稿已保存，待审核',
                  action: '继续审核',
                  updatedAt: draft.updatedAt,
                  priority: 1,
                  status: 'review',
                  target: { draftId: draft.id, revision: draft.revision },
                },
                { id: draft.id, revision: draft.revision, updatedAt: draft.updatedAt },
              ),
            );
          continue;
        }
        if (draft.status === 'discarded' || draft.discardedAt) continue;
        const task = sources['raw-task'].status === 'ok' ? currentTasks.get(draft.jobId) : undefined;
        if (task?.rawId === draft.rawId && task.draftId === draft.id) continue;
        rawDrafts.push(draft);
      }
      if (!rawDrafts.length) return found;
      const commits = await scanWikiCommits(root);
      if (commits.issues.length || commits.partial || commits.overflow) throw Error('incomplete commits');
      const commitsByDraft = new Map<string, (typeof commits.records)[number]['value'][]>();
      for (const { value: manifest } of commits.records) {
        const group = commitsByDraft.get(manifest.draftId);
        if (group) group.push(manifest);
        else commitsByDraft.set(manifest.draftId, [manifest]);
      }
      for (const draft of rawDrafts) {
        const manifests = commitsByDraft.get(draft.id) ?? [];
        if (
          draft.status === 'confirmed' &&
          !manifests.some((manifest) => manifest.status !== 'completed' && !manifest.supersededBy)
        )
          continue;
        const commit = pendingRawCommit(draft, manifests);
        const raw = await raws.get(draft.rawId);
        const written =
          draft.maintenance?.changes.filter((change) => change.committedOperationId && change.action !== 'noop')
            .length ?? 0;
        const remaining = draft.maintenance?.changes.filter((change) => !change.committedOperationId).length ?? 0;
        const status = commit
          ? 'commit-recovery'
          : draft.deferredAt
            ? 'deferred'
            : written && remaining
              ? 'partial'
              : 'review';
        const problem = !raw
          ? '关联 Raw 已删除'
          : commit
            ? '上次确认待完成'
            : status === 'deferred'
              ? '已安排稍后处理'
              : status === 'partial'
                ? '部分成果已入库'
                : '待审核';
        found.push(
          entry(
            {
              kind: 'draft',
              id: draft.id,
              title: draft.rawTitle || draft.id,
              status,
              problem,
              result: commit
                ? `已落盘 ${commit.writtenWikiIds.length} 项，可继续原提交。`
                : draft.maintenance
                  ? `已入库 ${written} 项，待确认 ${remaining} 项`
                  : '草稿已保存，待审核',
              action: commit ? '查看上次确认' : status === 'deferred' ? '查看暂缓成果' : '继续审核',
              updatedAt: commit?.updatedAt ?? draft.updatedAt,
              priority: commit ? 0 : 1,
              target: {
                draftId: draft.id,
                rawId: draft.rawId,
                revision: draft.revision,
                ...(!raw ? { missing: true } : {}),
              },
            },
            {
              id: draft.id,
              status: draft.status,
              revision: draft.revision,
              updatedAt: draft.updatedAt,
              raw: raw?.bodySha256,
              commit: commit && { id: commit.operationId, status: commit.status, updatedAt: commit.updatedAt },
            },
          ),
        );
      }
      return found;
    }),
    collect('workflow', async () => {
      const records = await scan<KnowledgeWorkflow>('drafts/knowledge-workflows', (v, f): v is KnowledgeWorkflow =>
        isWorkflow(v, path.basename(f, '.json')),
      );
      return Promise.all(
        records
          .filter((x) => x.status === 'pending_confirmation' || x.status === 'conflict')
          .map(async (w) => {
            const inputs = await Promise.all(w.rawSnapshots.map((x) => raws.get(x.id)));
            const page = w.targetWikiId ? await wiki.get(w.targetWikiId) : undefined;
            const missing = inputs.some((x) => !x) || (!!w.targetWikiId && !page);
            return entry(
              {
                kind: 'workflow',
                id: w.id,
                title: w.title || w.id,
                problem: missing ? '关联资料或 Wiki 已删除' : w.status === 'conflict' ? '提交冲突' : '待确认',
                result: w.lastCommitError ? '提交遇到问题，请打开查看。' : '草稿已保存，待审核',
                action: '查看工作流',
                updatedAt: w.updatedAt,
                priority: w.status === 'conflict' ? 0 : 1,
                target: { workflowId: w.id, revision: w.revision, ...(missing ? { missing: true } : {}) },
              },
              {
                id: w.id,
                revision: w.revision,
                updatedAt: w.updatedAt,
                status: w.status,
                raws: inputs.map((x) => x?.bodySha256 ?? null),
                wikiRevision: page?.revision ?? null,
              },
            );
          }),
      );
    }),
    collect('audit', async () => {
      const records = await scan<Audit>('knowledge/audit', validAudit);
      return Promise.all(
        records
          .filter((x) => x.status === 'open')
          .map(async (a) => {
            const page = await wiki.get(a.wikiId);
            return entry(
              {
                kind: 'audit',
                id: a.id,
                title: page?.title ?? `Wiki ${a.wikiId}`,
                problem: page ? a.comment.slice(0, 200) : '关联 Wiki 已删除',
                result: '待处理的知识纠错',
                action: '查看 Audit',
                updatedAt: a.updatedAt,
                priority: 1,
                target: {
                  wikiId: a.wikiId,
                  auditId: a.id,
                  revision: a.revision,
                  ...(page ? { wikiRevision: page.revision } : { missing: true }),
                },
              },
              { id: a.id, revision: a.revision, updatedAt: a.updatedAt, wikiRevision: page?.revision ?? null },
            );
          }),
      );
    }),
  ]);
  items.sort(
    (a, b) =>
      a.priority - b.priority ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  );
  return { items, sources };
}
