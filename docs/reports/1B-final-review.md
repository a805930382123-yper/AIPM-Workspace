# LLM-Wiki Batch 1B 最终独立验收

**默认阈值 0.42 下，Batch 1B 整体验收通过。** 产品提交 `74be77d80052c647987cf8316d9f45a31688d9b6`。本轮 B1 漏检返修也单独通过。真实 Hybrid 相对冻结 1A 新增命中 B1，当前 SQLite 单独检索同样能够找回该证据。B4 和四道负例保留为已知质量限制。

## 逐题与开销复核

复核主 Agent 执行的真实评测 `node --import tsx scripts/run-retrieval-eval.ts workspace evals/reports/batch-1b-final-live.md --fts-repair --live`（退出 0）。验收者未重复付费请求。[真实逐题报告](../../evals/reports/batch-1b-final-live.md) SHA-256 为 `049642fd8fae787e8bcd42dcf3e5c3d120d0a78a7cfeddc8c048312f361ffc9e`。

- 以 `node --input-type=module -e` 读取三份 Markdown，以题号、引擎为键逐行比较成绩、页数、字符数、锚点及上下文哈希，忽略耗时。最终 Legacy/SQLite 共 50 行，与[冻结 1A](../../evals/reports/batch-1a-baseline.md) 唯一差异是 SQLite B1，与[返修对照](../../evals/reports/batch-1b-fts-repair.md) 50/50 相同。
- 逐行检查 25 条真实 Hybrid。A1–A7、C1–C5、D1–D3 均命中并定位。B2/B3/B5 全部保留，B1 在送出第 2 页命中，FTS 与向量均进入候选。B 为 4/5。B4 的金标准向量分数 0.315833，低于 0.42。E2 空，E1/E3/E4/E5 误召回，4/5 持平冻结值。
- SQLite 与 Hybrid 三篇长页各九点均定位到正确章节和原文，纯向量送出块逐字核验 20/20。A–D 的 Top-30 含金标准 19/20，最终预算损失 0/19，低于 20% 诊断线。
- 真实模型 text-embedding-3-small，1536 维。正式与合成长页分别消耗 138,854 和 203,454 Token，查询 34 次共 689 Token，本轮 342,997 Token。按项目历史标准单价每百万 Token 0.02 美元估算约 0.00686 美元。前三轮合计 1,028,991 Token，估算约 0.02058 美元。查询网络平均/P95 为 356.39/846.89 ms。

## 最终产品工程检查

- 本轮独立运行 `node --expose-gc --import tsx scripts/bench-vector-1000.ts`，退出 0。Node v24.18.0，SQLite 3.53.2，1000 页、6000 块、1536 维。加载 347.04 ms，RSS/heap/ArrayBuffer 增量 85.65/2.33/69.07 MiB。各 50 次余弦及本地 Hybrid 平均/P95 为 10.78/14.34 ms 与 24.83/38.04 ms，满足平均低于 15/30 ms。混合样本全库与选页各 25 次，平均分别 34.60 和 15.06 ms。
- 本轮在隔离临时目录、缺失配置文件并清除宿主模型配置后运行 `node --import tsx --test --test-name-pattern='server process rolls back' tests/search-embeddings.test.ts`，1/1 通过。三次实际服务启动验证 Hybrid → SQLite FTS → 删除临时索引后 Legacy，保留引文及原文件哈希。
- 用 `Get-FileHash` 核对[返修施工报告](1B-fts-repair-builder.md)末表全部七项指纹，与当前工作树相符。沿用该候选全量命令 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx`，1,130/1,130，0 跳过，类型、格式、lint、guard、build 均通过。首次默认并发运行曾出现 HTTP 启动用例超时，以上限并发全量复跑覆盖。此外，[返修独立验收](1B-fts-repair-review.md)的同版专项 51/51 通过。
