import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import yaml from 'js-yaml';
import { RawStore } from '../services/raw/store.ts';
import { openSearchDatabase } from '../services/search/sqlite-store.ts';
import { wikiReviewDate } from '../services/wiki/freshness.ts';
import { parseWikiMarkdown, WikiStore, type WikiInput } from '../services/wiki/store.ts';
import { startFakeProvider } from './support/fake-llm.ts';
import { withoutInheritedEmbeddings } from './support/isolated-embedding-env.mjs';

async function server(t: TestContext, root: string, env: Record<string, string> = {}, observeWikiReads = false) {
  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const { port } = portProbe.address() as AddressInfo;
  await new Promise<void>((resolve) => portProbe.close(() => resolve()));
  const isolated = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_LLM_/i.test(key)));
  const observer = [
    "import { promises as fs } from 'node:fs';",
    "import { ServerResponse } from 'node:http';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "import path from 'node:path';",
    'const wikiDir = path.join(process.env.FMCG_DATA_DIR, "knowledge", "wiki");',
    'let reads = 0;',
    'const { readFile } = fs;',
    'fs.readFile = (file, ...args) => {',
    "  if (typeof file === 'string' && path.dirname(file) === wikiDir && /^[0-9a-f-]{36}[.]md$/i.test(path.basename(file)))",
    '    reads++;',
    '  return readFile(file, ...args);',
    '};',
    'syncBuiltinESMExports();',
    'const { end } = ServerResponse.prototype;',
    'ServerResponse.prototype.end = function(...args) {',
    '  if (!this.headersSent) this.setHeader("x-test-wiki-reads", reads);',
    '  return end.apply(this, args);',
    '};',
  ].join('\n');
  const args = ['--import', 'tsx'];
  if (observeWikiReads) args.push('--import', 'data:text/javascript,' + encodeURIComponent(observer));
  const child = spawn(process.execPath, [...args, 'server/index.ts'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...withoutInheritedEmbeddings({
        ...isolated,
        FMCG_DATA_DIR: root,
        FMCG_PORT: String(port),
        FMCG_LLM_CONFIG_FILE: path.join(root, 'missing.env'),
        SEARCH_ENGINE: 'sqlite_fts',
        WIKI_FRESHNESS_ENABLED: '1',
      }),
      ...env,
    },
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
  });
  let logs = '';
  let wikiReads = 0;
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const request = async (route: string, body?: unknown, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      ...(body === undefined
        ? {}
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    if (observeWikiReads) wikiReads = Number(response.headers.get('x-test-wiki-reads'));
    return { status: response.status, data: await response.json() };
  };
  for (let attempt = 0; attempt < 250; attempt++) {
    if (child.exitCode !== null) break;
    const health = await request('/api/health').catch(() => undefined);
    if (health?.status === 200) return Object.assign(request, { wikiMarkdownReads: () => wikiReads });
    await delay(80);
  }
  throw new Error(logs);
}

async function until<T>(check: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await check();
    if (value !== undefined) return value;
    await delay(30);
  }
  throw new Error('Review state did not appear');
}

const wikiInput = (title: string, body: string, extra: Partial<WikiInput> = {}): WikiInput => ({
  title,
  type: 'concept',
  category: 'channel',
  body,
  aliases: [],
  tags: [],
  sources: [],
  knowledge_status: 'inferred',
  confidence: 'low',
  source_level: 'D',
  review_status: 'unreviewed',
  ...extra,
});
const rawInput = (title: string, body: string) => ({
  title,
  body,
  sourceType: 'note' as const,
  sourceName: '合成来源',
  tags: [],
});

