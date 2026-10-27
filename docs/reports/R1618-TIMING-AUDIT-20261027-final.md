# F04 无上限计时与人工字段独立验收

2026-10-27，Astra独立审查；Sol交接停写后核实际差异，主Agent完成一次Chrome闭环后核阶段导出与刷新回读。受测基线 `b70a2f170be37c5e59b157b227fabb1c0c6b2862` 加本轮lab差异；lab SHA256 `93ECD26190924ED4CBE1E0F6E1B32903253038A14786A8920392B5999E5EEFAB`。最终交付提交由主Agent统一关联。

**局部F04人工编辑→保存刷新→审后修改失效→重审→正式新建刷新回读通过，原浏览器闭环阻塞关闭。** 结合原同版F01/F02/F03/F05工程证据，R1618-FIELDS人工字段功能任务卡通过；原配置读取历史偏差仍保留，不能宣称历次执行全部满足零读取。**自动逐字段内容质量未验证，R18历史自动FAIL不改，R16/R18整项、B09及全产品未通过。** 不自动推进下一批。

## 本轮独立检查

| 检查及实际命令 | 结果 |
| --- | --- |
| `git diff -- tests/acceptance/R1618-FIELDS-20261026-lab.mjs`，读取施工报告及TEMP `startup-timings.json` | 仅新增无时限完整HTTP正文计时和经批准的polling watcher；无产品变更 |
| `git rev-parse HEAD`、`Get-FileHash tests/acceptance/R1618-FIELDS-20261026-lab.mjs` | 与上方受测版本、冻结一致 |
| `git diff --name-only HEAD -- app services tests/r1618-field-editing.test.ts tests/acceptance/R1618-FIELDS-20261026-browser.tsx` | 空输出，产品、原测试及浏览器入口未改 |
| PowerShell here-string管道 `node`，使用 `node:assert/strict` 读取01–05导出，深比较各页source_facts/source_evidence、比较Raw SHA；最后读取06及TEMP Raw文件计算SHA256 | 全部断言通过；原4条事实及4条完整证据未变，Raw文件SHA为 `4f639fe6faefaa0219ba382c678fc9fd70d542c40d66a663501abbc56843d23a` |
| 同一只读Node核03/04/05的 `draft.humanReview.approvals.length` | 分别2/0/2；revision分别5/6/8，修改后确实失效并重新审查 |
| 只读Node将06中两正式正文与18/19刷新AX归一CRLF后逐字包含比较，检查formal.length | 两正文均完整存在于对应实际UI回读，正式记录3条（Source+Concept+Process），draft confirmed |
| `rg -n '/api/audits\|registerAudit' server -g '*.ts'`，读取WikiPage AuditPanel与lab注册路由 | 确认隔离lab未挂载Audit路由，见下方限定 |

以上是证据核对，未重跑7项工程测试或扩展矩阵。原 `node --import tsx --test tests/r1618-field-editing.test.ts` 7/7及模板/渲染/tsc结果为历史同版证据，详见 `R1618-FIELDS-AUDIT-20261026-final.md`；不称本轮重新执行。施工实际 `node --check ...lab.mjs` exit0和 `node --import tsx ...lab.mjs --measure-startup` 记录见 `R1618-TIMING-20261027-builder.md`。

## 计时及浏览器证据

计时从每个请求发出前至response `end`，`http.get` 设置timeout:0，没有准备/请求时限。最终shell/browser/Draft/Wiki响应分别6617.66/28779.94/1317.21/618.28ms，均HTTP200；首请求开始到末请求结束44.923秒包含间隙。它是所列模块完整响应时间，不是全依赖图编译耗时、UI就绪时间或性能门槛。8秒不是产品门槛。

首次无上限运行在shell200后遇Node Windows fs-event.c:72原生断言及browser ECONNRESET退出，保留为失败记录。仅lab启用polling后的运行完成；不据此追认历次8秒失败的唯一原因。Chrome后来实际正常显示并完成操作，另以UI证据证明功能可用。

`R1618-TIMING-20261027-01-initial.json` 至 `06-final.json` 与 `R1618-TIMING-20261027-ui/` 记录同一draft `028e1066-717a-4db6-a613-25eacd8ccaf0`：v1→v2字段保存刷新，v5两页审查，v6修改两类人工说明后审批归零且写入禁用，v8重新两页审查后明确提交。AX 04刷新、10失效、12展开预览、14重审及18/19正式刷新与导出相符。Concept一句话、Process触发、AI机会中的来源摘录、人工说明及分析建议标签分隔；未知/未来限定完整保留，未填字段仍待确认。

正式操作 `2cdb0351-266f-436e-8fc2-dc186be207c4`，主Agent操作记录及AX16显示完成；06含Source与两类型正式页。18/19全文与06正式正文逐字一致，包括两类修订人工说明及AI未上线/收益未知限定。本次只验新建正式页，不扩张为带字段合并、切型或旧Wiki更新能力。

## 残留与范围

正式Wiki下方Audit面板确实显示“请求失败，请稍后重试”。静态接线核明：WikiPage.tsx:269自动请求 `/api/audits?wikiId=...`，该接口由server/audit-api.ts注册，生产server/index.ts有挂载；本隔离lab仅注册B04/Knowledge及所列Raw/Wiki路由，没有registerAuditRoutes。故这是隔离入口未覆盖辅助Audit造成的残留，不阻断已实际读取的正式正文；不签Audit链或完整App通过，也没有为此改入口、重启或新增测试。

Provider恒undefined、envDir指向隔离TEMP，真实模型调用0，知识244/500和Prompt15/24不变。硬编码configReads:0不是审计证据，早期可能读取项目.env.local的历史偏差不抹除。本轮未改正式workspace或外部AGENTS/.agents/AGENT-ROUTER内容。主Agent关闭Chrome；施工交接确认本卡服务退出、5176/53098无监听，该清理结果为交接证据，未重复探测。

本审查仅写本文，停写交主Agent收尾同步。后续按原计划另行安排自动质量或下一独立小批，须用户确认；当前不启动。
