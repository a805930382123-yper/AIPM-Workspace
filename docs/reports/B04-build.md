# B04 施工报告：AI 提取 → 人工审核 → 正式 Wiki

状态：**施工完成，待独立验收**（本报告由施工方 DeepSeek V4.1 Flash 编写，不签署 B04 PASS，不修改 `docs/status.md`、批次卡、`docs/acceptance.md` 或历史验收证据；未进入 B05）。

- 依据：[B04 交接提示词](../handoffs/B04-deepseek-prompt.md)、`docs/batches/B04.md`、`docs/acceptance.md` 的 A06/A08–A13/A57/A60/A61、R04/R05/R09/R11–R15/R21–R23/R41。
- 权限范围：只施工 B04；B01/B02/B03 已 PASS 的接口与行为保持不变（回归见第 5 节）。

---

## 1. 产品 Provider 与配置来源

| 项目 | 实际值 |
|---|---|
| Provider | **未配置**（无凭证） |
| 配置来源 | 规划环境与本机核查均**未发现** `FMCG_LLM_BASE_URL` / `FMCG_LLM_MODEL` / `FMCG_LLM_API_KEY` 环境变量，也没有项目 `.env`（`.env.local` 不存在） |
| 适配器 | 冻结为单一 **OpenAI-compatible Chat Completions**（非流式），`services/llm/provider.ts` |
| 服务端配置名 | `FMCG_LLM_BASE_URL`、`FMCG_LLM_MODEL`、`FMCG_LLM_API_KEY` |
| 读取优先级 | 进程环境变量 → 项目根目录 `.env.local`（已加入 `.gitignore`，工作台显式读取，Node 不自动加载） |
| 密钥处理 | 仅服务端内存/环境；接口返回统一掩码 `••••••••••••` 与 `keyConfigured`；密钥不进入前端 bundle、草稿、Wiki、日志、错误或报告 |
| 未配置时的行为 | 服务正常启动；手动导入/Wiki/搜索/导出/删除全部可用；`POST /api/raw/:id/extract` 返回 `400 LLM_NOT_CONFIGURED`，不写任何状态 |
| 真实 Provider 调用 | **BLOCKED**：本机无可用 Provider 与凭证，未做任何真实 AI 调用，也未声称通过 |

新增 [.env.example](../../.env.example)（只有占位值，无密钥）。施工方没有把 DeepSeek Harness / 开发工具的凭证当作产品配置。

## 2. 契约与实现的代码映射

