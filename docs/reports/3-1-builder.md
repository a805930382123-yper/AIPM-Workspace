# LLM-Wiki 3-1 施工报告

基线 `5dd9969`，产品提交 `59261d5`。范围为 [3-1 任务卡](../handoffs/LLMWIKI-3-1.md) 的施工前勘察、主备 Provider 分档路由和按真实尝试分账。独立验收由主 Agent 汇总。

## Step 0 施工前勘察

| 项目 | 基线查验结果 |
|---|---|
| 配置与接线 | `services/llm/config.ts` 的 `LlmConfig` 原为 `baseUrl/model/apiKey/source/knownSecrets`，三个主端环境字段逐项覆盖本机文件。`config-manager.ts` 原子写文件，以 HMAC revision 和 writeToken 控制设置页写入。`server/index.ts` 的 `providerFactory` 将一次操作的 Provider 快照放入 AsyncLocalStorage。Prompt 服务通过同一产品工厂拿到模型，选页、授权、草稿状态和调用诊断由 `services/prompt-ai/service.ts` 自己管理。 |
| HTTP、重试与分账 | `services/llm/provider.ts` 直接发一次非流式 `POST /chat/completions`，按任务超时中止并限制响应字节数。错误码 `LLM_PROVIDER_ERROR` 原可同时表示 5xx、普通 4xx 或无效响应，因此要在传输层保留实际 HTTP 状态才能决定是否切换。部分业务会在已知输入变化或显式重试时重新发起任务。自动化 `context.ts` 记录 `requests/inputTokens/outputTokens/unknownUsageCount`，`ledger.ts` 将运行写入 `state/automation/runs/`，原先缺少跨产品入口的端级尝试账本。Embedding 经 `services/search/embedding-provider.ts` 独立配置和 `/embeddings` 请求，批量索引中的可恢复故障由其自行重试。 |
| Raw 检查点 | `services/llm/checkpoints.ts` 写入 `state/extraction-checkpoints/{jobId}.json`，保存 Raw SHA、规则及流水线版本、Provider 身份、分块、已验证块、计划和尝试数。 `services/llm/jobs.ts` 比对 `cacheIdentity \| model`、Raw SHA 和规则版本才复用。 |
| PDF 检查点 | `services/raw/pdf-pages.ts` 按 Raw 保存在 `state/raw-pdf/{rawId}/manifest.json`，绑定 Raw/附件 SHA、渲染和提示版本、逐页图片、结果及 Provider 身份 SHA。`services/raw/pdf-cleanup.ts` 的 `Job` 另存输入绑定、模型身份、已确认的批次、索引和写作阶段，可从同一依据续跑。 |
| Wiki 列表与统计 | `server/index.ts` 的 `GET /api/wiki` 先从 `services/wiki/store.ts` 扫描 Markdown 加载可见记录，再把这些记录交给关键词过滤和分类计数。`GET /api/stats` 使用 `services/stats/index.ts` 再读 Raw 列表、Wiki/Draft/Audit 文件及变更日志，并用 Prompt 存储统计有效记录。 |
| UI 与健康入口 | `app/pages/WikiPage.tsx` 内同时有手动创建、资料查看及 AI 问答、主动知识检查等入口，`app/components/WikiReview.tsx` 为复核抽屉。`app/pages/SettingsPage.tsx` 读取主端配置摘要和显式连接测试，`services/automation/wiki-health.ts` 将结构 Lint 与主动巡检的成功快照汇总，经 `server/automation-api.ts` 供 `AutomationPage` 与 `WorkflowsTab` 展示。自动化的既有运行详情抽屉在 `app/components/automation/RunDetailView.tsx`。 |
| 手动操作与纯 FTS | `app/pages/prompt/PromptDetail.tsx` 的变量填写交给 `usePromptLibrary.ts`，经 `app/api/prompt.ts` 调 `POST /api/prompts/:id/render`，由 `server/prompt-api.ts` 和 `services/prompt/store.ts` 中的 `renderVariables` 校验后渲染。复制使用浏览器剪贴板。Wiki 表单在 `app/pages/WikiPage.tsx` 请求 `POST /api/wiki` 或 `PUT /api/wiki/:id`，Markdown 下载链接请求 `GET /api/wiki/:id/export`，均由 `server/index.ts` 调用 `WikiStore`。知识检索经 `services/llm/knowledge-maintenance.ts` 的 `retrieveKnowledgeContextDetailed` 选择 `services/search/fts-retriever.ts` 的 `rankWikiChunks`。运行在 `SEARCH_ENGINE=sqlite_fts` 时，`services/search/indexer.ts` 不启动 Embedding。 |

