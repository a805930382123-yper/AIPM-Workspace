// Update only the current matrix from the latest historical matrix plus the new R41 evidence.
import fs from 'node:fs/promises';
const source=await fs.readFile('docs/reports/FULL2-20261010-spec-matrix.md','utf8');
const backup='docs/reports/SEC-20261013-original-delivery-matrix.md';
try{await fs.access(backup);}catch{await fs.copyFile('docs/delivery-matrix.md',backup);}
let table=source.slice(source.indexOf('| ID |')).replace(/\]\(([^)]+)\)/g,'](reports/$1)');
const oldR41=table.match(/^\| R41 .*$/m)?.[0];if(!oldR41)throw Error('Missing R41');
const requirement=oldR41.split('|')[2].trim();
const newR41=`| R41 | ${requirement} | PASS | PASS | 2026-10-13 S-03/S-04 CLOSED；本批六链安全HTTP、错误/多凭证/失败落盘及既有Audit保护复验；不代签真实AI | [本批独立报告](reports/SEC-20261013-acceptance.md)；[有效HTTP](reports/SEC-20261013-http-final.json)；[Audit](reports/SEC-20261013-http-audit.json)；[多凭证](reports/SEC-20261013-services.json) |`;
table=table.replace(oldR41,newR41);
const header='# 当前109项需求交付矩阵（2026-10-13）\n\nS-03/S-04安全返修本批PASS，R41已复验关闭。DOC109 PASS；RUN汇总73 PASS / 36 BLOCKED，全项目仍未签PASS。36项真实Provider成功/质量保持BLOCKED。M01–M05会议增量48项独立见 [M05矩阵](reports/M05-20261012-spec-matrix.md)。\n\n本表从 [最新全项目FULL2矩阵](reports/FULL2-20261010-spec-matrix.md)继承，仅以本批实际证据更新R41；其它行的“本轮”均指原2026-10-10 FULL2审查及明确历史复用，不代表安全返修重新运行全部109项或新增浏览器PASS。新增安全范围、校准、限制及数据保护见 [本批独立报告](reports/SEC-20261013-acceptance.md)。旧FAIL报告和矩阵原样保留。\n\n';
const rows=table.split('\n').filter(s=>/^\| [AR]\d{2} \|/.test(s));
const counts={rows:rows.length,docPass:rows.filter(s=>s.split('|')[3].trim()==='PASS').length,runPass:rows.filter(s=>s.split('|')[4].trim()==='PASS').length,runBlocked:rows.filter(s=>s.split('|')[4].trim()==='BLOCKED').length};
if(counts.rows!==109||counts.docPass!==109||counts.runPass!==73||counts.runBlocked!==36)throw Error('Unexpected matrix counts '+JSON.stringify(counts));
await fs.writeFile('docs/delivery-matrix.md',header+table);console.log(JSON.stringify(counts));
