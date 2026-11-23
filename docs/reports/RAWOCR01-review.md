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

## 第一次返修独立复验

返修基线 `7115321599b16af382f3bab6c9c0e6303aabe6ea`。两处返修文件经 `Get-FileHash` 独立核对，分流实现 SHA-256 为 `bb308724635df49854a496fffa52bd5d5e62adf465dd6c81c32a53031ca3d0b8`，定向测试为 `44b1bd8faa264e6b65822a1bd7ade190c5fc578aee7a1459e51ebb8d5f0aa016`。

- **本轮缺陷修复：PASS。** 将首次验收命令原样输入的两个榜单分别复算，均返回 `needs_vlm`、`high_gibberish:0.72`、质量分 14，两个对象均无 `ocrCleanText` 属性。实现按文字边界提取候选串，沿用已有阈值。
- **第 1 轮 RAWOCR01 整批：PASS。** 冻结卡的兼容存储、分流、样本边界和普通接口隔离均有实测。第 2–4 轮仍待后续授权。

用 `node --import tsx --input-type=module -e` 直接调用 `evaluateImageOcr({lines:[{text}]})`，独立追加三个对照。紧邻汉字的 `Gemini、Claude、GPT-6.2、API、SHA-256、HTML、CI/CD` 在同一技术句中全部保留，乱码率为 0。`本次试验关注甲A乙B版2号产品的上线结果` 同为 0，插入真实分隔空格成为 `本次试验关注甲 A 乙 B 版 2 号产品的上线结果` 后，孤立字符按 5/20 计入，命中 `high_gibberish:0.25`。

| 实际命令 | 独立复验 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/raw.test.ts tests/newsraw01.test.ts` | 22/22 通过，含新增返修回归和原有存储、正文及资讯导入检查。 |
| `node --import tsx tests/acceptance/rawocr01-http.mjs --tesseract` | 中英文图片本机识别通过，真实 HTTP 列表、摘要、详情均隐藏调试 OCR，原图字节一致。 |

本次复验使用隔离临时数据根及不存在的配置文件，清除继承的 Provider 环境变量。

主 Agent 核验的返修代码提交为 `42db0c9`。隔离环境执行 `npm.cmd run check` 退出码 0；1,029 项测试通过，零失败、零跳过，生产构建通过。ESLint 报告 0 个错误和 825 个已有告警。
