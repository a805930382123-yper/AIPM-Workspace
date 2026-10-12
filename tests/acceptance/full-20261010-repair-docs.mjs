import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const prefix='docs/reports/FULL-20261010-repair';
const source=await fs.readFile('docs/reports/FULL-20261009-spec-matrix.md','utf8');
const originalRows=source.split(/\r?\n/).filter(x=>/^\| [AR]\d{2} \|/.test(x));
if(process.argv[2]==='update'){
 const rows=originalRows.map(line=>{
  const cells=line.split('|').map(x=>x.trim());const id=cells[1];
  if(id==='R41'){cells[3]='PASS';cells[4]='PASS';cells[5]='2026-10-10 新 HTTP/落盘与多密钥复验，S-01 CLOSED；真实质量仍按其它项 BLOCKED';cells[6]='[本次 HTTP](FULL-20261010-repair-http.json)；[多密钥](FULL-20261010-repair-secrets.json)';}
  else if(id==='R46'){cells[3]='PASS';cells[4]='PASS';cells[5]='D-01/02 CLOSED，当前说明/109项映射与新实测对照，历史证据保留';cells[6]='[本次报告](FULL-20261010-repair-acceptance.md)；[文档核对](FULL-20261010-repair-docs.json)';}
  else cells[5]='2026-10-09及更早证据：'+cells[5];
  return '| '+cells.slice(1,-1).join(' | ')+' |';
 });
 const header='# A01–A63 / R01–R46 当前交付矩阵\n\n2026-10-10 全项目审查返修：DOC 109 PASS；RUN 汇总 73 PASS / 36 BLOCKED。S-01/S-02 与 D-01/02 已按新证据关闭；这不表示全产品真实 AI 验收通过。三处核心服务有授权修改，前端与其它核心文件未变；本次 build、155项单测及受影响 HTTP/磁盘/恢复回归通过。原判据不变，逐行注明历史证据，不能理解为本轮重新操作109项。真实 Provider 未配置，36项 BLOCKED 保持；本轮没有新实际浏览器 PASS。\n\n[本次独立验收](FULL-20261010-repair-acceptance.md)；[返修专项 HTTP](FULL-20261010-repair-http.json)；[知识回归](FULL-20261010-repair-knowledge.json)；[Audit/Lint](FULL-20261010-repair-audit-lint.json)；[Prompt AI](FULL-20261010-repair-prompt-ai.json)。历史全项目 FAIL 和旧批次报告均原样保留；B03最终证据为 B03-recheck-acceptance.md。\n\n';
 const table='| ID | 需求 | DOC | RUN汇总 | 本轮/复用证据方式 | 依据 |\n|---|---|---|---|---|---|\n'+rows.join('\n')+'\n';
 await fs.writeFile(prefix+'-matrix.md',header+table);
 await fs.writeFile('docs/delivery-matrix.md',(header+table).replace(/\]\(([^/:)]+\.\w+)\)/g,'](reports/$1)'));
 const rowsJson=rows.map(line=>{const cells=line.split('|').map(x=>x.trim());return {id:cells[1],text:cells[2],doc:cells[3],run:cells[4],mode:cells[5],evidence:cells[6]};});
 await fs.writeFile(prefix+'-mapping.json',JSON.stringify({source:'FULL-20261009-spec-matrix.md',docCounts:{PASS:109},runCounts:{PASS:73,BLOCKED:36},rows:rowsJson},null,2));
 console.log('Current matrix updated; historical source untouched');
}else{
 const matrix=await fs.readFile('docs/delivery-matrix.md','utf8');const rows=matrix.split(/\r?\n/).filter(x=>/^\| [AR]\d{2} \|/.test(x));
 const cells=rows.map(x=>x.split('|').map(y=>y.trim())),baseline=originalRows.map(x=>x.split('|').map(y=>y.trim()));
 assert.equal(rows.length,109);assert.equal(new Set(cells.map(x=>x[1])).size,109);
 assert.deepEqual(cells.map(x=>[x[1],x[2]]),baseline.map(x=>[x[1],x[2]]),'All stable criteria must remain exact');
 assert.equal(cells.filter(x=>x[3]==='PASS').length,109);assert.equal(cells.filter(x=>x[4]==='PASS').length,73);assert.equal(cells.filter(x=>x[4]==='BLOCKED').length,36);
 assert.ok(!matrix.includes('(reports/B03-acceptance.md)'));assert.ok(matrix.includes('(reports/B03-recheck-acceptance.md)'));
 const b03=await fs.readFile('docs/reports/B03-recheck-acceptance.md','utf8');assert.match(b03,/PASS/);
 const acceptance=await fs.readFile('docs/acceptance.md','utf8');assert.ok(!acceptance.includes('现为B02验收通过后停止'));assert.ok(acceptance.includes('历史结果（2026-10-04'));assert.ok(acceptance.includes('2026-10-10'));
 const status=await fs.readFile('docs/status.md','utf8');assert.ok(status.includes('FULL-20261010-repair-acceptance.md'));assert.ok(status.includes('36'));assert.ok(status.includes('S-01'));
 const missing=[];for(const file of ['docs/acceptance.md','docs/status.md','docs/delivery.md','docs/delivery-matrix.md',prefix+'-acceptance.md',prefix+'-matrix.md']){
  const text=await fs.readFile(file,'utf8');for(const [,target] of text.matchAll(/\]\(([^)]+)\)/g)){
   if(/^(https?:|app:|codex:|[A-Z]:|\/|#)/i.test(target))continue;
   try{await fs.access(path.resolve(path.dirname(file),target.split('#')[0]));}catch{missing.push({file,target});}
  }
 }assert.deepEqual(missing,[],'Current documentation links must resolve');
 const out={result:'PASS',uniqueCriteria:109,criteriaUnchanged:true,docCounts:{PASS:109},runCounts:{PASS:73,BLOCKED:36},b03FinalEvidenceCorrect:true,acceptanceCurrentAuthorization:true,oct04MarkedHistorical:true,currentStatusUpdated:true,currentDocumentationLinksValid:true};
 await fs.writeFile(prefix+'-docs.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}
