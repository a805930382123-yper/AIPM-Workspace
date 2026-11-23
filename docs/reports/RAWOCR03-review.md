# RAWOCR03 独立验收

验收依据为 [冻结任务卡](../handoffs/RAWOCR03-task.md)。基线提交 `2ca4c9f9e0d9d74ca4deebfd67924e6a896f856f` 加本轮工作树；施工停写后，独立复算 [施工报告](RAWOCR03-builder.md#文件指纹) 全部 **16/16 SHA-256 一致**，包括 12 个产品文件与 4 个测试文件。最终提交由主 Agent 记录。本验收实例参与规划但未修改产品，与施工实例不同。

## 双层结论

- **本轮施工范围内交付与缺陷：PASS。** R3-01～R3-05 均有本轮独立实测证据，未发现需返修的产品缺陷。新增导入、五态阅读和显式精读闭环通过，原正文及原图字节不变。
- **RAWOCR03 整批：PASS。** R3-01～R3-05 的独立定向及真实浏览器验收通过，主 Agent 对相同产品版本执行的隔离 `npm run check` **1,045/1,045 PASS**，0 跳过。全量检查和最终测试告警清理证据见下方。

评分沿用 **1/2/2/0 = 5，B 模式**。规划/独立验收为 Astra medium，施工为不同 Sol High 实例；实际派发身份由主 Agent 的调度记录确认，不以文档代替模型调用。未启动第四轮历史迁移。

## 实际命令与结果

独立环境使用 Windows Node `25.2.1`，Edge `158.0.4370.33`。所有数据、配置和服务均在系统临时目录及随机回环端口，未读取正式模型配置。真实付费 Provider 请求 **0**。浏览器脚本的回环模拟 Provider 请求 **11**，包括单图、重试、强制重读和故障批量请求；最大在途 **3**。合成网页传输与回环模型是测试替身，本机 Tesseract、HTTP 应用、React 页面和 Edge 则为真实集成。

| 实际命令 | 结果 |
|---|---|
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr03-import.test.ts tests/rawocr03-ui.test.tsx tests/rawocr01.test.ts tests/rawocr02.test.ts tests/newsraw01.test.ts` | **30/30 PASS**，0 跳过、退出 0。独立读取断言后复跑；覆盖两导入入口、三态分流、重复图片位置、尺寸、无图/仅图、原图/OCR故障、派生保存失败及同 Raw 续修、旧记录不迁移、图数上限、前两轮原文/图文隔离及 UI 状态。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawurl01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf01-ui.test.tsx tests/pdf02-ui.test.tsx` | **15/15 PASS**，0 跳过、退出 0。既有网页导入、PDF 页阅读/来源引用和结果修订回归。 |
| `node --import tsx tests/acceptance/rawocr03-builder-tesseract.mjs` | **PASS**，退出 0。独立复跑施工脚本；临时原生 Tesseract `5.5.0` 和 `chi_sim+eng`，手工 HTTP 与资讯保存各得到 2 个 `ocr_ready` 出现位置，平均置信度 `0.9646254216666665`，位置 ID 不同、原图相同且正文无 OCR。 |
| `node --import tsx tests/acceptance/rawocr03-independent.mjs --native-ocr` | **PASS**，退出 0。独立脚本执行真实本机 OCR 新网页分流和真实 Edge 交互，下表列出操作断言。 |
| `git diff --check` | 退出 0。 |
| PowerShell `Get-FileHash -Algorithm SHA256` 对施工报告表逐项比较 | **16/16 一致**。 |

运行原生 OCR 命令前设置 `FMCG_TESSERACT_PATH` 与 `TESSDATA_PREFIX` 指向主 Agent 准备的临时可执行文件/语言目录；报告不提交本机绝对路径。前两次浏览器启动尝试因沙箱拒绝本机 socket 未执行页面验证；批准使用本机执行权限后，在相同隔离边界完成测试。此为环境记录，未计为产品 FAIL 或 PASS。

## 浏览器与分项证据

[独立脚本](../../tests/acceptance/rawocr03-independent.mjs) 自建五态文章、5 图批量文章、无派生历史文章和未配置测试文章，使用真实后端、Vite 与 Edge；结束后关闭服务并删除临时数据。

| 验收项 | 独立观察与断言 |
|---|---|
| R3-01 新导入 | 两入口实际 HTTP/服务集成分别重读派生、图序及 SHA。原生 Tesseract 复跑两入口均为清洗文字，正文只保留网页文字和锚点。独立脚本另用不同文字图实测 `INDEPENDENT IMAGE 42` 仅进入清洗派生。 |
| R3-02 失败边界 | 两入口测试明确区分下载失败与 OCR 失败；资讯需要显式保留部分材料。注入派生写盘故障得到 `RAW_MEDIA_IMPORT_INCOMPLETE` 与已保存 Raw ID，重试资讯仍是同一 Raw，已有精读不被覆盖。第 17 个图片位置为明确 failed。阅读和刷新不调用模拟 Provider。 |
| R3-03 五态阅读 | 桌面五态逐一等待真实 DOM 状态，展开 OCR 清洗文字、精读 Markdown 表格/有序列表、置信度与警告。公开 media 响应及 DOM 无 `ocrRawText` 或调试哨兵。原图链接和来源链接经组件及字节读取断言覆盖。 |
| R3-04 显式操作 | 点击「精读此图」后正在处理按钮禁用；单图成功、已有失败重试及「重新精读（重新调用模型）」分别增加预期请求。刷新重新读取已保存结果，调用数不变。批量 5 图中第 3 图持续 503，其余 4 图成功，界面保持单图失败；关闭模拟故障后点击重试成功，实测最大并发 3。移除隔离服务模型配置后，单图操作返回明确 400 并显示未配置文案，状态仍 needs_vlm、请求数不增。 |
| R3-05 保真与兼容 | 请求前后的 Raw Markdown 文件和原图文件 Buffer 完全一致。待精读操作尚在途时切到历史 Raw，后续响应不污染该页；历史 Raw 派生记录仍为零。390×844 实测文档 `scrollWidth = 390`。无图、旧记录、PDF 及引用相关定向回归通过；译文和正文引用分支经差异检查继续使用既有独立阅读路径。 |

浏览器 `pageErrors = []`、阻断的外部请求 `[]`。正常操作阶段无控制台错误；未配置用例出现且只出现一次预期的 `400 Bad Request` 资源提示，脚本以精确错误文本断言，无其他控制台错误。仅有预期的未配置失败，不以“零错误”掩盖它。

独立复跑的两入口原生 OCR 样本正文 SHA-256 均为 `70c6be7a7524db9f4b25ccb5e4663bbcdf41eea7b6c659392781da06d541e769`，原图 SHA-256 均为 `4767c0ea162e0e25986c7c11ced94a673b354bba11cde0f739f4fab301530637`，与施工结果吻合。无真实外部网页或付费模型质量评测，任务预算本就为零；不把合成 Provider 称为真实模型验收。

## 主 Agent 全量与提交收尾

主 Agent 在隔离环境执行 `npm.cmd run check`：类型、格式、静态检查、体积门禁、默认测试与生产构建全部通过，默认测试 **1,045/1,045、0 跳过**；该轮 ESLint 为 **0 errors / 826 warnings**。这是主 Agent 提供的同产品版本实测记录，独立验收复用其全量结果，不冒称由验收实例重复运行。

全量后唯一新增告警在测试 Express 四参数错误中间件中。施工者只添加 `void _next` 保留中间件四参数行为，并执行单文件 ESLint **0 告警**、导入测试 **5/5 PASS**（见施工报告）。独立重新读取该最小差异，并再次核验最终 **16/16** 文件指纹一致；测试文件最终 SHA-256 为 `75a94020ee6295aa7a9495af3df8ab020915c31a2ef148ad413a8ab6e767957c`。12 个产品文件完全未变，先前真实浏览器/OCR 证据继续适用，不重复全量检查。独立脚本 SHA-256 为 `28f5d042523351c883717ee67013ea41b4b3ec3b2b3edff0547a677e1c256858`。

最终测试文件修改后，主 Agent 在 Windows Node 22.23.5 的新隔离目录依次执行 `npm.cmd run typecheck`、`npm.cmd run format:check` 和 `npm.cmd run lint`，均退出 0。全库 ESLint 为 0 个错误、825 条告警，回到本批前基线。NEWSRAW02 并发保存断言在施工自查中出现过间歇失败，本次全量运行通过，该历史问题仍有记录。交付版本为本报告与产品代码共同所在的 Git 提交，父提交 `2ca4c9f`。
