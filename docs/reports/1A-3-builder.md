# LLM-Wiki 1A-3 施工记录

施工基线为 `9bf9bdee44eb4295e111b87fe86c3038503cda68`。本轮实现并自查原提示词 Step 3–5，交主 Agent 独立验收后统一提交。Batch 1A 整体验收待后续阶段。[任务卡](../handoffs/LLMWIKI-1A-3.md)

## 驱动与实现

- 本机 Node `24.18.0` 的 `node:sqlite` 冒烟通过，SQLite `3.53.1` 报告 `ENABLE_FTS5=1`，建立 FTS 表后 `MATCH` 命中一条。产品沿用 1A-1 锁定的 `better-sqlite3@12.11.1`，本机实测 SQLite `3.53.2`。1A-1 的最低支持版本 Node `22.13.0` 缺原生 FTS5。[1A-1 施工记录](1A-1-builder.md)
- 新增 `Intl.Segmenter`、快消短词和英文连字符组合保留规则，以及版本化的 46 组查询同义词。词表扩展只作用于查询；分词索引版本升至 `intl-zh-v2`，启动时重建旧索引。FTS 使用参数绑定、逐词引号转义和空查询短路。[分词](../../services/search/tokenizer.ts) · [词表](../../config/fmcg-synonyms.json) · [SQLite](../../services/search/sqlite-store.ts)
- 以标题、别名标签、原文 `6/3/1` 的 BM25 取 30 个候选块，再按词组覆盖和精确标题别名排序。过滤低分单泛词，装入最多 8 页、每页 5 个块，页内保持原文顺序。每个发送块携带只读定位标签及正文 UTF-16 坐标，按实际 JSON 字符组装。[块召回](../../services/search/fts-retriever.ts)
- `retrieveKnowledgeContext` 继续返回完整记录数组。新增详细接口提供 `engine`、`degraded`、`chunks`、送模上下文和本地完整快照。SQLite 读取候选时核对正式文件哈希、原文切片与来源权限；索引不可用、过期或损坏时标脏并输出结构化告警，降级重新读取磁盘。[检索与维护](../../services/llm/knowledge-maintenance.ts) · [索引维护](../../services/search/indexer.ts)
- 问答使用命中块送模，引用必须落在已发送块且逐字匹配当前正式正文；未发送位置即使存在也会拒绝。巡检保留手工明确选页的完整读取和原有 48,000 字符门槛，相关扩展用剩余额度发送命中块，并对模型引文应用同样的块限制。未读取资料标识留在本地检查记录。[问答](../../services/llm/knowledge-answers.ts) · [巡检](../../services/llm/knowledge-inspections.ts)
- 提取作业的主题规划和维护提议使用块上下文，检查点保留完整 Wiki 修订作为本地依据。若模型建议替换一个只读到片段的目标，追加一次有计数的请求，用同一完整目标和对应输入主题生成更新；完整目标超过 48,000 JSON 字符时保留检查点并明确失败。关联或无改动候选沿用完整正文。[提取](../../services/llm/knowledge-extraction.ts) · [作业](../../services/llm/jobs.ts) · [检查点](../../services/llm/checkpoints.ts)
- Prompt 只在用户勾选页范围取块，实际发送 JSON 限每页 3,000、合计 12,000 字符。默认索引降级时，仍按序列化预算限制旧版摘录。显式旧引擎保留原有摘录字符计量，以便同原产品回滚行为核对。[Prompt](../../services/prompt-ai/service.ts)
- 正常 Express 启动默认执行启动对账，索引故障可继续启动。正式创建、编辑、删除和经用户确认的 Wiki 写入落盘后增量更新。SQLite 单次同步失败可观测且不阻止正式文件写入，启动可从正式 Markdown 恢复。[服务启动](../../server/index.ts) · [正式写入](../../services/wiki/store.ts)

## 自查实测

自查只使用系统临时目录及回环模拟 Provider。定向命令使用 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=2` 运行下列七个文件，共 **47/47 通过**。[运行时检索](../../tests/search-runtime.test.ts) · [切块](../../tests/search-chunking.test.ts) · [SQLite 对账](../../tests/search-sqlite-index.test.ts) · [Express 入口](../../tests/provider01-entry.test.ts) · [Prompt](../../tests/prompt-ai.test.ts) · [维护](../../tests/lw01-maintenance.test.ts) · [巡检](../../tests/lw03-core.test.ts)

- 3 篇长页共 9 个正文定位点全部命中，标题路径及 UTF-16 精确切片验证通过。验证了混合符号查询、中文口语同义词、空查询、来源拒绝、问答拒绝引用未发送区块及两种 Prompt 预算路径。
- 真实提取作业在规划和第一轮维护请求使用块。更新请求使用完整旧目标，保留未参与检索的人工内容；草稿在确认前未更改正式 Wiki，确认后索引可读取新增事实。同一场景还核对了无工作索引时正式保存和重建恢复。
- 设置 `SEARCH_ENGINE=legacy_scan`、关闭并删除隔离索引后，详细接口返回 `engine=legacy_scan`、`degraded=false`，结果与原数组函数一致。自动故障降级返回 `degraded=true`。Express 起服测试覆盖无法打开索引文件时的正常手工与读取入口。
- `npm run typecheck`、`npm run guard`、指定文件 Prettier 检查、新检索模块及定向测试 ESLint `--max-warnings=0`、`git diff --check` 自查通过。
- 初次施工冻结树的全量检查使用 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx`，**1,093/1,093 通过**，0 失败、0 跳过。首次 `npm test` 为 1,084/1,087，两个评估子进程受 Git 工作区归属检查阻止，另一个回环服务未在用例启动等待窗内就绪。复跑给子进程继承仅本次命令有效的 `safe.directory`，并限制测试并发。
- `npm run build` 通过，Vite 构建 269 个模块，报告单一入口产物超过 500 kB 的体积告警。

