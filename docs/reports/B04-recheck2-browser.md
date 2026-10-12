# B04 第二次返修浏览器关键回归（2026-10-05）

本轮普通UI选择、草稿派生、确认与刷新关键路径通过。剩余三项原失败请求的关闭由 [公开HTTP独立复验](B04-recheck2-acceptance.md) 裁决；本报告的fake成功不代表真实Provider验收通过。

## 环境与证据

API4335/UI5186/fake4336，专属 `docs/reports/fixtures/B04-recheck2-browser`；正式workspace未修改。真实产品适配器请求自建HTTP fake，模型 `independent-fake-b04`；没有真实模型调用。fixture明确标注“独立fake非生产复验”。

[DOM记录](B04-recheck2-browser-dom.json) 保存操作后完整真实界面；[确认前](B04-recheck2-browser-before-confirm.json)/[确认后](B04-recheck2-browser-after-confirm.json) 是公开API回读，[断言](B04-recheck2-browser-checks.json)核对实际内容与数量。没有修改浏览器内部状态制造结果。

## 实际操作

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 初始默认未选 | 两页未选，确认（0）禁用，Source Key Takeaways暂无、建议纯文本列为未创建。 | R2UI01，PASS |
| 保存有效选集 | 勾选第一项，标题改「二次返修人工改名的渠道页」，定义改「二次返修人工定义应进入Key Takeaways」，保存草稿。Source Key Takeaways含人工定义，只链接改名后的选中页，未创建列表仅含第二项。 | R2UI02，PASS |
| 确认实际落盘 | 确认（1）完成，Source1＋concept1，待确认0。正式知识页标题/定义正确；正式Source含同一Key Takeaways与有效链接，选中页没有被称为未创建，未选库存概念保持纯文本且没有落盘。 | R2UI03/04、API断言、[截图](B04-recheck2-formal-source.jpg)，PASS |
| 刷新读取 | 刷新后重开正式Source，人工定义/选中链接/未选列表保留；列表仍2页。 | R2UI05，PASS |
| Raw不变 | 公开API的Raw正文和正文SHA确认前后相同。 | before/after/checks，PASS子条件；整个文件不变另见后端指纹。 |

Raw `ea51dcc2-59b1-4eb3-b0e1-8093c8f8f575`，operation `56ffd746-0525-456e-84fc-790995b85c45`，Source `edb6e308-d398-441e-ae64-0b4baf002f49`，知识页 `127c510a-6822-4c7c-9679-d0363adc2217`。

## 边界与清理

本次产品改动集中于confirm、Source派生与LLM汇总；UI代码未变，未重复上轮所有Source手工正文保存、合并、取消、导入、故障恢复和API重启的浏览器步骤。公开confirm与selected标记不同、未知ID重试和有/无hint汇总由独立HTTP实测；上一轮浏览器已关闭的其它问题保留原证据，不冒称本轮重新全测。

真实Provider仍缺配置，不能签整批PASS；是否全部确定性缺陷关闭见独立报告。验收方没有改产品/正式数据。自有三个隐藏Node进程及临时标签已关闭，日志/fixture/截图保留；[清理记录](runtime/B04-recheck2-browser-cleanup.json)。B05未授权，不推进。
