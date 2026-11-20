import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readSourceBytes, sourceAttempt } from './source-health.ts';
import type { NewsItem, SourceResult } from './types.ts';

const atom = 'http://www.w3.org/2005/Atom';
const channel = 'UCXUPKJO5MZQN11PqgIvyuvQ';
const blog = 'https://karpathy.bearblog.dev';
const profile = 'https://x.com/karpathy';
const clean = (text: string) => text.replace(/\s+/gu, ' ').trim();
type Entry = { title: string; url: string; date?: string | null; text: string; kind?: NewsItem['evidenceKind'] };
type Format = 'json' | 'xml' | 'html';
const mediaTypes: Record<Format, { accept: string; type: RegExp }> = {
  json: { accept: 'application/json', type: /^application\/json\b/iu },
  xml: { accept: 'application/atom+xml,application/xml,text/xml', type: /^(?:application\/(?:atom\+xml|xml)|text\/xml)\b/iu },
  html: { accept: 'text/html', type: /^text\/html\b/iu },
};
const child = (parent: Element, name: string) => [...parent.children].find(node => node.localName === name && node.namespaceURI === atom);

function readAtom(raw: string, youtube: boolean): Entry[] {
  const dom = new JSDOM(raw, { contentType: 'application/xml' });
  try {
    const feed = dom.window.document.documentElement;
    if (feed.localName !== 'feed' || feed.namespaceURI !== atom) throw new SyntaxError('Atom feed expected');
    return [...feed.children].filter(node => node.localName === 'entry' && node.namespaceURI === atom).slice(0, 8).map(entry => {
      const title = child(entry, 'title')?.textContent ?? '';
      const date = child(entry, 'published')?.textContent;
      if (youtube) {
        const video = entry.getElementsByTagNameNS('http://www.youtube.com/xml/schemas/2015', 'videoId')[0]?.textContent ?? '';
        const owner = entry.getElementsByTagNameNS('http://www.youtube.com/xml/schemas/2015', 'channelId')[0]?.textContent;
        return {
          title, date, url: owner === channel && /^[\w-]{11}$/u.test(video) ? `https://www.youtube.com/watch?v=${video}` : '',
          text: entry.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'description')[0]?.textContent ?? '',
        };
      }
      const link = [...entry.children].find(node => node.localName === 'link' && node.namespaceURI === atom &&
        (!node.hasAttribute('rel') || node.getAttribute('rel') === 'alternate'));
      const target = URL.parse(link?.getAttribute('href') ?? '', blog);
      const summary = child(entry, 'summary');
      const material = summary ?? child(entry, 'content');
      let text = material?.textContent ?? '';
      if (material?.getAttribute('type') === 'html') {
        const fragment = JSDOM.fragment(text);
        fragment.querySelectorAll('script,style').forEach(node => node.remove());
        text = fragment.textContent ?? '';
      }
      return {
        title, date, text,
        url: target?.origin === blog && !target.username && !target.password && /^\/[\w%-]+\/?$/u.test(target.pathname) &&
          !/^\/(?:blog|feed)\/?$/u.test(target.pathname) ? `${blog}${target.pathname}` : '',
        kind: summary ? 'source_summary' : 'article_excerpt',
      };
    });
  } finally { dom.window.close(); }
}

function readGitHub(raw: string): Entry[] {
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new SyntaxError('GitHub repository list expected');
  return rows.slice(0, 12).filter(row => row?.fork === false && row.owner?.login === 'karpathy').map(row => {
    const name = typeof row.name === 'string' ? row.name : '';
    return {
      title: name, url: /^[\w.-]+$/u.test(name) && row.html_url === `https://github.com/karpathy/${name}` ? row.html_url : '',
      date: typeof row.created_at === 'string' ? row.created_at : null,
      text: typeof row.description === 'string' ? row.description : '',
    };
  });
}