| 交接契约 | 实现位置 | 实际路径/形态 |
|---|---|---|
| 结构化输出 schema | [rules/wiki-extract.schema.json](../../rules/wiki-extract.schema.json) | `document{title,main_topic,summary}` + `suggested_pages[]`；`additionalProperties:false`；type 枚举 `concept/entity/business_process/metric`；category 为 13 分类；页内 `source_facts/ai_organized/ai_inferences/related_pages/open_questions/source_evidence` 必填；证据 `{id,rawId,quote,start?,end?}`；每次最多 50 条 |
| 提取/写作规则与预算 | [rules/extraction-rules.yaml](../../rules/extraction-rules.yaml) | `role`+11 条 `instructions` 参与 system prompt；`budgets` 与冻结值逐项相等（8000/400/2 MiB/50/2/60 s/600 s/500000），不一致则启动即报 `LLM_RULES_INVALID` |
| 规则加载与自检 | `services/llm/rules.ts` | 运行时读取两个规则文件 + `fmcg-schema.yaml`；schema 关键字白名单；**type/category 枚举与 fmcg-schema 交叉校验**；`rulesVersion = b04-b04-1-<sha256 前 12 位>` |
| 结构校验 | `services/llm/schema-validator.ts` | 自实现的 JSON Schema 子集（type/required/properties/additionalProperties/enum/items/minItems/maxItems/minLength/maxLength/minimum/maximum），未知字段与错误枚举一律拒绝 |
| 分块 | `services/llm/chunk.ts` | ≤8000 字符/块、重叠 400、全局 UTF-16 索引左闭右开、不拆代理对、>500000 字符 `LLM_RAW_TOO_LARGE`（不截尾） |
| 证据定位 | `services/llm/evidence.ts` | 块内唯一精确匹配→全局索引；可选 start/end 提示必须满足 `body.slice(start,end)===quote`；重复匹配 `LLM_EVIDENCE_AMBIGUOUS`；找不到/跨块/错来源分别报错；人工改证据同路径重新校验 |
| 提取服务 | `services/llm/service.ts` | `LLMService.wikiExtract`：分波并发 2、每块一次调用、单次 60 s、总期限 10 min、响应上限 2 MiB、块级失败即整体失败、按标题合并并保留 provenance/证据 id 冲突重命名、文档汇总（超 4000 字符时一次额外汇总调用）、50 条上限 |
| 提取任务状态 | `services/llm/jobs.ts` + `state/extraction-jobs/<jobId>.json` | `running/completed/failed/cancelled` + `stage`（chunking/extracting/merging/validating/done）+ 分块进度 + `error{code,message,retryable}` + `draftId` |
| Raw 处理状态 | `services/raw/state.ts` + `state/raw-processing/<rawId>.json` | `unprocessed/processing/pending_confirmation/generated/failed` + `jobId/draftId/lastError/generatedWikiIds/confirmedOperationId/revertStatus` + 历史；Raw Markdown 从不重写 |
| 草稿 | `services/wiki/drafts.ts` + `drafts/<UUID>.json` | `status/revision/rulesVersion/provider/jobId/document/pages[]/source/warnings`；页含稳定 `pageId`、五类分节、证据全局位置、`selected`、`provenance`、`mergedFrom`、`editedFields` |
| Markdown 渲染 | `services/wiki/render.ts` | 正式页分节：一句话说明 / 来源事实 / AI 整理 / AI 推断 / 待确认问题 / 来源证据 / 关联 / 来源（`[[Source]]`+Raw ID）；Source 分节：摘要 / Key Takeaways / 涉及概念·实体·流程·指标 / 重要观点 / 待验证内容 / Raw 来源 |
| 提交清单与幂等 | `services/wiki/commits.ts` + `state/wiki-commits/<operationId>.json` | 清单落盘**早于任何正式写入**；冻结完整用户确认快照（含 Source 与每页正文的 sha256）、稳定 UUID、`idempotencyKey`、五个阶段 `source/pages/index/log/state`、`writtenWikiIds`、`error{code,message,phase}`、`recoveryHint` |
| Wiki 写入设施复用 | `services/wiki/store.ts`（B04 新增 `allRecords/pageContent/readPageFile/writePageLocked/appendLogLocked/rebuildIndexLocked`） | 正式创建路径与 B02 共用同一写锁；锁内不调用会再次取队列的 public `create`（避免死锁）；Log 按 `operationId+id` 去重 |
| 公开接口 | `server/llm-api.ts` + `server/llm-validation.ts`、接入点 `server/index.ts` | 见第 3 节；统一 `{error:{code,message,details?}}` |
| 待确认统计 | `services/stats/index.ts` | 只统计 `drafts/*.json` 中 `status=pending_confirmation` 的草稿（不再按文件数计） |

## 3. 已实现接口

| 方法/路径 | 状态与说明 |
|---|---|
| `GET /api/llm/config` | 200，非敏感摘要（`provider/baseUrlHost/model/keyConfigured/keyMask/configured/source/missing/configFile/envNames`），缺配置不影响启动 |
| `POST /api/raw/:id/extract` | 新任务 **202**；已有活动任务/草稿 **200 + reused:true**；缺配置 400 `LLM_NOT_CONFIGURED`；Raw 不存在 404 |
| `GET /api/extraction-jobs/:jobId` | 200；不存在 404 `JOB_NOT_FOUND` |
| `POST /api/extraction-jobs/:jobId/cancel` | 200；显式取消，取消后不落草稿 |
| `GET /api/drafts` | 200，列表（`rawId`/`status` 过滤） |
| `GET /api/drafts/:draftId` | 200，完整审核数据 + `preview`（Source 复用/标题冲突/批量重名/Raw 存在与哈希一致）+ `raw` 元数据 + 每页 `renderedBody` |
| `PATCH /api/drafts/:draftId` | 200；`baseRevision` 不符 409 `DRAFT_REVISION_CONFLICT`；`committing/confirmed/discarded` 409；证据非法 422；枚举/空字段 400 |
| `POST /api/drafts/:draftId/discard` | 200，幂等；已验证/提交中拒绝 |
| `POST /api/drafts/:draftId/confirm` | 完成 201 / 未完成 202；重名 409 `WIKI_TITLE_CONFLICT`、来源归属不明 409 `SOURCE_AMBIGUOUS`、key 不一致 409 `IDEMPOTENCY_KEY_MISMATCH`；部分提交 500 + `details{committed,recoverable,operationId,phases,writtenWikiIds}` |
| `GET /api/wiki-commits/:operationId` | 200，提交状态、五阶段、已写入/目标 ID、错误与恢复提示 |
| `GET /api/raw-processing` | 200，只读状态视图（原有 Raw/Wiki/Stats 响应形状未改） |

