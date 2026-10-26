# R12 独立最终验收

2026-10-26，实际指定GPT-6 Astra medium独立验收。依据本轮任务卡、独立plan/engineering报告及主Agent实际Chrome归档；最终仅只读核隔离落盘与图像/AX，不重跑工程、不修改产品、不读取配置或调用模型、不提交Git。

**本轮人工独立列出问题的缺口关闭，R12人工纠正→独立显示→明确审查→正式保存回读闭环通过。原C09/10模型自动分类历史FAIL保留；全产品/B09仍未通过。** 该结论遵循R12“人工编辑可纠正标记”，不声称模型自动分类已修复，也不追改旧C已确认Wiki。KB02 HUMAN和SYN01既有通过保持。

## 最终实证

主Agent实际Chrome操作：先审第9页，再标记09使审批清零；标记10、刷新、撤销09再重标；仅选择09/10保存，逐14页明确审查，再确认写入2页和刷新。具体动作由主Agent执行并陈述，独立者核归档initial/marked/committed/readback AX、14步reviews.json和readback.png，不冒称自己点击。标记后的v4 AX两复选框均1、已审0/14；14步审查归档从v8到v21、已审1/14到14/14；刷新AX为confirmed、正式确认按钮禁用，人工问题保留。截图显示区域09来源事实与独立待确认栏，区域10依据完整AX与磁盘核实，不将单截图称为两页截图。

只读核验lab manifest指定 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\kb02-budget-yJljpN` 的实际文件：

1. 当前draft confirmed/revision21。54原unit、全部assignments、basisDigest与旧candidate逐项相同；14页全部source_facts/source_evidence与原稿deepEqual，09/10各多一条完整“人工标记待确认：异常审批负责人未知，AI仅未来分析建议。”，其余页open_questions原样。
2. 两人工引用ID为原 `fu-60870-60890-fact`、`fu-68471-68491-fact`；没有拆改原记录或填造未知负责人。仅09/10被选择，原所有页仍完整保留。
3. 14个approval均绑定内容摘要 `e6e720d2ec72c1c315f58ec5eeb19d4e406146dac468676ad90d32fca8df415e`，通过生产assertReviewed来源/结构/当前内容完整核验。commit快照capturedRevision21、selectedPageIds恰两页。
4. operation `ed4a52b6-3ad2-4946-9cd1-5f04d65cbd7c` completed。实际正式页 `dd73609f-f168-423d-b09e-34aa78be3b4e`（09）、`fafcaccf-0c28-4abf-8eaf-5953f126eea5`（10）、Source `4d203d3c-7f67-4424-9790-44de2ad024cd`，恰三页/revision1，逐完整记录与操作快照一致。两知识正文与当前页全量渲染严格相同，独立待确认段含完整人工问题；Source含两实际标题Wikilink及待验证内容。
5. knowledge/logs/wiki.jsonl恰三条create，ID集合等于三正式页，全部同operation。不是以计数代替内容核实。
6. 实际Raw正文重算SHA `a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`，与原106400字符长文相同。11受测文件及4份旧C原件最终再次SHA一致，无漂移。无既有正式C页追改。

Chrome页面仍显示原稿历史“15次调用”是保留原提取元数据；本轮重放原件新增调用0。首checkbox.check工具反馈未立即checked，主Agent后续状态核实服务器v3成功；本轮无模型外发，不据该工具反馈额外重试。服务/tab关闭由主Agent收尾，独立最终脚本没有启动或关闭其会话。

## 实际命令与版本

`node --import tsx tests/acceptance/R12-AUDIT-20261026-final-check.mjs`：最终exit0，0.575秒，Node v24.20.0。结果为revision21/units54/approvals14/wiki3/log3、Raw和冻结通过。脚本保留，纯只读执行；前两次断言错误源于审计脚本将approval字段误写为contentDigest及将Source标题Wikilink误认作ID链接。读取现有HumanReview类型/实际Source后分别改为digest字段与`[[标题]]`精确断言，再成功；未修改产品、数据或放松正文比较。

受测基线 `340fc156cd309924d517ea5df2da93e1186703ce`；11文件冻结集合SHA `4477a4e433e7ea8a2aefe9d0f92f32d5ac2325a09dde07687885e210bf9bacb2`。各文件见builder-freeze.json。提交标识由主Agent统一交付关联。工程命令与全部结果见engineering报告：独立原C回放通过、新增3+核心19+知识UI1通过、tsc/diff通过；联合24项中的旧综合UI fake缺v1版本1失败明确保留，不宣称整套测试全绿。

## 剩余边界与下一步

原自动分类失败及旧C历史缺独立问题仍保留为真实证据；现有人工能力已通过同原件实际用户流程补足。本次未做新真实模型质量实验，知识244/500、Prompt15/24不变。全产品/B09仍缺R16/R18模板字段、R22来源等级职责及组合版本四链证据，不能由本轮局部通过签整体通过。旧综合UI fixture协议不兼容作为测试维护遗留单列，未擅改。

建议主Agent收尾保护检查、统一提交同步并汇报，随后等待用户确认下一小批。可优先按既有缺口清单零调用界定R16/R18模板字段；不自动启动、不扩大真实额度。独立者token实数不可得。