function readPublicPosts(raw: string): Entry[] {
  const dom = new JSDOM(raw, { virtualConsole: new VirtualConsole() });
  try {
    // X serves a signed-out preview of the profile with individual posts already in the HTML.
    const cards = [...dom.window.document.querySelectorAll('[role="link"][data-href] > article')];
    const posts = cards.filter(card => !card.parentElement?.closest('article'));
    const entries = posts.slice(0, 8).flatMap(card => {
      const path = card.parentElement?.getAttribute('data-href') ?? '';
      if (!/^\/karpathy\/status\/\d{1,20}$/u.test(path)) return [];
      const body = [...card.querySelectorAll('div[dir="auto"][lang]')].find(node => node.closest('article') === card);
      body?.querySelectorAll('button,script,style').forEach(node => node.remove());
      const bodyText = body?.textContent ?? '';
      const dateLabel = card.querySelector(`a[data-base-ui-tooltip-trigger][href="${path}"]`);
      const formatter = dateLabel?.nextElementSibling;
      const timestamp = formatter?.tagName === 'SCRIPT' ? formatter.textContent?.match(/"timestamp":(\d{13})\b/u)?.[1] : undefined;
      const date = dateLabel?.querySelector('time')?.getAttribute('datetime') ?? (timestamp ? new Date(Number(timestamp)).toISOString() : null);
      return [{ title: clean(bodyText.split('\n', 1)[0]).slice(0, 110), url: `https://x.com${path}`, date, text: bodyText, kind: 'article_excerpt' as const }];
    });
    if (!entries.length) throw new SyntaxError('No public posts visible on the X profile');
    return entries;
  } finally { dom.window.close(); }
}

const definitions: { id: string; name: string; homepage: string; url: string; format: Format; parse: (raw: string) => Entry[] }[] = [
  { id: 'karpathy-github', name: 'Karpathy · GitHub', homepage: 'https://github.com/karpathy?tab=repositories',
    url: 'https://api.github.com/users/karpathy/repos?per_page=12&sort=pushed', format: 'json', parse: readGitHub },
  { id: 'karpathy-blog', name: 'Karpathy · Bear Blog', homepage: `${blog}/blog/`,
    url: `${blog}/feed/`, format: 'xml', parse: raw => readAtom(raw, false) },
  { id: 'karpathy-youtube', name: 'Karpathy · YouTube', homepage: `https://www.youtube.com/channel/${channel}`,
    url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`, format: 'xml', parse: raw => readAtom(raw, true) },
  { id: 'karpathy-x', name: 'Karpathy · X 公开帖', homepage: profile, url: profile, format: 'html', parse: readPublicPosts },
];

export const karpathySources = definitions.map(({ id, name, homepage, url, format, parse }) => ({
  id, name, homepage,
  async read(now: Date): Promise<SourceResult> {
    const attempt = sourceAttempt({ id, name }, now);
    const items: NewsItem[] = [];
    try {
      const { accept, type } = mediaTypes[format];
      const bytes = await readSourceBytes(url, target => target.href === url, accept, type, 1024 * 1024, 8000, true);
      attempt.stage = 'parse';
      const entries = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const seen = new Set<string>();
      for (const entry of entries) {
        if (items.length === 5) break;
        attempt.counts.candidates++;
        const title = clean(entry.title), excerpt = clean(entry.text);
        if (!entry.url || !title || !excerpt) { attempt.counts.rejected++; continue; }
        if (seen.has(entry.url)) { attempt.counts.duplicates++; continue; }
        seen.add(entry.url);
        const time = Date.parse(entry.date ?? '');
        items.push({
          id: createHash('sha256').update(entry.url).digest('hex').slice(0, 24),
          sourceId: id, sourceName: name, author: 'Andrej Karpathy', url: entry.url, title: title.slice(0, 300),
          publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null, fetchedAt: now.toISOString(),
          excerpt: excerpt.slice(0, 1500), evidenceKind: entry.kind ?? 'source_summary',
        });
      }
      if (entries.length && !items.length) throw new SyntaxError('No usable source entries');
    } catch (error) { attempt.fail(error, attempt.stage); }
    return { items, sources: [attempt.finish(items.length)] };
  },
}));
