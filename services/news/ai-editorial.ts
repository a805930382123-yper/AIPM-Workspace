import { createHash } from 'node:crypto';
import { JSON_SCHEMA, load } from 'js-yaml';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readSourceBytes, sourceAttempt } from './source-health.ts';
import type { NewsItem, SourceResult } from './types.ts';

const candidateLimit = 3;
const github = 'https://api.github.com';
const cookbookFiles = '/repos/openai/openai-cookbook/contents/';
const hfBlogFiles = '/repos/huggingface/blog/contents/';
const anthropic = 'https://www.anthropic.com';
const simon = 'https://simonwillison.net';
const simonFeed = `${simon}/tags/prompt-engineering.atom`;
const anthropicArticle = /^\/(?:engineering|research)\/[a-z0-9-]+\/?$/iu;

type Material = Pick<NewsItem, 'title' | 'url' | 'publishedAt' | 'author' | 'excerpt' | 'evidenceKind'>;
type EditorialSource = { id: string; name: string; homepage: string; read(now: Date): Promise<SourceResult> };
type Attempt = ReturnType<typeof sourceAttempt>;

function plain(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function dateOnly(value: unknown): string | null {
  const date = plain(value);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/u.test(date);
  const englishDay = /^[a-z]{3,9} (\d{1,2}), \d{4}$/iu.exec(date)?.[1];
  if (!isoDate && !englishDay) return null;
  const timestamp = Date.parse(isoDate ? date : `${date} GMT`);
  if (!Number.isFinite(timestamp)) return null;
  const day = new Date(timestamp).toISOString().slice(0, 10);
  return (isoDate ? day === date : Number(day.slice(-2)) === Number(englishDay)) ? day : null;
}

function officialUrl(url: URL, origin: string): boolean {
  return url.origin === origin && !url.username && !url.password && !url.search && !url.hash;
}

async function githubFile(path: string): Promise<string> {
  const raw = 'application/vnd.github.raw+json';
  const bytes = await readSourceBytes(
    github + path,
    (url) => officialUrl(url, github) && url.pathname === path,
    raw,
    /^(?:application\/vnd\.github\.raw\+json|text\/plain)(?:;|$)/iu,
    512 * 1024,
    6000,
    true,
  );
  return bytes.toString('utf8');
}

function yaml(source: string): unknown {
  return load(source, { schema: JSON_SCHEMA });
}

function excerptFrom(paragraphs: string[]): string {
  const retained: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs.filter(Boolean)) {
    if (length + paragraph.length > 1500) return retained.length ? retained.join('\n\n') : paragraph.slice(0, 1500);
    retained.push(paragraph);
    length += paragraph.length + 2;
  }
  return retained.join('\n\n');
}

function editorialSource(
  source: Omit<EditorialSource, 'read'>,
  collect: (now: Date, attempt: Attempt, publish: (material: Material) => void) => Promise<void>,
): EditorialSource {
  return {
    ...source,
    async read(now) {
      const attempt = sourceAttempt(source, now);
      const items: NewsItem[] = [];
      const seen = new Set<string>();
      try {
        await collect(now, attempt, (material) => {
          if (
            !material.title ||
            material.excerpt.length < 60 ||
            !material.publishedAt ||
            Date.parse(material.publishedAt) > now.getTime()
          ) {
            attempt.counts.rejected++;
            return;
          }
          if (seen.has(material.url)) {
            attempt.counts.duplicates++;
            return;
          }
          seen.add(material.url);
          items.push({
            ...material,
            title: material.title.slice(0, 300),
            sourceId: source.id,
            sourceName: source.name,
            id: createHash('sha256').update(material.url).digest('hex').slice(0, 24),
            fetchedAt: now.toISOString(),
          });
        });
      } catch (error) {
        attempt.fail(error, attempt.stage);
      }
      return { items, sources: [attempt.finish(items.length)] };
    },
  };
}

