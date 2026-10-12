import fs from 'node:fs/promises';
const legacy='tests/acceptance/m05-legacy-http.mjs';
let source=await fs.readFile(legacy,'utf8');
source=source.replace('}finally{await h.close();}',"}finally{await h.close();await fs.writeFile(prefix+'.json',JSON.stringify({provider:'independent fake; real quality NOT_RUN',dataRoot:h.dataRoot,checks,summary:{pass:checks.filter(c=>c.result==='PASS').length,fail:checks.filter(c=>c.result==='FAIL').length},providerCalls:h.requests.length,servicesClosed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)},null,2));}");
await fs.writeFile(legacy,source);
const matrix='tests/acceptance/m05-matrix.mjs';await fs.writeFile(matrix,(await fs.readFile(matrix,'utf8')).replaceAll("'M02-browser.json'","'M02-browser-checks.json'"));
console.log('Added final legacy closure metadata and corrected historical link.');
