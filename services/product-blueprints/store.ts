import { randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { assertRawNotMeeting, SourcePolicyError } from '../meeting/source-policy.ts';
import type { RawStore, RawRecord } from '../raw/store.ts';
import type { WikiStore } from '../wiki/store.ts';
import { assertWikiSourcesAllowed } from '../wiki/source-lineage.ts';
import type { WorkItemStore } from '../work-items/store.ts';
import { isUuid } from '../storage/record-validators.ts';
import { readJsonRecord, scanJsonRecords, SerialQueue, StorageError, writeJsonAtomic } from '../storage/files.ts';
import { checksFor } from './checks.ts';
import type { Blueprint, BlueprintDetail, SourceDisplay } from './types.ts';

const collections = [
  'personas',
  'scenarios',
  'pains',
  'alternatives',
  'values',
  'features',
  'metrics',
  'risks',
  'milestones',
] as const;
type Collection = (typeof collections)[number];
type Row = Record<string, unknown> & { id: string };
const rules: Record<
  Collection,
  {
    limit: number;
    text: Record<string, number>;
    optional?: string[];
    enums?: Record<string, string[]>;
    arrays?: Record<string, string[]>;
  }
> = {
  personas: {
    limit: 30,
    text: { name: 120, profile: 4000, frequency: 500 },
    optional: ['wikiId'],
    enums: { side: ['internal', 'external'] },
    arrays: { relations: ['decision_maker', 'user', 'affected', 'payer'] },
  },
  scenarios: { limit: 100, text: { when: 500, task: 500, outcome: 500 }, optional: ['personaId'] },
  pains: {
    limit: 200,
    text: { text: 4000 },
    optional: ['personaId', 'scenarioId'],
    enums: { kind: ['fact', 'inference', 'question'], severity: ['high', 'medium', 'low'] },
  },
  alternatives: { limit: 100, text: { currentApproach: 4000, cost: 4000 }, optional: ['personaId'] },
  values: {
    limit: 100,
    text: { advantage: 4000, validation: 4000 },
    enums: { confidence: ['verified', 'assumed'] },
    arrays: { personaIds: [], painIds: [] },
  },
  features: {
    limit: 200,
    text: { title: 120, description: 4000, wontReason: 4000 },
    enums: { priority: ['must', 'should', 'could', 'wont'], phase: ['mvp', 'v1', 'later'] },
    arrays: { valueIds: [] },
  },
  metrics: { limit: 20, text: { name: 120, definition: 500, target: 500 } },
  risks: { limit: 50, text: { text: 4000 } },
  milestones: { limit: 30, text: { title: 120, targetWeek: 500, deliverable: 4000 }, arrays: { featureIds: [] } },
};
const refs: Record<string, Collection> = {
  personaId: 'personas',
  personaIds: 'personas',
  scenarioId: 'scenarios',
  painIds: 'pains',
  valueIds: 'values',
  featureIds: 'features',
};
function invalid(message: string): never {
  throw new StorageError('INVALID_PRODUCT_BLUEPRINT', message, 400);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('数据格式不正确。');
  return value as Record<string, unknown>;
}
function str(value: unknown, limit: number, field: string): string {
  if (typeof value !== 'string' || value.length > limit) invalid(`${field}必须为不超过 ${limit} 字的文本。`);
  return value;
}
function array(value: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${field}数量不能超过 ${max}。`);
  return value;
}
function weekValid(value: string) {
  if (!value) return true;
  const m = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]),
    w = Number(m[2]);
  if (y < 1 || w < 1 || w > 53) return false;
  const d = new Date(0);
  d.setUTCFullYear(y, 11, 28);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(0);
  start.setUTCFullYear(d.getUTCFullYear(), 0, 1);
  start.setUTCHours(0, 0, 0, 0);
  return w <= Math.ceil(((d.getTime() - start.getTime()) / 86400000 + 1) / 7);
}
function rows(b: Blueprint, key: Collection): Row[] {
  return (key === 'metrics' || key === 'risks' ? b.vision[key] : b[key]) as unknown as Row[];
}
function validate(b: Blueprint): void {
  b.title = str(b.title, 120, '名称').trim();
  if (!b.title) invalid('请填写构想名称。');
  str(b.oneLiner, 300, '一句话定义');
  if (!['exploring', 'defining', 'planning', 'executing', 'paused', 'archived'].includes(b.status))
    invalid('状态无效。');
  const ctx = record(b.context);
  for (const k of ['background', 'businessGoal', 'constraints']) str(ctx[k], 4000, k);
  const links = record(b.links);
  for (const [k, n] of [
    ['rawIds', 100],
    ['wikiIds', 100],
    ['workItemIds', 50],
  ] as const) {
    const ids = array(links[k], n, k);
    if (!ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 200)) invalid('关联 ID 无效。');
    links[k] = [...new Set(ids)];
  }
  const vision = record(b.vision);
  for (const k of ['northStar', 'targetScope', 'outOfScope']) str(vision[k], 4000, k);
  const ids = new Set<string>();
  for (const key of collections) {
    const rule = rules[key];
    const items = array(key === 'metrics' || key === 'risks' ? vision[key] : b[key], rule.limit, key);
    for (const item of items) {
      const row = record(item);
      if (!isUuid(row.id) || ids.has(row.id)) invalid('条目 ID 无效或重复。');
      ids.add(row.id);
      for (const [field, limit] of Object.entries(rule.text)) str(row[field], limit, field);
      for (const [field, options] of Object.entries(rule.enums ?? {}))
        if (typeof row[field] !== 'string' || !options.includes(row[field] as string)) invalid(`${field}无效。`);
      for (const [field, options] of Object.entries(rule.arrays ?? {})) {
        const values = array(row[field], 200, field);
        if (!values.every((x) => typeof x === 'string' && (options.length ? options.includes(x) : isUuid(x))))
          invalid(`${field}无效。`);
        row[field] = [...new Set(values)];
      }
      for (const field of rule.optional ?? []) {
        if (row[field] === '' || row[field] == null) delete row[field];
        else if (typeof row[field] !== 'string' || (field !== 'wikiId' && !isUuid(row[field])))
          invalid(`${field}无效。`);
      }
      if (key === 'values' && row.confidence === 'assumed' && !(row.validation as string).trim())
        invalid('假设价值需要验证方式。');
      if (key === 'features' && row.priority === 'wont' && !(row.wontReason as string).trim())
        invalid('不做功能需要理由。');
      if (key === 'milestones' && !weekValid(row.targetWeek as string)) invalid('目标周不是有效的 ISO 周。');
      if (key === 'pains' && row.kind === 'fact') {
        const evidence = record(row.evidence);
        if (!isUuid(evidence.rawId)) invalid('事实依据的 Raw ID 无效。');
        str(evidence.quote, 500, '引文');
        if (!(evidence.quote as string).trim()) invalid('请填写原文引文。');
      } else if (key === 'pains') {
        delete row.evidence;
        delete row.evidenceRedacted;
      }
    }
  }
}
function references(b: Blueprint) {
  const result: { collection: Collection; id: string; field: string; target: Collection; targetId: string }[] = [];
  for (const key of collections)
    for (const row of rows(b, key))
      for (const [field, target] of Object.entries(refs)) {
        const val = row[field];
        for (const id of Array.isArray(val) ? val : val ? [val] : [])
          result.push({ collection: key, id: row.id, field, target, targetId: id as string });
      }
  return result;
}
function checkRefs(b: Blueprint, old: Blueprint) {
  const referencesIn = references(b);
  const removed = new Map(
    collections.map((k) => [
      k,
      new Set(
        rows(old, k)
          .filter((r) => !rows(b, k).some((x) => x.id === r.id))
          .map((r) => r.id),
      ),
    ]),
  );
  const conflicts = referencesIn.filter((r) => removed.get(r.target)!.has(r.targetId));
  if (conflicts.length)
    throw new StorageError('REFERENCE_CONFLICT', '请先解除条目引用。', 409, {
      references: conflicts.map(({ collection, id, field }) => ({ collection, id, field })),
    });
  for (const r of referencesIn)
    if (!rows(b, r.target).some((x) => x.id === r.targetId)) invalid(`${r.field}引用的条目不存在。`);
  for (const p of b.pains)
    if (p.personaId && p.scenarioId && b.scenarios.find((s) => s.id === p.scenarioId)?.personaId !== p.personaId)
      invalid('痛点的角色与场景角色不匹配。');
}
function validStored(value: unknown, id: string): value is Blueprint {
  try {
    const b = structuredClone(value) as Blueprint;
    if (
      !b ||
      b.id !== id ||
      !isUuid(id) ||
      !Number.isSafeInteger(b.revision) ||
      b.revision < 1 ||
      typeof b.createdAt !== 'string' ||
      typeof b.updatedAt !== 'string'
    )
      return false;
    validate(b);
    checkRefs(b, b);
    return true;
  } catch {
    return false;
  }
}

export class ProductBlueprintStore {
  private readonly dir: string;
  private readonly queue = new SerialQueue();
  constructor(
    private readonly root: string,
    private readonly raws: Pick<RawStore, 'get' | 'list'>,
    private readonly wiki: Pick<WikiStore, 'get' | 'list'>,
    private readonly work: Pick<WorkItemStore, 'get' | 'list'>,
  ) {
    this.dir = path.join(root, 'product-blueprints');
  }
  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }
  private async current(id: string) {
    const b = isUuid(id)
      ? await readJsonRecord(this.root, this.file(id), (v): v is Blueprint => validStored(v, id))
      : undefined;
    if (!b) throw new StorageError('PRODUCT_BLUEPRINT_NOT_FOUND', '没有找到产品构想。', 404);
    return b;
  }
  private async save(b: Blueprint) {
    if (Buffer.byteLength(`${JSON.stringify(b, null, 2)}\n`) > 2 * 1024 * 1024)
      throw new StorageError('PRODUCT_BLUEPRINT_TOO_LARGE', '构想超过 2 MiB。', 413);
    await writeJsonAtomic(this.file(b.id), b);
  }
  async list() {
    const scan = await scanJsonRecords(
      this.dir,
      (v, file): v is Blueprint => validStored(v, path.basename(file, '.json')),
      this.root,
    );
    return {
      items: scan.records
        .map(({ value: b }) => ({
          id: b.id,
          title: b.title,
          oneLiner: b.oneLiner,
          status: b.status,
          updatedAt: b.updatedAt,
          revision: b.revision,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      errors: scan.issues.map((i) => ({
        id: path.basename(i.file, '.json'),
        message: `记录不可读取（${i.reason}），原文件已保留。`,
      })),
    };
  }
  private async raw(id: string): Promise<{ raw?: RawRecord; restricted: boolean }> {
    let raw: RawRecord | undefined;
    try {
      raw = await this.raws.get(id);
    } catch {
      return { restricted: true };
    }
    if (!raw) return { restricted: false };
    try {
      assertRawNotMeeting(raw);
      return { raw, restricted: false };
    } catch (e) {
      if (e instanceof SourcePolicyError) return { restricted: true };
      throw e;
    }
  }
  private async sourceInfo(b: Blueprint) {
    const rawMap = new Map<string, { raw?: RawRecord; restricted: boolean }>();
    for (const id of new Set([...b.links.rawIds, ...b.pains.flatMap((p) => (p.evidence ? [p.evidence.rawId] : []))]))
      rawMap.set(id, await this.raw(id));
    const raw: SourceDisplay[] = b.links.rawIds.map((id) => ({
      id,
      available: !!rawMap.get(id)?.raw,
      ...(rawMap.get(id)?.raw ? { title: rawMap.get(id)!.raw!.title } : {}),
    }));
    const wiki: SourceDisplay[] = [];
    for (const id of new Set([...b.links.wikiIds, ...b.personas.flatMap((p) => (p.wikiId ? [p.wikiId] : []))])) {
      const page = await this.wiki.get(id);
      let allowed = !!page;
      if (page) {
        try {
          await assertWikiSourcesAllowed(this.wiki, this.raws, page);
        } catch (e) {
          if (e instanceof SourcePolicyError || (e as { code?: string }).code === 'KNOWLEDGE_SOURCE_MISSING')
            allowed = false;
          else throw e;
        }
      }
      wiki.push({ id, available: allowed, ...(allowed ? { title: page!.title } : {}) });
    }
    const workItems: SourceDisplay[] = [];
    for (const id of b.links.workItemIds) {
      try {
        const item = await this.work.get(id);
        workItems.push({ id, available: true, title: item.title });
      } catch (e) {
        if (e instanceof StorageError && e.status === 404) workItems.push({ id, available: false });
        else throw e;
      }
    }
    return { rawMap, sources: { raw, wiki, workItems } };
  }
  private async detail(b: Blueprint): Promise<BlueprintDetail> {
    const { rawMap, sources } = await this.sourceInfo(b);
    const invalidEvidence = new Set<string>();
    const projected = structuredClone(b);
    for (const p of projected.pains)
      if (p.kind === 'fact' && p.evidence) {
        const source = rawMap.get(p.evidence.rawId);
        if (
          !b.links.rawIds.includes(p.evidence.rawId) ||
          !source?.raw ||
          !source.raw.body.includes(p.evidence.quote ?? '')
        )
          invalidEvidence.add(p.id);
        if (!source?.raw) {
          p.evidence = { rawId: p.evidence.rawId };
          p.evidenceRedacted = true;
        }
      }
    return { blueprint: projected, checks: checksFor(b, invalidEvidence), sources };
  }
  async get(id: string) {
    return this.detail(await this.current(id));
  }
  async candidates() {
    const raw = (await this.raws.list({ strictScan: true }))
      .filter((item) => {
        try {
          assertRawNotMeeting(item);
          return true;
        } catch (error) {
          if (error instanceof SourcePolicyError) return false;
          throw error;
        }
      })
      .map(({ id, title }) => ({ id, title }));
    const wiki: { id: string; title: string }[] = [];
    for (const page of await this.wiki.list()) {
      try {
        await assertWikiSourcesAllowed(this.wiki, this.raws, page);
        wiki.push({ id: page.id, title: page.title });
      } catch (error) {
        if (!(error instanceof SourcePolicyError) && (error as { code?: string }).code !== 'KNOWLEDGE_SOURCE_MISSING')
          throw error;
      }
    }
    const workItems = (await this.work.list()).map(({ id, title }) => ({ id, title }));
    return { raw, wiki, workItems };
  }
  async create(input: unknown) {
    const v = record(input),
      now = new Date().toISOString();
    const b: Blueprint = {
      id: randomUUID(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      title: str(v.title, 120, '名称'),
      oneLiner: v.oneLiner === undefined ? '' : str(v.oneLiner, 300, '一句话定义'),
      status: 'exploring',
      context: { background: '', businessGoal: '', constraints: '' },
      links: { rawIds: [], wikiIds: [], workItemIds: [] },
      personas: [],
      scenarios: [],
      pains: [],
      alternatives: [],
      values: [],
      features: [],
      vision: { northStar: '', targetScope: '', outOfScope: '', metrics: [], risks: [] },
      milestones: [],
    };
    validate(b);
    return this.queue.run(async () => {
      const detail = await this.detail(b);
      await this.save(b);
      return detail;
    });
  }
  private async revision(id: string, base: unknown) {
    if (!Number.isSafeInteger(base) || Number(base) < 1) invalid('请提供有效版本。');
    const b = await this.current(id);
    if (b.revision !== base)
      throw new StorageError('REVISION_CONFLICT', '构想已有更新，请重新读取。', 409, { currentRevision: b.revision });
    return b;
  }
  async delete(id: string, base: unknown) {
    return this.queue.run(async () => {
      await this.revision(id, base);
      await mkdir(path.join(this.dir, 'recycle'), { recursive: true });
      await rename(this.file(id), path.join(this.dir, 'recycle', `${id}.json`));
    });
  }
  async update(id: string, input: unknown) {
    const v = record(input);
    return this.queue.run(async () => {
      const old = await this.revision(id, v.baseRevision),
        b = structuredClone(old);
      const data = structuredClone(v.data);
      const section = v.section;
      if (section === 'background') {
        const d = record(data),
          meta = record(d.meta);
        b.title = meta.title as string;
        b.oneLiner = meta.oneLiner as string;
        b.status = meta.status as Blueprint['status'];
        b.context = d.context as Blueprint['context'];
        b.links = d.links as Blueprint['links'];
      } else if (section === 'meta') {
        const d = record(data);
        b.title = d.title as string;
        b.oneLiner = d.oneLiner as string;
        b.status = d.status as Blueprint['status'];
      } else if (section === 'users') {
        const d = record(data);
        b.personas = d.personas as Blueprint['personas'];
        b.scenarios = d.scenarios as Blueprint['scenarios'];
        b.pains = d.pains as Blueprint['pains'];
        b.alternatives = d.alternatives as Blueprint['alternatives'];
      } else if (section === 'concept') {
        const d = record(data);
        b.vision = d.vision as Blueprint['vision'];
        b.milestones = d.milestones as Blueprint['milestones'];
      } else if (
        typeof section === 'string' &&
        [
          'context',
          'links',
          'personas',
          'scenarios',
          'pains',
          'alternatives',
          'values',
          'features',
          'vision',
          'milestones',
        ].includes(section)
      )
        (b as unknown as Record<string, unknown>)[section] = data;
      else invalid('保存区无效。');
      const idMap: Record<string, string> = {};
      const keys = new Set<string>();
      for (const key of collections) {
        const list = array(
          key === 'metrics' || key === 'risks' ? record(b.vision)[key] : (b as unknown as Record<string, unknown>)[key],
          rules[key].limit,
          key,
        );
        for (const item of list) {
          const r = record(item);
          if (typeof r.id !== 'string') invalid('条目 ID 无效。');
          if (r.id.startsWith('new:')) {
            if (!/^new:[A-Za-z0-9_-]{1,64}$/.test(r.id) || keys.has(r.id)) invalid('临时 ID 无效或重复。');
            keys.add(r.id);
            idMap[r.id] = randomUUID();
            r.id = idMap[r.id];
          } else if (!rows(old, key).some((x) => x.id === r.id)) invalid('已有条目 ID 不属于此构想。');
        }
      }
      for (const key of collections)
        for (const row of rows(b, key))
          for (const field of Object.keys(refs)) {
            const val = row[field];
            if (typeof val === 'string' && idMap[val]) row[field] = idMap[val];
            else if (Array.isArray(val))
              row[field] = val.map((x) => (typeof x === 'string' && idMap[x] ? idMap[x] : x));
          }
      for (const p of b.pains) {
        const before = old.pains.find((x) => x.id === p.id);
        if (
          p.evidenceRedacted &&
          before?.evidence &&
          p.evidence?.rawId === before.evidence.rawId &&
          p.evidence.quote === undefined
        ) {
          const source = await this.raw(before.evidence.rawId);
          if (source.raw) invalid('依据状态已变化，请重新读取。');
          p.evidence = before.evidence;
        }
        delete p.evidenceRedacted;
      }
      validate(b);
      checkRefs(b, old);
      for (const [kind, ids, prior] of [
        ['raw', b.links.rawIds, old.links.rawIds],
        ['wiki', b.links.wikiIds, old.links.wikiIds],
        ['work', b.links.workItemIds, old.links.workItemIds],
      ] as const)
        for (const sourceId of ids)
          if (!prior.includes(sourceId)) {
            if (kind === 'raw') {
              if (!(await this.raw(sourceId)).raw) invalid('所选 Raw 来源不可用。');
            } else if (kind === 'wiki') {
              if (!(await this.wiki.get(sourceId))) invalid('所选 Wiki 不存在。');
            } else {
              try {
                await this.work.get(sourceId);
              } catch (e) {
                if (e instanceof StorageError && e.status === 404) invalid('所选工作事项不存在。');
                throw e;
              }
            }
          }
      for (const p of b.personas)
        if (
          p.wikiId &&
          !old.personas.some((x) => x.id === p.id && x.wikiId === p.wikiId) &&
          !(await this.wiki.get(p.wikiId))
        )
          invalid('角色关联的 Wiki 不存在。');
      for (const p of b.pains)
        if (p.kind === 'fact' && p.evidence) {
          const previous = old.pains.find((x) => x.id === p.id);
          const unchanged =
            previous?.kind === 'fact' &&
            previous.evidence?.rawId === p.evidence.rawId &&
            previous.evidence.quote === p.evidence.quote;
          if (!unchanged) {
            const source = await this.raw(p.evidence.rawId);
            if (
              !b.links.rawIds.includes(p.evidence.rawId) ||
              !source.raw ||
              !source.raw.body.includes(p.evidence.quote!)
            )
              invalid('事实引文必须逐字来自已关联且可用的 Raw。');
          }
        }
      b.revision++;
      b.updatedAt = new Date().toISOString();
      const detail = await this.detail(b);
      await this.save(b);
      return { ...detail, idMap };
    });
  }
}
