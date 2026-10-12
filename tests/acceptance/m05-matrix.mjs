import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const prefix='docs/reports/M05-20261012';
const read=async suffix=>JSON.parse(await fs.readFile(prefix+'-'+suffix+'.json','utf8'));
for(const suffix of ['scenario','http','deep','api-regression','app-component','backup']){const j=await read(suffix);assert.equal(j.summary.fail,0,suffix);}
assert.equal((await read('browser')).result,'PASS');
assert.equal((await read('app-job-component')).summary.fail,0);
const text=await fs.readFile('docs/meeting-hub/batch-boundaries.md','utf8');
const descriptions=[...text.matchAll(/^\| MH(\d{2}) \| ([^|]+) \|/gm)];assert.equal(descriptions.length,48);
const groups=[
 [[1,2,5,6,10,11,12,13,18,26,27],'本地PASS','scenario S01；api-regression创建/字段/目录/默认策略','M05-20261012-scenario.json','当前产品HTTP实测；Restricted仅最少元数据'],
 [[3,4,35],'本地PASS','scenario S07；component C03；browser删除确认','M05-20261012-scenario.json','删除只影响本地，不删除飞书/外部备份，不声称安全擦除'],
 [[7],'本地能力PASS；外部权限未测','browser HTTPS新标签属性；M02历史实际外链入口','M05-20261012-browser.json','只提供点击HTTPS链接，不保证飞书登录、权限或远端可用'],
 [[8,14,15,16,17],'本地PASS（含历史复用）','browser基本筛选/缺链接；M02历史多维筛选/排序；当前Meeting筛选逻辑只读复核','M02-browser-checks.json','不是把历史全部多组合过滤倒称本轮重跑；搜索只覆盖元数据'],
 [[9,25],'本地PASS','scenario S04/S05；api-regression真实写故障；App AC03/AC09；deep恢复','M05-20261012-scenario.json','部分成功可保留受限Raw；明确状态、同ID恢复'],
 [[19,20,22,23,24],'本地PASS','scenario S03真实multipart/BOM/CRLF/副本/再导入；component；M03既有格式拒绝','M05-20261012-scenario.json','仅UTF-8 .md和粘贴，不签PDF/DOCX；原件不被工作副本覆盖'],
 [[21],'本地PASS','browser危险Markdown阅读；M03历史安全渲染；scenario原件精确','M05-20261012-browser.json','HTML不执行、图片不自动加载、仅HTTPS外链；Raw原文只读'],
 [[28,29,30,31,32,33],'本地PASS（按MVP收窄）','scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝','M05-20261012-deep.json','Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输'],
 [[34,41,42],'本地PASS','scenario S08；deep拒绝前无写入；browser lab roots及Provider计数','M05-20261012-scenario.json','显式Raw增加真实Raw计数；一般会议操作不改知识/Prompt/草稿'],
 [[36],'本地兼容PASS；旧安全FAIL/真实AI BLOCKED','旧链与B05/B06实际fake回归；App真实任务轮询AJ01；FULL2历史遗留','M05-20261012-legacy-http.json','S-03/S-04未修；fake不代表真实Provider输出质量'],
 [[37],'本地兼容PASS；旧安全FAIL/真实AI BLOCKED','旧链手动Prompt与deep正常预览/受限确认','M05-20261012-legacy-http.json','Library无Provider可用；真实生成/优化质量未签收'],
 [[38,39,40],'本地PASS（按MVP收窄）','scenario S03/S07；http21与deep11；App真实Raw定位','M05-20261012-http.json','复用既有Raw格式；只Public/Internal明确登记；不创建会议Wiki'],
 [[43,44,45,47,48],'本地PASS','实际browser桌面/基本窄屏；App AC01/02/04/05/07/08；两轴只读','M05-20261012-browser.json','没有播放器/会议AI假入口；未知目标不展示其它资料'],
 [[46],'本地PASS（不新增会议样例）','api-regression空会议目录；scenario S01；旧demo实际显式导入及isDemo保留','M05-20261012-legacy-http.json','Meeting不自动灌入；旧演示功能需用户显式导入并标记，测试数据只在隔离目录']
];
const rows=descriptions.map(([,number,description])=>{const n=Number(number),found=groups.find(([ids])=>ids.includes(n));assert(found,'Missing MH'+number);const [,result,evidence,artifact,limits]=found;return{id:'MH'+number,requirement:description.trim(),result,evidence,artifact,limits};});
const result={at:new Date().toISOString(),scope:'Meeting Hub M01–M05 local MVP; not whole-product or real-AI PASS',rows,total:rows.length,legacySecurity:'S-03/S-04 FAIL retained',realProvider:'36 historical checks BLOCKED retained',historicalEvidence:'M02/M03 unchanged feature checks explicitly distinguished from M05 runtime'};
await fs.writeFile(prefix+'-spec-matrix.json',JSON.stringify(result,null,2));
await fs.writeFile(prefix+'-spec-matrix.md','# Meeting Hub MH01–MH48 最终映射\n\n2026-10-12。每项列本地结果、实际或明确历史证据及限制；M05阶段通过不能覆盖旧安全FAIL或真实AI阻塞。\n\n| ID | 要求 | 结果 | 证据 | 限制 |\n|---|---|---|---|---|\n'+rows.map(r=>`| ${r.id} | ${r.requirement} | ${r.result} | ${r.evidence}；[记录](${r.artifact}) | ${r.limits} |`).join('\n')+'\n\n历史证据不是本轮重跑：M02多组合过滤/排序与外链、M03格式/安全渲染分别保留原记录；本轮以完整真实HTTP/重启/CLI备份、App级组件及实际桌面/窄屏验证跨批组合。详细冻结差异和复用理由见M05最终验收报告。\n');
console.log(JSON.stringify({mapped:rows.length,legacySecurity:result.legacySecurity,realProvider:result.realProvider}));