其余错误码（`LLM_AUTH_FAILED`/`LLM_RATE_LIMITED`/`LLM_TIMEOUT`/`LLM_NETWORK_ERROR`/`LLM_INVALID_JSON`/`LLM_SCHEMA_INVALID`/`LLM_EMPTY_RESULT`/`LLM_OUTPUT_TRUNCATED`/`LLM_RESPONSE_TOO_LARGE`/`LLM_EVIDENCE_*`/`LLM_TOO_MANY_PAGES`/`LLM_DEADLINE_EXCEEDED`/`LLM_RAW_TOO_LARGE`/`LLM_MERGE_FAILED`/`COMMIT_*`/`RAW_ACTIVE_WORK`）与 HTTP 状态见代码与 README。

## 4. E04-01 – E04-11 自检结果（施工方）

fake 指 `tests/support/fake-llm.ts` 起的一个**独立 HTTP Provider 服务**，通过真实 `OpenAiCompatibleProvider` 与产品代码交互；没有任何 fake 进入 `services/`，缺配置时也不会被静默启用。

| ID | 场景 | 方式 | 结果 | 证据 |
|---|---|---|---|---|
| E04-01 | 无 Key 启动、缺字段、设置掩码；手动导入/Wiki/搜索/导出正常；AI 错误明确、零正式变化 | HTTP（无 Provider 环境变量）+ DOM | **RUN=PASS** | `tests/llm-http.test.ts`「E04-01」；`tests/ui-b04.test.tsx` 设置页 2 项；`tests/llm-flow.test.ts`「E04-01」 |
| E04-02 | 真实 Provider 成功路径：多主题中文素材→合法草稿、证据可核验、规则参与请求 | **真实调用 BLOCKED**（无凭证）；同协议 fake 已实测 | **RUN=BLOCKED（真实）/ PASS（fake）** | `tests/llm-flow.test.ts`「E04-02/03/04」；`tests/llm-http.test.ts` 闭环（system prompt 含规则、`Authorization: Bearer <key>` 仅发往 Provider） |
| E04-03 | 模型成功/编辑/取消/放弃前后正式 Source/Wiki/Index/Log 与 Raw 摘要不变 | 服务级 + HTTP | **RUN=PASS** | 同上：确认前 `GET /api/wiki` 为空、Log 为空、Raw 文件 sha256 前后相等；取消/失败路径均断言零正式写入 |
| E04-04 | 部分选择/全选/编辑/删除/合并/Source 预览/人工改来源等级；N 选只新增 Source1+N；复用已有 Source 仅 N；分节与来源正确 | 服务级 + HTTP + DOM | **RUN=PASS** | `llm-flow` 成功链路/复用 Source/审核编辑；`llm-http` 闭环（选中 1/2、未选中标题不落盘、分节断言）；`ui-b04` 审核页 |
| E04-05 | 双击、并发确认、不同 key、响应丢失/重启再确认：同一操作与页面 ID，无重复 Log；过期 revision 与同 key 不同内容拒绝 | 服务级 + HTTP | **RUN=PASS** | `llm-flow`「E04-05」（含 `Promise.all` 并发确认）；`llm-http` 幂等重试（operationId/wikiIds 相同、计数不变）+ `IDEMPOTENCY_KEY_MISMATCH` + `DRAFT_REVISION_CONFLICT` |
| E04-06 | 注入 401/429/网络/超时/非法 JSON/空结果/schema/枚举/证据越界/截断/超限 | 服务级 + Provider 级 + HTTP | **RUN=PASS** | `llm-flow`「E04-06」（9 类注入 + 关闭端口的网络失败）；`llm.test.ts` Provider 适配器（超时/响应超限/鉴权/截断/空结果）；`llm-http`（401/429/非法 JSON） |
| E04-07 | 真实磁盘故障在 Index/Log 阶段：区分零写入与已部分提交；解除故障同目录重启完整恢复，再重启幂等 | 服务级 + HTTP（真实目录占位） | **RUN=PASS** | `llm-flow`「E04-07」；`llm-http`「E04-07」；证据见 `B04-http-evidence.json` 的 `partialCommitAndRecovery` |
| E04-08 | 取消、晚到结果、放弃、刷新/重启、pending 恢复、processing 中断恢复；同 Raw 重复任务、删除 vs 确认/提取并发 | 服务级 + HTTP | **RUN=PASS** | `llm-flow`「E04-08」（取消 + 放弃 + 重启对账三分支）；`llm-http`「E04-08」（取消 + `RAW_ACTIVE_WORK` 删除门禁） |
| E04-09 | 100k 中文含空白/CRLF/emoji 的确定性分块覆盖、末尾证据、汇总不丢块；一块失败/超时明确失败；500k 上限不截尾 | 契约 + 服务级 | **RUN=PASS** | `tests/llm.test.ts` 分块 3 项；`llm-flow`「E04-09」（14 段全覆盖、末尾证据全局索引、每段摘要都在汇总里、超预算 `LLM_RAW_TOO_LARGE` 且原文完整） |
| E04-10 | 确认后 UI 即时刷新、搜索/来源回跳/导出、刷新与同目录重启；旧 Raw/旧 Wiki 字节不变；B01–B03 受影响回归 | HTTP + DOM + 全量回归 | **RUN=PASS** | `llm-http` 闭环（搜索、导出含 Raw ID、Stats、Raw 不变）；`npm test` 80/80（含 B01/B02 14 项与 B03 32 项） |
| E04-11 | 无效测试 Key 泄漏探针：配置返回、异常 UI、普通日志、草稿/Raw/Wiki/导出/报告与 error details | HTTP + DOM + Provider 级 | **RUN=PASS**（只报命中数/位置，不打印 Key） | `llm-http` 对 8 个接口与进程日志断言不含测试 Key；`llm.test.ts` 配置摘要与鉴权错误脱敏；`ui-b04` 设置页/审核页断言不渲染 Key |

