# LLM-Wiki 2B-2 独立验收

产品提交 `dbd7b4d`，基线 `d0797fd`。本轮一跳检索及故障回退通过独立验证。全仓结论见下方记录。2B-3 向量重复提示尚未验收。

## 本轮实测

- 在 Node 24.18.0 的临时数据目录创建四个真实 Wiki 页面，给种子正文设置独有查询词。关闭 `SEARCH_WIKI_ONE_HOP=0` 只返回种子。默认开启后，直接结果保持首位，入边与出边各增加一页，二跳页未进入上下文。限定种子页、排除种子、精确耗尽直接上下文字符预算均得到预期结果。
- 通过 `KnowledgeAnswerService.ask` 捕获本地模拟 Provider 收到的 JSON。邻页块包含“🧾复核时点为周三午后。”，回答状态为 completed，返回邻页 ID 与原文 UTF-16 起点。删除临时 SQLite 的 relations 表后仍走 FTS，保留直接页；显式 Legacy 的开关两次返回值深度相等。实际命令为 `Get-Content -Raw -Encoding utf8 $probe | node --import tsx --input-type=module -`，临时探针 SHA-256 为 `38701b41e32ec710f571a30e428a8c4e1311dd3f1b8a560b895738dba41571ab`。
- 独立复跑 `node --import tsx --test tests/search-runtime.test.ts tests/search-embeddings.test.ts`，34/34 通过，零跳过。覆盖受限种子、邻页与来源链，去重、单页和总页数上限、磁盘哈希与偏移失效、Raw 写时提醒、读时复核。回环向量 Provider 证实 Hybrid 纯向量直接命中可以扩展邻页，未增加 embedding 请求。此次没有调用外部模型。

## 同版回归证据

- 主 Agent 运行 `node --import tsx scripts/run-retrieval-eval.ts workspace <临时报告> --fts-repair` 比对冻结 25 问双路 50 行。关闭后除时延与历史逐行一致。默认开启的差异仅在 D1 增加两页，上下文从 6,937 增至 8,033 字符，原有三个锚点保持。FTS 分类命中 A 7/7、B 4/5、C 5/5、D 3/3；B4 漏检，E 误召回 4/5。长页 9/9。开启、关闭证据 SHA-256 分别为 `0f452642eb95d6805476174d9f42c4a76ae6a96384ae2f921f8436c840fd20f2`、`7e34d46a100fb4a4d2c2b03dd5f96da14c7bda8065230e856c88577001588625`。历史真实模型结果见 [1B 最终评测](../../evals/reports/batch-1b-final-live.md)。
- 主 Agent 运行 `node --import tsx scripts/bench-1000-pages.ts`。1,000 页、6,000 块重建 1,469.38 ms，FTS 查询均值 8.66 ms、P95 15.31 ms，Legacy 均值 438.83 ms、P95 610.15 ms。

验收工作树文件 SHA-256 前 12 位：knowledge-maintenance.ts `cd667e54b9c9`，fts-retriever.ts `4e1329b8dea3`，indexer.ts `2c6bb40315b0`，sqlite-store.ts `97ee00f8fa73`。

## 批次结论

2B-2 整体 PASS。复用同一组产品指纹的[施工全仓记录](2B-2-builder.md)：首次 `npm.cmd run check` 有三个 HTTP 启动用例失败，分别单跑 1/1、2/2 通过；限制为六核后全仓复跑 1,148/1,148，零跳过，类型、格式、lint、体积守护及构建通过。ESLint 有 761 项警告，Vite 保留包体积警告。2B 整体仍待 2B-3。