const openaiCookbook = editorialSource(
  { id: 'openai-cookbook', name: 'OpenAI Cookbook', homepage: 'https://developers.openai.com/cookbook' },
  async (now, attempt, publish) => {
    const registry = await githubFile(cookbookFiles + 'registry.yaml');
    attempt.stage = 'parse';
    const rows = yaml(registry);
    if (!Array.isArray(rows)) throw Error('Cookbook registry');
    const candidates = rows
      .map((row) => ({ row, date: dateOnly(row?.date) }))
      .filter(({ date }) => date && Date.parse(date) <= now.getTime())
      .sort((a, b) => b.date!.localeCompare(a.date!))
      .slice(0, candidateLimit);
    if (!candidates.length) return;

    let authors: Record<string, { name?: unknown }> = {};
    try {
      attempt.stage = 'detail';
      const authorFile = await githubFile(cookbookFiles + 'authors.yaml');
      attempt.stage = 'parse';
      const names = yaml(authorFile);
      if (!names || typeof names !== 'object' || Array.isArray(names)) throw Error('Cookbook authors');
      authors = names as typeof authors;
    } catch (error) {
      attempt.fail(error, attempt.stage);
    }

    for (const { row, date } of candidates) {
      attempt.counts.candidates++;
      const path = plain(row.path);
      if (!/^(?:articles|examples)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:md|ipynb)$/iu.test(path)) {
        attempt.counts.rejected++;
        continue;
      }
      const names: string[] = Array.isArray(row.authors) ? row.authors.map(plain).filter(Boolean) : [];
      const author = names.map((name) => plain(Object.hasOwn(authors, name) && authors[name]?.name) || name).join('、');
      const url = `https://developers.openai.com/cookbook/${path.replace(/\.(?:md|ipynb)$/iu, '').toLowerCase()}`;
      publish({
        title: plain(row.title),
        url,
        publishedAt: date,
        ...(author ? { author } : {}),
        excerpt: plain(row.description).slice(0, 1200),
        evidenceKind: 'source_summary',
      });
    }
  },
);

const anthropicEngineering = editorialSource(
  { id: 'anthropic-engineering', name: 'Anthropic Engineering', homepage: `${anthropic}/engineering` },
  async (_now, attempt, publish) => {
    const page = async (path: string) => {
      const bytes = await readSourceBytes(
        anthropic + path,
        (url) => officialUrl(url, anthropic) && url.pathname.replace(/\/$/u, '') === path.replace(/\/$/u, ''),
        'text/html',
        /^text\/html(?:;|$)/iu,
        1024 * 1024,
        6000,
        true,
      );
      attempt.stage = 'parse';
      return new JSDOM(bytes.toString('utf8'), { virtualConsole: new VirtualConsole() });
    };
    const listing = await page('/engineering');
    const paths = new Set<string>();
    try {
      for (const row of listing.window.document.querySelectorAll('main article')) {
        const path = row.querySelector('h3 a[href]')?.getAttribute('href') || '';
        if (anthropicArticle.test(path)) paths.add(path.replace(/\/$/u, ''));
        if (paths.size >= candidateLimit) break;
      }
      if (!paths.size) throw Error('Anthropic Engineering listing');
    } finally {
      listing.window.close();
    }

    for (const path of paths) {
      attempt.counts.candidates++;
      try {
        attempt.stage = 'detail';
        const detail = await page(path);
        try {
          const doc = detail.window.document;
          const meta = doc.querySelector('script[type="application/ld+json"]');
          const data = meta ? JSON.parse(meta.textContent || '{}') : {};
          const author = data['@type'] === 'Article' ? plain(data.author?.name) : '';
          const content = [...doc.querySelectorAll('main article p.post-text')];
          if (!content.length) throw Error('Anthropic Engineering article');
          publish({
            title: plain(doc.querySelector('main h1')?.textContent),
            url: anthropic + path,
            publishedAt: dateOnly(
              doc.querySelector('main article time[datetime]')?.getAttribute('datetime') ||
                plain(data.datePublished).slice(0, 10),
            ),
            ...(author ? { author } : {}),
            excerpt: excerptFrom(content.map((p) => plain(p.textContent))),
            evidenceKind: 'article_excerpt',
          });
        } finally {
          detail.window.close();
        }
      } catch (error) {
        attempt.fail(error, attempt.stage);
      }
    }
  },
);