浏览器：本回合**没有浏览器工具**，真实浏览器交互 **NOT_RUN**（DOM 交互测试用真实 React 组件、真实事件流，仅 stub `fetch`，不能替代真实浏览器），交独立验收补齐。

## 5. 命令、数据目录与结果

| 命令 | 结果 |
|---|---|
| `npm run build` | PASS（`tsc -b` 无错；vite 39 modules，`dist/assets/index-C_NXw5Uk.js` 294.47 kB、`index-uxFGZpP_.css` 30.00 kB） |
| `npm test` | **80/80 PASS**（B01/B02 14 + B03 32 + B04 34），耗时约 11 s |
| `node tests/acceptance/b03-http.mjs`（B03 回归） | **23/23 PASS**：导入四格式/失败矩阵/超限、删除与引用、重导入、并发、跨文件关联恢复、重启一致性、Node 版本一致性全部继续通过，未发现 B04 引入的回归 |
| 其中 B04 用例 | `tests/llm.test.ts` 11、`tests/llm-flow.test.ts` 12、`tests/llm-http.test.ts` 5、`tests/ui-b04.test.tsx` 6 |

> 说明：第 3 行会向 `docs/reports/B03-api-evidence.json` 写入**施工方自己的** B03 自检结果（现为 B04 版本上的 23/23 PASS，并新增一份带时间戳归档）；B03 的独立验收证据（`B03-independent-http-*.json`、`B03-recheck-*`）未被修改。

