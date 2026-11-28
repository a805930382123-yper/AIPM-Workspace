import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore, type WikiRecord } from '../services/wiki/store.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-wiki-catalog-bench-'));
const pageCount = 1_000;
const samples = 15;
const date = new Date().toISOString();
const routes = ['/api/wiki', '/api/wiki?category=channel&q=sku07', '/api/stats'] as const;
const results = [];
const expected = new Map<string, unknown>();

try {
  const directory = path.join(root, 'knowledge', 'wiki');
  await mkdir(directory, { recursive: true });
  const wiki = new WikiStore(root, new RawStore(root));
  for (let start = 0; start < pageCount; start += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, offset) => {
        const number = start + offset;
        const id = 'a3300000-0000-4000-8000-' + String(number).padStart(12, '0');
        const page: WikiRecord = {
          id,
          title: '合成工作台页面 ' + number,
          type: 'concept',
          domain: 'fmcg',
          category: number % 2 ? 'channel' : 'supply_chain',
          sources: number === 7 ? ['b3300000-0000-4000-8000-000000000001'] : [],
          tags: ['渠道', '复核'],
          aliases: ['sku' + String(number % 50).padStart(2, '0')],
          revision: 1,
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'D',
          review_status: 'unreviewed',
          created: date,
          updated: date,
          body: '## 来源事实\n\n本条为合成渠道营运资料，按签约门店核对进货、陈列和库存。\n\n'.repeat(4),
        };
        return writeFile(path.join(directory, id + '.md'), wiki.pageContent(page));
      }),
    );
  }

  for (const engine of ['sqlite_fts', 'legacy_scan']) {
    const probe = createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const isolated = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(FMCG_LLM_|EMBEDDING_|SEARCH_)/i.test(name)),
    );
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...isolated,
        FMCG_DATA_DIR: root,
        FMCG_PORT: String(port),
        FMCG_LLM_CONFIG_FILE: path.join(root, 'missing.env'),
        SEARCH_ENGINE: engine,
        WIKI_FRESHNESS_ENABLED: '0',
      },
    });
    const closed = once(child, 'close');
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const request = (route: string) =>
      fetch('http://127.0.0.1:' + port + route, { signal: AbortSignal.timeout(10_000) });
    try {
      let ready = false;
      for (let i = 0; i < 750 && child.exitCode === null; i++) {
        if ((await request('/api/health').catch(() => undefined))?.ok) {
          ready = true;
          break;
        }
        await delay(50);
      }
      assert(ready, output);
      for (const route of routes) {
        const elapsed = [];
        for (let sample = -3; sample < samples; sample++) {
          const start = performance.now();
          const response = await request(route);
          const body = await response.json();
          const elapsedMs = performance.now() - start;
          assert.equal(response.status, 200, JSON.stringify(body).slice(0, 500));
          if (route === '/api/stats') {
            assert.equal(body.wikiCount, 999);
            assert.equal(body.thisWeekNewCount, 999);
          } else {
            assert.equal(body.items.length, route === '/api/wiki' ? 999 : 19);
            assert.equal(body.categoryCounts.channel, 499);
            assert.equal(body.categoryCounts.supply_chain, 500);
          }
          if (!expected.has(route)) expected.set(route, body);
          else assert.deepEqual(body, expected.get(route));
          if (sample >= 0) elapsed.push(elapsedMs);
        }
        elapsed.sort((a, b) => a - b);
        results.push({
          engine,
          route,
          samples,
          meanMs: +(elapsed.reduce((sum, value) => sum + value, 0) / samples).toFixed(2),
          p95Ms: +elapsed[Math.ceil(samples * 0.95) - 1].toFixed(2),
        });
      }
    } finally {
      child.kill();
      await closed;
    }
  }
  console.log('Node ' + process.version + ', ' + pageCount + ' Wiki pages');
  console.table(results);
} finally {
  await rm(root, { recursive: true, force: true });
}
