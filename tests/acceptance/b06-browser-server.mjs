import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHarness, port, expect, rawInput, wikiInput, delay, fileSnapshot } from './b06-harness.mjs';
const rawBody = '验收原始资料：铺货率采用有销售门店数除以目标门店数，统计周期为自然月。';
let raw;
const previous = process.argv[2] === 'reuse' ? JSON.parse(await readFile('docs/reports/B06-acceptance-browser-runtime.json','utf8')) : null;
const fakeReply = async () => {
  const hold = path.join(harness.dataRoot,'.hold-provider');
  if (await readFile(hold).then(()=>true,()=>false)) {
    await writeFile(path.join(harness.dataRoot,'.provider-held'),'');
    for (let n=0; n<300; n++) { if (!await readFile(hold).then(()=>true,()=>false)) break; await delay(100); }
  }
  return { replacement: '铺货率采用有销售门店数除以目标门店数。', rationale: '依据Raw纠正口径，人工内容需保留', evidence: [{ rawId: raw.id, quote: rawBody }] };
};
const harness = await createHarness(fakeReply,previous?.dataRoot); let service, ui;
const report = { clientDate: '2026-10-07', provider: 'independent HTTP fake only', dataRoot: harness.dataRoot, uiLogs: '' };
try {
  service = await harness.start();
  raw = previous ? await expect(service,'/api/raw/'+previous.rawId,'GET') : await expect(service, '/api/raw', 'POST', rawInput('B06浏览器来源', rawBody), 201);
  const wiki = previous ? await expect(service,'/api/wiki/'+previous.wikiId,'GET') : await expect(service, '/api/wiki', 'POST', wikiInput('B06浏览器铺货率', [raw.id], '## 定义\n铺货率采用上架门店数除以目标门店数。\n## 人工保留\n不要删除这条人工备注。', { aliases: ['浏览器原别名'] }), 201);
  const uiPort = await port();
  ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], { env: { ...process.env, FMCG_PORT: String(service.port) }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  ui.stdout.on('data', c => report.uiLogs += c); ui.stderr.on('data', c => report.uiLogs += c);
  const url = `http://127.0.0.1:${uiPort}/`;
  for (let n = 0; n < 100; n++) { if (ui.exitCode !== null) throw new Error(report.uiLogs); try { if ((await fetch(url)).ok) break; } catch {} await delay(100); }
  await rm(path.join(harness.dataRoot,'.stop-browser'),{force:true});
  Object.assign(report, { url, api: service.base, apiPid: service.child.pid, uiPid: ui.pid, rawId: raw.id, wikiId: wiki.id, beforeRaw: previous?.beforeRaw ?? await fileSnapshot(path.join(harness.dataRoot, 'knowledge/raw')), beforeWiki: previous?.beforeWiki ?? await fileSnapshot(path.join(harness.dataRoot, 'knowledge/wiki')), reuse: Boolean(previous), stopFile: path.join(harness.dataRoot, '.stop-browser') });
  await writeFile('docs/reports/B06-acceptance-browser-runtime.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ url, api: service.base, dataRoot: harness.dataRoot, wikiId: wiki.id }));
  while (!await readFile(report.stopFile).then(() => true, () => false)) {
    const restart = path.join(harness.dataRoot, '.restart-api');
    if (await readFile(restart).then(() => true, () => false)) { await rm(restart); const p = service.port; await harness.stop(service); service = await harness.start(harness.dataRoot, true, p); report.apiPid = service.child.pid; report.restartCount = (report.restartCount ?? 0) + 1; await writeFile('docs/reports/B06-acceptance-browser-runtime.json', JSON.stringify(report, null, 2)); console.log('API restarted same directory'); }
    await delay(500);
  }
  report.afterRaw = await fileSnapshot(path.join(harness.dataRoot, 'knowledge/raw')); report.afterWiki = await fileSnapshot(path.join(harness.dataRoot, 'knowledge/wiki'));
} finally {
  if (ui && ui.exitCode === null) { const done = once(ui, 'exit'); ui.kill(); await done; }
  await harness.close(); report.closed = { api: !service || service.child.exitCode !== null || service.child.signalCode !== null, ui: !ui || ui.exitCode !== null || ui.signalCode !== null };
  await writeFile('docs/reports/B06-acceptance-browser-runtime.json', JSON.stringify(report, null, 2));
}
