# LLM-Wiki 2B-2 施工自查

2026-11-27 · 基线 `d0797fd` · 产品提交 `dbd7b4d` · 施工范围见[任务卡](../handoffs/LLMWIKI-2B-2.md)。冻结题库、千页基准和阶段结论由主 Agent 汇总。

## 实现

- 直接检索先执行原有排序、来源可见性与上下文预算校验。以已入选直接页为种子，通过 SQLite `relations` 合并入边、出边，按种子顺序与邻页 ID 排序。每次最多取 16 个邻页候选，最多追加 2 页，每页取一个原文块，优先事实块，再按章节种类与正文顺序选择。直接结果、预装上下文和范围外页面从候选中排除。
- 邻页通过当前 Markdown 文件哈希、来源校验、块哈希和 UTF-16 `body.slice(startOffset, endOffset)` 核对后进入现有上下文预算。无直接命中时跳过查询。邻页变化、不可见或关系表故障时保留可用的直接证据。`SEARCH_WIKI_ONE_HOP=0` 恢复原索引检索路径。
- Raw 新来源复核沿用 FTS 或 Hybrid 的直接排名。正常读取时，所有入选页面继续使用 2A 的时效评估。Hybrid 评测根据实际发送块与融合排名区分关联证据和纯向量命中，并核查关联证据的原文坐标。

## 自查

- `node --import tsx --test --test-name-pattern='Wiki one-hop|a vector-only direct hit' tests/search-runtime.test.ts tests/search-embeddings.test.ts`，3/3。正常问答调用的测试替身收到双向一跳的原文，返回的 UTF-16 引文通过校验。覆盖重复边、环、二跳、不可见种子和邻页、来源类型、显式选择、排除项、页数与字符预算、无命中、旧文件哈希、坏坐标、关系表故障与禁用开关。验证有向量的 Hybrid 只用一次回环查询，并验证默认缺少向量配置时由 FTS 回退补充证据。验证已入选邻页仍显示既有时效提醒，Raw 新来源只为直接相似页创建提醒。
- `npm.cmd run check` 首轮测试通过 1,145/1,148。三个失败均发生在既有测试启动本地 HTTP 服务时。`node --import tsx --test --test-name-pattern='F04-05/06 HTTP' tests/llm-http.test.ts` 单跑通过 1/1，`node --import tsx --test tests/provider01-entry.test.ts` 单跑通过 2/2。
- 将本轮 PowerShell 的处理器亲和性限制为 6 核后复跑 `npm.cmd run check`，类型、格式、静态检查、体积守护和生产构建均通过，测试 **1,148/1,148**，零失败、零跳过。ESLint 0 错误、761 项警告，Vite 构建有包体积警告。

Node `24.18.0`。使用系统临时目录下独立 `FMCG_DATA_DIR` 和不存在的配置文件，清除继承的模型及搜索配置，真实 Provider 调用 0 次。

## 施工版本

| 文件 | SHA-256 |
| --- | --- |
| `services/llm/knowledge-maintenance.ts` | `cd667e54b9c93c0a8ca3f5c19a2b4a260391bd84b8b266b85f832020d9391189` |
| `services/search/fts-retriever.ts` | `4e1329b8dea3947ce8632c5ba41112aa50cef6e8080317002ddaac4e28d203c7` |
| `services/search/indexer.ts` | `2c6bb40315b06d1011f9d3dae197d79a054137b27eeeba2fef2a98cede3e96ca` |
| `services/search/sqlite-store.ts` | `97ee00f8fa73315c8fd6c5994b17c09d30eaafce80296c02095d84dd2f14e837` |
| `scripts/run-retrieval-eval.ts` | `ed0349fec2caf9282f1acffa01ccd1cbce24b91612cd8fd3868814d827d7611f` |
| `tests/search-runtime.test.ts` | `78a5e550a6f8d09a69e92b55c67bfd84e27e2399858b918469e3f2433f2eeb1e` |
| `tests/search-embeddings.test.ts` | `b75c7a1be8892d8f96e31413b8ff8c1034816954f98d1001dce987f98af6ee81` |
