import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FormalNoteReader } from '../app/components/FormalNoteReader';

test('ordinary Markdown renders reading structure safely and does not mutate body', () => {
  const body = '## 标题\n\n段落\n\n- 一项\n\n> 引用\n\n```text\n代码\n```\n\n<script>window.bad=1</script>';
  const html = renderToStaticMarkup(createElement(FormalNoteReader, { body }));
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<li>一项<\/li>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<code/);
  assert.doesNotMatch(html, /<script/);
  assert.match(body, /<script>/);
});
