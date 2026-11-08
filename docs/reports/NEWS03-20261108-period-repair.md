# NEWS03 F01 数据时期返修施工交接

按 B 模式收缩方案完成施工自查，交 Astra 独立复验 F01 与 NEWS03 整体门禁。施工实例为新 Sol High `news03_period_repair`。接手基线 `7998f27d9b885fd275b77d0bbf29dbbbb3a000ee`，交接时共享 HEAD 为 `8a8d7741fc70755a6c0c16414c0badf9f10b8b13`，包含其他任务的首页布局提交。本返修以文件 SHA256 标识。冻结任务卡 SHA256 `BE4FA33C6E4B751B9E0800FD091BE6C2683C3D3CDA3E3CE86E6162E0245C2345`。[任务卡](../handoffs/NEWS03-20261108-task.md)

`period` 只读取段首或明确句界后、带冒号的独立口径标签。单一标签后的完整值须为一个日期或连续日期区间，保留标签和值在摘录中的原文。经营叙述、无标签、预测措辞、列表式或多标签混合均返回 `null`。该策略只检查已有摘录中的文字。PDF 断词或日期格式超出支持范围导致无法匹配完整标签和值时，沿用“请以原文为准”。

| 用例 | 旧结果 | 本轮施工实测 |
| --- | --- | --- |
| NIQ 即时零售白皮书第 10 页，2026 年预计订单量 | `2026 年` | `null`，541 字符摘录、发布日期、PDF URL、页码及材料等级与原证据完全一致 |
| Worldpanel 购物者报告，历史数据与预计 2026 年走势混排 | `2025年、2026年一季度、2026年` | `null`，427 字符摘录、发布日期及材料等级与原证据完全一致 |
| 同句混合发布月和 2025 年经营数据、仅有发布月、仅有真实历史经营叙述 | 混合句或历史经营叙述可提取裸年 | 全部 `null`，摘录与来源发布日期逐字保留 |
| `统计周期：2025年1月至12月`、独立调查时间、数据截至等标签 | 截断、汇总或忽略值 | 保留完整原文标签和值，预测修饰和多口径混合均 `null` |

[上一轮原始摘录和旧字段](NEWS03-20261108-review-evidence/second-repair-live.json)

- `node --import tsx --test tests/news03-repair.test.ts`。Node v25.2.1，最终 19/19 通过。旧函数先运行同一组用例，16 项失败，含已知误判和收缩后的新预期。最终另核对正文选取、材料等级、原文和发布日期。
- `node node_modules/typescript/bin/tsc -p node_modules/.cache/news03/tsconfig.json --pretty false`。隔离产品范围退出码 0。既有受损测试文件维持原样。
- `node --import tsx node_modules/.cache/news03-period-repair-replay.mjs`。使用独验保存的 5 条完整摘录，经本地响应夹具走 Worldpanel HTML 和 NIQ PDF 两条适配器路径，5/5 均为 `null`，逐对象对比其余字段全部相等。NIQ 使用由原摘录生成的测试 PDF。首次夹具页面宽度截断文字，扩大测试页宽后重跑通过。该回放未重新访问公开来源。

| 修改文件 | 最终 SHA256 |
| --- | --- |
| `services/news/research-sources.ts`，仅 `period` | `6BB13240544EFFADF5BA79EF6E9A4D9AF90E049C5621999E1A85386271ED2F34` |
| `tests/news03-repair.test.ts`，日期和摘录相关断言 | `DB79E923749E65EF0085BB20AD3B78B83D24CF226BA31573A461C650E6AAB4FE` |

本轮零付费产品模型调用、零依赖安装，测试使用隔离夹具。UI、HTTP、Raw 与备份全链本轮未重跑，交独验按原证据和实物指纹判定是否复用。
