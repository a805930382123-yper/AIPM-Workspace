import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { chunkWikiPage } from '../services/search/chunking.ts';
import { renderStructuredNote } from '../services/wiki/structured-note.ts';

function checkChunks(body: string) {
  const chunks = chunkWikiPage({ id: 'wiki', title: '页面名称', body });
  let covered = 0;
  for (const [i, chunk] of chunks.entries()) {
    assert.equal(chunk.chunkId, `wiki#${i}`);
    assert.equal(chunk.chunkIndex, i);
    assert.equal(chunk.rawText, body.slice(chunk.startOffset, chunk.endOffset));
    assert.equal(chunk.rawHash, createHash('sha256').update(chunk.rawText).digest('hex'));
    assert.equal(chunk.charCount, chunk.rawText.length);
    assert.ok(chunk.charCount <= 1200);
    assert.ok(chunk.startOffset <= covered && chunk.endOffset > covered);
    covered = chunk.endOffset;
  }
  assert.equal(covered, body.length);
  return chunks;
}

test('formal headings and attributed paragraphs separate source-supported, inferred and unverified text', () => {
  const chunks = checkChunks(
    [
      '## 来源信息\r\n渠道材料',
      '## 摘要\r\n经营情况概要',
      '## 原始事实\r\n报表给出销售额。',
      '### 终端\r\n实际铺货 12 店。'.padEnd(190, ' '),
      '### AI 推断\r\n下季可能继续增店。',
      '### 其他实测\r\n现有门店覆盖率 24%。',
      '## 问答推断与建议（待核）\r\n预计有机会提价。',
      '## 待确认问题\r\n尚未核对门店样本。',
      '## 结构化笔记\r\n阅读问题：怎么铺货？\r\n- 【原文支持】 事实引用：fact-1 把货铺进十家店。\r\n- 【待核实】 试点日期。',
    ].join('\r\n\r\n'),
  );
  for (const [text, kind] of [
    ['渠道材料', 'meta'],
    ['经营情况概要', 'meta'],
    ['实际铺货', 'fact'],
    ['下季可能', 'inference'],
    ['24%', 'fact'],
    ['预计有机会', 'inference'],
    ['尚未核对', 'mixed'],
    ['把货铺进十家店', 'fact'],
    ['试点日期', 'mixed'],
  ]) {
    const chunk = chunks.find(({ rawText }) => rawText.includes(text));
    assert.equal(chunk?.sectionKind, kind, text);
  }
  assert.equal(chunks.find(({ rawText }) => rawText.includes('实际铺货'))?.headingPath, '原始事实 > 终端');
  assert.ok(chunks.every(({ rawText }) => !rawText.includes('实际铺货') || !rawText.includes('下季可能')));
});

test('standalone classification markers are hard boundaries while prose can mention a marker literally', () => {
  const chunks = checkChunks('【来源事实】 库存还有十二箱。\n【AI 推断】 推测需求在增加。\n正文提及【原文支持】一词。');
  assert.deepEqual(
    chunks.map(({ sectionKind }) => sectionKind),
    ['fact', 'inference', 'mixed'],
  );
});

