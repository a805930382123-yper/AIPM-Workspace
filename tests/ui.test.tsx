// B03: UI contract check without a browser. Renders the real components and asserts the
// controls, limits and states the browser self-check would look for. It cannot replace real
// browser interaction (recorded as NOT_RUN in the build report), but it does prove that the
// upload form, the retained-original wording, the paste fallback and the delete confirmation
// are actually rendered from the product code.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Raw } from '../app/api';
import { DeleteDialog, ImportDialog, RawPage } from '../app/pages/RawPage';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../services/raw/limits.ts';

const noop = () => undefined;
const settled = async () => undefined;
const base: Raw = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '渠道动销分析',
  sourceType: 'article',
  sourceName: '公众号来源',
  author: '作者',
  publishedAt: '2026-10-01',
  url: 'https://example.com/a',
  tags: ['渠道'],
  body: '原始正文内容',
  importedAt: '2026-10-05T02:00:00.000Z',
  status: 'unprocessed',
  bodySha256: 'b'.repeat(64),
};
const fileRaw: Raw = {
  ...base,
  title: '文件导入资料',
  assetId: '22222222-2222-4222-8222-222222222222',
  assetFileName: 'zh-report.md',
  assetFormat: 'markdown',
  assetByteSize: 337,
  assetSha256: 'c'.repeat(64),
  extractionNote: '按严格 UTF-8 解码；已去除编码 BOM，正文空白与换行原样保留（不做 trim、不解析 frontmatter）。',
};
function page(items: Raw[], props: { openImport?: boolean } = {}) {
  return renderToStaticMarkup(
    <RawPage
      items={items}
      selectedId={items[0]?.id ?? null}
      onSelected={noop}
      onOpenImport={noop}
      onCommitted={settled}
      openImport={props.openImport ?? false}
      onCloseImport={noop}
      onDeleted={settled}
      processing={{}}
      job={null}
      onJobStarted={noop}
      onOpenDraft={noop}
      onRefresh={settled}
    />,
  );
}

test('粘贴导入对话框保留原有文本流程与字符上限', () => {
  const html = renderToStaticMarkup(
    <ImportDialog onClose={noop} onCommitted={settled} onOpen={noop} onGenerate={settled} />,
  );
  assert.match(html, /导入原始资料/);
  assert.match(html, /粘贴文本/);
  assert.match(html, /上传文件/);
  assert.match(html, /<textarea/);
  assert.match(html, new RegExp(MAX_BODY_CHARS.toLocaleString('en-US')));
  assert.match(html, /正文写入后不可由 AI 改写/);
  assert.match(html, /仅保存 Raw/);
  assert.equal(html.includes('type="file"'), false, '粘贴模式不显示文件选择器');
  assert.match(html, /分隔符：中文\/英文逗号、顿号、分号 · 当前 0 项/);
});

test('文件上传对话框提供四种格式、20 MiB 与 500,000 字符边界', () => {
  const html = renderToStaticMarkup(
    <ImportDialog onClose={noop} onCommitted={settled} onOpen={noop} onGenerate={settled} prefill={fileRaw} />,
  );
  assert.match(html, /重新导入/);
  assert.match(html, /重新导入会创建新的 Raw ID/);
  assert.match(html, /不会自动复制上一条的原文件或转移 Wiki 来源/);
  assert.match(html, /请重新选择原文件/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="\.md,\.markdown,\.txt,\.docx,\.pdf"/);
  assert.match(html, new RegExp(`${MAX_UPLOAD_BYTES / 1024 / 1024} MiB`));
  assert.match(html, /严格 UTF-8/);
  assert.match(html, /扫描版 PDF 可以逐页阅读，加密 PDF 暂不支持/);
  assert.match(html, /从网页导入 Raw/);
  assert.doesNotMatch(html, /保存并生成 Wiki 草稿/, '重导入预填链接且尚未选文件时，只提供保存网页原文');
  const titleInput = /<input[^>]*placeholder="例如：经销商订货流程访谈纪要"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(titleInput, /value="文件导入资料"/, '重新导入必须预填标题');
  const sourceInput = /<input[^>]*placeholder="例如：客户访谈 \/ 公众号名称"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(sourceInput, /value="公众号来源"/, '重新导入必须预填来源名称');
  const tagInput = /<input[^>]*placeholder="用逗号或顿号分隔[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(tagInput, /value="渠道"/, '重新导入必须预填标签');
  assert.match(html, /当前 1 项（未修改，按原标签保存）/, '未编辑的标签必须按原数组保存');
});

test('Raw 详情区分“原件已保留”和粘贴资料', () => {
  const withAsset = page([fileRaw]);
  assert.match(withAsset, /原件已保留/);
  assert.match(withAsset, /zh-report\.md/);
  assert.match(withAsset, /Markdown/);
  assert.match(withAsset, new RegExp(fileRaw.assetSha256 as string));
  assert.match(withAsset, /提取说明/);
  assert.match(withAsset, /重新导入/);
  assert.match(withAsset, /删除/);
  const pasted = page([base]);
  assert.equal(pasted.includes('原件已保留'), false, '粘贴资料没有原件区块');
  assert.equal(pasted.includes('原始文件'), false);
  assert.match(pasted, /重新导入/);
  assert.match(pasted, /删除/);
});

test('导入入口渲染出对话框，空列表也有导入按钮', () => {
  const opened = page([base], { openImport: true });
  assert.match(opened, /导入原始资料/);
  const empty = page([]);
  assert.match(empty, /还没有原始资料/);
  assert.match(empty, /导入资料/);
});

test('删除确认先检查引用，未确认前不能删除', () => {
  const html = renderToStaticMarkup(<DeleteDialog item={fileRaw} onClose={noop} onDeleted={settled} />);
  assert.match(html, /删除「文件导入资料」/);
  assert.match(html, /正在检查引用关系/);
  assert.match(html, /确认删除/);
  assert.match(html, /disabled/);
  assert.match(html, /删除只由你的显式确认触发/);
});
