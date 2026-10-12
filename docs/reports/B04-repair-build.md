# B04 返修报告（2026-10-05）

对象：[B04 返修卡](B04-fix-card.md) 中 11 项缺陷（F04-01…F04-11）。本报告由施工方 DeepSeek V4.1 Flash 编写，**不签署 B04 PASS**，不修改 `docs/status.md`、批次卡、`docs/acceptance.md`、`B04-acceptance.md`、`B04-independent-*`/`b04-independent-*` 或历史验收证据。最终裁决权在独立验收。

- 修复顺序按返修卡：F04-10 → F04-01/02/07 → F04-08/09/04 → F04-03/05/06/11。
- 每项都先复刻独立验收的失败断言，再改产品；下表"修复前/后"指同一断言的实测结果。
- 新证据文件：[B04-http-evidence.json](B04-http-evidence.json)（本次运行重新生成）、本报告；历史验收证据保持原样。
- 真实 Provider 仍**无凭证 → BLOCKED**（不发送/不提交任何 Key，fake 不代替真实成功与质量验收）。真实浏览器交互仍 **NOT_RUN**（本回合无浏览器工具），F04-01/02/03 的界面行为用真实 React 组件 + 真实事件流的 jsdom 用例覆盖，并明确标注为 DOM 测试而非真实浏览器。

## 1. 逐项修复结果

