import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
const layoutOnly = process.argv.includes('--layout');
assert.equal(session.provider, 'fake-only');
assert.equal(session.configuration, 'not-connected');
for (const url of [session.url, session.api]) assert.equal(new URL(url).hostname, '127.0.0.1');
const out = path.resolve('docs/reports/QAUI01-20261107-evidence');
await mkdir(out, { recursive: true });
const evidence = { checks: [], layouts: [], screenshots: [], pageErrors: [], success: false };
const { chromium } = createRequire(import.meta.url)(process.env.QAUI01_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await chromium.launch({ executablePath: process.env.QAUI01_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const answers = '/api/knowledge/answers';
const panel = page.locator('.wiki-question');
const question = page.getByLabel('知识库问题', { exact: true });
const button = name => page.getByRole('button', { name, exact: true });
const inline = page.locator('[data-answer-citations] :is(button, a)');
const preview = page.getByLabel('问答保存预览', { exact: true });
const requests = [];
page.setDefaultTimeout(12_000);
page.on('pageerror', error => evidence.pageErrors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url()).pathname;
  if (request.method() !== 'GET' || url.includes('/citations/')) requests.push({ url, method: request.method(), data: request.postDataJSON() });
});

async function api(url, { method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(session.api + url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
const control = (name, body = {}) => api('/__control/' + name, { method: 'POST', body });
const counters = () => api('/__control/counters');

async function action(route, run, method = 'POST', status = 200) {
  const next = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === route);
  await run();
  const response = await next;
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

async function openQuestion(target = page, navigate = true) {
  if (navigate) await target.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '知识库', exact: true }).click();
  const loaded = target.waitForResponse(response => new URL(response.url()).pathname === answers + '/current');
  await target.getByRole('button', { name: '向知识库提问', exact: true }).click();
  assert.equal((await loaded).status(), 200);
  await target.getByLabel('知识库问题', { exact: true }).waitFor();
}

const settled = () => page.waitForFunction(() => document.querySelector('.wiki-question')?.getAttribute('aria-busy') === 'false');

async function shot(target, name, region) {
  const filename = `review-${name}.png`;
  if (region) await region.screenshot({ path: path.join(out, filename), animations: 'disabled' });
  else await target.screenshot({ path: path.join(out, filename), animations: 'disabled' });
  evidence.screenshots.push(filename);
}

async function snapshot() {
  const files = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files[path.relative(session.root, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  await walk(path.join(session.root, 'knowledge'));
  await walk(path.join(session.root, 'state/raw-processing'));
  return files;
}

async function layout(target, width) {
  await target.setViewportSize({ width, height: 1000 });
  // The shared reduced-motion stylesheet applies a short transition even to shell spacing.
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const bounds = await target.locator('.wiki-question').evaluate(node => {
    const rect = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const answer = node.querySelector('[data-answer-section]').closest('pre');
    const input = node.querySelector('[aria-label="知识库问题"]');
    const citation = [...node.querySelectorAll('h3,h4')].find(heading => /引用依据|本次回答引用/u.test(heading.textContent));
    return { pageWidth: document.documentElement.scrollWidth, panelWidth: node.scrollWidth, panelClientWidth: node.clientWidth, input: rect(input), answer: rect(answer), citation: rect(citation) };
  });
  evidence.layouts.push({ viewport: width, ...bounds });
  assert.ok(bounds.pageWidth <= width && bounds.panelWidth <= bounds.panelClientWidth + 1, `横向溢出 ${width} ${JSON.stringify(bounds)}`);
  if (width === 390) assert.ok(bounds.panelClientWidth > 330, '窄屏问答应使用主内容宽度');
  assert.ok(bounds.citation.y >= bounds.answer.y + bounds.answer.height - 1, '引用依据必须位于回答正文下方');
  if (width >= 1024) {
    assert.ok(bounds.answer.x >= bounds.input.x + bounds.input.width - 1, `右侧回答 ${width}`);
    assert.ok(bounds.answer.width > bounds.input.width, `右栏宽于左栏 ${width}`);
  } else {
    assert.ok(bounds.answer.y >= bounds.input.y + bounds.input.height, '窄屏先提问后回答');
  }
}

async function selectAcross(answer) {
  const [first, second] = answer.sections;
  const expected = first.text.slice(-14) + '\n\n【综合推断】' + second.text.slice(0, 12);
  const rawSelection = await panel.evaluate((node, sections) => {
    const firstText = node.querySelector(`[data-answer-section="${sections[0].id}"]`).lastChild;
    const secondText = node.querySelector(`[data-answer-section="${sections[1].id}"]`).lastChild;
    const range = document.createRange();
    range.setStart(firstText, firstText.length - 14);
    range.setEnd(secondText, secondText.length - sections[1].text.length + 12);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return range.toString();
  }, [first, second]);
  assert.notEqual(rawSelection, expected, '选区必须经过内联引用');
  return { expected, rawSelection, first, second };
}

async function activateByTab(target) {
  await question.focus();
  const handle = await target.elementHandle();
  for (let count = 0; count < 40; count++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(element => document.activeElement === element, handle)) {
      assert.equal(await target.evaluate(element => element.matches(':focus-visible')), true);
      assert.notEqual(await target.evaluate(element => getComputedStyle(element).outlineStyle), 'none');
      return;
    }
  }
  assert.fail('键盘无法从问题输入到达指定控件');
}

const evidenceRegion = target => target.getByRole('region', { name: '引用依据', exact: true });
const citationRow = (target, number) => evidenceRegion(target).getByRole('listitem').nth(number - 1);
const reference = (target, number) => target.getByRole('link', { name: `查看引用依据 ${number}`, exact: true }).first();

async function locateCitation(answer, citation, keyboard) {
  const number = answer.citations.indexOf(citation) + 1;
  const link = reference(page, number);
  const row = citationRow(page, number);
  const oldCalls = requests.filter(request => request.url.includes('/citations/')).length;
  if (keyboard) {
    await activateByTab(link);
    await page.keyboard.press('Enter');
  } else {
    await link.click();
  }
  await row.waitFor();
  const target = await link.getAttribute('href');
  assert.equal(target, '#' + await row.getAttribute('id'));
  assert.equal(new URL(page.url()).hash, target);
  assert.equal(await row.evaluate(element => element === document.activeElement), true, '定位后焦点应到引用条目');
  const rowBox = await row.boundingBox();
  assert.ok(rowBox.y >= 0 && rowBox.y < page.viewportSize().height, '定位的依据应进入视口');
  assert.equal(requests.filter(request => request.url.includes('/citations/')).length, oldCalls, '定位依据与打开原文是两步');
  assert.match(await row.innerText(), new RegExp(`^\\[${number}\\]`));
  const source = row.getByRole('button');
  assert.ok((await source.innerText()).includes(citation.title));
  assert.equal(await row.locator('blockquote').innerText(), citation.quote);
  if (keyboard) {
    await page.keyboard.press('Tab');
    assert.equal(await source.evaluate(element => element === document.activeElement && element.matches(':focus-visible')), true);
    assert.notEqual(await source.evaluate(element => getComputedStyle(element).outlineStyle), 'none');
  }
  return source;
}

async function ask(text) {
  await question.fill(text);
  const result = await action(answers, () => button('提问').click());
  await settled();
  return result;
}

async function runBrowser() {
  assert.equal((await api('/api/health')).isolated, true);
  const original = await snapshot();
  let first = layoutOnly ? await api(answers + '/current') : null;
  await page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await openQuestion();
  if (!first) {
    await panel.getByRole('heading', { name: '回答与依据', exact: true }).waitFor();
    assert.equal(await button('提问').isDisabled(), true);
    await shot(page, 'desktop-empty', panel);

    await control('mode', { mode: 'raw' });
    await control('delay', { ms: 1300 });
    await question.fill(session.fixtures.question);
    await activateByTab(button('提问'));
    first = await action(answers, async () => {
      await page.keyboard.press('Enter');
      await panel.getByRole('status').filter({ hasText: '正在依据已读资料生成回答' }).waitFor();
      assert.equal(await panel.getAttribute('aria-busy'), 'true');
      assert.equal(await question.isDisabled(), true);
      assert.equal(await button('提问').isDisabled(), true);
      assert.equal(await button('收起问答').isDisabled(), true);
    });
    await settled();
    await control('delay', { ms: 0 });
    assert.equal(requests.filter(request => request.url === answers).length, 1);
    evidence.checks.push('Q01 empty screenshot; Q05 polling and disabled controls while asking');
  }
  assert.equal(first.status, 'completed');
  assert.equal(first.attempts, 2);
  assert.equal(first.independentRawIds.length, 2);
  assert.equal(first.readWiki.length, 3);
  await inline.first().waitFor();
  await layout(page, 1440);
  await shot(page, 'desktop-answer', panel);
  evidence.checks.push('Q01 normal desktop answer');

  // Exercise long text and all category labels using a dedicated visual-only browser response.
  const visual = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  visual.on('pageerror', error => evidence.pageErrors.push(error.message));
  const longTitle = '渠道口径合成知识页_' + 'LongSyntheticTitle'.repeat(10);
  const longWord = 'ChannelDefinitionWithNoBreakPoints'.repeat(8);
  await visual.route('**' + answers + '/current', async route => {
    const response = await route.fetch();
    const result = await response.json();
    const [firstSection] = result.sections;
    const [firstCitation] = result.citations;
    await route.fulfill({ response, json: {
      ...result,
      sections: [
        { ...firstSection, text: firstSection.text + '\n' + longWord },
        { id: 'test-inference', kind: 'inference', text: '建议按活跃与签约口径分别追踪，结论仍待核对。', citationIds: [firstCitation.id] },
        { id: 'test-conflict', kind: 'conflict', text: '同一年度的签约门店有 90 家和 120 家两种记录，待核对统计范围。', citationIds: [firstCitation.id, result.citations[1].id] },
      ],
      citations: [{ ...firstCitation, title: longTitle }, ...result.citations.slice(1)],
    } });
  });
  await visual.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await openQuestion(visual);
  await visual.getByText('【分歧待核】同一年度', { exact: false }).waitFor();
  const visualPanel = visual.locator('.wiki-question');
  const visualProse = await visualPanel.locator('pre').innerText();
  for (const label of ['来源事实', '综合推断', '分歧待核']) assert.ok(visualProse.includes(`【${label}】`));
  assert.ok(visualProse.includes(longWord));
  assert.ok(!visualProse.includes(longTitle));
  assert.equal(await visual.getByRole('link', { name: '查看引用依据 1', exact: true }).count(), 3);
  assert.equal(await citationRow(visual, 1).getByRole('button').count(), 1);
  assert.ok((await citationRow(visual, 1).innerText()).includes(longTitle));
  for (const [index, citation] of first.citations.entries()) {
    const number = index + 1;
    const link = reference(visual, number);
    const row = citationRow(visual, number);
    assert.equal((await link.innerText()).trim(), `[${number}]`);
    assert.equal(await link.getAttribute('href'), '#' + await row.getAttribute('id'));
    assert.ok((await row.getByRole('button').innerText()).includes(citation.revision ? `v${citation.revision}` : `[${citation.start}, ${citation.end})`));
  }
  for (const width of [1440, 1024, 390]) {
    await layout(visual, width);
    if (layoutOnly) {
      const labelRects = await visualPanel.locator('.answer-citation-number, .panel-heading button').evaluateAll(nodes => nodes.map(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const centers = [...range.getClientRects()].map(rect => rect.y + rect.height / 2);
        return { text: node.textContent, whiteSpace: getComputedStyle(node).whiteSpace, verticalSpread: Math.max(...centers) - Math.min(...centers) };
      }));
      assert.equal(labelRects.length, first.citations.length + 1);
      for (const label of labelRects) {
        assert.equal(label.whiteSpace, 'nowrap');
        assert.ok(label.verticalSpread < 4, `${width}px ${label.text} must fit on one line`);
      }
    }
    await shot(visual, `long-content-${width}`, visualPanel);
  }
  await visual.close();
  evidence.checks.push('Q01 long text and source titles at 1440/1024/390; Q02 labels and stable numbering with real current response plus visual-only fixtures');

  const wikiCitation = first.citations.find(citation => citation.kind === 'wiki' && citation.recordId === session.fixtures.wa);
  if (layoutOnly) {
    await layout(page, 390);
    await shot(page, 'mobile-answer', panel);
    await locateCitation(first, wikiCitation, true);
    await shot(page, 'keyboard-citation-focus-390');
    evidence.checks.push('Repair recheck: one line for close control and all citation numbers at 1440/1024/390, keyboard scroll and visible source focus at 390');
    return;
  }
  const wikiSource = await locateCitation(first, wikiCitation, true);
  await shot(page, 'keyboard-citation-focus');
  const wikiRef = await action(`${answers}/${first.id}/citations/${wikiCitation.id}`, () => page.keyboard.press('Enter'), 'GET');
  assert.equal(wikiRef.recordId, wikiCitation.recordId);
  await page.locator('.wiki-detail').getByRole('heading', { name: wikiCitation.title, exact: true }).waitFor();
  assert.equal(await wikiSource.count(), 1);

  await layout(page, 390);
  const rawCitation = first.citations.find(citation => citation.kind === 'raw');
  const rawSource = await locateCitation(first, rawCitation, false);
  const rawRef = await action(`${answers}/${first.id}/citations/${rawCitation.id}`, () => rawSource.click(), 'GET');
  const mark = page.locator('.raw-body mark[data-citation-start]');
  await mark.waitFor();
  assert.equal(await mark.innerText(), rawCitation.quote);
  assert.equal(Number(await mark.getAttribute('data-citation-start')), rawCitation.start);
  assert.equal(Number(await mark.getAttribute('data-citation-end')), rawCitation.end);
  const rawRecord = await api('/api/raw/' + rawRef.recordId);
  assert.equal(rawRecord.body.slice(rawCitation.start, rawCitation.end), rawCitation.quote);
  assert.equal(rawRecord.bodySha256, rawCitation.bodySha256);
  await shot(page, 'mobile-raw-location');
  evidence.checks.push('Q03 keyboard and pointer locate corresponding evidence, real Wiki navigation and Raw offset/quote/SHA');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openQuestion();
  await panel.getByText(`对应问题：${first.question}`, { exact: false }).waitFor();
  await control('mode', { mode: 'inference' });
  await control('fail-provider');
  await control('delay', { ms: 900 });
  const changedQuestion = '有效门店统计的活跃口径和签约口径如何区分？';
  await question.fill(changedQuestion);
  const failed = await action(answers, async () => {
    await button('提问').click();
    await panel.getByRole('status').filter({ hasText: '正在依据已读资料生成回答' }).waitFor();
    assert.equal(await button('保存全部预览').isDisabled(), true);
    assert.equal(await button('保存选段预览').isDisabled(), true);
  });
  await settled();
  assert.equal(failed.status, 'failed');
  assert.equal(await question.inputValue(), changedQuestion);
  await panel.getByRole('heading', { name: '保留的已有答案', exact: true }).waitFor();
  await panel.getByText(`对应问题：${first.question}`, { exact: false }).waitFor();
  await panel.getByRole('alert').filter({ hasText: 'LW02 controlled provider failure' }).waitFor();
  const countAfterFailure = (await counters()).provider;
  await shot(page, 'old-answer-after-failure', panel);
  assert.equal((await counters()).provider, countAfterFailure);
  await control('delay', { ms: 0 });
  const answer = await action(answers, () => button('明确重试本次问题').click());
  await settled();
  assert.equal(answer.id, failed.id);
  assert.equal(answer.attempts, 2);
  assert.equal(answer.status, 'completed');
  assert.equal((await counters()).provider, countAfterFailure + 1);
  evidence.checks.push('Q05 failure is explicit, old question remains identified, retry requires action and reuses request ID');

  await activateByTab(button('保存全部预览'));
  await page.keyboard.press('Enter');
  await preview.waitFor();
  await preview.getByText('实际选择的回答原文', { exact: true }).click();
  const whole = await preview.locator('pre').innerText();
  assert.equal(whole, await panel.getByRole('region', { name: '回答', exact: true }).locator('[data-answer-section]').allTextContents().then(text => text.join('\n\n')));
  assert.equal(await preview.getByLabel('保存结论', { exact: true }).inputValue(), answer.sections[0].text);
  assert.equal(await preview.getByLabel('保存推断', { exact: true }).inputValue(), answer.sections[1].text);
  const allSources = answer.citations.map(citation => citation.title);
  assert.ok((await preview.getByText('保留依据：', { exact: false }).innerText()).includes(allSources.join('、')));
  await preview.getByRole('button', { name: '取消预览', exact: true }).click();
  assert.equal((await api('/api/drafts')).items.length, 0);
  assert.equal(requests.filter(request => request.url.endsWith('/save')).length, 0);

  const { expected, rawSelection, first: fact, second: inference } = await selectAcross(answer);
  await button('保存选段预览').click();
  await preview.waitFor();
  await preview.getByText('实际选择的回答原文', { exact: true }).click();
  assert.equal(await preview.locator('pre').innerText(), expected);
  assert.equal(await preview.getByLabel('保存结论', { exact: true }).inputValue(), fact.text.slice(-14));
  assert.equal(await preview.getByLabel('保存推断', { exact: true }).inputValue(), inference.text.slice(0, 12));
  const title = 'QAUI01 合成渠道口径核对';
  const edited = inference.text.slice(0, 12) + '\n人工核对后再分渠道统计。';
  await preview.getByLabel('建议主题', { exact: true }).fill(title);
  await preview.getByLabel('保存推断', { exact: true }).fill(edited);
  await shot(page, 'cross-section-preview', preview);
  assert.deepEqual(await snapshot(), original);
  assert.equal((await api('/api/drafts')).items.length, 0);

  await control('fail-draft');
  await control('delay', { ms: 900 });
  const countBeforeSave = (await counters()).provider;
  const saveButton = preview.getByRole('button', { name: '生成维护草稿', exact: true });
  await action(`${answers}/${answer.id}/save`, async () => {
    await saveButton.click();
    await panel.getByRole('status').filter({ hasText: '正在生成维护草稿' }).waitFor();
    assert.equal(await button('提问').isDisabled(), true);
    assert.equal(await saveButton.isDisabled(), true);
  }, 'POST', 500);
  await settled();
  assert.equal(await preview.getByLabel('保存推断', { exact: true }).inputValue(), edited);
  assert.equal(await preview.getByLabel('建议主题', { exact: true }).inputValue(), title);
  await panel.getByRole('alert').filter({ hasText: 'LW02 controlled draft storage failure' }).waitFor();
  assert.equal((await api('/api/drafts')).items.length, 0);
  assert.deepEqual(await snapshot(), original);
  await control('delay', { ms: 0 });
  const saved = await action(`${answers}/${answer.id}/save`, () => saveButton.click());
  await settled();
  assert.equal(saved.status, 'draft_created');
  assert.equal((await counters()).provider, countBeforeSave + 1);
  const [failure, retry] = requests.filter(request => request.url === `${answers}/${answer.id}/save`).map(request => request.data);
  assert.deepEqual(failure, retry);
  assert.equal(retry.preview.selectedText, expected);
  assert.deepEqual(retry.preview.selectedSectionIds, [fact.id, inference.id]);
  assert.deepEqual(retry.preview.citationIds, [...new Set([...fact.citationIds, ...inference.citationIds])]);
  const draft = JSON.parse(await readFile(path.join(session.root, 'drafts', saved.draftId + '.json'), 'utf8'));
  assert.equal(draft.input.kind, 'question_answer');
  assert.deepEqual(draft.input.preview, retry.preview);
  assert.equal((await api('/api/drafts')).items.length, 1);
  assert.deepEqual(await snapshot(), original);
  await button('查看对应草稿').click();
  await page.getByRole('heading', { name: '审核知识变更', exact: true }).waitFor();
  evidence.selection = { rawSelection, selectedText: expected, sections: retry.preview.selectedSectionIds, citations: retry.preview.citationIds };
  evidence.checks.push('Q04 whole/selected previews, crossed inline numbers stripped from selection, cancel read-only, stored selection IDs and draft access; Q05 disk failure preserves edits, retry reuses proposal');

  await button('返回知识库').click();
  await openQuestion(page, false);
  await button('查看对应草稿').waitFor();
  const stale = saved.answer.citations.find(citation => citation.kind === 'wiki');
  const current = await api(`/api/wiki/${stale.recordId}`);
  await api(`/api/wiki/${stale.recordId}`, { method: 'PUT', body: {
    baseRevision: current.revision, title: current.title, type: current.type, category: current.category,
    body: current.body + '\n独验主动变更旧引用版本。', sources: current.sources, tags: current.tags, aliases: current.aliases,
    knowledge_status: current.knowledge_status, confidence: current.confidence, source_level: current.source_level, review_status: current.review_status,
  } });
  const staleSource = await locateCitation(saved.answer, stale, false);
  const error = await action(`${answers}/${answer.id}/citations/${stale.id}`, () => staleSource.click(), 'GET', 409);
  assert.equal(error.error.code, 'ANSWER_BASIS_CHANGED');
  await panel.getByRole('alert').filter({ hasText: '回答依据页已变化' }).waitFor();
  const countBeforeInsufficient = (await counters()).provider;
  const insufficient = await ask('天王星卫星轨道周期需要多久？');
  assert.equal(insufficient.status, 'insufficient');
  assert.equal((await counters()).provider, countBeforeInsufficient);
  await panel.getByRole('status').filter({ hasText: '依据不足' }).waitFor();
  await evidenceRegion(page).getByText('本次没有可引用的资料。', { exact: true }).waitFor();
  assert.equal(await button('保存全部预览').isDisabled(), true);
  assert.equal(await button('保存选段预览').isDisabled(), true);
  assert.equal(await button('明确重试本次问题').count(), 0);
  evidence.checks.push('Q03 real stale citation rejects and exposes error; Q05 insufficient answer has no fake citations, save or extra provider call');
}

try {
  await runBrowser();
  evidence.counters = await counters();
  assert.equal(evidence.counters.realProviderCalls, 0);
  assert.deepEqual(evidence.pageErrors, []);
  evidence.success = true;
  console.log(JSON.stringify({ chrome: browser.version(), checks: evidence.checks, ...evidence.counters }, null, 2));
} catch (error) {
  evidence.failure = { message: error.message, stack: error.stack };
  await shot(page, 'failure');
  throw error;
} finally {
  evidence.chrome = browser.version();
  evidence.requests = requests;
  await writeFile(path.join(out, layoutOnly ? 'review-layout.json' : 'review-browser.json'), JSON.stringify(evidence, null, 2));
  await browser.close();
}
