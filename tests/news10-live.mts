import { normalizedUrl, normalizedTitle } from '../services/news/normalize.ts';
import { readFile } from 'node:fs/promises';
import { readNewResearch } from '../services/news/new-research.ts';
import { mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const parent = path.resolve('node_modules/.cache');
await mkdir(parent, { recursive: true });
const dir = await mkdtemp(path.join(parent, 'news10-live-')),
  log = async (e: unknown) => appendFile(path.join(dir, 'events.jsonl'), JSON.stringify(e) + '\n'),
  orig = fetch,
  pending: Promise<void>[] = [];
let id = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input),
    n = ++id,
    t = Date.now();
  await log({ id: n, url, event: 'start', at: new Date().toISOString() });
  try {
    const r = await orig(input, init);
    await log({ id: n, event: 'headers', status: r.status, ms: Date.now() - t });
    pending.push(
      (async () => {
        const reader = r.clone().body!.getReader(),
          parts = [];
        let size = 0;
        for (;;) {
          const v = await reader.read();
          if (v.done) break;
          size += v.value.length;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw Error('limit');
          }
          parts.push(v.value);
        }
        const bytes = Buffer.concat(parts);
        await writeFile(path.join(dir, n + '.bin'), bytes);
        await log({
          id: n,
          event: 'complete',
          ms: Date.now() - t,
          bytes: size,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      })().catch(async (e) => {
        await log({ id: n, event: 'snapshot-error', ms: Date.now() - t, error: String(e) });
      }),
    );
    return r;
  } catch (e) {
    await log({ id: n, event: 'fetch-error', ms: Date.now() - t, error: String(e) });
    throw e;
  }
};
try {
  const prior = JSON.parse(await readFile('node_modules/.cache/news10-live-nJrGHZ/result.json', 'utf8')) as {
    items: Array<{ url: string; title: string }>;
  };
  const exclusions = {
    urls: new Set(prior.items.map((x) => normalizedUrl(x.url))),
    titles: new Set(prior.items.map((x) => normalizedTitle(x.title))),
  };
  const result = await readNewResearch(new Date(), exclusions, true);
  await Promise.all(pending);
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        dir,
        sources: result.sources,
        items: result.items.map(({ title, url, publishedAt, research }) => ({ title, url, publishedAt, research })),
      },
      null,
      2,
    ),
  );
} catch (e) {
  await Promise.all(pending);
  await log({ event: 'fatal', error: String(e) });
  console.log(JSON.stringify({ dir, error: String(e) }));
}