| ID | 根因（验收定位） | 实际改动 | 复刻断言与结果 |
|---|---|---|---|
| **F04-10** P1 | `services/llm/service.ts` 把 Provider 原始文本（含回显的 Key）放进 `LLM_INVALID_JSON.details.preview`，并随 job 响应/任务文件/日志外泄 | `provider.ts` 新增 `sanitizeProviderText(text, secrets)`（按本进程真实持有的密钥整值 + 长片段 + Bearer/`sk-`/40+ 令牌模式脱敏）、`sanitizeDeep`、`describeUnparsable`（只给长度/首字符/已脱敏预览）、`LlmProvider.secrets`；`service.ts` 解析/schema 错误先脱敏；`jobs.ts` 在**返回、持久化、日志之前**统一 `sanitizeDeep`，并在生成草稿前用 `findSecretHits` 检查 Provider 输出，命中即 `LLM_OUTPUT_CONTAINS_SECRET`（丢弃结果，不产生草稿） | `tests/llm-repair.test.ts`「F04-10」两项：非法 JSON 回显随机无效 Key → job 响应/任务文件/Raw 状态文件精确命中 **0**，错误码仍为 `LLM_INVALID_JSON` 且保留已脱敏形状信息；401 回显 Key → `LLM_AUTH_FAILED` 且 0 命中；Provider 把 Key 放进知识字段 → `LLM_OUTPUT_CONTAINS_SECRET`、零草稿、零正式写。修复前 `preview` 原样命中 Key（FAIL） |
| **F04-01** P1 | `DraftReviewPage.saveEdits` 只 PATCH `pages`，Source 编辑被丢弃；且 PATCH 响应不带 `raw` 元数据，保存后左栏变空 | PATCH 现返回与 GET 相同的完整 view（含 `preview` 与 `raw`），前端保存快照包含 Source 标题/正文/摘要/分类/等级/知识状态/可信度与全部页面字段 | `tests/llm-http.test.ts` 闭环：PATCH 源标题后回读仍为新标题、响应 `raw.id` 存在；`tests/ui-b04.test.tsx`「Source 编辑…一起持久化」：PATCH body 带人工 Source 标题与正文，保存后界面仍显示 Raw 标题与正文字数 |
| **F04-02** P1 | 直接确认只提交草稿里的旧内容，界面成功但写旧标题/定义 | 确认改为**先保存当前屏幕快照（PATCH）再用返回的 revision 提交**；零选择时前端禁用按钮、后端 `NO_SELECTION` 400 | `tests/ui-b04.test.tsx`：确认前必须有一次 PATCH，且确认用的 `baseRevision` = 保存后的 revision；`tests/llm-http.test.ts`：空选择 400 |
| **F04-03** P2 | `drafts.fromExtracted` 默认 `selected: true` | 默认 `selected: false`；草稿告警明确"默认未选择任何知识建议" | `tests/llm-http.test.ts`（新草稿全未选 + 空选择 400）、`tests/ui-b04.test.tsx`「新草稿默认全不选」（已选 0、按钮禁用、全选/全不选/单选正常） |
| **F04-04** P1 | 同草稿不同 key 重试被 409；同 key 换选择却 201 复用（重试语义绑定 key 而非内容） | 清单新增 `payloadDigest`（冻结内容投影的 sha256）；确认时**比较 payload**：相同 → 任意 key 复用原 operation/IDs；不同 → 409（同 key `IDEMPOTENCY_KEY_MISMATCH`，异 key `CONFIRM_PAYLOAD_CHANGED`），并在 details 里给出既有/请求的选择集合 | `tests/llm-flow.test.ts`「E04-05」与 `tests/llm-http.test.ts` 闭环：同 key 重试/异 key 同 payload 均复用同一 operationId 且页面数不变；同 key 换选择 409、异 key 换选择 409、正式文件不变。修复前异 key 同 payload 被 409、同 key 换 payload 被复用（FAIL） |
| **F04-07** P1 | `drafts.applyMerge` 单行 `if (duplicate) for (...) if (...) …; else …` 的 `else` 绑定到内层 if，导致"无重复事实被丢弃、重复事实被再插一次" | 加花括号并把 `source_facts` 从空表重建；相同事实合并证据、不同事实全部保留 | `tests/llm-repair.test.ts`「F04-07」：两页事实 A/B 合并后 A、B 都在且 A 只出现一次，证据引用仍能按全局索引核验，整理/推断/问题/证据四类都在，确认后正式页正文同时含 A、B。修复前实际 `["事实A","事实A"]`（FAIL） |
| **F04-08** P1 | `runner.start` 无互斥 → 同 Raw 并发产生两份 job/draft；extract 与 DELETE 无共同资源锁 → 删除后晚到提取仍建草稿 | `ExtractionRunner.start` 自带 `SerialQueue`（服务级互斥）；`POST /api/raw/:id/extract` 与 `DELETE /api/raw/:id` 共用 `wikiStore.withLock`；草稿写入后再查一次取消信号，若已取消则丢弃草稿并回到稳定状态 | `tests/llm-repair.test.ts`「F04-08」：并发两次 start 同一 jobId、只有一份草稿；提取中删除被识别为活动工作；取消后晚到不复活（状态回到 unprocessed、无草稿）。`tests/llm-http.test.ts`「F04-08」：并发 HTTP extract 同一 jobId；extract∥DELETE 只会得到 200+404 或 409+202，且 Raw 被删时无孤儿草稿（含 900 ms 后复查） |
| **F04-09** P1 | 清单持续写失败时的异常从 catch 内抛出（markPhase/save 二次失败），HTTP 只剩 `INTERNAL_ERROR`，operationId/committed/已写 IDs/阶段全丢 | `execute` 的 catch 先记录内存中的已写集合（`writtenSoFar`），所有持久化动作各自 try/catch，最后一定抛出带 `{committed, recoverable, operationId, failedPhase, phases, writtenWikiIds}` 的 `WikiError`；`confirm` 首次清单写入失败时抛 `COMMIT_MANIFEST_WRITE_FAILED`（committed=false、可重试）；fs 错误映射为 `COMMIT_STATE_WRITE_FAILED`；`reconcile` 的冲突项也带 `code/committed/writtenWikiIds/failedPhase` | `tests/llm-repair.test.ts`「F04-09」两条真实磁盘故障通道：① 清单目录不可写（零正式写）→ 500 `COMMIT_MANIFEST_WRITE_FAILED`、`committed=false`、`recoverable=false`、operationId、phases、cause，草稿仍 pending 可重试；② Source+页已写、清单被设为只读（仍可读但每次 rename EPERM）→ 首次响应 500 且 `committed=true`、`writtenWikiIds` = 2 个真实文件、`failedPhase=index`，随后重启恢复报出的冲突项同样带 operationId/committed/已写 IDs/failedPhase，磁盘清单确实未被更新；解除故障再次恢复 → 同一 operationId `completed`、写入集合同一批、页面 2 个、日志 2 行、草稿 confirmed |
| **F04-05** P2 | 复用 Source 时新页链接草稿里的 Source 标题（实际不存在）；新 Source 正文仍带未创建建议的 Wikilink | `checkConflicts` 返回既有 Source 的**真实标题**，`freeze`/`view` 用它渲染新页 `## 来源`；Source 正文默认按**本次选中的页**重新渲染（`sourceBodyFor`/`patch`/`view`），未选建议以纯文本列在「本次未创建的建议（未选中，待处理）」；Key Takeaways 随选中集合派生；只在用户真正改写正文时冻结正文 | `tests/llm-repair.test.ts` 两项：① 复用既有（已改名）Source 时新页正文含 `[[既有 Source 标题]]` 且不含草稿标题，Wikilink 唯一解析到既有页，既有 Source 文件字节不变；② 部分选择 + 人工改标题后确认 → 新 Source 只链接创建出来的 `[[人工改名后的指标]]`，未选概念仅以纯文本出现且无链接。`tests/llm-http.test.ts`「F04-05/06」在 HTTP 层复现同一结论。修复前新页链接 missing（FAIL） |
| **F04-06** P2 | Source 正文只有 Raw 标题/ID，缺来源类型/名称/作者/日期/链接 | 草稿保存 `rawMeta`（类型/名称/作者/发布日期/链接/导入时间），`renderSourceBody` 增加 `## 来源信息`，缺失字段写「未提供（字段名）」；确认快照按 rawMeta 渲染 | `tests/llm-repair.test.ts`「F04-06」：草稿与正式 Source 同时含「来源类型：行业报告（report）/来源名称/作者/发布日期/原始链接」；缺字段资料写「未提供（作者）」等；用户编辑正文后仍保留 Raw 归属。`tests/llm-http.test.ts` 在同一流程里核对正式 Source 五个字段 |
| **F04-11** P2 | 额外汇总调用的输入只含摘要与标题/定义；且三段不同摘要时并未真正触发汇总调用 | `callDocumentMerge` payload 增加每块的 `chunkRange`、每页 `category`、`source_facts`（含证据 id/引文/全局 start/end）、`ai_organized`、`ai_inferences`、`open_questions`、`related_pages`，并在提示中要求综合全部事实/整理/推断、覆盖每段、写出冲突；触发条件改为"多块且摘要不相同即需要结构化汇总"（相同摘要仍走确定性合并） | `tests/llm-flow.test.ts`「E04-09」：14 段长文 → `callCount = 14 + 1`，捕获到 **1 次真实汇总请求**，`mergeEntriesFromPrompt` 逐字段断言 14 个条目每个都带 document 摘要与页面 9 个字段 + 事实证据引文/位置；汇总正文仍覆盖每段、末尾证据位置正确、Raw 不变。修复前未触发任何汇总请求（原结论作废） |

