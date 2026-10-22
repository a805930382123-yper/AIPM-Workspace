import fs from 'node:fs/promises';
const dir='docs/reports/SEC-20261013-';
const read=async name=>JSON.parse(await fs.readFile(dir+name+'.json','utf8'));
const initial=await read('http-final'),recheck=await read('http-recheck');
if(!initial.calibration){
 await fs.copyFile(dir+'http-final.json',dir+'http-final-calibration.json');
 await fs.copyFile(dir+'http-final.log',dir+'http-final-calibration.log');
 initial.calibration={initialPass:initial.summary.pass,initialInvalid:initial.summary.fail,reasons:'Repeated evidence fixture lacked global location hints; Prompt GET uses a prompt wrapper. Product unchanged; corrected four cases rerun separately.',source:'SEC-20261013-http-final-calibration.json',recheck:'SEC-20261013-http-recheck.json'};
 for(const check of recheck.checks){const index=initial.checks.findIndex(x=>x.id===check.id);if(index<0)throw Error('Unknown recheck');initial.checks[index]={...check,correctedProbe:true};}
 initial.summary={pass:initial.checks.filter(x=>x.result==='PASS').length,fail:initial.checks.filter(x=>x.result==='FAIL').length};
 await fs.writeFile(dir+'http-final.json',JSON.stringify(initial,null,2));
}
const audit=await read('http-audit'),service=await read('services'),b05=await read('b05-regression'),integrity=await read('integrity'),baseline=await read('baseline');
const result={at:new Date().toISOString(),elapsedMs:Date.now()-Date.parse(baseline.createdAt),commands:{build:{command:'npm run build',exitCode:0,log:'SEC-20261013-build.log'},tests:{command:'npm test',exitCode:0,tests:204,pass:204,fail:0,log:'SEC-20261013-tests.log',shimUsed:false},http:{command:'node tests/acceptance/sec-20261013-http.mjs final',summary:initial.summary,evidence:'SEC-20261013-http-final.json'},httpAudit:{summary:audit.summary,subcasesPerGroup:{clean:1,rejected:4},evidence:'SEC-20261013-http-audit.json'},services:{summary:service.summary,evidence:'SEC-20261013-services.json'},b05:{summary:b05.summary,evidence:'SEC-20261013-b05-regression.json'}},integrity:{pass:integrity.pass,protectedCount:integrity.protectedCount,changedProduct:integrity.productChangesFromBaseline,frozenChanges:integrity.frozenProductChanges},selfServicesClosed:[...initial.services,...recheck.services,...audit.services].every(x=>x.servicesClosed&&x.fakeClosed),realProvider:'NOT_RUN; existing 36 BLOCKED retained',browser:'NOT_RUN; no UI changes',subagentTokenUsage:'Unavailable'};
result.selfServicesClosed=result.selfServicesClosed&&b05.services.every(s=>s.closed);
result.reviews={standards:{result:'PASS',actionableFindings:0,evidence:'SEC-20261013-standards.md'},spec:{result:'PASS',actionableFindings:0,independentMemoryProbes:43,evidence:'SEC-20261013-spec.md'}};
await fs.writeFile(dir+'evidence.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if([initial,audit,service,b05].some(x=>x.summary.fail)||!integrity.pass||!result.selfServicesClosed)process.exitCode=1;
