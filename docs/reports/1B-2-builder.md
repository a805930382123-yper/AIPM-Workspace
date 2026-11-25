# LLM-Wiki 1B-2 施工与自查

施工基线 `4b4081ad2b5a7f7facaa1b396aff2d79232a5b17`。范围为 [1B-2 任务卡](../handoffs/LLMWIKI-1B-2.md) Step 3–5 及对应离线回归。

## 施工内容

- SQLite 同版本单位向量以页为单位缓存在内存中。启动核对、页同步与删除、补算实写、版本切换和库替换同步刷新缓存。白名单、排除列表、来源类型均在点积之前应用。向量路按点积排序取 30 项，FTS 路继续使用 Batch 1A 的候选与重排。
- RRF 使用两路等权。环境变量 `SEARCH_RRF_K` 接受有限正数，未设置或值无效时取 60。沿用 1A 标题和别名信号，加分 0.008。余弦门槛 `SEARCH_VECTOR_MIN_SCORE` 默认 0.42，纯向量块的入选门槛为该值加 0.06，最高为 1。双路候选保留各自排名、余弦值、RRF 分和命中来源。总预算沿用 48,000 字符，Prompt 沿用 12,000 字符及单页 3,000 字符。
- 默认混合检索，Embedding 不可用回退 FTS，SQLite 故障回退旧扫描。返回实际引擎和已发生的降级原因，串联故障依次记录。显式 `sqlite_fts` 和 `legacy_scan` 关闭向量外发，旧扫描回滚无需 SQLite 文件。
- 问答、问答维护、提取及维护规划、巡检、PDF 知识草稿和 Prompt 生成走原入口。送出 Embedding 查询前核对来源权限与已知凭据。PDF 草稿在模型等待期间释放 Wiki 写锁，落草稿前重新核对资料、整理记录和相关 Wiki。问答将混合结果作为索引证据，引用仍核对当前 Markdown、逐字 UTF-16 位置和当前底源权限。

## 实测

Node `v24.18.0`，使用系统临时数据目录、不存在的配置文件、合成数据及随机回环端口。清除宿主模型和向量配置，真实提供方调用、正式资料外发、真实模型费用均为 0。

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test --test-concurrency=3 --test-reporter=spec tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts` | 40/40，通过，18.35 秒。覆盖真实服务启动后的混合问答、实际 Prompt 生成的选页与空选择、纯向量引用、缓存重载、维度切换、并行正式写入、错误降级及两档回滚。 |
| `node --import tsx --test --test-reporter=spec tests/provider01-entry.test.ts` | 2/2，通过。首轮全量 1,113/1,114 的唯一失败为旧的默认 FTS 状态断言，已覆盖当前默认混合无向量配置降级到 FTS 并返回具体原因。 |
| `node --import tsx --test --test-concurrency=3 --test-reporter=spec tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts tests/provider01-entry.test.ts` | R1 冻结定向 42/42，通过，24.71 秒。验证 k=10 的单路和双路分数、无效配置取 60，以及余弦门槛 0.99 时只保留满分纯向量块。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=4 --test-reporter=spec tests/*.test.ts tests/*.test.tsx` | R1 冻结全量 1,114/1,114，通过，0 跳过，285.85 秒。使用进程专用 Git `safe.directory`。 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过，0 错误。 |
| `npm.cmd run guard` | 通过，6,179 个已跟踪文件，0 违反。使用进程专用 Git `safe.directory`。 |
| `npm.cmd run build` | 通过，包含严格 TypeScript 检查，构建 269 个模块，保留既有前端包体积提示。 |
| 修改路径的 `prettier --check` 与 `eslint` | 格式通过，ESLint 0 错误，存量告警保留。 |
| `git diff --check` | 通过。 |

千页向量基准、25 问真实三引擎评测及最终阈值校准留待 1B-3。此处为施工自查，1B-2 待独立验收，Batch 1B 整体待后续证据。

## 冻结文件 SHA-256

| 路径 | SHA-256 |
| --- | --- |
| `services/llm/checkpoints.ts` | `cabdec172ece5d58e548f2e99a63fd8d9d33c3c8d6de0cadbd934159edff9cd2` |
| `services/llm/jobs.ts` | `eeb19c09f516af8d1acb03ed526a394423679906488e5327143227e4b547923a` |
| `services/llm/knowledge-answers.ts` | `909e07ea88dd2c1280d29db1fad1a8ed1ec2bf9fb6cfa73dede6c07a6348f4a6` |
| `services/llm/knowledge-inspections.ts` | `988cd6431de08ec00e4d265856fcee4c756eaf89162ea5fca7161a80424ef010` |
| `services/llm/knowledge-maintenance.ts` | `21614c3c561567f2c11b70e89601245931877a0630e486147f9e2bd6fc073a25` |
| `services/prompt-ai/service.ts` | `b4bfd30b03c475cbacbf459d3b04761c907de501ce3e99b73e26c05c98cbe7fd` |
| `services/raw/pdf-cleanup.ts` | `790eb43d83455c8f90c0f3095c2b29e0435e2ad8dfbcfe2ddbc7ec7fb3aefcf3` |
| `services/search/embedding-backfill.ts` | `189a49a7471d8df679179e04c79755871ebfda78d9a7a431bdecf7c8cecb35c9` |
| `services/search/embedding-provider.ts` | `cae7be5b8cc913fd45f011e5f5c7ce781faef282a66c5eb5f09c120c67446a81` |
| `services/search/fts-retriever.ts` | `d2e8e915b9cc581e9c75779d0f6a99228c194b4d70d2305cf33326c44793f884` |
| `services/search/hybrid-retriever.ts` | `7beef1d19ceaa49224c2f70a971b9def3b8af7a5a90325bba3299f5248c2b972` |
| `services/search/indexer.ts` | `d7ed87899548c0190aaced3ca8aaa13f66c245345acee441daa854a5ca8e3f05` |
| `services/search/sqlite-store.ts` | `3e076405d55bdef936fe762ba26b954ce64849804f8a9b13daef057a3840dd54` |
| `services/search/vector-retriever.ts` | `97a1cde297e24cd0d5787009c6b842b8caf7f0b72d5055443f0674f4e05c74fc` |
| `tests/provider01-entry.test.ts` | `4f24f67962171df64853291e35800ecd069129d1b21a35cb7c2ad89dd728d612` |
| `tests/search-embeddings.test.ts` | `741f3887a0ea33cf01019b2bf8ae5564615cd8666ae164e7c6229d8a58cca4be` |
| `tests/search-runtime.test.ts` | `2e5f3570cf7c32da7b6aba77a87e0c41ad2292981ca4a624965fa3cd98ec8c04` |