## 2. 命令与结果（冻结版本上实测）

| 命令 | 结果 |
|---|---|
| `npm run build` | PASS（tsc 无错；vite 39 modules，`dist/assets/index-CC-_fZgv.js` 295.16 kB、CSS 30.00 kB） |
| `npm test` | **92/92 PASS**（B01/B02 14 + B03 32 + B04 首次 34 + 返修新增 12），连续 3 次稳定通过 |
| `node tests/acceptance/b01-http.mjs` | **7/7 PASS** |
| `node tests/acceptance/b02-http.mjs` | **12/12 PASS** |
| `node tests/acceptance/b03-http.mjs` | **23/23 PASS**（含导入四格式、失败矩阵、删除/引用、并发、故障恢复、重启一致性） |

- 新增施工测试文件 `tests/llm-repair.test.ts`（8 项，全部为返修卡场景复刻）；`tests/llm-flow.test.ts`、`tests/llm-http.test.ts`、`tests/ui-b04.test.tsx`、`tests/llm.test.ts`、`tests/support/fake-llm.ts` 按新语义更新（幂等按 payload、默认未选、确认先保存、汇总输入、Source 元数据/链接）。
- 隔离环境不变：每个用例自建 `%TEMP%`/工作区临时数据目录 + OS 分配端口，从不使用 4317/5173，不触碰正式 `workspace/`。
- 运行上述 B01/B02/B03 自检脚本会刷新 `docs/reports/B0*-api-evidence.json`（施工方自检证据，含时间戳归档）；独立验收的 `B0*-independent-*`、`B04-acceptance.md`、`B04-browser-*` 未被修改。

## 3. 变更文件指纹（SHA-256）

