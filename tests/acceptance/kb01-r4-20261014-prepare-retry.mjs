import fs from 'node:fs/promises';
let text=await fs.readFile('tests/acceptance/kb01-r4-20261014-real-http.mjs','utf8');
text=text.replace('checks=[],artifacts={};',"checks=[],previous=JSON.parse(await fs.readFile(prefix+'real-http.json','utf8')),artifacts={...previous.artifacts};");
const start=text.indexOf("await test('R4-REAL-SHORT"),end=text.indexOf("await test('R4-REAL-LONG");if(start<0||end<start)throw Error('Retry section boundary mismatch');text=text.slice(0,start)+text.slice(end);
text=text.replace("prefix+'real-http.json',JSON.stringify", "prefix+'real-http-r2.json',JSON.stringify");
text=text.replace("const raw=await ok('/api/raw','POST',rawInput('R4十四区域中文长文虚构验收',body,['KB01_R4长文']),201);", "const raw=await ok('/api/raw/'+artifacts.longRaw.id);assert.equal(raw.body,body,'Same long Raw must survive restart and retry');");
text=text.replace("const raw=await ok('/api/raw','POST',rawInput('R4虚构铺货率复核',body,['KB01_R4虚构']),201),draft=await extract(raw);", "const raw=await ok('/api/raw/'+artifacts.updateRaw.id);assert.equal(raw.body,body,'Same supplementary Raw must survive restart and retry');const draft=await extract(raw);");
// First failed supplementary attempt stores its Raw only after extraction in the old script.
text=text.replace("const raw=await ok('/api/raw/'+artifacts.updateRaw.id);", "const raw=await ok('/api/raw/'+(artifacts.updateRaw?.id??Object.values(artifacts).find(value=>value?.rawId&&value.rawId!==artifacts.shortRaw.id&&value.rawId!==artifacts.longRaw.id)?.rawId));");
text=text.replace("if(!user.includes(raw.id))return [];", "if(t.sequence<=meta.newCallsAtStartup||!user.includes(raw.id))return [];");
text=text.replace("id:'R4-REAL", "id:'R4-REAL");
await fs.writeFile('tests/acceptance/kb01-r4-20261014-real-http-r2.mjs',text);
let wire=await fs.readFile('tests/acceptance/kb01-20261014-standards-adapter-wire.mjs','utf8');wire=wire.replaceAll('docs/reports/KB01-20261014-','docs/reports/KB01-R4-20261014-');
// Expected change is limited to the authorized knowledgeFlash branch, checked independently.
if(!wire.includes("{reasoning_effort:'low'}"))throw Error('Exact scoped expected wire fixture missing');
wire=wire.replace("{reasoning_effort:'low'}","{reasoning_effort:'low',response_format:{type:'json_object'}}");
await fs.writeFile('tests/acceptance/kb01-r4-20261014-standards-adapter-wire.mjs',wire);
console.log('Same-Raw final retry and scoped wire assertions prepared; first failures retained.');
