# Batch 1A 独立验收

**本轮修复通过，1A-4 阶段 PASS，Batch 1A 整体 PASS。** 候选基于 `205baf20525a4257792e7f5af29c02de11b600ea`。结合 1A-1 驱动、1A-2 切块与增量索引、1A-3 正式入口的独立返修结论，本次补齐检索对照、性能和真实进程回滚门禁。Windows x64，Node 24.18.0，better-sqlite3 12.11.1，SQLite 3.53.2。最低 Node 22.13.0 缺原生 FTS5 的实测见 [1A-1](1A-1-review.md)。[1A-2](1A-2-review.md) · [1A-3](1A-3-review.md)

## 冻结与评分

执行 `node --import tsx scripts/run-retrieval-eval.ts workspace "$env:TEMP/1a4-independent-eval.md"`。施工首次跑分留存的题库、长页生成器、评测器 SHA-256 依次为 `b8937bceae061acecfd28e91d5e03fd0187ac564e39ec76569991b22b0f68899`、`d719119203b35e4403b90f84173939648d96ce61bc9592ac7a76402b0796bdbe`、`49c18fff8b8fddf2de8b25ea06c697be1057a2de88e62409de77713bfdf0dc59`。独立复跑与首次记录三项一致，与交付快照的 50 个上下文指纹逐项一致。候选检索器、分词器 SHA-256 为 `dc77693ce61133dbbbd9bbbb7b510580e784b76330f4b9935f4efd9debb56e21`、`c89b86282bacfd99cec73c60d31f80711eb0a0dd5474f72f2852dcb856e6dd7b`。

两引擎共用隔离副本，逐文件校验 95 篇正式 Wiki、9 份关联 Raw；另加 3 篇合成长页。逐题核对正样本的原文片段与问义，并校验来源权限、正文坐标、章节和内容哈希。A7 单词 GMV 只考术语检索，可匹配两页实际 GMV 指标。E 问题均要求邻近主题的具体政策，人工标注无答案。另查 95 篇正式正文，“温控”“本人验收”“上门费”“赔付上限”“跨城包邮”的字面匹配均为零。此项抽查无法穷尽同义表达。

两引擎均按正式调用交付顺序取前 8 页，须在实际发送内容中找到任一完整金标准锚点；同一页的多个块合算一页。A/B/C/E 调用正式详细检索；D 捕获 PromptAiService.generate 的 Provider 入参，选页相同，每页及总预算按各自生产路径核验。D3 旧引擎摘录用满 12,000 字符，新引擎实际 JSON 11,869 字符。E 只要发出非空证据就计误召回。

| 类别 | Legacy | SQLite | 指标 |
| --- | ---: | ---: | --- |
| A | 3/7 | 7/7 | 命中与章节定位 |
| B | 0/5 | 3/5 | 命中与章节定位 |
| C | 0/5 | 5/5 | 命中与章节定位 |
| D | 2/3 | 3/3 | 命中与章节定位 |
| E | 4/5 | 4/5 | 误召回 |

三页首中尾共 9/9 正确定位并逐字通过生产引文检查。B1“CVS 通常多大，多长时间营业？”、B4“闪电仓常规下单后多久送到？”仍漏检。初版 SQLite 的 E2 会发送 8 页，修复后为零，E1、E3、E4、E5 仍误召回。查阅实现，过滤按独立长问句的有效词覆盖权重生效，没有按题号或页 ID 特判。E 已达到不劣于 Legacy 的门槛，80% 的绝对误召回率仍高，且本次用同一题库调参与回归，未测额外留出集的误召回率。[逐题快照](../../evals/reports/batch-1a-baseline.md)

## 基准、工程门禁与回滚

- 独立运行 `node --import tsx scripts/bench-1000-pages.ts`，隔离磁盘 1,000 页、6,000 块，读取至索引切换共 1,584.05 ms。各预热 5 次后测 30 次，Legacy 平均/P95 为 485.70/531.04 ms，SQLite 为 19.52/32.29 ms，均通过相应门槛。
- 独立运行施工留存的隔离演练驱动 `node --import tsx .scratch/batch-1a4-rollback.mjs`。两个实际服务进程先后以 sqlite_fts、legacy_scan 启动，中间删除同一临时数据根的 SQLite 文件。回滚后库文件持续缺失，健康和 Wiki 可读，正式问答完成、逐字引用正确、degraded=false，Wiki 哈希一致。两个回环模拟模型请求，零外部请求。
- 核查施工串行检查驱动和日志。复用 `npm run typecheck`、`npm run format:check`、`npm run lint`、`npm run guard`、`npm run build` 成功记录，及 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` 全量 1,099/1,099、0 跳过、0 失败。Lint 保留 770 条既有告警，生产构建保留体积提示。删库重建、失败降级及引文变动的早期独立用例见对应阶段验收记录。当前阶段及整批没有剩余阻塞。
