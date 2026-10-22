import fs from 'node:fs/promises';
const old='KB02-SOURCE-AUDIT-20261022',now='KB02-EDGE-AUDIT-20261022';
for(const name of ['run','trace-hook','lab','real-http','browser-prepare','quality','update-check']){
 let s=await fs.readFile(`tests/acceptance/${old}-${name}.mjs`,'utf8');
 s=s.replaceAll(old,now).replaceAll('126+', '146+').replaceAll('126+(', '146+(').replaceAll('previousKB02:126','previousKB02:146').replaceAll('priorKB02:126','priorKB02:146').replaceAll('previousKB02Calls:126','previousKB02Calls:146').replaceAll('153+','173+').replaceAll('KB02-SOURCE-20261022-frozen.json','KB02-EDGE-20261022-frozen.json').replaceAll('kb02-source-audit-','kb02-edge-audit-');
 if(name==='run'){
  s=s.replace("targeted=['tests/kb02-source-assignment.test.ts'","targeted=['tests/kb02-edge-extraction.test.ts','tests/wiki-selection.test.tsx','tests/kb02-source-assignment.test.ts'");
  s=s.replace("'tests/acceptance/KB02-EDGE-AUDIT-20261022-boundary.test.mjs'","'tests/acceptance/KB02-SOURCE-AUDIT-20261022-boundary.test.mjs'");
  s=s.replace("await run('node24-version'","await run('independent-edge-boundary',process.execPath,[...args,'tests/acceptance/KB02-EDGE-AUDIT-20261022-boundary.test.mjs']);await run('node24-version'");
 }
 if(name==='real-http'){
  const start=s.indexOf('let current=draft;'),end=s.indexOf('return {rawId:raw.id',start);
  if(start<0||end<0)throw Error('short adapter markers');
  s=s.slice(0,start)+"artifacts.shortMetricPageId=metric.pageId;\n "+s.slice(end);
  s=s.replace('KB02-REAL-SHORT-v2-normalized-and-explicit-confirm','KB02-REAL-SHORT-extraction-awaiting-browser-confirm');
  s=s.replace('selectedPages:1','selectedPages:0');
 }
 await fs.writeFile(`tests/acceptance/${now}-${name}.mjs`,s,{flag:'wx'});
}
