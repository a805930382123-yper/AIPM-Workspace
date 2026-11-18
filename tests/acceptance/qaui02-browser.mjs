import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { answerText, answerSelection } from '../../services/wiki/question-display.ts';

const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(session.provider, 'fake-only');
assert.equal(session.configuration, 'not-connected');
for (const url of [session.url, session.api]) assert.equal(new URL(url).hostname, '127.0.0.1');
const output = path.join(session.root, 'qaui02-evidence');
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.QAUI02_PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.QAUI02_BROWSER, args: ['--no-proxy-server'] });
const answers = '/api/knowledge/answers';
const pageErrors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.on('pageerror', error => pageErrors.push(error.message));
const panel = page.locator('.wiki-question');
const question = page.getByRole('textbox', { name: '知识库问题' });
const button = (name, target = page) => target.getByRole('button', { name, exact: true });
const status = panel.locator('.answer-status-summary');
const responseFor = (target, pathname, method = 'GET') => target.waitForResponse(response =>
  new URL(response.url()).pathname === pathname && response.request().method() === method
);
const askResponse = () => responseFor(page, answers, 'POST');
const control = async (name, body) => {
  const response = await fetch(session.api + '/__control/' + name, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.text());
};
const open = async target => {
  target.setDefaultTimeout(12_000);
  await target.goto(session.url);
  await target.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '知识库' }).click();
  const loaded = responseFor(target, answers + '/current');
  await button('向知识库提问', target).click();
  assert.equal((await loaded).status(), 200);
};
const readPreview = async target => {
  const preview = target.getByRole('region', { name: '问答保存预览' });
  await preview.getByText('实际选择的回答原文').click();
  return { preview, text: await preview.locator('pre').textContent() };
};