async function restrictedWiki(wiki: WikiStore, raws: RawStore, title: string, body: string, aliases: string[] = []) {
  const { record } = await raws.createMeetingRegistration({
    ...rawInput('合成限制资料', '合成限制正文'),
    id: randomUUID(),
    importedAt: new Date().toISOString(),
    origin: {
      kind: 'meeting',
      meeting_id: randomUUID(),
      import_id: randomUUID(),
      original_sha256: 'a'.repeat(64),
      registered_confidentiality: 'Restricted',
      processing_policy: 'meeting_local_only',
    },
  });
  const denied = await wiki.create(wikiInput(title, body, { category: 'company_business', aliases }));
  await wiki.withLock(() => wiki.writePageLocked({ ...denied, sources: [record.id] }));
  return denied;
}

test('SQLite Wiki catalogue answers list and stats without Wiki Markdown reads, then safely falls back', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-wiki-catalog-http-'));
  const raws = new RawStore(root);
  const wiki = new WikiStore(root, raws);
  await raws.initialize();
  await wiki.initialize();
  const raw = await raws.create(rawInput('公开合成资料', '公开正文。'));
  const page = await wiki.create(
    wikiInput('库内检索样本', '## 来源事实\r\n\r\n证据正文🧾。', {
      aliases: ['ＳＫＵ'],
      tags: ['端架'],
      sources: [raw.id],
    }),
  );
  const restricted = await restrictedWiki(wiki, raws, '受限页', '受限正文。');
  const allowedChild = await wiki.create(wikiInput('曾经可见派生页', '公开派生正文。'));
  const blockedChild = await wiki.create(wikiInput('间接受限页', '派生受限正文。'));
  for (const [child, parent] of [
    [allowedChild, page],
    [blockedChild, restricted],
  ]) {
    await wiki.withLock(() =>
      wiki.writePageLocked({
        ...child,
        answerDerivations: [
          {
            answerId: randomUUID(),
            answerRevision: 1,
            wikiIds: [parent.id],
            rawIds: [],
            manualWikiIds: [],
            containsInference: false,
          },
        ],
      }),
    );
  }
  const publicPage = await wiki.create(wikiInput('独立公开页', '额外公开正文。', { category: 'company_business' }));
  await writeFile(path.join(root, 'knowledge', 'wiki', 'sidebar.md'), '# 本地辅助 Markdown');
  const api = await server(t, root, { WIKI_FRESHNESS_ENABLED: '0' }, true);
  const afterStartup = api.wikiMarkdownReads();
  // The detail path still reads Markdown.
  assert.equal((await api('/api/wiki/' + page.id)).status, 200);
  const before = api.wikiMarkdownReads();
  assert(before > afterStartup);
  const list = await api('/api/wiki');
  const { categories } = (await api('/api/wiki/schema')).data;
  const label = categories.find(({ id }: { id: string }) => id === 'channel').label;
  const filtered = await api('/api/wiki?category=channel&q=' + encodeURIComponent('sku 端架 证据正文 ' + label));
  const stats = await api('/api/stats');
  assert.equal(list.status, 200);
  assert.equal(filtered.status, 200);
  assert.deepEqual(
    new Set(list.data.items.map(({ id }: { id: string }) => id)),
    new Set([page.id, allowedChild.id, publicPage.id]),
  );
  assert.deepEqual(filtered.data.items, [page]);
  assert.deepEqual(filtered.data.categoryCounts, list.data.categoryCounts);
  assert.equal(list.data.categoryCounts.channel, 2);
  assert.equal(list.data.categoryCounts.company_business, 1);
  assert.equal(stats.status, 200);
  assert.equal(stats.data.wikiCount, 3);
  assert.equal(stats.data.thisWeekNewCount, stats.data.rawCount + 3);
  assert.deepEqual(
    new Set(stats.data.recentChanges.map(({ id }: { id: string }) => id)),
    new Set([page.id, allowedChild.id, publicPage.id]),
  );
  assert.equal(api.wikiMarkdownReads(), before);
  assert.equal((await api('/api/wiki?category=not_a_category')).status, 400);

  const created = await api('/api/wiki', wikiInput('同进程页面', '写入后立即可见。'));
  assert.equal(created.status, 201);
  const edited = await api(
    '/api/wiki/' + created.data.id,
    { ...wikiInput('同进程改名', '新写入正文。'), baseRevision: 1 },
    'PUT',
  );
  assert.equal(edited.status, 200);
  assert.deepEqual((await api('/api/wiki?q=' + encodeURIComponent('同进程改名'))).data.items, [edited.data]);
  assert.equal((await api('/api/stats')).data.wikiCount, 4);
  assert.equal((await api('/api/wiki/' + created.data.id, { baseRevision: 2 }, 'DELETE')).status, 200);

  const beforeRawRemoval = api.wikiMarkdownReads();
  await raws.delete(raw.id);
  const afterRawRemoval = await api('/api/wiki');
  assert.deepEqual(afterRawRemoval.data.items, [publicPage]);
  const visibleStats = (await api('/api/stats')).data;
  assert.equal(visibleStats.wikiCount, 1);
  assert.equal(visibleStats.recentChanges.length, 1);
  assert(visibleStats.recentChanges.every(({ id }: { id: string }) => id === publicPage.id));
  assert.equal(api.wikiMarkdownReads(), beforeRawRemoval);

  // An external edit is visible even before any reconciliation.
  await wiki.writePageLocked({ ...publicPage, title: '盘外更新标题', type: 'entity', isDemo: true });
  const fallback = await api('/api/wiki');
  assert.equal(fallback.data.items[0].title, '盘外更新标题');
  assert(api.wikiMarkdownReads() > beforeRawRemoval);
  const retitledStats = {
    ...visibleStats,
    recentChanges: visibleStats.recentChanges.map((change: { title: string }) => ({
      ...change,
      title: '盘外更新标题',
      type: 'entity',
      isDemo: true,
    })),
  };
  assert.deepEqual((await api('/api/stats')).data, retitledStats);

  const db = openSearchDatabase(path.join(root, 'state', 'search-index.sqlite'));
  try {
    db.exec('DROP TABLE wiki_catalog');
    assert.deepEqual((await api('/api/wiki')).data, fallback.data);
    assert.deepEqual((await api('/api/stats')).data, retitledStats);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'index_dirty'").pluck().get(), '1');
  } finally {
    db.close();
  }
});