- 隔离数据目录：每个用例自建 `%TEMP%\.test-b04-flow-*`、`%TEMP%\.test-b04-http-*`（用例结束即删除）；服务端口由 `net` 动态分配，从不使用 4317/5173，不触碰正式 `workspace/`。
- HTTP 证据（施工方，进程级）：[B04-http-evidence.json](B04-http-evidence.json)（`cbac4825…`）。其中：
  - 成功链路：Raw `ca28465a-6faa-48c5-9658-b198289c7f82`（正文 sha256 `6e9e4020…`、磁盘文件 sha256 `3d8a19b5…`）→ 草稿 `9956af5d-7792-4ea1-ab1f-ac5e32e86d12`（revision 2）→ 选中 1 页 `e90b8ae9-…` → 提交 `operationId 8c8e5e5a-8480-4f88-b3e7-963a4775415c` → Source `e1d559f0-…` + 页面 `f334b514-…`；未选中标题「人工改名的概念」未落盘；重试同 key 复用同一 operationId 与 wikiIds；确认前后 Raw 文件 sha256 不变。
  - 部分提交与恢复：Raw `60d47f2d-…`、草稿 `c74cca95-…`、`operationId de6d463d-ec8e-4654-aa70-9ecf133b4ac4`；Index 阶段失败后阶段为 `source:done/pages:done/index:failed/log:pending/state:pending`，已写入 3 个正式文件并如实返回；解除故障重启同一数据目录后状态 `completed`、写入仍 3 个（不复制页面）、Wiki 计数 3、Log 3 行且 `operationId` 唯一、Raw 文件仍 1 个。

## 6. 变更文件与指纹

新增（A）/修改（M），SHA-256：

| 文件 | 类型 | SHA-256 |
|---|---|---|
| rules/wiki-extract.schema.json | A | `4e7dc316afcaadb523885a970c52705cd8a5eb28dd8b702d6e46cb241d1f36c3` |
| rules/extraction-rules.yaml | A | `b5b7a17bd7646d4b2a517cf09f06035203223f7af08d411a0df4cb9188af1391` |
| services/llm/config.ts | A | `77605c22ca7c822f3d7219777db7e29d93c49eeef37bcdfa56fd22192444d5a1` |
| services/llm/provider.ts | A | `4ac34af2c7dbe90c47cd3bec9c84bfa198a0371f8e4bfd7990e9d1a6387b7a51` |
| services/llm/chunk.ts | A | `9e0556144628d12b089fd67385611646e37804c725c1d341407bff0cdd328606` |
| services/llm/schema-validator.ts | A | `7eb0e66b67cacdd68688c083098763ecd049fb411a98c50c875ea81307341d7a` |
| services/llm/rules.ts | A | `2f0323b761d60c72d8674a055dc22672fb864156fed8aab8f65e44940682a606` |
| services/llm/evidence.ts | A | `1d9c68c98c250c550b5dd9dcc6fd09428ac0bd626dca376814b16576d78b0882` |
| services/llm/service.ts | A | `30ae99591800c707d62eac7790203e838ff9fe77c400881d3de4ff1334e08e54` |
| services/llm/jobs.ts | A | `38c03c75b6fe4aba1767b2a36506fb456b45299a0c09ed9d059aa56b071c3be9` |
| services/storage/files.ts | A | `7ca3e33b9c1a5d6facd76ea4853589d2a6ffd076d0de589b5ad8498fb1801439` |
| services/raw/state.ts | A | `af2d63e146988dcbae1ca39294aff3328bb351b33d47f97072e21df61f11ff06` |
| services/wiki/drafts.ts | A | `e8f13cd79dfad4148d943e27255b525c1335584484ca91a8447880c6ffe1c4c3` |
| services/wiki/commits.ts | A | `5c5333dc3ed0a768da1842955023e42e5216da924b9fc14939f821026ae90e15` |
| services/wiki/render.ts | A | `f729f9d33c559f5c850a35963c1244d2b491f63de831a5096bc38571b8b35e26` |
| server/llm-api.ts | A | `7f1adc1b1fabbef40f07d69523fdc9094a98e4481df045ed2bc8c8cae10b1e72` |
| server/llm-validation.ts | A | `0a3f4b8bc97c34a758b96fc57752bff69363a203c31a61440402561b631621f6` |
| app/pages/SettingsPage.tsx | A | `d8b948b9bf683c1f2a708800f253874d6e01ecd90885921ae53939f9a539908b` |
| app/pages/DraftReviewPage.tsx | A | `01bff8f741ee7df4951db41f4845b8c7b08b045a0a5369aa3470b107a02cbeea` |
| app/b04.css | A | `e7c2a7d7a43ccb5a744f42d2031ea8dbd3f7417d117b31266184b4da4fc9471f` |
| tests/support/fake-llm.ts | A | `6ac98339508be96189c4e882f7c6679181488c9056ef265568b65383155ccca1` |
| tests/llm.test.ts | A | `f4ebc66f203b1900038bd8eb85791122b74ec37c7c7a30bac8c3e65fc9644aae` |
| tests/llm-flow.test.ts | A | `3b81178c339ccbd4a38e0b076ae60856f677fcbc23e931b0754857f7b5f44025` |
| tests/llm-http.test.ts | A | `a2c64ac239fde7b26c51e70c6d9197f11ec198adcfed126c13a5e1ccb57bd791` |
| tests/ui-b04.test.tsx | A | `477dbbe53ad0a005d4491ad107db15c6efbaa309c7ff3c3854cac868c9518adb` |
| .env.example | A | `be8758a8e2931a089b4cff552d563852689d87f20f2935a4a8796267cb560a49` |
| docs/reports/B04-http-evidence.json | A | `cbac48250d78f02ea5cba466614ebff2c18caa5a2330a75fa8a90080c7648e4c` |
| app/api.ts | M | `d89aa74ac332d1b37b94e3d71dc2c24aba4662e8fca02ec9b7ebed1142fa38e9` |
| app/App.tsx | M | `6b0a4809919a14da42ae5c44ce41ab493c62e7ffe9c01428e0e40b5365502f37` |
| app/pages/RawPage.tsx | M | `3d389c1b68dded89f4178dfc92497204aa782edd8d273db7555252ac04896b61` |
| app/main.tsx | M | `4db8c65ea04b913e73d88d6766a9137e39f5479acb57a91c3e3fd72cded67602` |
| server/index.ts | M | `c4252604ba65371f8a33275d875db495da1a245646a6738ede236893337ea77a` |
| services/wiki/store.ts | M | `468578ad5f26914785b8e31cad4f8da3041ae744964cd49111ab3d69c2c43af1` |
| services/stats/index.ts | M | `8984f13b0818e32a3ec672aa7eb421eba17b4ea36c476efa4b968853920ec263` |
| README.md | M | `0dd7daf72a3843f32060fe7d6de516df5d4d17ecb25edf645073ac6877c6b5c7` |
| .gitignore | M | `b7c82e90c2f9ca63fd0265cb120bb4a2ed1502423de7e0c81d26e922da825b74` |
| tests/ui.test.tsx | M | `714c9c7dd0b59cdca96c09d159b6ef059870a2a39a9631ac494af903e9418098` |
| tests/ui-interaction.test.tsx | M | `f1af334b540b5c5865f87bc8edb5338ed76741a36d7cc1d89f15cc390c29e475` |

