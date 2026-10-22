import fs from 'node:fs/promises';let s=(await fs.readFile('tests/kb02-planning-budget.test.ts','utf8')).replaceAll('\r\n','\n');
s=s.replace('  const start = (options:', '  const ids = new Set<string>();\n  const start = async (options:');s=s.replace('= {}) => runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString(), ...options });','= {}) => { const result = await runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString(), ...options }); ids.add(result.job.id); return result; };');
const a=s.indexOf('  const wait =');const b=s.indexOf('  const hashes =',a);
s=s.slice(0,a)+`  const safeSnapshot = async (id: string) => {
    const job = await jobs.get(id).catch(() => undefined);
    const cp = await new ExtractionCheckpointStore(root).get(id).catch(() => undefined);
    const state = await rawStates.get(raw.id).catch(() => undefined);
    const runtime = await runner.readJob(id).catch(() => undefined);
    return { node: process.version, job: job ? { status: job.status, stage: job.stage, callCount: job.callCount, errorCode: job.error?.code } : null, checkpoint: cp ? { stage: cp.stage, attempts: cp.attempts, validatedChunks: cp.completedChunks.length, diagnosticPresent: !!cp.lastError?.diagnostic, errorCode: cp.lastError?.code } : null, rawStatus: state?.status, requests: requests.length, execution: runtime?.execution, recovery: runtime?.recovery ? { code: runtime.recovery.code, phase: runtime.recovery.phase, persisted: runtime.recovery.persisted } : null };
  };
  const wait = async (id: string) => {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const view = await runner.readJob(id);
      if (view.execution === 'settled') {
        if (view.recovery || !view.job || view.job.status === 'running') throw new Error('Budget fixture settlement failed: ' + JSON.stringify(await safeSnapshot(id)));
        return view.job;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Budget fixture deadline: ' + JSON.stringify(await safeSnapshot(id)));
  };
`+s.slice(b);
s=s.replace("clean: () => rm(root, { recursive: true, force: true })", "clean: async () => { for (const id of ids) { if ((await runner.readJob(id)).execution === 'running') await runner.cancel(id); await runner.waitForSettlement(id); } await rm(root, { recursive: true, force: true }); }");
s=s.replace('    assert.equal(job.callCount, 2);',"    assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');\n    assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);\n    assert.equal(job.callCount, 2);");
s=s.replace('      assert.equal((await f.start({ planningRetry: true })).job.id, job.id);',"      assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');\n      assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);\n      assert.equal((await f.start({ planningRetry: true })).job.id, job.id);");
s=s.replace('      await f.start({ planningRetry: true });',"      assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');\n      assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);\n      await f.start({ planningRetry: true });");
s=s.replace('    f.succeed();\n    assert.equal',"    assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');\n    assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);\n    f.succeed();\n    assert.equal");
await fs.writeFile('tests/kb02-planning-budget.test.ts',s);