test('formal Wiki HTTP writes and details maintain resolved backlinks, including an index write failure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-wiki-backlinks-http-'));
  const api = await server(t, root, { WIKI_FRESHNESS_ENABLED: '0' });
  const create = async (title: string, body: string, extra?: Partial<WikiInput>) => {
    const result = await api('/api/wiki', wikiInput(title, body, extra));
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  };
  const detail = async (id: string) => {
    const result = await api(`/api/wiki/${id}`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  const update = async (id: string, baseRevision: number, title: string, body: string) => {
    const result = await api(`/api/wiki/${id}`, { ...wikiInput(title, body), baseRevision }, 'PUT');
    assert.equal(result.status, 200, JSON.stringify(result.data));
  };
  const remove = async (id: string) => {
    const result = await api(`/api/wiki/${id}`, { baseRevision: 1 }, 'DELETE');
    assert.equal(result.status, 200, JSON.stringify(result.data));
  };
  const body = [
    '## 正文🧾',
    '见 [[ 目标页 ]]、[[目标页]]、[[引用页]]。',
    '\\[[示例页]]、`[[示例页]]`、[[[示例页]]]，以及 [[示例别名]]。',
    '',
    '> ~~~md',
    '> [[示例页]]',
    '> ~~~',
    '',
    '    [[示例页]]',
  ].join('\r\n');
  const source = await create('引用页', body);
  const target = await create('目标页', '目标正文');
  const example = await create('示例页', '示例正文', { aliases: ['示例别名'] });
  const edge = [{ id: source.id, title: source.title }];
  assert.deepEqual((await detail(target.id)).backlinks, edge);
  assert.deepEqual((await detail(source.id)).backlinks, []);
  assert.deepEqual((await detail(example.id)).backlinks, []);
  assert.equal((await detail(source.id)).body, body);

  const duplicate = await create('目标页', '同名正文');
  assert.deepEqual((await detail(duplicate.id)).backlinks, []);
  assert.deepEqual((await detail(target.id)).backlinks, []);
  await remove(duplicate.id);
  assert.deepEqual((await detail(target.id)).backlinks, edge);

  await update(target.id, 1, '改名目标', '目标正文');
  assert.deepEqual((await detail(target.id)).backlinks, []);
  await update(source.id, 1, '改名引用', '迁移到 [[改名目标]]。');
  assert.deepEqual((await detail(target.id)).backlinks, [{ id: source.id, title: '改名引用' }]);
  await update(source.id, 2, '改名引用', '删除出边。');
  assert.deepEqual((await detail(target.id)).backlinks, []);

  const db = openSearchDatabase(path.join(root, 'state', 'search-index.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_relation BEFORE INSERT ON relations BEGIN SELECT RAISE(ABORT, 'test fault'); END");
    const linked = await create('降级引用', '保存并引用 [[改名目标]]。');
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'index_dirty'").pluck().get(), '1');
    assert.deepEqual(db.prepare('SELECT * FROM relations').all(), []);
    assert.equal((await detail(linked.id)).body, linked.body);
    assert.deepEqual((await detail(target.id)).backlinks, [{ id: linked.id, title: linked.title }]);
    await remove(linked.id);
    assert.deepEqual((await detail(target.id)).backlinks, []);
  } finally {
    db.close();
  }
});

test(
  'review HTTP flows preserve original bytes, update only permitted metadata, and annotate real citations',
  { timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-wiki-review-http-'));
    const raws = new RawStore(root);
    const wiki = new WikiStore(root, raws);
    await raws.initialize();
    await wiki.initialize();
    const raw = await raws.create(rawInput('独立编辑的原始来源', '原始内容第一版。'));
    const suffix = '# 渠道端架复核口径\r\n\r\n## 来源事实\r\n\r\n合成句子📦统一端架资料。\r\n\r\n';
    const topic = '渠道端架复核口径';
    const page = await wiki.create(wikiInput(topic, 'body', { sources: [raw.id] }));
    const wikiFile = path.join(root, 'knowledge', 'wiki', `${page.id}.md`);
    const front = (await readFile(wikiFile, 'utf8')).split('\n---\n', 1)[0];
    await writeFile(
      wikiFile,
      `${front}\nunknown: {owner: 'saved', stamp: 2024-02-29}\nsource_published_at: 2024-02-31\n---\n${suffix}`,
    );
    const rawEdit = (raw: { bodySha256: string; bodyRevision?: number }, body: string) => ({
      body,
      expectedBodySha256: raw.bodySha256,
      expectedBodyRevision: raw.bodyRevision ?? 0,
    });
    const alternate = '陈列端架巡检说明';
    const matching = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        wiki.create(wikiInput(`独立旧页 ${i}`, `本页描述${alternate}的货架设计。`, { aliases: [alternate] })),
      ),
    );
    const weak = await wiki.create(wikiInput('旧页弱匹配', '市场渠道产品资料与经营数据。\n[[受限链接别称]]'));
    const denied = await restrictedWiki(wiki, raws, alternate, '受限旧页合成标记。\n[[旧页弱匹配]]', ['受限链接别称']);
    const fake = await startFakeProvider((request) => {
      const payload = JSON.parse(request.user);
      const item = payload.wiki.find((item: { id: string }) => item.id === page.id);
      assert(item);
      assert(!Object.hasOwn(item, 'freshness'));
      assert(!Object.hasOwn(item, 'review_trigger_checkpoint'));
      const quote = '合成句子📦统一端架资料。';
      const chunk = item.chunks.find((chunk: { rawText: string }) => chunk.rawText.includes(quote));
      const start = chunk.startOffset + chunk.rawText.indexOf(quote);
      return {
        kind: 'content',
        content: JSON.stringify({
          version: 1,
          needsRaw: [],
          sections: [{ kind: 'fact', text: '合成结论。', citationIds: ['evidence'] }],
          citations: [{ id: 'evidence', kind: 'wiki', recordId: page.id, quote, start, end: start + quote.length }],
        }),
      };
    });
    t.after(() => fake.close());
    const api = await server(t, root, {
      FMCG_LLM_BASE_URL: fake.url,
      FMCG_LLM_MODEL: 'test-review',
      FMCG_LLM_API_KEY: 'isolation-key-review',
    });
    const wi = `/api/wiki/${page.id}`;
    const rawPath = `/api/raw/${raw.id}/body`;
    const first = await api(rawPath, rawEdit(raw, '原始内容第二版。'), 'PATCH');
    assert.equal(first.status, 200);
    assert.equal((await api(rawPath, rawEdit(raw, '并发陈旧编辑。'), 'PATCH')).status, 409);
    const initial = await until(async () => {
      const result = await api(wi);
      return result.data.freshness?.reminders.length ? result.data : undefined;
    });
    assert.equal(initial.revision, 1);
    assert.equal(initial.freshness.status, 'unverified');
    assert.deepEqual(
      initial.freshness.reminders.map(({ kind, rawId, bodyRevision }: Record<string, unknown>) => [
        kind,
        rawId,
        bodyRevision,
      ]),
      [['source_changed', raw.id, 1]],
    );
    assert.equal((await api(`/api/wiki/${weak.id}`)).data.freshness.reminders.length, 0);

    const confirm = await api(`${wi}/review/confirm`, { baseRevision: 1 });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    assert.equal(confirm.data.last_verified_at, wikiReviewDate());
    assert.equal(confirm.data.revision, 2);
    assert.equal(confirm.data.knowledge_status, 'inferred');
    assert.deepEqual(confirm.data.freshness.reminders, []);
    const afterConfirm = await readFile(wikiFile, 'utf8');
    assert(afterConfirm.endsWith(suffix));
    assert.deepEqual(parseWikiMarkdown(afterConfirm).body, parseWikiMarkdown(`${front}\n---\n${suffix}`).body);
    const metadata = yaml.load(afterConfirm.split(/^---\r?$/m)[1]) as Record<string, unknown>;
    assert.deepEqual(metadata.unknown, { owner: 'saved', stamp: new Date('2024-02-29') });
    assert.match(afterConfirm, /source_published_at: 2024-02-31/u);
    assert.equal((await api(`${wi}/review/confirm`, { baseRevision: 1 })).status, 409);

    const second = await api(rawPath, rawEdit(first.data, '同一天的第三版原始正文。'), 'PATCH');
    assert.equal(second.status, 200);
    await until(async () => {
      const result = await api(wi);
      return result.data.freshness?.reminders[0]?.bodyRevision === 2 ? result : undefined;
    });
    assert.equal(await readFile(wikiFile, 'utf8'), afterConfirm);
    const snooze = await api(`${wi}/review/snooze`, { baseRevision: 2 });
    assert.equal(snooze.status, 200);
    assert.equal(snooze.data.freshness.snoozed, true);
    assert.equal(await readFile(wikiFile, 'utf8'), afterConfirm);
    assert(
      (await api('/api/wiki/review-queue?view=snoozed')).data.items.some(
        ({ pageId }: { pageId: string }) => pageId === page.id,
      ),
    );
    assert(
      !(await api('/api/wiki/review-queue')).data.items.some(({ pageId }: { pageId: string }) => pageId === page.id),
    );
    assert.equal((await api(`${wi}/review/cycle`, { baseRevision: 2, reviewCycleDays: -1 })).status, 400);
    for (const [index, reviewCycleDays] of [45, null, 0].entries()) {
      const cycle = await api(`${wi}/review/cycle`, { baseRevision: 2 + index, reviewCycleDays });
      assert.equal(cycle.status, 200, JSON.stringify(cycle.data));
      assert.equal(cycle.data.last_verified_at, confirm.data.last_verified_at);
      assert.equal(cycle.data.review_cycle_days, reviewCycleDays);
      assert.equal(cycle.data.freshness.status, reviewCycleDays ? 'fresh' : 'evergreen');
      assert((await readFile(wikiFile, 'utf8')).endsWith(suffix));
    }

    const imported = await api('/api/raw/import', {
      metadata: rawInput(alternate, ''),
      body: '合成新登记文件，描述陈列端架巡检步骤。',
    });
    assert.equal(imported.status, 201, JSON.stringify(imported.data));
    const suggestions = await until(async () => {
      const details = await Promise.all(matching.map(({ id }) => api(`/api/wiki/${id}`)));
      const reminders = details.flatMap(({ data }) => data.freshness.reminders);
      return reminders.length === 3 ? reminders : undefined;
    });
    assert(
      suggestions.every(
        (item) =>
          item.rawId === imported.data.raw.id && item.origin === 'system_inference' && item.reason.includes('请比对'),
      ),
    );
    assert.equal((await api(`/api/wiki/${denied.id}`)).status, 403);
    assert.equal((await api(`/api/wiki/${denied.id}/export`)).status, 403);
    assert.equal((await api(`/api/wiki/${denied.id}/references`)).status, 403);
    assert.equal((await api(`/api/wiki/${denied.id}/review/confirm`, { baseRevision: 1 })).status, 403);
    const visible = (await api('/api/wiki')).data;
    const visiblePages = (await wiki.allRecords()).filter(({ id }) => id !== denied.id);
    assert.deepEqual(
      visible.items.map(({ id }: { id: string }) => id),
      visiblePages.map(({ id }) => id),
    );
    assert.equal(visible.categoryCounts.channel, matching.length + 2);
    assert.equal(visible.categoryCounts.company_business, 0);
    const found = (await api('/api/wiki?category=channel&q=' + encodeURIComponent(alternate))).data;
    assert.deepEqual(found.categoryCounts, visible.categoryCounts);
    assert.deepEqual(found.items.map(({ id }: { id: string }) => id).sort(), matching.map(({ id }) => id).sort());
    assert.deepEqual((await api('/api/wiki?q=' + encodeURIComponent('受限旧页合成标记'))).data.items, []);
    const queue = (await api('/api/wiki/review-queue')).data.items;
    assert.equal(queue.length, 5);
    assert(!queue.some(({ pageId }: { pageId: string }) => pageId === denied.id));
    assert.deepEqual((await api('/api/wiki/review-index')).data, { engine: 'sqlite_fts', sqlite: 'ready' });
    assert.deepEqual((await api('/api/wiki/review-queue?view=due_soon')).data.items, []);
    const unverified = (await api('/api/wiki/review-queue?view=unverified')).data.items;
    assert.equal(unverified.length, 5);
    assert(unverified.every((item: { status: string }) => item.status === 'unverified'));
    assert(!unverified.some(({ pageId }: { pageId: string }) => pageId === denied.id));
    for (const { pageId } of queue.filter(({ reminders }: { reminders: unknown[] }) => reminders.length)) {
      const detail = (await api(`/api/wiki/${pageId}`)).data;
      assert.deepEqual(found.items.find(({ id }: { id: string }) => id === pageId).freshness, detail.freshness);
    }
    const weakDetail = (await api(`/api/wiki/${weak.id}`)).data;
    assert.deepEqual(weakDetail.links, [{ target: '受限链接别称', status: 'missing', candidates: [] }]);
    assert.deepEqual(weakDetail.backlinks, []);
    assert.deepEqual((await api(`/api/wiki/${weak.id}/references`)).data.items, []);
    const weakRaw = await api('/api/raw', rawInput('市场情况', '市场渠道产品资料与经营数据。'));
    assert.equal(weakRaw.status, 201);

    const answer = await api('/api/knowledge/answers', { requestId: randomUUID(), question: topic });
    assert.equal(answer.status, 200, JSON.stringify(answer.data));
    assert.equal(answer.data.status, 'completed', JSON.stringify(answer.data.error));
    const citation = answer.data.citations[0];
    assert.equal(citation.freshness.status, 'evergreen');
    assert.equal(citation.freshness.snoozed, true);
    assert.equal(
      answer.data.readWiki.find(({ id }: { id: string }) => id === page.id).body.slice(citation.start, citation.end),
      citation.quote,
    );
    const citationPath = `/api/knowledge/answers/${answer.data.id}/citations/${citation.id}`;
    assert.deepEqual((await api(citationPath)).data, citation);
    assert.equal(citation.reviewRevision, 5);
    assert.equal((await api(citationPath + '/review', { baseRevision: citation.reviewRevision })).status, 200);
    const afterConfirmation = await api(citationPath);
    assert.equal(afterConfirmation.status, 200, JSON.stringify(afterConfirmation.data));
    const { freshness: afterFreshness, reviewRevision: afterRevision, ...afterEvidence } = afterConfirmation.data;
    const priorEvidence = { ...citation };
    delete priorEvidence.freshness;
    delete priorEvidence.reviewRevision;
    assert.deepEqual(afterEvidence, priorEvidence);
    assert.equal(afterRevision, 6);
    assert.equal(afterFreshness.snoozed, false);
    assert.equal(fake.requests.length, 1);
    assert.equal((await api(`/api/wiki/${weak.id}`)).data.freshness.reminders.length, 0);
    const lint = await api('/api/wiki-lint');
    assert.equal(lint.data.freshness.byStatus.evergreen, 1);
    assert.equal(lint.data.freshness.byStatus.unverified, matching.length + 1);
    assert(!lint.data.findings.some((finding: { objectId: string }) => finding.objectId === denied.id));
    assert(!JSON.stringify(lint.data).includes('受限旧页合成标记'));

    const stateFile = path.join(root, 'state', 'review-triggers.json');
    await writeFile(stateFile, '{ damaged JSON');
    const beforeFailure = await readFile(wikiFile, 'utf8');
    assert.equal((await api(`${wi}/review/confirm`, { baseRevision: afterRevision })).status, 500);
    assert.equal(await readFile(wikiFile, 'utf8'), beforeFailure);
    const third = await api(rawPath, rawEdit(second.data, '状态文件损坏时依然保存的第四版。'), 'PATCH');
    assert.equal(third.status, 200);
    assert.equal((await api(`/api/raw/${raw.id}`)).data.body, third.data.body);
    assert.equal((await api(wi)).data.freshness.remindersAvailable, false);
    assert.equal((await api(citationPath)).status, 409);
    assert.equal((await api(citationPath + '/review', { baseRevision: afterRevision })).status, 409);
    assert.equal((await api('/api/knowledge/answers/current')).data.citations[0].reviewRevision, undefined);
    assert.equal((await api('/api/knowledge/answers/current')).data.citations[0].quote, citation.quote);
    assert.equal(await readFile(wikiFile, 'utf8'), beforeFailure);
    assert.equal(await readFile(stateFile, 'utf8'), '{ damaged JSON');
  },
);