- **`package.json` / `package-lock.json` 本批未改**（`e5645495…` / `b40e9e8a…`，与 B03 返修冻结值一致）：B04 没有引入任何新依赖，也没有新增测试框架（复用 B03 已有的 jsdom 与 css-stub loader）。
- 未修改（B01–B03 已 PASS 的产品文件，供核对）：`services/raw/{store,assets,parse,limits}.ts`、`server/{validation,wiki-validation,raw-import}.ts`、`app/raw.css`、`tests/{raw,wiki,import}.test.ts`、`tests/fixtures/b03/*`、`docs/acceptance.md`、`docs/status.md`、`docs/batches/*`、`docs/handoffs/B04-deepseek-prompt.md`、B01–B03 的报告与独立证据。
- 本报告自身不列入指纹表。

## 7. 提交故障、恢复与重复确认的可核对数据

- 同一草稿的重复确认（HTTP）：同 `idempotencyKey` 返回同一 `operationId 8c8e5e5a-…` 与同一 `wikiIds`，Wiki 计数不变；不同 key 返回 `409 IDEMPOTENCY_KEY_MISMATCH`。
- 并发双击（服务级）：`Promise.all` 两次确认只产生一个 `operationId`，页面数与日志行数为 `Source + N`，`writtenWikiIds` 与目标 ID 完全一致。
- 部分提交（HTTP，Index 被真实目录占位）：响应 500 + `details.committed=true` + `operationId de6d463d-…`；阶段记录为 `source:done/pages:done/index:failed/log:pending/state:pending`，`writtenWikiIds` 3 个；草稿保持 `committing`（禁止编辑/放弃），Raw 状态未提前变 `generated`。
- 重启恢复（同一数据目录）：启动对账继续同一 `operationId` → `completed`，写入仍 3 个（`wikiIds` 完全一致）、Log 3 行且目标唯一、`wikiCount=3`、草稿 `confirmed`、Raw `generated`；再次启动对账为 0 次操作（幂等）。

