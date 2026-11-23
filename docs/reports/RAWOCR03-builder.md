# RAWOCR03 施工自查与交接

基线 `2ca4c9f`。按 [冻结任务卡](../handoffs/RAWOCR03-task.md) 实施新网页导入和详情交互，未做历史迁移。施工分为服务端与 UI 两个实例；最终独立验收由不同实例执行。版本以本报告列出的基线及文件 SHA-256 为准，施工者不提交，由主 Agent 统一收尾。

## 施工结果

- 两个网页入口共用 `readWebMaterial`，对正文中的图片按出现顺序获取原图、实际尺寸及 Tesseract TSV 行，调用 RAWOCR01 的 `evaluateImageOcr`。移除原有名称、HTML 尺寸和 240px 筛选，装饰图仍保留来源位置并由统一阈值标为跳过。重复图片可复用下载及 OCR，但每次出现拥有不同位置 ID。
- 新 Raw 正文只保存网页文字及来源图锚点。OCR 原文、清洗文字和精读正文均在派生文件；`RawInput.webImageArtifacts` 是内部输入，创建和补采时剥离，不进入 Raw 文件或公共对象。确定 Raw ID 后再写对应位置派生。
- 原图下载、解码、OCR 和 16 图上限异常分别留为明确失败；原图已经保存时保留字节。资讯仍要求显式保留部分材料。手工入口保留原有 10 MiB / 30 秒网页预算，资讯保留原有 6 MiB / 12 秒预算，图片仍为 8 MiB。
- 派生写入失败返回 `RAW_MEDIA_IMPORT_INCOMPLETE`，公开已提交的安全 Raw 与 ID，明确告知不要重复导入。资讯收据保留内部初始结果，重试修补相同 Raw 的缺失派生，不覆盖已有精读。新闻 HTTP 与候选流水线保留此错误语义。
- 读取旧记录不创建派生，也不触发模型；精读继续使用 RAWOCR02 的既有接口和并发控制。

## 实际验证

使用 Windows Node `22.23.5`；隔离数据目录位于系统 `<TEMP>/aipm-*`，模型配置指向不存在的文件并清除继承的 `FMCG_LLM_*`。HTTP 全部为随机回环端口，网页及图片为动态合成输入，没有外部网页请求或真实 Provider 请求。沙箱阻止回环连接后，使用批准的本机执行权限完成 HTTP 检查，未改产品行为。

| 实际命令 | 结果与覆盖 |
|---|---|
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-reporter=dot tests/rawocr03-import.test.ts tests/newsraw01.test.ts tests/rawocr01.test.ts tests/rawocr02.test.ts tests/rawurl01-http.test.ts tests/rawurl01-ui.test.tsx tests/raw-integrity.test.ts` | **37/37 PASS**，退出 0。新增导入集成 5 项：两入口三种分流、重复图位置 ID、实际尺寸优先于 HTML 属性、落盘重读和原图哈希、OCR/下载故障、派生写入故障与相同 Raw 重试、无图/仅图/旧记录及图数上限。既有 OCR、原文完整性及网页导入回归通过。 |
| `node --import tsx tests/acceptance/rawocr03-builder-tesseract.mjs` | **PASS**。原生 Tesseract `5.5.0`、`chi_sim+eng` 通过手工 HTTP 和资讯保存链路实际识别。每入口含同一原图两次出现，均为 `ocr_ready`，实际尺寸 `800×240`，平均置信度 `0.9646254216666665`。正文无 OCR，正文哈希及原图字节重读一致，位置 ID 不同，真实 Provider 请求 **0**。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr03-import.test.ts tests/newsraw01.test.ts tests/rawocr01.test.ts tests/rawocr02.test.ts tests/rawurl01-http.test.ts tests/rawurl01-ui.test.tsx tests/pipe01.test.ts` | 44/45，通过项涵盖上述导入和流水线主流程；唯一失败为已登记的 NEWSRAW02 并发断言。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/pipe01.test.ts` | 9/10，同一已登记并发断言再次出现，未修改该测试。 |
| `npm.cmd run typecheck` | 退出 0。 |
| `node node_modules/prettier/bin/prettier.cjs --check services/raw/web-material.ts services/raw/url-import.ts services/raw/store.ts services/news/raw-material.ts services/news/raw-save.ts services/automation/pipeline/service.ts server/raw-import.ts server/news-api.ts tests/newsraw01.test.ts tests/rawocr03-import.test.ts` | 退出 0，施工文件格式检查通过。 |
| `git diff --check` | 退出 0。 |
| `node node_modules/eslint/bin/eslint.js tests/rawocr03-import.test.ts`；`node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr03-import.test.ts` | 收尾将 Express 四参数错误处理中间件的 `_next` 显式标记使用，消除本轮唯一新增未使用参数告警；单文件 ESLint 退出 0、0 告警，导入集成复跑 **5/5 PASS**。 |

Tesseract 样本两个入口的正文 SHA-256 均为 `70c6be7a7524db9f4b25ccb5e4663bbcdf41eea7b6c659392781da06d541e769`，原图 SHA-256 为 `4767c0ea162e0e25986c7c11ced94a673b354bba11cde0f739f4fab301530637`。可再生脚本自行删除测试数据，无大型证据进入仓库。

NEWSRAW02 的唯一失败位于 `tests/pipe01.test.ts:697`：并发保存结果虽指向同一 Raw，测试假设 Promise 数组第二项的 `created` 必须为 `false`，本次为 `true`。相同断言的基线间歇失败证据已记录在 [RAWOCR02 主 Agent 收尾核验](RAWOCR02-review.md#主-agent-收尾核验)。本报告如实记录本次结果，不将失败计入 PASS；未扩展范围修复该竞态。

## UI 施工交接

UI 施工实例已停写。新增 `RawWebContent` 按图序呈现原图、来源链接及五态，OCR 清洗文本与精读 Markdown 使用紧凑折叠内容，可检查置信度和警告。单图精读、重试、明确重新精读及批量待精读复用已有 API；进行时防重复点击，批量逐图错误不掩盖成功。组件按 Raw ID 重建并取消过期读取。旧记录仍可看原图；正文引用、译文和 PDF 阅读路径保持既有展示。

导入的 `RAW_MEDIA_IMPORT_INCOMPLETE` 单独显示「正文已保存，图片解析记录未完成」、Raw 标识和「打开已保存资料」，不使用旧文件关联恢复提示。新增组件回归核对同一 Raw 被加入列表并打开，未重新导入或调用模型。

UI 施工实例报告的实际命令 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr03-ui.test.tsx tests/rawurl01-ui.test.tsx` 为 **9/9 PASS**（新增组件 6 项），`npm.cmd run typecheck` 退出 0。更早一轮相关 UI 组 38/38 通过，最后的新增分支以 9/9 结果为准。生产构建中的 TypeScript 已通过，但沙箱阻止 Vite 对 `app/main.tsx` 的 realpath，返回 `EPERM`；最终构建由主 Agent 在允许的本机环境完成，施工报告未将该构建标为 PASS。桌面与 390px 真浏览器、回环 Provider 计数及五态操作由独立验收报告裁决。