test('freshness switch restores ordinary Wiki response and skips new Raw reminders', { timeout: 45_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-wiki-review-off-'));
  const raws = new RawStore(root);
  const wiki = new WikiStore(root, raws);
  await raws.initialize();
  await wiki.initialize();
  const denied = await restrictedWiki(wiki, raws, '隔离开关复核资料', '受限的开关回退正文。');
  const api = await server(t, root, { WIKI_FRESHNESS_ENABLED: '0' });
  assert.equal((await api('/api/wiki/schema')).data.freshnessEnabled, undefined);
  assert.equal((await api('/api/wiki/review-index')).status, 404);
  const page = await api('/api/wiki', wikiInput('隔离开关复核资料公开页', '产品模型仍走旧检索。'));
  const raw = await api('/api/raw', rawInput(page.data.title, '产品模型仍走旧检索。'));
  assert.equal(raw.status, 201);
  assert.equal((await api(`/api/wiki/${page.data.id}`)).data.freshness, undefined);
  assert.equal((await api(`/api/wiki/${denied.id}`)).status, 403);
  const listed = (await api('/api/wiki?q=' + encodeURIComponent(denied.title))).data;
  assert.deepEqual(
    listed.items.map(({ id }: { id: string }) => id),
    [page.data.id],
  );
  assert.equal(listed.items[0].freshness, undefined);
  assert.equal(listed.categoryCounts.channel, 1);
  assert.equal(listed.categoryCounts.company_business, 0);
  await assert.rejects(readFile(path.join(root, 'state', 'review-triggers.json')), { code: 'ENOENT' });
});

