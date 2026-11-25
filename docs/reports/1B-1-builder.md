# LLM-Wiki 1B-1 施工与自查

范围为 [1B-1 任务卡](../handoffs/LLMWIKI-1B-1.md) 的 Step 0–2。施工基线 `87b5969`。本报告记录施工自查，独立验收待签发。

## 1A 基线核对

| 指标 | `legacy_scan` | `sqlite_fts` |
| --- | ---: | ---: |
| A 命中 / 路径定位 | 3/7 | 7/7 |
| B 命中 / 路径定位 | 0/5 | 3/5 |
| C 命中 / 路径定位 | 0/5 | 5/5 |
| D 命中 / 路径定位 | 2/3 | 3/3 |
| E 误召回 | 4/5 | 4/5 |

两路命中数均等于各自章节定位数。`sqlite_fts` 漏题为 B1「CVS 通常多大，多长时间营业？」、B4「闪电仓常规下单后多久送到？」。数据来自 [1A 冻结 25 问报告](../../evals/reports/batch-1a-baseline.md)。

`chunks` 已预留 `embedding` BLOB 和 `embedding_ver` TEXT，`meta` 已预留 `embedding_provider`、`embedding_model`、`embedding_dimensions`。现行 `SearchOptions.pageIds` 是 FTS 选页约束，显式空数组返回空。知识维护读取 `SEARCH_ENGINE`，Prompt 只传已选页 ID，问答仍用 `WikiRecord.body.slice(startOffset, endOffset)` 校验逐字引用。Wiki 正式写入由 `writePageLocked` 和 `commitChange` 接入同步索引，删除清除页、块和 FTS 行。这两个钩子已覆盖本轮，无需改 Wiki 代码。

## 实现与验证

- Provider 使用显式 `EMBEDDING_MODEL`。`EMBEDDING_BASE_URL` 与 `EMBEDDING_API_KEY` 可独立覆盖主配置，显式 URL 与主端点一致时才可继承主 Key。支持 `EMBEDDING_DIMENSIONS`，默认批量 32、索引单批 15 秒、查询 4 秒，分别由 `EMBEDDING_BATCH_SIZE`、`EMBEDDING_INDEX_TIMEOUT_MS`、`EMBEDDING_QUERY_TIMEOUT_MS` 调整。回环验证了请求批次维度、逆序返回对齐、单位向量、错维度、重复 index、非有限值、零向量、429/500 重试上限、查询 503 及超时。每次实际 HTTP 尝试记录脱敏用量，涵盖输入条数、提供方、模型、已知 Token、耗时和错误码。
- SQLite 以端点身份、提供方、模型、配置与实际维度锁定向量。锁切换在事务内清空旧 BLOB。增量替换同版本、同页且完整外发输入一致时复用 BLOB。实测局部修改仅补 1/2 块，改标题补 2/2 块。验证了 TypedArray 子视图的 BLOB 写入、非对齐 Buffer 解码、错误字节数拒绝、换端点重算、模型和维度切换及持久化。
- 正式保存同步完成 FTS 更新后启动单飞向量补算。依据当前 Markdown 快照和来源链对每次 HTTP 外发重新授权，网络等待在 Wiki 写锁之外。实际发包仅含 1 个允许块，缺源、会议受限来源和派生页共 3 块均保留待补算。挂起 HTTP 响应期间，正式新增、修改、删除以及确认草稿均完成，检索返回 `sqlite_fts`。并发删除、磁盘改动和切换模型时丢弃过时结果。HTTP 500 第二次失败后停止，手动补算恢复。
- `WikiSearchIndexer.getEmbeddingStatus()` 和 `backfillMissingEmbeddings()` 提供进程内状态和手动触发。向量待补算计数独立于 FTS `index_dirty`。全量重建先替换 FTS 库，再按新库补向量。本轮全量重建会重算全部向量，手动离线重建 CLI 可在服务器下次启动时完成补算。
- 实际服务启动测试用隔离配置复用主模型端点和 Key，经 `POST /api/wiki` 创建页面，查 SQLite 验证启动存量和新增页的 `openai-compatible:production-smoke:2`，日志含脱敏用量。真实 Provider 请求、正式资料外发和真实模型费用均为 0。

## 施工命令与结果