const huggingFaceBlog = editorialSource(
  { id: 'huggingface-blog', name: 'Hugging Face 官方博客', homepage: 'https://huggingface.co/blog' },
  async (now, attempt, publish) => {
    const index = await githubFile(hfBlogFiles + '_blog.yml');
    attempt.stage = 'parse';
    const rows = yaml(index);
    if (!Array.isArray(rows)) throw Error('Hugging Face blog index');
    const candidates = rows
      .map((row) => ({ slug: plain(row?.local), date: dateOnly(row?.date) }))
      .filter(({ slug, date }) => /^[a-z0-9_-]+$/iu.test(slug) && date && Date.parse(date) <= now.getTime())
      .sort((a, b) => b.date!.localeCompare(a.date!))
      .slice(0, candidateLimit);
    for (const { slug, date } of candidates) {
      attempt.counts.candidates++;
      try {
        attempt.stage = 'detail';
        const article = await githubFile(`${hfBlogFiles}${slug}.md`);
        attempt.stage = 'parse';
        const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(article);
        if (!frontMatter) throw Error('Hugging Face blog metadata');
        const data = yaml(frontMatter[1]) as { title?: string; authors?: { user?: string }[] } | null;
        const author = Array.isArray(data?.authors)
          ? data.authors
              .map((row) => plain(row?.user))
              .filter(Boolean)
              .join('、')
          : '';
        const paragraphs = article
          .slice(frontMatter[0].length)
          .replace(/```[\s\S]*?```|<!--[\s\S]*?-->|!\[[^\]]*\]\([^\n]+?\)|<[^>]+>/gu, '')
          .split(/\r?\n\s*\r?\n/u)
          .map((block) => plain(block.replace(/\[(.*?)\]\([^\n]+?\)/gu, '$1').replace(/[`*]/gu, '')))
          .filter((block) => block.length >= 30 && !/^#/u.test(block));
        publish({
          title: plain(data?.title),
          url: `https://huggingface.co/blog/${slug}`,
          publishedAt: date,
          ...(author ? { author } : {}),
          excerpt: excerptFrom(paragraphs),
          evidenceKind: 'article_excerpt',
        });
      } catch (error) {
        attempt.fail(error, attempt.stage);
      }
    }
  },
);

const simonPromptEngineering = editorialSource(
  { id: 'simon-prompt-engineering', name: 'Simon Willison 提示词专题', homepage: `${simon}/tags/prompt-engineering/` },
  async (_now, attempt, publish) => {
    const bytes = await readSourceBytes(
      simonFeed,
      (url) => officialUrl(url, simon) && url.href === simonFeed,
      'application/atom+xml, application/xml, text/xml',
      /^(?:application\/(?:atom\+xml|xml)|text\/xml)(?:;|$)/iu,
      1024 * 1024,
      6000,
      true,
    );
    attempt.stage = 'parse';
    const feed = new JSDOM(bytes.toString('utf8'), { contentType: 'application/xml' });
    try {
      const doc = feed.window.document;
      if (!doc.querySelector('feed')) throw Error('Simon Willison Atom feed');
      const feedAuthor = plain(doc.querySelector('feed > author > name')?.textContent);
      for (const entry of [...doc.querySelectorAll('feed > entry')].slice(0, candidateLimit)) {
        attempt.counts.candidates++;
        const url = URL.parse(entry.querySelector('link[rel="alternate"]')?.getAttribute('href') || '');
        if (!url || !officialUrl(url, simon) || !/^\/\d{4}\/[a-z]{3}\/\d{1,2}\/[a-z0-9-]+\/$/iu.test(url.pathname)) {
          attempt.counts.rejected++;
          continue;
        }
        const summary = entry.querySelector('summary');
        let excerpt = plain(summary?.textContent).slice(0, 1200);
        if (summary?.getAttribute('type') === 'html') {
          const fragment = JSDOM.fragment(summary.textContent || '');
          for (const element of fragment.querySelectorAll('script, style')) element.remove();
          const paragraphs = [...fragment.querySelectorAll('p')]
            .map((paragraph) => plain(paragraph.textContent))
            .filter((paragraph) => !paragraph.startsWith('Tags:'));
          excerpt = excerptFrom(paragraphs.length ? paragraphs : [plain(fragment.textContent)]);
        }
        const published = plain(entry.querySelector('published')?.textContent);
        const author = plain(entry.querySelector('author > name')?.textContent) || feedAuthor;
        publish({
          title: plain(entry.querySelector('title')?.textContent),
          url: url.href,
          publishedAt: Number.isFinite(Date.parse(published)) ? published : null,
          ...(author ? { author } : {}),
          excerpt,
          evidenceKind: 'source_summary',
        });
      }
    } finally {
      feed.window.close();
    }
  },
);

export const editorialSources: readonly EditorialSource[] = [
  openaiCookbook,
  anthropicEngineering,
  huggingFaceBlog,
  simonPromptEngineering,
];