## 文件指纹

| 文件 | SHA-256 |
|---|---|
| `services/raw/web-material.ts` | `fa772eae2cdbb705ea03b4b8693b5f5077d10d11e70ad3651b47c8ff65c9fbb1` |
| `services/raw/url-import.ts` | `8290f4c89a6d581a3550e94d8d8288eadf5b9bb0165966148e00e7ae814d72ae` |
| `services/raw/store.ts` | `689838744a8f007b30f6f44c69de46138c145cc8fcb79056a5ef256fef57a4f9` |
| `services/news/raw-material.ts` | `51456274f869e1f98adf150580dc25fa8ffcf34223aeffbef2698b4fef38dd23` |
| `services/news/raw-save.ts` | `f083993b83975e0e3e0525a3fd14491c19bcf93dc35e5274916a2c35625f8373` |
| `services/automation/pipeline/service.ts` | `9d6dc2a64296d2f9c71ef8642a355cc4add799dac5b18329a9c5a8521dbefa2a` |
| `server/raw-import.ts` | `0e7d8afbf15f01d07dbdab520a0197cc0470c6903e7f66aa398c5a9664c50bca` |
| `server/news-api.ts` | `6b7fc02d8aa2fe0afa5a9e12bce53fd2750c76c3abea21de4213ff485cdda61d` |
| `tests/newsraw01.test.ts` | `67097bc602e620657d5510d0b0ddbff1aa73c14e550e80729b5ea086cd85916e` |
| `tests/rawocr03-import.test.ts` | `75a94020ee6295aa7a9495af3df8ab020915c31a2ef148ad413a8ab6e767957c` |
| `tests/acceptance/rawocr03-builder-tesseract.mjs` | `10c19f88438ded59fafa94199e32c5c5c86049f766f75f4b6fd2a8fc40901a49` |
| `app/api.ts` | `2037f0ca613ed3b133af716b7285f6fae153358a17057e52124b695440ede97f` |
| `app/pages/RawPage.tsx` | `b24f8c49dc0f4f8c7be90e85cf3fbddaf0463155872d192dc3a13450a4372847` |
| `app/raw.css` | `d60aa81705606196748e551f8bcb8148e6211dae76b75ae9589aba5acb0e8e7f` |
| `app/components/RawWebContent.tsx` | `724e64a0484ca281fc1bc1510d5e3b58dfeef81a9fc3633add7f75794a022b6e` |
| `tests/rawocr03-ui.test.tsx` | `63d8047b603b60938ce8d4f7a55218bb45b0397481b6c36f7c281329358daecd` |

## 分层结论

- **本轮施工范围内缺陷：定向自查 PASS。** 新增五项导入集成、六项 UI 回归和真实本地 OCR 导入链路通过；无真实模型开销，已保存的 Raw 正文与原图在派生读写中保持不变。
- **RAWOCR03 整批：待独立验收与主 Agent 全量检查。** 本施工报告不代替必选的真实浏览器操作、部分失败和原文完整性独立检查；既有 NEWSRAW02 并发断言亦交主 Agent 记录。