| 文件 | 修复涉及 | SHA-256 |
|---|---|---|
| services/llm/provider.ts | F04-10 | `c24e5117c4d4c2fdd2a2f4e60845241e2cde1abd7ba3c50ab618cb33ec4f0d37` |
| services/llm/service.ts | F04-10, F04-11 | `69fdbae6804db9546143c6b0e657a1392126a69cb1f07641730bdce2d40c9245` |
| services/llm/jobs.ts | F04-08, F04-10 | `e4b0ac53979515c61bb435429135fa935e33de79a38364ae43e1974c1e036b86` |
| services/storage/files.ts | 落盘稳健性（Windows 瞬时 EPERM 重试，不改语义） | `bf17c152f39528a5213e20666ffcee18bd54dc3a0f7f88a76131bd3e74bfd92f` |
| services/wiki/drafts.ts | F04-01, F04-03, F04-05, F04-06, F04-07 | `b0f8484546e2b7bfa1362f015307f31986f296e651428e74cb590a7aa65885c0` |
| services/wiki/render.ts | F04-05, F04-06 | `7b9261a5de96c5a579c03ee7ff558a173db7f15c89dec86b7070012678c2578e` |
| services/wiki/commits.ts | F04-04, F04-05, F04-06, F04-09 | `0be885b6686e8d846e24fe2b78c9c3b5622c5cf9402e6d5c4e3209357b007ca2` |
| server/llm-api.ts | F04-01, F04-05, F04-08 | `07229db6ed0558e8d88463120f45e7172b1233cf1b1d2dfb1b403178e867a237` |
| app/pages/DraftReviewPage.tsx | F04-01, F04-02, F04-03 | `c0a8673286cb286ee869f82ca687b784d01bcb1e64d18e834cf4163596cb3e44` |
| README.md | 使用流程/错误码说明 | `814b4c5d1317e3f73db70e4c358486ada4b5bcc30e2f473c54a4fb19128042cd` |
| tests/support/fake-llm.ts | 测试支持（汇总请求识别、合并响应） | `42e53ba86bd2f692d2556e94fb9e246316b4c100aa1476b056bcac58096b0ae6` |
| tests/llm.test.ts | 渲染断言（来源信息） | `3365c1b43c324d8d21c271a7d806d0e92bf0a20f4a647d0df912f350ec00ebf0` |
| tests/llm-flow.test.ts | F04-04, F04-11 语义 | `df8aa07fea3c266d3cef8661e66565f00462f241ad68afba79e3169ef3810b3a` |
| tests/llm-http.test.ts | F04-01, F04-03, F04-04, F04-05/06, F04-08 | `ea281ed618557784ce105f0a3f85fcfa958a9d9022a25c4141165e0249c8fdf0` |
| tests/ui-b04.test.tsx | F04-01, F04-02, F04-03 | `9fca3e2dc928fdaeb7340bbf54dfaf57d05d521a0c93021d4d64bab0b911cda5` |
| tests/llm-repair.test.ts | 返修专项（新增） | `5b5309460643c8c916e0bb7b906773cb8c4690a3224bafbd774a99f7ca6343ea` |
| docs/reports/B04-http-evidence.json | 证据（重生成） | 见文件 |

本次运行的进程级证据内容（`node v25.2.1`）：

- 成功链路：Raw `2a19dea2-9f36-4973-8b67-52286166c8a9`（正文 sha256 `6e9e4020…`）→ 草稿 `398157bf-864b-4f48-a047-c9dfa0cb345f`（revision 2，只选中 1 条）→ `operationId 17c4b3b5-cab3-4bd8-b2b7-105ebdb55735` → Source `587612b0-25e6-4b4b-9a6b-64d44a74c53c` + 页 `f0226e46-3cae-4845-ab12-7514c2c28f11`；未选中标题「人工改名的概念」未落盘；`keyLeakInResponses=false`。
- 部分提交与恢复：Raw `269a8d4b-…`、草稿 `1f13a69f-…`、`operationId 6b9ff917-26de-4564-a628-cbd3e33e4c0a`；失败阶段 `source:done/pages:done/index:failed/log:pending/state:pending`、已写 3；重启恢复后仍 3 个、Wiki 3、日志 3 行且目标唯一、Raw 文件仍 1 个。

`npm test` 每次都会重写该证据文件；独立验收若需保留本轮内容，请在复跑前自行归档。

`package.json`（`e5645495…`）与 `package-lock.json`（`b40e9e8a…`）**未改动**：返修未引入任何依赖。

## 4. 契约兼容性说明

- 冻结契约中的响应形状、状态机、路径与预算未变；本次为**加法**：新增错误码 `LLM_OUTPUT_CONTAINS_SECRET`、`COMMIT_MANIFEST_WRITE_FAILED`、`COMMIT_STATE_WRITE_FAILED`、`CONFIRM_PAYLOAD_CHANGED`，清单新增 `payloadDigest`/`snapshot.reuseSourceTitle`，草稿新增 `rawMeta` 与 `source.bodyEditedByUser`。
- 行为上的**有意变更**（均来自返修卡要求）：新草稿默认未选；确认前先保存快照；重试以 payload 判定；Source 正文按选中集合与 Raw 元数据渲染。
- 兼容性回归：B01 7/7、B02 12/12、B03 23/23 与 `npm test` 92/92 全部通过，B01–B03 接口形状未变（Raw 响应仍不含 B04 字段）。

## 5. 未完成 / 待独立验收

- 真实 Provider（成功路径、真实错误注入、内容质量）仍 **BLOCKED**（无凭证）；需用户按 README 配置后由独立验收补测。
- 真实浏览器交互仍 **NOT_RUN**：F04-01/02/03 的界面行为由 jsdom 用例（真实组件、真实事件、stub fetch）覆盖，不能替代真实浏览器；建议独立验收重跑 U01–U03 与 U11。
- 未在本机验证的边界：真实 Agent 沙箱下的 rename 限制（本次为 Windows 瞬时 EPERM 加了重试，语义未改）；`COMMIT_STATE_WRITE_FAILED` 的网盘/权限类磁盘故障（本机用只读文件与"目录被文件占用"两种真实故障复现）。
- 本次未触碰 `docs/status.md`、批次卡、验收文档与历史证据；未进入 B05。

