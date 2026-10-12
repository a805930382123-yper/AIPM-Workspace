# B04 返修真实浏览器复验（2026-10-05）

本轮实际浏览器复验关闭 F04-01/F04-02/F04-03，验证正常 UI 选择路径中的 F04-05 修复。**整批仍 FAIL**：独立公开 HTTP 对 F04-04/F04-05/F04-11 发现残留，浏览器通过路径不抵消它们，详见 [独立报告](B04-recheck-acceptance.md)。

## 环境和证据

API4335、UI5186、自建 fake Provider4336，专属 `docs/reports/fixtures/B04-recheck-browser` 数据目录。产品经真实适配器 HTTP 获取确定性 JSON，模型 `independent-fake-b04`；无真实模型调用。测试资料均标识独立 fake 非生产资料，正式 `workspace/` 与既有服务未修改。

[DOM记录](B04-recheck-browser-dom.json) 保存实际操作后完整页面；[持久化断言](B04-recheck-browser-checks.json) 来自公开HTTP回读及文件SHA比对；另有 [确认前](B04-recheck-browser-before-confirm.json)/[确认后](B04-recheck-browser-after-confirm.json)、[重启前](B04-recheck-browser-before-restart.json)/[重启后](B04-recheck-browser-after-restart.json) 快照。没有修改浏览器内部状态制造成功结果。

## 实测结果

| 检查 | 预期与实际 | 证据/结论 |
|---|---|---|
| F04-03 初始选择 | 新草稿两页都未选，已选0，确认（0）禁用；全选、全不选、再单选正常。 | RUI01/RUI04；[初始截图](B04-recheck-default-unselected.jpg)，PASS |
| F04-01 Source保存 | 标题改「返修人工Source标题」，保留原正文并追加人工备注，等级C→A，点击保存后标题/正文/A和Raw左栏元数据保留。 | RUI02；[保存截图](B04-recheck-source-save.jpg)，PASS |
| F04-01 刷新重开 | 刷新页面，再从Raw继续审核，Source所有人工修改仍在。 | RUI03，PASS |
| F04-02 直接确认 | 只选第一页，将页标题改「返修直接确认人工知识标题」、定义改「返修人工定义必须进入正式知识页」，没有另点保存直接确认。操作完成，公开API及正式Wiki页面均为新标题/定义；人工Source备注/A也保留。 | RUI04–RUI07、确认后API；[正式编辑结果](B04-recheck-formal-edits.jpg)，PASS |
| 数量与Raw | 首条Raw确认只创建Source1＋concept1，待确认0；Raw正文及正文SHA与确认前一致。 | 确认前后JSON、checks，PASS；整Raw文件冻结另见后端证据。 |
| F04-05 正常UI选择 | 第二条Raw不手工编辑Source正文，选择第一页并人工改名后直接确认；Source只有 `[[返修实际创建的人工改名页]]` 一个有效关联，未选库存概念只列待处理纯文本；正式库累计4页，没有未选页落盘。 | RUI08/RUI09；[有效关联截图](B04-recheck-selected-links.jpg)，此UI子路径PASS。公开confirm选择与旧selected标记不同仍FAIL，见独立报告。 |
| F04-06 来源展示 | 第一Raw的来源类型/名称/测试作者/URL显示在Source正文和Raw面板，未提供日期明确标记；第二Raw缺作者/URL时明确未提供。 | RUI01/RUI06/RUI09，PASS子条件；完整日期等由后端独立核验。 |
| 重启持久化 | 同目录重启本轮API、刷新UI，人工正式页仍显示新标题/定义，Source/选中链接亦由API回读保留，Raw2/Wiki4/待确认0。所有16个数据文件SHA重启前后零差异（包括Raw、正式页、Index、Log、草稿、任务/状态/清单）。 | RUI10、before/after restart、checks；[重启截图](B04-recheck-restart-formal.jpg)，PASS |
| 缺配置展示 | 重启时只移除本轮fake环境变量，项目未有.env.local。设置明确模型/BaseURL/Key未配置，配置来源无。 | RUI11、config API，PASS展示子条件；本次未从该UI重试缺配置请求，后端另验。真实Provider继续BLOCKED。 |

第一条Raw ID `e9831976-895a-49ec-8837-2f5b4fd3051e`，operation `c1228e9c-0b5c-4fac-a7f7-5897dfaaaa5a`；第二条Raw `f5ed34fa-cbd8-4007-903b-2eb8958ed251`，operation `f209a385-7e7f-4455-9b01-5b562ba5e212`。第一Source的正文是用户主动编辑冻结的文本，正文内初始C描述未手动修改，元数据人工等级A已正确持久化；第二Source保持自动派生，用于检查选集和链接。

## 边界与清理

本次只重测返修影响及关键持久化，不重复上轮已通过且无关联改动的所有浏览器导入/取消/放弃步骤。相关后端取消/竞态/合并/恢复已独立复验。主Agent没有修产品，旧报告/截图保留。自有三个隐藏Node进程与本轮临时浏览器标签已关闭，fixture/日志保留，[清理记录](runtime/B04-recheck-browser-cleanup.json)。B05未授权，不推进。
