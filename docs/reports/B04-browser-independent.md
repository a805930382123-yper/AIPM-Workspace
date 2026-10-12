# B04 主 Agent 真实浏览器独立验收（2026-10-05）

**结论：FAIL。** 通过真实浏览器操作导入、提取、审核、保存、确认、合并、放弃、取消及重启。F04-01/F04-02/F04-03 实际复现；未选页链接缺陷 F04-05 也从正式 Source 页面复现。其它通过行为不能抵消这些失败。

## 环境与证据

专属 API 4335、UI 5186、自建 fake Provider 4336，数据目录 `docs/reports/fixtures/B04-browser-independent`；未修改正式 `workspace/`。Provider 经产品真实 HTTP 适配器返回确定性 JSON，模型 `independent-fake-b04`，无真实 AI 调用。fake 脚本为 [b04-browser-fake.mjs](../../tests/acceptance/b04-browser-fake.mjs)。

界面操作使用 Codex in-app browser；[DOM 操作记录](B04-browser-dom.json) 保留编辑前后及结果，部分早期记录为界面差异文本。[API 持久化断言](B04-browser-persistence.json)、[确认前](B04-browser-before-confirm.json)/[确认后](B04-browser-after-confirm.json)、[放弃后](B04-browser-after-discard.json)、[取消晚到应答及鉴权失败后](B04-browser-after-cancel-and-auth.json)、[重启后](B04-browser-after-restart.json) 为另行公开 HTTP 回读，不通过浏览器内部状态制造结果。

## 实际操作与结果

| 场景 | 预期 / 实际 | 结论与证据 |
|---|---|---|
| 初始人工选择 | 提取 Raw「B04独立UI-编辑确认」后打开审核；冻结要求默认全不选，实际两页均勾选、确认（2）已启用。 | FAIL F04-03；[截图](B04-browser-auto-selected.jpg)，U01 |
| Source 编辑保存 | Source 标题改为「独立人工Source标题-不应丢失」、正文人工修改、等级 C→A，点击保存草稿；v1→v2 却全部恢复旧值，API 最终仍旧标题/正文/C。 | FAIL F04-01；[保存后截图](B04-browser-source-save-lost.jpg)，U02、持久化 JSON |
| 页编辑直接确认 | 取消第二页勾选，第一页标题改为「人工确认后的新标题-不应丢失」、定义改为「人工编辑定义-确认应保存」，未点击保存直接确认（1）；操作成功，正式页却是旧标题/定义，界面未阻止或提醒未保存修改。 | FAIL F04-02；[确认结果](B04-browser-confirm-old-content.jpg)、[正式页](B04-browser-formal-old-title.jpg)，U03、API 回读 |
| 选择数量及 Raw | 上述确认正式 Wiki 从0→2，确为 Source1＋concept1；Raw 正文和正文 SHA-256 前后相同。 | PASS 子条件；持久化 JSON。此处只核对正文及正文校验值，整个 Raw 文件冻结另见后端证据。 |
| 未选页链接 | 已确认的 Source 正文仍有库存概念 Wikilink，库存概念没有创建，UI 显示「未找到匹配页面」。 | FAIL F04-05；[重启后正式 Source](B04-browser-restart-persistence.jpg)，U03/U11 |
| 页明确保存 | 第二条 Raw「B04独立UI-保存合并放弃」，全不选，修改第一页标题「已保存的人工知识标题」，点击保存后标题保留、版本增加。 | PASS 子条件；U04。此结果不能代表 Source 保存成功。 |
| 合并交互 | 选两个合并复选框，点击合并后页面数2→1、版本增加、合并来源和证据展示。 | 交互实测；未给内容完整性签PASS。此 fake 两页事实相同，事实完整性由后端不同事实 fixture 复现 F04-07。 |
| 放弃 | 放弃草稿并确认，返回 Raw，首页 Raw2/Wiki2/待确认0，未增加正式 Wiki；API 草稿 discarded，Raw unprocessed。 | PASS 子条件；[截图](B04-browser-discard-stats.jpg)、放弃后 JSON，U06 |
| 取消及晚到应答 | 第三条 Raw「B04独立UI-取消慢任务」使用12秒慢 fake，点击取消，回到 unprocessed/AI整理按钮；晚到响应后无新草稿/正式 Wiki。随后同 Raw 发起鉴权失败场景。 | PASS 子条件；U07、后续组合 API 快照共3 Raw/2 Wiki/0 pending，仅前两份已确认/放弃草稿。没有独立保存取消与鉴权之间的完整 API 快照。 |
| 鉴权失败 | fake HTTP401，页面明确 LLM_AUTH_FAILED、处理失败与重试按钮；无新草稿/Wiki。 | PASS 子条件；[截图](B04-browser-auth-failure.jpg)、U08、组合 API 快照 |
| 重启/缺配置 | 只重启本轮 API，同数据目录移除临时 fake 环境变量，项目无 .env.local；刷新后设置显示未配置，Raw3/Wiki2及已确认/放弃/失败状态仍存在；点击重试明确提示尚未配置产品LLM，无草稿增长。 | PASS 子条件；U09–U11、重启后 JSON。此测试未配置或调用真实 Provider。 |

确认操作 ID `198d3fd4-2ec6-4371-a3fd-24cef7ecfc01`；Source ID `1989bf73-d436-4251-a280-8a8f6790b6df`，知识页 ID `40097a66-4903-4288-bef3-c87ac5692bad`。所有资料是隔离的明确非生产 fixture。

## 边界与清理

真实 Provider 成功/质量/真实AI Raw不变为 BLOCKED；本轮没有用户产品配置，不能用 fake 签这些整项 PASS。后端竞态、错误矩阵、故障恢复、长文等见 [独立总报告](B04-acceptance.md)。本浏览器报告按行为列出结果，没有将交互步骤重复累加为整批通过场景。

未修改产品代码，未进入 B05。日志、fixture、截图全部保留；关闭且仅关闭本轮已验证的三个 Node 服务及临时浏览器标签，清理记录见 [B04-browser-cleanup.json](runtime/B04-browser-cleanup.json)。既有正式服务保持原状态。
