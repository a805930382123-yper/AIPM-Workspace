import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const p='docs/delivery.md';let text=await fs.readFile(p,'utf8');let changes=0;
text=text.split(/\r?\n/).map(line=>{
 if(line.startsWith('本文记录 B09 当前交付')){changes++;return '本文记录 B09 最终交付的运行方式、施工自测、主 Agent独立验收结果与限制。同一 GPT-6 Luna High 完成施工及返修，F09-01–04 全部 CLOSED，确定性实现通过；真实 Provider 成功和质量仍 BLOCKED，整批不补签真实 AI。四条实际浏览器 AI 机械链路使用独立本地 fake。最终报告见 [B09-acceptance.md](reports/B09-acceptance.md)，109 项独立矩阵见 [B09-delivery-matrix.md](reports/B09-delivery-matrix.md)。';}
 if(line.startsWith('| B09/B08/B07 独立 HTTP 与回归')){changes++;return '| B09/B08/B07 独立 HTTP 与回归 | PASS | [最终 B09 HTTP](reports/B09-acceptance-http-fixture-corrected.json) 7/7、[B08 HTTP](reports/B09-regression-acceptance-http.json) 15/15、[B07 HTTP](reports/B09-regression-acceptance-b07-http.json) 11/11；四类损坏记录+重启通过。原始无效预期输出保留，最终证据以独立报告为准。 |';}
 if(line.startsWith('| 首页视觉与桌面操作')){changes++;return '| 首页视觉与桌面操作 | PASS | [首页截图](reports/B09-acceptance-home.png)、[统计返修截图](reports/B09-repair1-acceptance-home.png)、[失效入口最终截图](reports/B09-repair2-acceptance-stale-wiki.png)。最终 Wiki 选择修复独立构建 PASS，45 modules/980ms；[10/10 实际浏览器复验](reports/B09-repair2-acceptance-browser.json)通过。 |';}
 if(line.startsWith('| F09-04 最近失效 Wiki 不串页')){changes++;return '| F09-04 最近失效 Wiki 不串页 | PASS；F09-04 CLOSED | [原始失败](reports/B09-initial-stale-wiki-browser.json)保留；[最终独立10/10](reports/B09-repair2-acceptance-browser.json)：删除及旧新建历史不显示其他页详情/导出，手动选有效页恢复，非首条准确ID、搜索、普通知识库、重复新建入口正常，F09-03创建/解决计数保持。 |';}
 if(line.startsWith('- Wiki/Raw/Prompt 关联以稳定 ID')){changes++;return '- Wiki/Raw/Prompt 关联以稳定 ID 解析；F09-04 已独立 CLOSED，失效最近记录明确报错且不自动打开另一页；其它错误或过期引用仍需用户检查。';}
 return line;
}).join('\n');assert.equal(changes,5);
text=text.replace('原始 `B09-acceptance-backup.json` 保留了一个对已回收 Prompt versions API 期待 404 的无效断言','原始 `B09-acceptance-backup.json` 保留了一个误期待仍可通过 versions API 读取已回收 Prompt 的无效断言（实际正确返回 404）');
text+='\n\n主 Agent文档收尾：最终仅 WikiPage 选择保护改动，独立最终 build PASS（45 modules/980ms）。先前冻结完整152/152、F09-03修复37/37 UI和12/12实际浏览器证据按不变SHA复用，没有冒称最终修复又运行完整套件。`docs/delivery-matrix.md` 由主 Agent将109项最终 DOC/RUN 状态与独立矩阵同步；施工报告仍保留各轮当时的待复验状态，不改历史原件。\n';
await fs.writeFile(p,text);
const matrix=await fs.readFile('docs/reports/B09-delivery-matrix.md','utf8');await fs.writeFile('docs/delivery-matrix.md',matrix.replace('# B09 主Agent独立最终交付矩阵','# A01–A63 / R01–R46 最终交付矩阵').replace(/\]\(([^)]+)\)/g,'](reports/$1)'));
console.log({deliveryUpdates:changes,matrixRows:109,productCodeUntouched:true});