## 实现

- `services/llm/provider-router.ts` 提供两端路由。每端同用地址与 Key，分别设名称、重档模型、可选轻档模型、独立超时与启用状态。端级默认 45 秒，调用任务可以覆盖。同端缺省轻档时使用重档。旧三项配置继续直接使用主端重档。主端关闭且备用有效时直走备用，主端无效且无备用时手工入口仍可使用。[配置示例](../../.env.example)
- 正常问答、维护、Prompt 生成和优化、Raw 与 PDF 核心提取调用重档。资讯分析、翻译、候选分类、周期摘要及主动巡检发现调用轻档，巡检后的维护草稿使用重档。Prompt 的原 API、输入选页和落盘权限沿用原调用链。Embedding 保留独立传输与自身重试，账本纳入独立端统计。
- 主端超时、网络错误、408、429 和 5xx 向有效备用端最多发一次。取消、401/403、普通请求错误和响应结构异常维持失败。地址、模型和凭据完全相同时不会重复发送。对接端收到请求后即使本地超时，仍可能计费，账本保留这次主端尝试，未知用量用空值表示。
- 完成结果及模型错误透传调用 ID、档位、切换标记、尝试顺序与实际模型。生产 API 响应提供 `X-FMCG-LLM-Request-Id`，可信本机 `GET /api/llm/routing?requestId=…` 可读取同一操作的后台尝试。设置页连接测试直测启用主路，并以 `diagnostic` 标识入账。已结束的真实尝试存入 `state/llm-routing/attempts.jsonl`，进程重启可读。汇总按端返回故障率、错误类型、延迟与已知用量，100 条近期明细的上限不影响累计统计。账本不写凭据、地址、用户输入或模型正文。
- Raw/PDF 检查点沿用原数据结构。单主保持原身份，启用不同重档备用时将端点组合纳入身份校验。各阶段产物的实际模型绑定归 3-2。本轮完成独立路由诊断接口，3-2 接入状态抽屉，3-3 处理 Wiki 列表及统计读取。

## 施工验证

- Node `v24.18.0`，隔离系统临时数据目录、缺省配置文件，清除继承的 `FMCG_LLM_*` 与 `EMBEDDING_*`，所有 Provider 测试用回环和随机端口。
- `npm.cmd run typecheck` 已通过。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/provider-router.test.ts tests/provider01-entry.test.ts tests/provider-config.test.ts tests/provider-knowledge-reasoning.test.ts tests/search-embeddings.test.ts tests/prompt-ai.test.ts` 通过 47/47。覆盖正式问答 503 切备用、异步巡检轻档与维护重档、主端诊断单独分账、两端失败、同网关异凭据、取消、权限、按端超时、备用独跑、已知零 Token、仅有总 Token 的响应、历史汇总与 Embedding 及 Prompt 边界。
- `cmd /d /c 'start "" /b /wait /affinity 3F cmd.exe /d /c npm.cmd run check'` 限制为六核。产品提交 `59261d5` 的全仓检查退出码 0，类型、格式、Lint、仓库门禁、1,153/1,153 测试与生产构建全部通过。Lint 维持 0 错误、761 条已有告警，生产构建提示已有的超过 500 KiB 分块。通过进程级 `GIT_CONFIG_*` 指定本仓库为安全目录，解决 guard 的 Git 所有权报错。冻结 25 问及千页基准由主 Agent 汇总。

| 最终定向验证文件 | SHA-256 |
|---|---|
| `services/llm/provider-router.ts` | `4da7e725ab1a1da2c999d048ca17e0bac6fe6e97d254c40d74a9e9f27729e2bf` |
| `services/llm/provider.ts` | `713613d1607befda5d165b9ff21a23b837f1f57e13ff92ba0b4e861d1d9b7c86` |
| `server/index.ts` | `020060c0155eb064c7683130d3ca7e03b19e23561827c37f70027266ff95e9e2` |
| `server/llm-config-api.ts` | `3085ce687ae91a825a66981caabdd8d16944818aa9e4b01018fc7188d80910d4` |
| `tests/provider-router.test.ts` | `dbbdc59d0831e88fd9c04c5935d22a3edd0304bdd49a9908708451ae6fe54d8e` |
| `tests/provider01-entry.test.ts` | `25dd7ee2b4701c601550dc5bf93b749d0c5c923760e2996bcb66911d31c38fe0` |