### 独立验收返修

- SQLite、自动降级与显式 Legacy 的问答均在每次模型响应后重新读取 Wiki，核对完整快照、来源权限及底层 Raw 哈希。Wiki 引用对照当前正文与实际送出的片段，Raw 按当前原文或对应图片解析验证。三种模式均实测拒绝模型调用期间被替换的原句以及被收紧权限的来源。[首次独立验收](1A-3-review.md) · [问答](../../services/llm/knowledge-answers.ts)
- 从回答生成维护草稿的正常 SQLite 路径发送有界的命中块。显式选定但没有命中的目标，用经权限核验的磁盘原文块保留用户指定范围。目标只发送了部分正文时，Provider 只提议新增内容，服务对照目标完整磁盘正文、权限及修订后在草稿中追加，保留未发送的旧段落。每次保存只调用一次 Provider。目标在模型调用期间发生变更时拒绝生成草稿。[问答](../../services/llm/knowledge-answers.ts)
- 返修后 `npm run typecheck`、变更文件 Prettier、新检索测试 ESLint `--max-warnings=0` 与 `git diff --check` 通过。`node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=2 tests/search-runtime.test.ts tests/provider01-entry.test.ts tests/lw02-boundaries.test.ts tests/lw03-core.test.ts` **37/37 通过**，包含三种引擎复现探针及真实 Express 回环请求上下文断言。返修后的全量检查待主 Agent 收尾。[运行时测试](../../tests/search-runtime.test.ts) · [Express 入口](../../tests/provider01-entry.test.ts)

### 千页性能

以 `node --import tsx --input-type=module` 在系统临时目录生成 1,000 份不同 ID 的合成正式 Markdown，每页 6 个章节，含中文行业词、标签和 25 种用于定位的探针。构建耗时由 `WikiSearchIndexer.rebuildAll()` 记录，含文件读取、哈希、解析、切块、分词、SQLite 写入和原子切换。FTS 计时使用详细接口，包含正式文件复核、权限和 JSON 装配。P95 为最近秩，SQLite 100 次查询各返回 8 个块，Legacy 独立 10 次同类查询。

| 数据 | 全量建索引 | 查询平均 | 查询 P95 |
| --- | ---: | ---: | ---: |
| SQLite 1,000 页 / 6,000 块 | 2,491.33 ms | 10.45 ms | 12.18 ms |
| Legacy 1,000 页 | — | 584.81 ms | 634.95 ms |

该次独立运行达到建索引 `<5,000 ms` 和检索 `<50 ms` 目标。另一次和全量测试同机并发运行时，构建 `10,990.63 ms`，查询平均 `71.02 ms`、P95 `110.12 ms`，留作负载条件对照。

### 施工文件校验

| 文件 | SHA-256 |
| --- | --- |
| `services/search/tokenizer.ts` | `c68406a1615a393ca6d4587419dadec39ee255e8de8ecfe0ff9a2e326bc82450` |
| `services/search/fts-retriever.ts` | `49201aeb5a244bb602096d8f7018f04078cfa44edc60c4e831cd6573100b5df3` |
| `services/llm/knowledge-answers.ts` | `d50bfeb658b256889aada22c21bc8cc5f73eacbb5ea7bf0adf2d1b42e57d09ee` |
| `services/llm/knowledge-maintenance.ts` | `2cdc31bcaec4dde4b6d103657011b317a94934f35a8cc4d92299c081b5795e36` |
| `services/prompt-ai/service.ts` | `164c2cc611c7036997b6ccfae3accf60f8ffde26c1d7b1263ecf90755e1c1a37` |
| `tests/provider01-entry.test.ts` | `c05cbec277c73a87f6b1a53335a63011916a8ac31c2a673436d6d5c0648db51b` |
| `tests/search-runtime.test.ts` | `c0c87c052fa2c34915d8fe473d1549468e545e710d73aac4c9834c4fa2abf33d` |

## 阶段边界

25 问 A（精确术语）、B（换说法）、C（长页）、D（紧预算）、E（负样本）以及 B 类具体漏题交 1A-4 实测。1A-3 尚待独立验收。实测仅在隔离数据目录执行，真实 Provider 调用为零。
