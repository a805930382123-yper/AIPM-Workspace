# KB02 EDGE 独立验收结论

**KB02整体FAIL。工程通过；本轮原空白选择缺陷和Wiki同项点击缺陷在限定回归范围内可关闭。新的真实规划type/category混淆使原短文没有草稿，完整补充更新链NOT_RUN。** 新失败不是旧空白问题复发，不以严格拒绝坏响应当作质量成功。

验收者：当前Astra独立实例；施工由Sol承担，状态/Git由主Agent管理。冻结UTC2026-10-22T13:52:05.091Z，产品验收后未修改。既有用户明确授权open.bigmodel.cn虚构资料和Playwright真实Chrome持续有效，本轮没有授权阻塞。

## 分项结果

| 门槛 | 结论与证据 |
|---|---|
| 工程/兼容/安全回归 | PASS。默认385/385，tsc/Vite，旧Node24.19.0下51/51与106/106，历史probe2+2及新probe4；全部零skip。见[工程报告](KB02-EDGE-AUDIT-20261022-engineering.md)。 |
| 原F-KB02-SOURCE-01空白sourceNotes | 本例PASS，可按原缺陷关闭。seq147原134字符短文提取4事实、1问题、1来源说明；c1-a0005不在发送目录也未被选择，非空原ID/原文证据保留。受控测试另证引用隐藏空白仍严格拒绝。不能由一次真实样本外推所有模型输出稳定。 |
| 原F-KB02-SOURCE-UI-01同项清空详情 | PASS，可按原缺陷关闭。冻结产品在历史真实隔离root完整副本运行Chrome，metric/source连续同项点击、正常切换、编辑同项返回、刷新后两页重点击6项通过；无任何mutation。见[浏览器结果](KB02-EDGE-AUDIT-20261022-browser-reclick.json)及同名前缀截图/DOM。该数据不是当前短文生成的目标。 |
| 当前原短文完整提取规划 | **FAIL**。seq147提取通过，seq148规划返回pages[1].type=ai_application，正确类型枚举不含此值；严格拒绝并保留1个已验证块，无plan/草稿/正式Wiki。 |
| 原106400字符14区域全文 | PASS。seq149–163共15调用，14页、79事实+27问题、56unit/106原ID。全部ID恰好一次归属，同源拆分0；逐区主体/2026年9月/目标100家/在售11–24家及11–24%均保留，各页对应单一区域，未知/未来限制保留，无排版声明进入业务页。 |
| 长文实际浏览器 | PASS。14张草稿卡均读取并留DOM字段，区域06/07/14截图，刷新后仍14页；未选择写入。见[browser结果2](KB02-EDGE-AUDIT-20261022-browser-result-2.json)。 |
| 补充资料/候选选旧目标/更新预览/冲突/双来源/人工备注/明确确认/刷新回读完整链 | **NOT_RUN，依赖当前短文失败**。未创建替代目标、未伪造模型规划、未借历史新建页声称更新链通过。原计划补充2+预览1未调用。 |
| 独立搜索乱序旁支 | F-KB02-EDGE-DIAG-UI-02/P2保持未修；不以普通搜索及同项测试签其通过。 |

## 新失败与最小诊断入口

**F-KB02-EDGE-PLAN-01 / P1：真实规划混淆type与category，阻断短文草稿及更新闭环。** seq148 HTTP200/stop，响应第二页把ai_application同时写入type/category。请求已经明确给出完整schema：type仅concept/entity/business_process/metric，category允许ai_application。离线按同一请求schema重放准确得到一个pages[1].type枚举错误。输入含4事实unit和1问题unit，响应引用齐全；当前直接阻断点是类型，不是ID缺失、网络、空白atom或数据丢失。

完整原Raw、job/checkpoint、提取响应、规划请求/响应/schema与离线错误：[短文证据](KB02-EDGE-AUDIT-20261022-short-failure.json)。Raw ID `4f322c20-3986-4c53-b667-46580a95cf5f`；job `ba15779e-f26c-4536-9ae2-836ad7c041aa`。Chrome失败初次与刷新截图如实显示LLM_SCHEMA_INVALID、已验证1/1段、累计2调用；没有点击继续提取/重新生成。

最小零外发复现：`node --import tsx tests/acceptance/KB02-EDGE-AUDIT-20261022-planning-replay.mjs`。下一轮建议先由施工者离线诊断规划类型/分类提示边界，保留原失败响应严格拒绝，评估最小明确字段约束及合法示例，提交方案再施工；不可静默把非法type映射成合法值、放宽schema或盲重试。若Prompt或规划输入改变，须重新评估旧规则兼容与真实长文必要回归。本轮未启动新返修。

## 事实归属、Raw与持久证据

[质量报告](KB02-EDGE-AUDIT-20261022-quality.json)逐页列出事实与区域；[全部unit/ID归属](KB02-EDGE-AUDIT-20261022-same-source-split.json)覆盖56unit/106ID，split=[]。长文保留原SHA `a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`；短文保留原SHA `d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515`。提取前后Raw/Wiki文件快照一致，失败短文未发布半成品；长文checkpoint与job均计15，草稿刷新可读。恢复/取消/旧规则兼容有本轮工程实测，但未为真实故障重放额外外发。

## 预算、保护与清理

本轮17/24：seq147–148短文2，seq149–163长文15；累计**163/200**，总余37，本轮余7封存不用，Prompt独立15/24。17条事前attempt与17条trace逐一连续对应，知识调用全部low，失败也计数，没有自动重试。见[预算](KB02-EDGE-AUDIT-20261022-budget.json)。主Agent已关闭真实门禁。

真实根 `C:/Users/80593/AppData/Local/Temp/fmcg-kb02-final-audit-real-WPnLby`、浏览器历史副本 `C:/Users/80593/AppData/Local/Temp/kb02-edge-browser-v838gm` 保留证据。两组API/Vite及自有Chrome全部关闭，见[真实服务结束](KB02-EDGE-AUDIT-20261022-main-lab-final.json)、[副本服务结束](KB02-EDGE-AUDIT-20261022-browser-lab-final.json)、[Chrome结束](KB02-EDGE-AUDIT-20261022-browser-closed.json)。历史root完整复制初始相同、结束原root全字节不变，副本外网阻断记录为空；原历史服务未重启。

[完整性](KB02-EDGE-AUDIT-20261022-integrity.json)冻结、历史资产、正式workspace和配置均无变化。[安全扫描](KB02-EDGE-AUDIT-20261022-local-safety.json)未发现当前密钥泄漏，服务日志也已检查。所有首败与新真实FAIL保留，不修改状态/Git、不推进下一批。