## 8. 已知限制与风险

1. **真实 Provider 未调用（BLOCKED）**：所有"真实 AI"结论都没有证据；需要用户按第 1 节配置后由独立验收补测（建议至少：一篇多主题中文文章、一个 100k 长文、一次 401/429 注入）。
2. 浏览器交互 **NOT_RUN**：审核页的视觉/可用性（长列表、按钮布局）未经真实浏览器确认。
3. 文档汇总：多分块时先用确定性合并；仅当合并摘要超过 4000 字符才额外调用一次 Provider 汇总；该额外调用失败会整体失败（`LLM_MERGE_FAILED`）。
4. 提取页类型限 `concept/entity/business_process/metric`，Source 由服务端按 `document` 与 Raw 元数据生成；Synthesis 与"更新旧 Wiki"属 B05。
5. `source_level` 服务端默认 `C`（保守值），未让模型臆造 A/B；`verified` 只能由用户显式标记。
6. 重名冲突采用整体 409（含批内冲突）；没有"自动改名"或"自动合并旧页"。
7. 删除 Raw 在有活动提取/待审核草稿时返回 409 `RAW_ACTIVE_WORK`；正式引用仍按 B03 的 `RAW_REFERENCED` 拦截。并发只覆盖同一进程内的写锁。
8. 长文分块重叠 400 字符意味着相邻块有重复内容；合并按标题去重并保留 provenance，不会重复建页。
9. `state/` 下的任务/清单/处理状态会随时间累积（本批不提供清理界面）；`drafts/` 中已放弃/已确认的草稿保留以供审计。
10. 模型 token 计量在 `state/extraction-jobs/*.json` 中没有单独字段（Provider 返回的 usage 只在本次响应内使用）；平台未暴露子 Agent token 计量，**不可得**，未估算成本。

## 9. 新终端启动与复现步骤

```powershell
# 1) 安装与自检（不调用真实 Provider）
npm install
npm run build          # 期望 PASS
npm test               # 期望 80/80 PASS，并刷新 docs/reports/B04-http-evidence.json

# 2) 配置产品 Provider（二选一；缺配置时手动链路仍可用）
#    a) 环境变量（推荐）
$env:FMCG_LLM_BASE_URL = 'https://<你的 Provider>/v1'
$env:FMCG_LLM_MODEL    = '<模型名>'
$env:FMCG_LLM_API_KEY  = '<你的 Key>'
#    b) 复制 .env.example 为 .env.local 并填值（已加入 .gitignore）

# 3) 启动（正式入口保持 5173/4317；隔离复现请用其它端口与数据目录）
$env:FMCG_DATA_DIR = 'E:\AI\Work\B04-recheck-data'
$env:FMCG_PORT = '4321'
npm run dev:api                     # 或 npm run dev 同时起 UI
npx vite --port 5184 --host 127.0.0.1   # 若 5173 已被既有服务占用

# 4) 在浏览器里走一遍：Raw → 「AI 整理知识」→ 进度/取消 → 「继续审核」→
#    选择/编辑/删除/合并 → 「确认写入 Wiki」→ 知识库搜索、来源回跳、导出
```

继续未完成操作：任何处于 `pending_confirmation` 的草稿可在 Raw 详情点「继续审核」；任何 500 且带 `details.operationId` 的提交可在 `GET /api/wiki-commits/<operationId>` 查看阶段，**解除磁盘故障后重启同一数据目录**会自动补齐（无需重新确认）。`state/extraction-jobs/` 中 `failed` 的任务可直接在 Raw 详情点「重试 AI 整理」。

## 10. 未完成项 / 待独立验收验证

- 真实 Provider 成功路径与真实错误注入（401/429/超时）→ BLOCKED，需用户配置。
- 真实浏览器交互（含长列表、分栏阅读、证据回跳、Source 预览编辑）→ NOT_RUN。
- A06 的"AI 不改 Raw"在 B04 只需提取/草稿/确认三阶段前后的 Raw 摘要一致（已实测 PASS）；其 B05/B06 增量仍待后续批次。
- A57/R09 跨批整项（Prompt 持久化、五种状态在 AI 全链路的完整性）留待后续批次签。
- 依赖最低环境未变：Node ≥ 22.13（`jsdom` 仅测试用）。
