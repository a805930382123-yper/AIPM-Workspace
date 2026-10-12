import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHarness, port, expect, rawInput, wikiInput, extract, delay, fileSnapshot } from './b05-harness.mjs';
import { fakeReply, bodyA, bodyB } from './b05-fake-reply.mjs';
const previousRuntime = process.env.B05_BROWSER_REUSE_FILE ? JSON.parse(await readFile(process.env.B05_BROWSER_REUSE_FILE, 'utf8')) : undefined;
const harness = await createHarness(fakeReply, previousRuntime?.dataRoot);
let service, ui;
const report = { clientDate: '2026-10-07', provider: 'HTTP fake only', dataRoot: harness.dataRoot, uiLogs: '' };
try {
  service = await harness.start();
  const a = previousRuntime ? { id: previousRuntime.aId } : await expect(service, '/api/raw', 'POST', rawInput('浏览器来源A', bodyA), 201);
  const b = previousRuntime ? { id: previousRuntime.bId } : await expect(service, '/api/raw', 'POST', rawInput('浏览器来源B', bodyB), 201);
  const old = previousRuntime ? { id: previousRuntime.oldId } : await expect(service, '/api/wiki', 'POST', wikiInput('铺货率', [a.id], bodyA, { aliases: ['Distribution Rate'] }), 201);
  const draft = previousRuntime ? { id: previousRuntime.draftId } : await extract(service, b.id);
  report.reusedDataRoot = Boolean(previousRuntime);
  const uiPort = await port();
  ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], { cwd: process.cwd(), env: { ...process.env, FMCG_PORT: String(service.port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  ui.stdout.on('data', chunk => report.uiLogs += chunk); ui.stderr.on('data', chunk => report.uiLogs += chunk);
  const url = `http://127.0.0.1:${uiPort}/`;
  for (let n = 0; n < 100; n++) {
    if (ui.exitCode !== null) throw new Error(report.uiLogs);
    try { if ((await fetch(url)).ok) break; } catch {}
    await delay(100);
  }
  Object.assign(report, { url, api: service.base, apiPid: service.child.pid, uiPid: ui.pid, aId: a.id, bId: b.id, oldId: old.id, draftId: draft.id, beforeKnowledge: await fileSnapshot(path.join(harness.dataRoot, 'knowledge')), beforeRaw: await fileSnapshot(path.join(harness.dataRoot, 'knowledge', 'raw')) });
  await writeFile('docs/reports/B05-acceptance-browser-runtime.json', JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ url, api: service.base, dataRoot: harness.dataRoot, pids: [service.child.pid, ui.pid], draftId: draft.id }) + '\n');
  report.stopFile = path.join(harness.dataRoot, '.stop-browser');
  await writeFile('docs/reports/B05-acceptance-browser-runtime.json', JSON.stringify(report, null, 2));
  process.stdout.write('Create isolated .stop-browser marker after browser acceptance.\n');
  while (!await readFile(report.stopFile).then(() => true).catch(() => false)) {
    const restart = path.join(harness.dataRoot, '.restart-api');
    if (await readFile(restart).then(() => true).catch(() => false)) {
      await rm(restart); const apiPort = service.port; await harness.stop(service); service = await harness.start(harness.dataRoot, true, apiPort);
      report.apiPid = service.child.pid; report.restartCount = (report.restartCount ?? 0) + 1;
      await writeFile('docs/reports/B05-acceptance-browser-runtime.json', JSON.stringify(report, null, 2));
      process.stdout.write(`API restarted with same data directory: ${service.child.pid}\n`);
    }
    await delay(500);
  }
  report.afterKnowledge = await fileSnapshot(path.join(harness.dataRoot, 'knowledge')); report.afterRaw = await fileSnapshot(path.join(harness.dataRoot, 'knowledge', 'raw'));
} finally {
  if (ui && ui.exitCode === null) { const done = once(ui, 'exit'); ui.kill(); await done; }
  await harness.close();
  report.closed = { ui: !ui || ui.exitCode !== null || ui.signalCode !== null, api: !service || service.child.exitCode !== null || service.child.signalCode !== null };
  await writeFile('docs/reports/B05-acceptance-browser-runtime.json', JSON.stringify(report, null, 2));
}
