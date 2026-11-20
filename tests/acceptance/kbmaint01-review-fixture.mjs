import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lwFixture } from '../lw01-fixture.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'kbmaint01-review-'));
const data = path.join(run, 'data');
const fixture = await lwFixture(data);
const topics = [
  ['星砂计划终稿', '星砂计划规定2027年一季度上海地区直营店期末目标为80家。'],
  ['星砂计划渠道附件', '星砂计划规定2027年一季度上海地区直营店期末目标为110家。'],
  ['星砂库存盘点规则', '星砂门店每周二闭店前盘点库存，按箱登记实物数量。'],
  ['星砂门店库存作业手册', '星砂门店每周二闭店前盘点库存，按箱登记实物数量。'],
];
const ids = [];
for (const [title, body] of topics) {
  const raw = await fixture.rawStore.create({ title, body, sourceType: 'report', sourceName: '隔离合成样本', tags: [] });
  const page = await fixture.wiki.create({ title, body, type: 'metric', category: 'channel',
    sources: [raw.id], tags: [], aliases: [], knowledge_status: 'source_supported',
    confidence: 'low', source_level: 'D', review_status: 'unreviewed' });
  ids.push(page.id);
}
const hashes = {};
for (const branch of ['knowledge/wiki', 'knowledge/raw', 'drafts']) {
  const base = path.join(data, branch);
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    hashes[path.relative(data, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const cached = { status: 'source_only', attempt: 1, startedAt: now.toISOString(), finishedAt: now.toISOString(), items: [], sources: [] };
await mkdir(path.join(data, 'state/news'), { recursive: true });
await writeFile(path.join(data, 'state/news', today + '.json'), JSON.stringify({ schemaVersion: 1,
  date: today, updatedAt: now.toISOString(), sections: { ai: cached, fmcg: { ...cached, contentVersion: 'research-v1' } } }));
await mkdir(path.join(run, 'vite-env'));
await writeFile(path.join(run, 'empty-provider.env'), '');
await writeFile(path.join(run, 'fixture.json'), JSON.stringify({ data, ids, hashes }, null, 2));
console.log(run);
