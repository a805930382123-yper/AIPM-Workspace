import assert from 'node:assert/strict';
import test from 'node:test';
import { karpathySources } from '../services/news/ai-karpathy.ts';

const now = new Date('2026-11-20T12:00:00Z');
const channel = 'UCXUPKJO5MZQN11PqgIvyuvQ';
const atom = (entries: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">${entries}</feed>`;
const response = (body: string, contentType: string) =>
  new Response(body, { headers: { 'Content-Type': contentType } });
const repo = (name: string, fork = false, owner = 'karpathy') => ({
  name,
  fork,
  owner: { login: owner },
  description: 'Model training project',
  html_url: `https://github.com/${owner}/${name}`,
  created_at: '2026-03-06T22:00:43Z',
  pushed_at: '2026-11-19T03:00:00Z',
});

test('Karpathy readers use owned channels, stable links and evidence from the response', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (value: URL, init: RequestInit) => {
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal);
    switch (value.href) {
      case 'https://api.github.com/users/karpathy/repos?per_page=12&sort=pushed':
        return response(
          JSON.stringify([repo('autoresearch'), repo('upstream', true), repo('unrelated', false, 'another')]),
          'application/json',
        );
      case 'https://karpathy.bearblog.dev/feed/':
        return response(
          atom(`<entry><title>Blog entry</title><link href="/entry/"/><published>2026-11-13T00:00:00Z</published><summary type="html">&lt;b&gt;Official summary&lt;/b&gt;</summary><content>Longer body</content></entry>
          <entry><title>Second entry</title><link href="/second/"/><content type="html">&lt;p&gt;Article body&lt;/p&gt;</content></entry>
          <entry><title>Offsite article</title><link href="https://other.example/copy"/><summary>Not an owned article</summary></entry>`),
          'application/atom+xml',
        );
      case `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`:
        return response(
          atom(`<entry><title>How I use LLMs</title><yt:channelId>${channel}</yt:channelId><yt:videoId>EWvNQjAaOHw</yt:videoId><published>2025-02-27T22:29:56+00:00</published><updated>2026-11-19T03:00:00Z</updated><media:group><media:description>Official video description</media:description></media:group></entry>
          <entry><title>Unrelated video</title><yt:channelId>UCsomeOtherAccount</yt:channelId><yt:videoId>8AnV7xAvpLQ</yt:videoId><media:group><media:description>Unrelated description</media:description></media:group></entry>`),
          'text/xml',
        );
      case 'https://x.com/karpathy':
        return response(
          `<main><div role="link" data-href="/karpathy/status/2119114537442189652"><article>
          <a data-base-ui-tooltip-trigger href="/karpathy/status/2119114537442189652">Nov 7</a><script>window.__xClientTextFormatters.run("id","formatter",{"timestamp":1794071251000});</script>
          <div dir="auto" lang="en">Original author post <button>Show more</button></div>
          <div role="link" data-href="/karpathy/status/2116957135661945283"><article><div dir="auto" lang="en">Nested quote</div></article></div>
          </article></div>
          <div role="link" data-href="/another/status/2116957135661945284"><article><div dir="auto" lang="en">Another account's post</div></article></div>
          <div role="link" data-href="/karpathy/status/2116957135661945285"><article><div role="link" data-href="/another/status/2116957135661945286"><article><div dir="auto" lang="en">Quote without author text</div></article></div></article></div></main>`,
          'text/html',
        );
      default:
        throw new Error(`Unexpected source: ${value.href}`);
    }
  });

  const [github, blog, youtube, x] = await Promise.all(karpathySources.map((source) => source.read(now)));
  assert.equal(fetch.mock.callCount(), 4);
  assert.deepEqual(
    karpathySources.map((source) => source.id),
    ['karpathy-github', 'karpathy-blog', 'karpathy-youtube', 'karpathy-x'],
  );
  for (const result of [github, blog, youtube, x]) {
    assert.equal(result.sources[0].diagnosis?.outcome, 'ok');
    assert.ok(result.items.every((item) => item.author === 'Andrej Karpathy' && item.fetchedAt === now.toISOString()));
  }
  assert.deepEqual(
    github.items.map(({ url, publishedAt, evidenceKind }) => [url, publishedAt, evidenceKind]),
    [['https://github.com/karpathy/autoresearch', '2026-03-06T22:00:43.000Z', 'source_summary']],
  );
  assert.deepEqual(
    blog.items.map(({ url, excerpt, evidenceKind }) => [url, excerpt, evidenceKind]),
    [
      ['https://karpathy.bearblog.dev/entry/', 'Official summary', 'source_summary'],
      ['https://karpathy.bearblog.dev/second/', 'Article body', 'article_excerpt'],
    ],
  );
  assert.deepEqual(
    youtube.items.map(({ url, publishedAt, excerpt, evidenceKind }) => [url, publishedAt, excerpt, evidenceKind]),
    [
      [
        'https://www.youtube.com/watch?v=EWvNQjAaOHw',
        '2025-02-27T22:29:56.000Z',
        'Official video description',
        'source_summary',
      ],
    ],
  );
  assert.deepEqual(
    x.items.map(({ url, publishedAt, excerpt, evidenceKind }) => [url, publishedAt, excerpt, evidenceKind]),
    [
      [
        'https://x.com/karpathy/status/2119114537442189652',
        new Date(1794071251000).toISOString(),
        'Original author post',
        'article_excerpt',
      ],
    ],
  );
});

test('Karpathy sources report Cloudflare errors, offsite redirects and missing public posts', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (target: URL) => {
    switch (target.hostname) {
      case 'karpathy.bearblog.dev':
        return new Response('Just a moment', { status: 403 });
      case 'www.youtube.com':
        return new Response(null, { status: 302, headers: { Location: 'https://other.example/feed' } });
      case 'x.com':
        return response('<h1>Log in to X</h1>', 'text/html');
      default:
        throw new Error(`Unexpected source: ${target.href}`);
    }
  });
  const [blog, youtube, x] = await Promise.all(karpathySources.slice(1).map((source) => source.read(now)));
  assert.equal(fetch.mock.callCount(), 3);
  assert.deepEqual(
    [blog, youtube, x].map((result) => result.items.length),
    [0, 0, 0],
  );
  assert.equal(blog.sources[0].diagnosis?.error?.httpStatus, 403);
  assert.equal(youtube.sources[0].diagnosis?.outcome, 'failed');
  assert.equal(x.sources[0].diagnosis?.error?.type, 'parse');
});
