import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { editorialSources } from '../services/news/ai-editorial.ts';

const now = new Date('2026-11-20T04:00:00Z');
const method = 'Measure the failure modes against a repeatable task set and use the results to revise the workflow.';
const cookbookFiles = 'https://api.github.com/repos/openai/openai-cookbook/contents/';
const hfFiles = 'https://api.github.com/repos/huggingface/blog/contents/';
const raw = 'application/vnd.github.raw+json';
const engineering = 'https://www.anthropic.com';
const atom = 'https://simonwillison.net/tags/prompt-engineering.atom';

function responses(t: TestContext, routes: Record<string, () => Response>): string[] {
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    requested.push(url.href);
    assert.ok(Object.hasOwn(routes, url.href), `Unexpected request for ${url.href}`);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    return routes[url.href]();
  });
  return requested;
}
const body = (value: string, type: string) => () => new Response(value, { headers: { 'content-type': type } });

test('Cookbook reads the publication registry and the byline lookup in two requests', async t => {
  const urls = responses(t, {
    [cookbookFiles + 'registry.yaml']: body(`
- path: articles/older.md
  title: Earlier recipe
  description: ${method}
  date: 2026-10-29
- path: examples/current/README.md
  title: Current recipe
  description: ${method}
  date: 2026-11-18
  authors: [cookbook-writer]
- path: articles/future.md
  title: Scheduled recipe
  description: ${method}
  date: 2026-11-21
`, raw),
    [cookbookFiles + 'authors.yaml']: body('cookbook-writer: { name: Cookbook Writer }', raw),
  });
  const result = await editorialSources.find(source => source.id === 'openai-cookbook')!.read(now);
  assert.deepEqual(urls, [cookbookFiles + 'registry.yaml', cookbookFiles + 'authors.yaml']);
  assert.deepEqual(result.items.map(item => item.title), ['Current recipe', 'Earlier recipe']);
  assert.equal(result.items[0].publishedAt, '2026-11-18');
  assert.equal(result.items[0].author, 'Cookbook Writer');
  assert.equal(result.items[0].url, 'https://developers.openai.com/cookbook/examples/current/readme');
  assert.equal(result.items[0].excerpt, method);
  assert.equal(result.items[0].evidenceKind, 'source_summary');
  assert.equal(result.sources[0].diagnosis?.outcome, 'ok');
});

test('Anthropic limits article fetches, rejects a redirect outside its exact source path, and diagnoses a partial result', async t => {
  const details = ['agent-memory', 'redirect', 'busy', 'over-budget'];
  const urls = responses(t, {
    [engineering + '/engineering']: body(`<main>${details.map(slug => `<article><h3><a href="/research/${slug}">${slug}</a></h3></article>`).join('')}</main>`, 'text/html'),
    [engineering + '/research/agent-memory']: body(`<main><article><h1>Agent memory</h1><time datetime="2026-11-18">Nov 18</time>
      <script type="application/ld+json">{"@type":"Article","author":{"name":"Engineering Team"}}</script>
      <p>Related articles</p><p class="post-text">${method}</p></article></main>`, 'text/html'),
    [engineering + '/research/redirect']: () => new Response(null, { status: 302, headers: { location: 'https://www.anthropic.com.unrelated.invalid/article' } }),
    [engineering + '/research/busy']: () => new Response(null, { status: 503 }),
  });
  const result = await editorialSources.find(source => source.id === 'anthropic-engineering')!.read(now);
  assert.equal(urls.length, 4);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].author, 'Engineering Team');
  assert.equal(result.items[0].publishedAt, '2026-11-18');
  assert.equal(result.items[0].excerpt, method);
  assert.equal(result.items[0].evidenceKind, 'article_excerpt');
  assert.equal(result.sources[0].diagnosis?.outcome, 'partial');
  assert.equal(result.sources[0].diagnosis?.counts.failed, 2);
});

test('Hugging Face uses published article authors and calendar dates from its official publication files', async t => {
  const urls = responses(t, {
    [hfFiles + '_blog.yml']: body(`
- local: model-guide
  date: November 18, 2026
- local: missing-day
  date: November, 2026
- local: ../not-a-blog-post
  date: November 19, 2026
`, raw),
    [hfFiles + 'model-guide.md']: body(`---
title: Model evaluation guide
authors: [{ user: hf-writer }]
---

# Model evaluation guide

${method}

\`\`\`python
print('example code')
\`\`\`
`, raw),
  });
  const result = await editorialSources.find(source => source.id === 'huggingface-blog')!.read(now);
  assert.deepEqual(urls, [hfFiles + '_blog.yml', hfFiles + 'model-guide.md']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].publishedAt, '2026-11-18');
  assert.equal(result.items[0].author, 'hf-writer');
  assert.equal(result.items[0].url, 'https://huggingface.co/blog/model-guide');
  assert.equal(result.items[0].excerpt, method);
  assert.equal(result.items[0].evidenceKind, 'article_excerpt');
});

test('Simon Willison retains Atom publication time and quotation attribution without following external article links', async t => {
  const urls = responses(t, {
    [atom]: body(`<feed xmlns="http://www.w3.org/2005/Atom"><author><name>Simon Willison</name></author>
      <entry><title>Quoting a prompting guide</title><link rel="alternate" href="https://simonwillison.net/2026/Nov/18/prompting/"/>
        <published>2026-11-18T12:10:00+00:00</published><updated>2026-11-19T14:00:00+00:00</updated>
        <summary type="html">&lt;blockquote&gt;&lt;p&gt;${method}&lt;/p&gt;&lt;/blockquote&gt;
        &lt;p class="cite"&gt;— Prompting guide, example contributor&lt;/p&gt;&lt;p&gt;Tags: prompt-engineering&lt;/p&gt;</summary></entry>
      <entry><title>External link</title><link rel="alternate" href="https://elsewhere.invalid/2026/Nov/18/prompting/"/>
        <published>2026-11-18T12:10:00+00:00</published><summary>${method}</summary></entry>
    </feed>`, 'application/xml'),
  });
  const result = await editorialSources.find(source => source.id === 'simon-prompt-engineering')!.read(now);
  assert.deepEqual(urls, [atom]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].author, 'Simon Willison');
  assert.equal(result.items[0].publishedAt, '2026-11-18T12:10:00+00:00');
  assert.equal(result.items[0].excerpt, `${method}\n\n— Prompting guide, example contributor`);
  assert.equal(result.items[0].evidenceKind, 'source_summary');
  assert.equal(result.sources[0].diagnosis?.counts.rejected, 1);
});
