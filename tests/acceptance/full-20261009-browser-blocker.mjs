import fs from 'node:fs/promises';
const output={checkedAt:new Date().toISOString(),status:'BLOCKED',attempts:2,resetAttempted:true,tool:'mcp__cua_repl.js',operation:'cua.createBrowserTab(iab, isolated localhost URL)',error:'node_repl kernel exited; windows sandbox failed: helper_unknown_error: setup refresh had errors',impact:'No fresh real-browser click, layout, clipboard or native download acceptance this run. HTTP and jsdom results are reported separately. No tab was created.'};
await fs.writeFile('docs/reports/FULL-20261009-browser-blocker.json',JSON.stringify(output,null,2));
const tests=await fs.readFile('docs/reports/FULL-20261009-tests.log','utf8');
const cases=tests.split(/\r?\n/).filter(s=>s.startsWith('✔'));
console.log({testOutputPassLines:cases.length,browserStatus:output.status});