try {
  await open(page);
  assert.equal(await status.count(), 0);
  assert.equal(await button('提问').isDisabled(), true);
  await control('mode', { mode: 'raw' });
  await control('delay', { ms: 1300 });
  await question.fill(session.fixtures.question);
  const pending = askResponse();
  await question.press('Control+Enter');
  await status.getByText('正在依据已读资料生成回答', { exact: true }).waitFor();
  assert.equal(await button('提问中').isDisabled(), true);
  assert.equal(await button('提问中').locator('.answer-spinner').count(), 1);
  const actual = await (await pending).json();
  await status.getByText('回答完成', { exact: true }).waitFor();
  assert.equal(actual.attempts, 2);
  assert.match(await status.innerText(), /模型调用 2 次.*底层 Raw 2 份/su);
  const trace = panel.getByRole('button', { name: /本次实际读取与依据范围/u });
  assert.match(await trace.innerText(), /候选 \d+ 页 · 实读 3 页/u);
  await trace.click();
  assert.equal(await trace.getAttribute('aria-expanded'), 'true');
  assert.match(await panel.locator('#answer-reading-trace').innerText(), /已读 Wiki.*已读 Raw 原文.*原文片段\[.*必要性：/su);
  await trace.click();
  assert.equal(await panel.locator('#answer-reading-trace').count(), 0);
  const ordinary = panel.locator('.answer-prose');
  assert.ok((await ordinary.innerText()).includes(actual.sections[0].text.split('\n')[0]));

  await button('保存全部预览').click();
  const full = await readPreview(page);
  assert.equal(full.text, answerText(actual.sections));
  await button('取消预览').click();
  console.log('Idle, Ctrl+Enter, live loading, completed counts, trace, untagged fallback and full preview passed');

  for (const kind of ['wiki', 'raw']) {
    const index = actual.citations.findIndex(citation => citation.kind === kind);
    const citation = actual.citations[index];
    const row = panel.locator('#answer-citation-' + index);
    await panel.getByRole('link', { name: '查看引用依据 ' + (index + 1), exact: true }).first().click();
    assert.equal(new URL(page.url()).hash, '#' + await row.getAttribute('id'));
    assert.equal(await row.evaluate(node => node === document.activeElement), true);
    assert.match(await row.innerText(), kind === 'wiki' ? /Wiki 知识页/u : /Raw 原文/u);
    const checked = responseFor(page, answers + '/' + actual.id + '/citations/' + citation.id);
    await row.getByRole('button').click();
    const verified = await checked;
    assert.equal(verified.status(), 200);
    assert.equal((await verified.json()).recordId, citation.recordId);
    if (kind === 'wiki') {
      await page.locator('.wiki-detail').getByRole('heading', { name: citation.title, exact: true }).waitFor();
    } else {
      const mark = page.locator('mark[data-citation-start]');
      assert.equal(await mark.innerText(), citation.quote);
      assert.equal(Number(await mark.getAttribute('data-citation-start')), citation.start);
      assert.equal(Number(await mark.getAttribute('data-citation-end')), citation.end);
    }
    await open(page);
    await status.getByText('回答完成', { exact: true }).waitFor();
  }
  console.log('Citations anchor to evidence and open real isolated Wiki and Raw records after API validation');

  const visual = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  visual.on('pageerror', error => pageErrors.push(error.message));
  const names = ['安心', '补给', '尝鲜', '犒赏', '分享', '欢聚', '便利', '焕新'];
  const commonIds = actual.citations.slice(0, 2).map(citation => citation.id);
  const cards = names.map((name, index) => {
    const separator = index % 2 ? ':' : '：';
    return `【建议】${index + 1}. ${name}时刻${separator}消费者在${name}时刻有不同的需求。营销上可把这一场景放进陈列与文案。`;
  });
  const sections = [
    { id: 'fact', kind: 'fact', text: '【来源事实】合成资料记录了八类消费时刻。', citationIds: [commonIds[0]] },
    { id: 'intro', kind: 'advice', text: '【建议】以下是结合已读资料提出的经营建议。', citationIds: [] },
    ...cards.slice(0, 2).map((text, index) => ({ id: 'card-' + index, kind: 'advice', text, citationIds: [commonIds[index]] })),
    { id: 'cards', kind: 'advice', text: cards.slice(2).join('\n'), citationIds: commonIds },
  ];
  await visual.route('**' + answers + '/current', async route => route.fulfill({ json: { ...actual, sections } }));
  await open(visual);
  const grid = visual.locator('.answer-advice-grid');
  const items = grid.locator('.answer-advice-card');
  await items.last().waitFor();
  assert.equal(await items.count(), 8);
  assert.deepEqual(await items.locator('h5').allInnerTexts(), names.map(name => name + '时刻'));
  assert.equal(await items.getByText('场景含义', { exact: true }).count(), 8);
  assert.equal(await items.getByText('营销动作', { exact: true }).count(), 8);
  assert.doesNotMatch(await visual.locator('.answer-prose').innerText(), /【(?:来源事实|建议)】/u);
  assert.equal(await visual.getByText('对应问题：', { exact: false }).count(), 0);
  for (const [width, columns] of [[1440, 2], [390, 1]]) {
    await visual.setViewportSize({ width, height: 1000 });
    await visual.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await grid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), columns);
    const bounds = await visual.locator('.wiki-question').evaluate(node => {
      const prompt = node.querySelector('.wiki-question-prompt').getBoundingClientRect();
      const bar = node.querySelector('.answer-status-bar').getBoundingClientRect();
      const result = node.querySelector('.answer-result').getBoundingClientRect();
      return { stacked: prompt.bottom <= bar.top && bar.bottom <= result.top, pageWidth: document.documentElement.scrollWidth, panelWidth: node.scrollWidth, panelClient: node.clientWidth };
    });
    assert.ok(bounds.stacked && bounds.pageWidth <= width && bounds.panelWidth <= bounds.panelClient + 1 && (width !== 390 || bounds.panelClient > 330),
      `Unexpected layout at ${width}px: ${JSON.stringify(bounds)}`);
    await visual.locator('.wiki-question').screenshot({ path: path.join(output, `answer-${width}.png`) });
  }
  const start = '有不同的需求。', end = '消费者在补给时刻';
  const from = items.nth(0).getByText(/消费者在安心时刻/u);
  const to = items.nth(1).getByText(/消费者在补给时刻/u);
  await from.scrollIntoViewIfNeeded();
  const point = async (locator, phrase, after = false) => locator.evaluate((node, { phrase, after }) => {
    const range = document.createRange();
    const offset = node.textContent.indexOf(phrase) + (after ? phrase.length : 0);
    range.setStart(node.firstChild, offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.top + rect.height / 2 };
  }, { phrase, after });
  const first = await point(from, start);
  const last = await point(to, end, true);
  await visual.mouse.move(first.x, first.y);
  await visual.mouse.down();
  await visual.mouse.move(last.x, last.y, { steps: 20 });
  await visual.mouse.up();
  await button('保存选段预览', visual).click();
  const selected = await readPreview(visual);
  const expected = cards[0].slice(cards[0].indexOf(start)) + '\n\n【建议】' + cards[1].slice(0, cards[1].indexOf(end) + end.length);
  assert.equal(selected.text, expected);
  assert.deepEqual(answerSelection(sections, selected.text).sectionIds, ['card-0', 'card-1']);
  assert.deepEqual(answerSelection(sections, selected.text).citationIds, commonIds);
  assert.match(await selected.preview.innerText(), /保留依据：/u);
  console.log('Eight structured cards, desktop/mobile grids and real drag-selection preserve canonical text and both citation IDs');

  await control('delay', { ms: 0 });
  await control('fail-provider', { count: 1 });
  await question.fill(session.fixtures.question + '（复核）');
  const failed = askResponse();
  await button('提问').click();
  assert.equal((await (await failed).json()).status, 'failed');
  await status.getByText('回答失败，可明确重试', { exact: true }).waitFor();
  await panel.getByRole('heading', { name: '保留的已有答案' }).waitFor();
  const recovered = askResponse();
  await button('明确重试本次问题').click();
  assert.equal((await (await recovered).json()).status, 'completed');
  await status.getByText('回答完成', { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('Failed request retained the previous answer, explicit retry recovered, zero page errors');
  console.log(output);
} finally {
  await browser.close();
}
