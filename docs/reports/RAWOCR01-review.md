# RAWOCR01 独立验收

## 首次验收

2026-11-23。基线提交 `5255caecc07d9df7b7a9c9ba614e41721434111a`，交接时尚未提交的实现由[施工报告](RAWOCR01-builder.md)末尾六项指纹标识。按[冻结任务卡](../handoffs/RAWOCR01-task.md)验收。本节记录首次施工交接。

- **本轮施工缺陷结论：FAIL。** 中英文紧邻时，分词把汉字和拉丁字母作为同一词，连续辅音乱码漏计，进入可供下游消费的清洗文本。
- **RAWOCR01 整批结论：FAIL。** 关联存储、正文隔离、现有接口和定向回归通过。需修复分流问题并独立复验。全量检查由主 Agent 另行记录。

| 实际命令或输入 | 独立观察 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/raw.test.ts tests/newsraw01.test.ts` | 21/21 通过。含旧记录读取、同图多次出现、更新/重读、正文文件字节未变、删除派生产物。 |
| `node --import tsx tests/acceptance/rawocr01-http.mjs --tesseract` | 中英文图片本机识别通过。实际 HTTP 的 Raw 列表、摘要、详情均未泄漏 OCR 哨兵，响应原图字节一致。 |
| `node --import tsx --input-type=module -e "import {evaluateImageOcr as e} from './services/raw/media-ocr-triage.ts'; for(const s of ['排行榜BCDFGH品牌BCDFGH排名BCDFGH','排行榜 BCDFGH 品牌 BCDFGH 排名 BCDFGH']) {const r=e({lines:[{text:s}]});console.log(r.routeStatus,r.metrics.gibberishRatio,r.ocrCleanText)}"` | 首项为 `ocr_ready / 0` 并保留全部乱码，对照组为 `needs_vlm / 0.72`。两者均有 18 个满足连续辅音条件的拉丁字符，应命中 `high_gibberish`。 |

测试进程清除了继承的 `FMCG_LLM_*`，临时数据根和不存在的配置文件都位于系统临时目录。真实 Provider 调用为零。

独立执行 `git rev-parse HEAD` 与 PowerShell `Get-FileHash`，施工报告所列六个文件的 SHA-256 全部匹配。复验应将表中两项输入都路由至 `needs_vlm`，包含 `high_gibberish` 原因且没有 `ocrCleanText`，正常技术术语样本继续通过。此处记录缺陷与复验标准，本轮在汇报后停止。

## 主 Agent 的版本与全量检查记录

本次代码提交为 `84cbfc8`。在测试数据隔离且未配置 Provider 的环境运行 `npm.cmd run check`，退出码 0。类型、格式、体积门禁和生产构建通过，ESLint 报告 0 个错误、825 个告警，全量测试 1,028 项通过，零失败、零跳过。上表中的无空格榜单是独立审查发现的额外反例，仍须返修。
