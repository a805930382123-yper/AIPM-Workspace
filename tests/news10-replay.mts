import { readNewResearch } from '../services/news/new-research.ts';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dir = path.resolve(process.argv[2]),
  events = (await readFile(path.join(dir, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === 'https://china.mintel.com/press-centre/')
    return new Response(await readFile('node_modules/.cache/news10-review/mintel-probe-64UpPY/directory.html'), {
      headers: { 'content-type': 'text/html' },
    });
  if (url === 'https://china.mintel.com/press-centre/feed/')
    return new Response(await readFile('node_modules/.cache/news10-review/mintel-probe-64UpPY/feed.xml'), {
      headers: { 'content-type': 'application/rss+xml' },
    });
  if (url === 'https://china.mintel.com/press-centre/flavour-innovation-trends/')
    return new Response(await readFile('node_modules/.cache/news10-review/mintel-probe-64UpPY/detail.html'), {
      headers: { 'content-type': 'text/html' },
    });
  const start = events.find((x) => x.event === 'start' && x.url === url);
  if (!start) return new Response('', { status: 503 });
  const h = events.find((x) => x.id === start.id && x.event === 'headers');
  if (!h) return new Response('', { status: 503 });
  if (h.status === 301)
    return new Response('', {
      status: 301,
      headers: { location: url.replace('https://kpmg.com/', 'https://assets.kpmg.com/') },
    });
  const b = await readFile(path.join(dir, start.id + '.bin'));
  return new Response(b, {
    status: h.status,
    headers: { 'content-type': url.includes('.pdf') ? 'application/pdf' : 'text/html' },
  });
};
const r = await readNewResearch(new Date('2026-11-12T09:40:00Z'), undefined, true);
await writeFile(path.join(dir, 'replay-result.json'), JSON.stringify(r, null, 2));
console.log(
  JSON.stringify(
    {
      sources: r.sources,
      items: r.items.map(({ title, url, publishedAt, research, excerpt }) => ({
        title,
        url,
        publishedAt,
        research,
        excerptLength: excerpt.length,
      })),
    },
    null,
    2,
  ),
);