Node `v24.18.0`，每次测试进程使用系统临时目录和不存在的 Provider 配置文件，清除继承的主模型、向量和搜索引擎环境覆盖，HTTP 使用随机回环端口。

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test tests/search-embeddings.test.ts tests/search-runtime.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts` | 33/33，通过。包含 7 项新增测试及 1A 回归。 |
| `node --import tsx --test tests/llm-http.test.ts` | 10/10，通过。真实产品服务与回环模型覆盖 B04 HTTP 回归。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=4 --test-reporter=spec tests/*.test.ts tests/*.test.tsx` | 全量 1,107/1,107，通过，0 跳过，278.90 秒。为子进程注入单次 `safe.directory`。 |
| `npm.cmd run typecheck` | 严格 TypeScript 通过。最终文件再次随 `build` 做严格检查。 |
| `npm.cmd run build` | 通过，269 个模块，保留前端大包提示。 |
| 修改路径 `prettier --check` 与 `eslint` | 格式通过，0 lint 错误，`server/index.ts` 3 条存量未使用变量告警。 |
| `npm.cmd run guard` | 为子进程注入单次 `safe.directory` 后通过，6,171 个已跟踪文件，0 违反。 |
| `git diff --check` | 通过。 |

全量默认并发出现多组既有 HTTP 测试启动超时，其中 B04 测试子进程超时后仍在等待回环连接，已停止该子进程并单独重跑。并发 4 的首次复跑仅余 EVAL01 的 Git 工作区所有权错误，加入本次进程专用的 `safe.directory` 后全量通过。

## 冻结文件 SHA-256

| 路径 | SHA-256 |
| --- | --- |
| `server/index.ts` | `eea20556f245eb3eabf2e266980805170e2a4456abfd02d088bcbf2998279f2f` |
| `services/search/embedding-provider.ts` | `871d81c46941a91fc100300cec0466426624bb3a43f63e38426d3afa8ae16480` |
| `services/search/embedding-backfill.ts` | `44811faca5a5f4e8dc0a9d4ece0a3427fedd0ea0b2e12e3c3d6ddcf9e4d97098` |
| `services/search/indexer.ts` | `acb64abea95fe77ea3adb9913f3daa0af0f78390645ee24701fc41aa27d7a130` |
| `services/search/sqlite-store.ts` | `70c84fa2b7b6dca3555ada090e32472ba66e9e89b672a8aac7b57ec757e133a8` |
| `tests/search-embeddings.test.ts` | `4aafea59ae4be477eeaecca8db2702aeec3ee67fa3fa3ca347a27c606a64340b` |

1B-1 定向施工自查通过。整个 1B 的验收还需后续阶段的向量检索、RRF、阈值校准、千页压测和真实三引擎评测证据。

## P1 返修记录

为 [独立验收发现的配置继承问题](1B-1-review.md) 加入共享测试环境过滤器。产品子进程启动前删除所有继承的 `EMBEDDING_*` 值，按大小写无关匹配。专项测试清理后填入本次回环模型配置。产品代码和既有主聊天 Provider 设置沿用原逻辑。

审计覆盖 101 处现有直接启动点、B07 的动态参数入口、两个浏览器联动启动点和 RUN01 的开发及生产启动路径。共修改 103 份已有测试启动文件，其中 95 份为按需运行的历史验收脚本。静态审计覆盖全部 102 个直接 `spawn` 调用（含专项回环），没有遗漏，修改过的脚本通过语法解析。历史验收脚本本轮只做静态核查。

在父测试进程注入合成 `EMBEDDING_MODEL`、Key 和随机回环端点后，定向 `node --import tsx --test tests/search-embeddings.test.ts tests/search-runtime.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts` **34/34 通过**，继承端点收到 **0 次**请求。新增回归直接启动独立验收复现命令 `node --import tsx --test --test-name-pattern="E04-01 HTTP" tests/llm-http.test.ts`，断言通过且专用哨兵收到 0 次请求。显式回环配置的服务启动、正式新增与两个向量落盘同时通过。`npm.cmd run build` 包含严格类型检查，构建通过。修改范围的格式与 `git diff --check` 通过。

带同一类父环境合成配置运行 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=4 --test-reporter=spec tests/*.test.ts tests/*.test.tsx`，**全量 1,108/1,108 通过**，0 跳过，243.74 秒，继承端点收到 **0 次**请求。使用临时数据目录、缺失的主配置文件和本次进程专用的 Git `safe.directory`。

返修冻结指纹（初验产品代码指纹见上表）：

| 路径或差异 | SHA-256 |
| --- | --- |
| `git diff --no-ext-diff --binary HEAD -- tests docs/testing.md` | `9210583faaa816fb495aebf6de66fb2fadc713c2d241b160ae9a041ec71fc61e` |
| `tests/search-embeddings.test.ts` | `91d6a4eb87191058b733633d6df9428ff2fc561ed304a217b390e8b309b950e9` |
| `tests/support/isolated-embedding-env.mjs` | `9c5fbf82545641ff21a6ffaf330afd5e65346dd233c579f441562b36c439d336` |
| `tests/support/isolated-embedding-env.d.mts` | `9a461aa9dc788a410105f839c7cdd2c0d8f0457a508afefdd0d077769745a059` |