test(
  'Raw similarity embeds in the background and keeps current and historical provider credentials local',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-wiki-review-embedding-'));
    const raws = new RawStore(root);
    const wiki = new WikiStore(root, raws);
    await raws.initialize();
    await wiki.initialize();
    const page = await wiki.create(wikiInput('隔离陈列复核主题', '这是只用于回环向量服务的旧页。'));
    const credentials = ['synthetic-main-key-for-review', 'synthetic-historical-key-for-review'];
    const localConfig = path.join(root, 'embedding-only.env');
    await writeFile(localConfig, `FMCG_LLM_API_KEY=${credentials[1]}\n`);
    const marker = 'syntheticdelayedquery';
    const requests: string[] = [];
    let releaseQuery!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const fake = createHttpServer(async (req, res) => {
      const bytes: Buffer[] = [];
      for await (const chunk of req) bytes.push(Buffer.from(chunk));
      const { input } = JSON.parse(Buffer.concat(bytes).toString('utf8')) as { input: string[] };
      requests.push(...input);
      if (input.some((text) => text.includes(marker))) await gate;
      res.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 0] })) }));
    }).listen(0, '127.0.0.1');
    await once(fake, 'listening');
    t.after(async () => {
      releaseQuery();
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    });
    const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
    const api = await server(t, root, {
      SEARCH_ENGINE: 'hybrid',
      EMBEDDING_BASE_URL: url,
      EMBEDDING_API_KEY: 'different-synthetic-vector-key',
      EMBEDDING_MODEL: 'synthetic-review-embedding',
      EMBEDDING_QUERY_TIMEOUT_MS: '10000',
      FMCG_LLM_API_KEY: credentials[0],
      FMCG_LLM_CONFIG_FILE: localConfig,
    });
    await until(async () => (requests.some((input) => input.includes(page.title)) ? true : undefined));
    const getReminder = async (rawId: string) => {
      const result = await api(`/api/wiki/${page.id}`);
      return result.data.freshness.reminders.find((item: { rawId: string }) => item.rawId === rawId);
    };
    const ordinary = await api('/api/raw', rawInput(marker, marker));
    assert.equal(ordinary.status, 201);
    await until(async () => (requests.some((input) => input.includes(marker)) ? true : undefined));
    assert.equal((await api(`/api/raw/${ordinary.data.id}`)).data.body, marker);
    assert.equal(await getReminder(ordinary.data.id), undefined);
    releaseQuery();
    const semantic = await until(() => getReminder(ordinary.data.id));
    assert.match(semantic.reason, /语义相似度较高/u);

    const beforeSecret = requests.length;
    for (const credential of credentials) {
      const privateInput = await api('/api/raw', rawInput(page.title, `此 Raw 包含回环测试凭据 ${credential}`));
      assert.equal(privateInput.status, 201);
      const local = await until(() => getReminder(privateInput.data.id));
      assert.match(local.reason, /标题或别名高度相似/u);
    }
    assert.equal(requests.length, beforeSecret);
    assert(!requests.some((input) => credentials.some((credential) => input.includes(credential))));
  },
);