test('third-level Wiki headings work without a second-level parent, and code fences keep fake headings literal', () => {
  const chunks = checkChunks(
    '### 本主题依据\n证据位置\n### **来源事实**\n终端是十家。\n```md\n## 推断\n```\n### AI 推断\n预计明年扩张。\n### 待核问题\n何时执行？',
  );
  assert.deepEqual(
    chunks.map(({ sectionKind }) => sectionKind),
    ['meta', 'fact', 'inference', 'mixed'],
  );
  assert.match(chunks[1].rawText, /## 推断/);
});

test('formal path diagrams separate attributed nodes and edges inside an inference section', () => {
  const body =
    renderStructuredNote(
      {
        version: 1,
        orientation: '渠道执行',
        sections: [
          {
            id: 'section',
            title: '推断',
            question: '渠道表现如何？',
            blocks: [
              {
                type: 'path_diagram',
                title: '补货路径',
                nodes: [
                  { id: 'a', text: '实测节点十二箱', role: 'source_supported', factIds: ['fact-1'] },
                  { id: 'b', text: '待核节点配送日期', role: 'needs_verification', factIds: [], reason: '未见排班表' },
                ],
                edges: [
                  { from: 'a', to: 'b', text: '实测边每日盘点', role: 'source_supported', factIds: ['fact-2'] },
                  {
                    from: 'b',
                    to: 'a',
                    text: '待核边节假日复盘',
                    role: 'needs_verification',
                    factIds: ['fact-1'],
                    reason: '缺少节日样本',
                  },
                ],
              },
            ],
          },
        ],
      },
      true,
    ) + '\n普通段落可提及【原文支持】作为示例。';
  const chunks = checkChunks(body);
  for (const [text, expected] of [
    ['实测节点', 'fact'],
    ['实测边', 'fact'],
    ['待核节点', 'mixed'],
    ['待核边', 'mixed'],
    ['作为示例', 'inference'],
  ]) {
    const chunk = chunks.find(({ rawText }) => rawText.includes(text));
    assert.equal(chunk?.sectionKind, expected, text);
    assert.equal(chunk?.headingPath, '推断 > 补货路径');
  }
});

test('a fourth-level sibling restores the inherited role and retains its own heading path', () => {
  const chunks = checkChunks('## 来源事实\n### 价格\n#### AI 推断\n假设\n#### 门店数\n实测');
  assert.deepEqual(
    chunks.map(({ sectionKind, headingPath, rawText }) => [sectionKind, headingPath, rawText]),
    [
      ['fact', '来源事实', '## 来源事实\n### 价格\n'],
      ['inference', '来源事实 > 价格 > AI 推断', '#### AI 推断\n假设\n'],
      ['fact', '来源事实 > 价格 > 门店数', '#### 门店数\n实测'],
    ],
  );
});

test('soft merge is limited to short siblings and preserves blank lines, while a flat page uses its title', () => {
  const flat = '# 内文单级标题\r\n\r\n扁平正文🧾\n\n';
  assert.equal(checkChunks(flat)[0].headingPath, '页面名称');
  assert.equal(checkChunks(flat)[0].rawText, flat);
  assert.deepEqual(checkChunks(''), []);
  const body = '## 政策\n' + '政策说明'.repeat(45) + '\n### 华东\n短说明。\n\n### 华南\n短说明。\n## 复盘\n短说明。';
  const chunks = checkChunks(body);
  assert.deepEqual(
    chunks.map(({ headingPath }) => headingPath),
    ['政策', '政策 > 华东', '复盘'],
  );
  assert.equal(chunks[1].rawText, '### 华东\n短说明。\n\n### 华南\n短说明。\n');
});

test('hard limits include overlap and keep UTF-16, CRLF, paragraph and sentence boundaries intact', () => {
  const paragraphEnd = '## 来源事实\r\n\r\n' + '（逐字引文）。'.repeat(135) + '\r\n\r\n';
  const fact = paragraphEnd + '无句末且含扩展字符🧾'.repeat(330);
  const chunks = checkChunks(fact + '\r\n## 推断\r\n' + '仍待核。'.repeat(380));
  assert.equal(chunks[0].rawText, paragraphEnd);
  assert.ok(chunks.length > 5);
  for (const [i, chunk] of chunks.entries()) {
    assert.doesNotMatch(chunk.rawText, /^[\udc00-\udfff]|[\ud800-\udbff]$/);
    assert.ok(!chunk.rawText.startsWith('\n') || chunks[i - 1]?.rawText.at(-1) !== '\r');
    const prev = chunks[i - 1];
    if (!prev) continue;
    const overlap = prev.endOffset - chunk.startOffset;
    if (prev.sectionKind === chunk.sectionKind) assert.ok(overlap >= 74 && overlap <= 126, String(overlap));
    else assert.equal(overlap, 0);
  }
});
