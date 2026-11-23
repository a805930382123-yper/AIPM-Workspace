# RAWOCR01 施工报告

2026-11-23，依据 [RAWOCR01 任务卡](../handoffs/RAWOCR01-task.md)。施工自查通过，交由独立验收裁决本轮与批次结论。基线提交 `5255caecc07d9df7b7a9c9ba614e41721434111a`，施工交接用下方文件 SHA-256 标识。

## 交付

- [RawStore](../../services/raw/store.ts) 将派生产物分别保存到 `knowledge/raw/media-artifacts/<rawId>/<mediaId>.json`。`mediaId` 基于 Raw ID、原有图片顺序、来源 URL 和原图内容 SHA-256。原图可继续按内容哈希验证，同一原图在不同位置的产物独立。补采时清除已移除位置的产物，删除 Raw 时清除该 Raw 的产物目录。
- [OCR 分流](../../services/raw/media-ocr-triage.ts) 集中配置尺寸、有效字符、乱码、碎行、置信度、离散度、图表信号和质量阈值。三个噪声类别按字符计同等权重。有坐标时按 `2 × 左边界标准差 / 图宽 + 多列行占比` 归一化，缺图宽的像素坐标取观测宽度。纯文本路径结合行长变异系数与分栏行占比。达标文本清除边界 UI 噪点，并保留列表、标题及段落边界。
- [Tesseract TSV](../../services/raw/web-material.ts) 提供按词坐标合并的结构行入口。连续汉字重组，常规英文保留词间空格，显著横向间隔保留分栏信号。旧导入继续使用现有文本入口；本轮交付的 `ocrRawText` 仅由内部产物存储接口读取。

## 施工自查

Windows Node `v24.18.0`。数据根目录为测试临时 `aipm-*`，配置指向不存在的文件，清除继承的 `FMCG_LLM_*`。真实 Provider 请求数为 0。

| 实际命令 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/raw.test.ts tests/newsraw01.test.ts` | 21 项全部通过，包含 8 项本轮新测试。 |
| `node --import tsx tests/acceptance/rawocr01-http.mjs --tesseract` | 本地 Tesseract `5.5.0.20241111`（`chi_sim+eng`）实测可识别合成英文两行的坐标和置信度。连续中文可读并进入 `ocr_ready`。实际服务的 Raw 完整列表、摘要及详情都隐藏 OCR 哨兵，原图 HTTP 响应字节一致。 |
| `npm.cmd run typecheck` | 退出码 0。 |
| `node_modules/.bin/prettier.cmd --check services/raw/media-artifact.ts services/raw/media-ocr-triage.ts services/raw/store.ts services/raw/web-material.ts tests/rawocr01.test.ts` | 改动 TypeScript 文件通过格式检查。 |
| `node_modules/.bin/eslint.cmd services/raw/media-artifact.ts services/raw/media-ocr-triage.ts services/raw/store.ts services/raw/web-material.ts tests/rawocr01.test.ts` | 改动 TypeScript 文件零错误、零告警。 |

固定用例确认 80×80、800×60、短文装饰和空白输入分流；缺尺寸记录仍按内容判断；对照像素和归一化坐标、纯文本回退、置信度 0.72 和质量分 70；英文技术词无乱码扣分，中文段落及列表保留结构；模拟榜单同时含 `KRCHANEAPRM`、低元音词、碎片和异常符号，命中 `high_gibberish`，流程图和表格按实测信号分流。存储用例确认同哈希图片的两个位置分开保存，重新实例化 RawStore 可读，保存更新前后 Raw 文件逐字节一致（涵盖正文、正文哈希、修订字段），已有 `webImages` 记录可直接读取，补采和删除后对应产物清除并保留实际原图。

## 文件指纹

| 文件 | SHA-256 |
| --- | --- |
| `services/raw/media-artifact.ts` | `59e9f4645fe11fc127034974c58b05f70e8226fd5e6efb2d92daf92d4a27ac6a` |
| `services/raw/media-ocr-triage.ts` | `dbf3f93bd6f6881215721d415ba3d3353755952996b5e4b9155899189122dc91` |
| `services/raw/store.ts` | `c1e213ce2fdf13dfbd60cc9d78378799bb72dbd2ae7f0b27d3266ef7c11d3a98` |
| `services/raw/web-material.ts` | `6a76af0427835b8774d9d9e33fd6e5d5f7162bee144a207bb75cf891f5af41e7` |
| `tests/rawocr01.test.ts` | `f8ab97d93a749fd88cb60a0bd3adffb10f9204a6e26cfd13551dc7b72dd2622a` |
| `tests/acceptance/rawocr01-http.mjs` | `be7ff5a046afdabb76b9d28378ec1653ee0d0db6ff23537f907f88f6d5416602` |

## 独立验收阻塞返修

返修基线 `7115321`。按[独立验收反例](RAWOCR01-review.md#首次验收)原样复现，紧邻汉字的榜单样本返回 `ocr_ready`，乱码率为 0；插入空格的同一内容已经返回 `needs_vlm`，乱码率为 0.72。

乱码检测现在在汉字边界识别紧邻的独立拉丁字母串，并按原阈值检查元音比例和连续辅音。孤立单字符仍按实际空白或符号边界计数。两条榜单样本复跑均为 `needs_vlm`，乱码率 `0.72`，命中 `high_gibberish:0.72`，无 `ocrCleanText`。`Gemini`、`Claude`、`GPT-6.2`、`API`、`SHA-256`、`HTML`、`CI/CD` 紧邻中文及 `甲A乙B版2号` 这类单字符和数字紧邻汉字的输入，乱码率均为 0，清洗结果与输入一致。

| 实际命令 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/raw.test.ts tests/newsraw01.test.ts` | 22 项全部通过，含上述返修回归。 |
| `node --import tsx tests/acceptance/rawocr01-http.mjs --tesseract` | 本机 Tesseract 中英文识别和实际 HTTP 回归通过。 |
| `npm.cmd run typecheck` | 退出码 0。 |
| `node_modules/.bin/prettier.cmd --check services/raw/media-ocr-triage.ts tests/rawocr01.test.ts` | 格式检查通过。 |
| `node_modules/.bin/eslint.cmd services/raw/media-ocr-triage.ts tests/rawocr01.test.ts` | 零错误、零告警。 |

验证用系统临时 `aipm-*` 数据目录和不存在的 Provider 配置文件，清除继承的 `FMCG_LLM_*`。真实 Provider 请求数为 0。以下是返修自查对应的文件指纹。

| 文件 | SHA-256 |
| --- | --- |
| `services/raw/media-ocr-triage.ts` | `bb308724635df49854a496fffa52bd5d5e62adf465dd6c81c32a53031ca3d0b8` |
| `tests/rawocr01.test.ts` | `44b1bd8faa264e6b65822a1bd7ade190c5fc578aee7a1459e51ebb8d5f0aa016` |
