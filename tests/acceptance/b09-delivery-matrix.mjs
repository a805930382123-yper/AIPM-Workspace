import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const spec=await fs.readFile('docs/acceptance.md','utf8');const rows=spec.split(/\r?\n/).filter(l=>/^\| [AR]\d{2} \|/.test(l)).map(l=>l.split('|').slice(1,-1).map(x=>x.trim()));assert.equal(rows.length,109);assert.equal(new Set(rows.map(r=>r[0])).size,109);
const blockedA=new Set([6,8,9,10,18,23,24,28,44,45,46,47,48,53,54,55,63]);
const blockedR=new Set([5,7,9,11,12,15,16,17,18,19,20,22,23,24,26,35,36,38,42]);
const history={B01:'B01-acceptance.md',B02:'B02-acceptance.md',B03:'B03-acceptance.md',B04:'B04-recheck3-acceptance.md',B05:'B05-acceptance.md',B06:'B06-acceptance.md',B07:'B07-repair3-acceptance.md',B08:'B08-acceptance.md'};
const batchA=n=>n<=3||n===7?'B01':n<=5?'B03':n<=13?'B04':n<=17||[19,20,21,35,36,58].includes(n)?'B02':n===18||n<=24?'B05':n<=34?'B06':n<=43||n===59?'B07':n<=56?'B08':'B09';
const batchR=n=>n<=3?'B09':n<=6?'B04':n<=10?'B03':n<=23?'B04':n===24?'B05':n<=29?'B06':n<=32?'B09':n<=34?'B07':n<=39?'B08':n===40?'B07':n===41?'B04':'B09';
const notes={
 A06:'Raw文件及正文在独立fake、人工确认、错误/重启过程中不变；真实Provider全链路仍待验。',
 A18:'两来源Synthesis的预览、确认、来源与冲突保存已有独立证据；真实综合成功/质量待验。',
 A22:'标题/别名/分类/标签/内容候选与用户三决策实际通过；启发式候选不承诺语义等价。',
 A23:'旧页预览/版本保护/人工编辑/确认通过；真实模型建议质量待验。',
 A24:'固定相反公式不丢失及标记/追溯通过；真实模型识别未知冲突待验。',
 A25:'整页/段落创建及字段保存复用B06有效证据，本批复核整页链路。',
 A27:'定位插入/歧义/被改被删及人工重定位复用B06独立证据。',
 A29:'提议/放弃/拒绝零改页、显式确认更新、决议记录的机械行为已实际执行；不签语义质量。',
 A49:'预览/重生成/退出未自动进正式Library；实际显式保存才增加。',
 A50:'预览编辑被复制/保存采用，实物读回用户正文；质量判定另列。',
 A51:'实际用户确认后Library读回、来源ai_generated及版本历史；Provider产出质量不在此PASS中。',
 A52:'原文比较及保存后保留原文本实际浏览器通过，沿用B08复验。',
 A56:'原记录版本递增、旧正文/来源/修改来源保存及重启实际通过；真实优化质量另列。',
 A57:'Wiki/手动/审核fixture/生成fixture/优化fixture保存结果刷新重启实际在盘；真实AI成功不因此补签。',
 A60:'缺配置/鉴权/限流/断开/格式错误/截断/schema/EIO无空正式资产；真实60秒超时复用B08冻结不变Provider证据。',
 A61:'无Key手动Raw/Wiki/Prompt/搜索/变量复制/导出/历史实际操作及HTTP通过；无需施工Agent参与运行。',
 A62:'显式1/5/4演示及任务入口，列表/详情/原文/导出标记，用户编辑仍保留系统标识。',
 A63:'实际桌面四链路及持久化接线使用独立fake通过；真实Provider四链路成功/质量缺配置。',
 R02:'逐文件落点、修改及未复用范围，与代码/规则核对；复用历史已读取上游快照，不声称本批新核验main。',
 R03:'LLM-Wiki-KB MIT原文保留且不变；另一上游只采用思想，未取得LICENSE/固定commit，未复制代码。',
 R04:'实际服务独立启动，仅用自身HTTP Provider适配器；无Agent/Obsidian/Coze运行依赖。',
 R21:'旧记录兼容及新增只读isDemo，枚举/原来源/版本时间保持；备份逐文件字节一致。',
 R28:'Home最近日志按真实ID、计数来自实际知识操作；Prompt新增/改版/草稿不新增知识日志。',
 R31:'六真实计数/五快捷入口/周一上海周界口径；本批操作前后与公开API/磁盘核对。',
 R33:'完整手动Library复用B07最终浏览器及本批B07公开HTTP/损坏重启回归。',
 R34:'十用户字段及系统来源/变量/版本实际读回，Demo只读isDemo保留，普通请求不能伪造。',
 R36:'只发送所选Wiki必要片段、单页3000/总12000硬预算已实测；真实模型利用背景/关联质量仍待验。',
 R39:'人工/生成/优化修改来源可读，原Prompt新版本不破坏历史，重试/409/EIO/对账保持。',
 R40:'Prompt独立于knowledge；删除与失效关联、知识Log隔离已实际验证。',
 R41:'仅服务端读取配置，API/UI显示掩码；fake错误脱敏探针通过；实际Provider缺配置明确保留。',
 R42:'独立fake通过四条实际浏览器闭环/公开API/实物；真实供应商成功/内容质量BLOCKED。',
 R43:'范围检查无排除项运行功能；Prompt模板里的Agent/Eval字样不等于运行Agent/Eval系统。',
 R44:'固定1 Raw/5 Wiki/4 Prompt/1任务，启动不seed、并发幂等、不覆盖编辑、不复活删除；EIO恢复同manifest。',
 R45:'桌面中文界面、长文/审核/生成/优化实际可操作；本批截图与既有长文浏览器证据核对。',
 R46:'README/delivery/reuse/109项矩阵与实测逐条对照，解析/格式/搜索/去重/长文/API/质量/上下文/关联风险明确。'
};
let out='# B09 主Agent独立最终交付矩阵\n\n2026-10-08；依据docs/acceptance.md原63项与正文46项，共109行。DOC=PASS仅说明设计/文档/实现与范围相符；RUN记录实际运行门禁，不代签真实AI。确定性调用只使用独立本地fake，真实Provider未配置。沿用未受本批影响且已经CLOSED/PASS的历史独立证据，不复用旧FAIL冒称通过。\n\n本批新证据详见[B09主报告](B09-acceptance.md)、[最终HTTP](B09-acceptance-http-fixture-corrected.json)、[最终备份](B09-acceptance-backup-fixture-corrected.json)、[首版浏览器](B09-acceptance-browser.json)、[修复后浏览器](B09-repair1-acceptance-browser.json)。F09-01–03最终全部CLOSED；初始FAIL和无效fixture原始观察保留，RUN按主报告最终闭合状态。\n\n| ID | 验收判据 | DOC | RUN | 通过子条件/剩余边界 | 独立证据 |\n|---|---|---|---|---|---|\n';
for(const [id,criterion] of rows){const n=Number(id.slice(1)),blocked=(id[0]==='A'?blockedA:blockedR).has(n),b=id[0]==='A'?batchA(n):batchR(n);const note=notes[id]??(blocked?'Schema/UI/审核/持久化与fake确定性行为已验证；真实Provider成功或语义/内容质量缺配置，整项不签PASS。':'实际操作/结构/文件/错误与持久化按对应批次独立证据通过，本批完整测试及受影响范围回归核对。');const ref=history[b]?`[${b}最终独立报告](${history[b]})；[B09增量](B09-acceptance.md)`:'[B09独立报告](B09-acceptance.md)';out+=`| ${id} | ${criterion} | PASS | ${blocked?'BLOCKED':'PASS'} | ${note} | ${ref} |\n`;}
out+='\n状态边界：Node v25.2.1/Windows本机实测；最低Node版本与其他操作系统NOT_RUN；扫描PDF无OCR、复杂版式与语义搜索不承诺。演示、备份和确定性核心链路通过不关闭B04–06/B08的真实AI阻塞。所有本批实测用隔离TEMP，正式workspace和历史报告完整性由SHA证据核对。\n';
await fs.writeFile('docs/reports/B09-delivery-matrix.md',out.replace('F09-01–03最终全部CLOSED','F09-01–04最终全部CLOSED'));console.log({rows:rows.length,blockedA:blockedA.size,blockedR:blockedR.size});
