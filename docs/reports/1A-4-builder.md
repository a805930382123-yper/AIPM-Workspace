# LLM-Wiki 1A-4 施工记录

本轮起点 `205baf20525a4257792e7f5af29c02de11b600ea`。施工自查中，A、C、D 类达到命中提升要求，E 类误召回率与 Legacy 持平，长页九处逐字定位全部通过。1A-4 阶段及 Batch 1A 整体结论交独立验收。 [任务卡](../handoffs/LLMWIKI-1A-4.md)

## 驱动

最低支持版本 Node `22.13.0` 的原生 `node:sqlite` 缺 FTS5，创建虚拟表报 `no such module: fts5`。Node `24.18.0` 的原生驱动通过冒烟。产品继续使用 `better-sqlite3@12.11.1`，本轮在 Node `24.18.0` 实测 SQLite `3.53.2`。 [驱动选型证据](1A-1-builder.md)

## 真实题库与首次跑分前冻结

从 `workspace/knowledge/wiki/` 的 95 篇正式 Markdown 与 9 份底层关联 Raw 按原文件 SHA-256 冻结语料。A、B、D 的金标准从真实正文核定，E 用真实库已收录品类的相邻政策核对五个无答案问题。部分 Wiki 文件的大体积来自 YAML 的 PDF 证据元数据，产品进入索引的是解析后的正文。当前 FMCG Wiki 不足以覆盖三篇超过 48,000 正文字符的长页，C 和长页九点使用三篇可再生合成 Markdown。

题库提交相对文件名和 SHA-256、题目、Prompt 选页、正文 UTF-16 锚点坐标和哈希、章节路径与评分规则。首次执行任一引擎前记录以下原始字节指纹，完成修复后用同一组文件复跑。三个文件通过 `.gitattributes` 固定 LF，以便 Windows 检出也能使用原指纹。

| 冻结文件 | SHA-256 |
| --- | --- |
| `evals/retrieval-baseline.json` | `b8937bceae061acecfd28e91d5e03fd0187ac564e39ec76569991b22b0f68899` |
| `evals/fixtures/batch-1a-long.ts` | `d719119203b35e4403b90f84173939648d96ce61bc9592ac7a76402b0796bdbe` |
| `scripts/run-retrieval-eval.ts` | `49c18fff8b8fddf2de8b25ea06c697be1057a2de88e62409de77713bfdf0dc59` |

从仓库根目录执行 `node --import tsx scripts/run-retrieval-eval.ts workspace`。也可将 `workspace` 参数替换为有权读取、包含同字节 `knowledge/wiki/` 与 `knowledge/raw/` 文件的本地历史快照。缺文件或哈希不一致时评测中止。脚本只读取本地源，逐字复制清单内的文件到 `os.tmpdir()`，加载正式权限检查并生成隔离索引。真实正文仅在隔离目录和本机进程中读取，报告中的正文信息是证据坐标和摘要。可给第二个参数写入独立报告路径。

## 分类结果与检索修复

首次跑分 A `3/7 → 7/7`、B `0/5 → 3/5`、C `0/5 → 5/5`、D `2/3 → 3/3`，九点 `9/9`。E 误召回 `4/5 → 5/5`，首次评测退出码 `1`。

复核发现，单个业务主题的部分词元即可进入 FTS 排序并获得长问题的送模资格。在首次 E2 的最高候选里，只有时间、品类与配送的主题重合，缺少询问的配送条件和验收规则。SQLite 现在对包含至少六组有效词的单条独立问题，要求候选覆盖至少一半的有效词字符权重，完整标题或别名精确命中可继续召回。普通问句填充词和泛词不增加门槛，按字符计权降低分词碎片对覆盖率的影响。指定选页和使用内容扩展词的任务仍按原多词召回处理。新增独立合成回归，核对经销商返利结算主题不会应答无关的贷款问题，同时仍能为带未收录的加急限定的回款抵扣问题提供已有证据。 [检索](../../services/search/fts-retriever.ts) · [分词](../../services/search/tokenizer.ts) · [运行时回归](../../tests/search-runtime.test.ts)

最后两次评测逐题比较，50 份送模上下文指纹和各评分一致。A/B/C/E 经正式详细检索接口，D 使用 `PromptAiService.generate` 并从进程内模拟 Provider 捕获实际 `relatedWiki`。D3 Legacy 摘录计量达到 12,000 字符，SQLite 实际 JSON 为 11,869 字符。详细预算、两引擎逐题延迟和章节定位见快照。 [评测报告](../../evals/reports/batch-1a-baseline.md)

| 类别 | Legacy 命中 / 章节 | SQLite 命中 / 章节 |
| --- | ---: | ---: |
| A 精确术语 | 3/7 · 3/7 | 7/7 · 7/7 |
| B 换说法 | 0/5 · 0/5 | 3/5 · 3/5 |
| C 长页定位 | 0/5 · 0/5 | 5/5 · 5/5 |
| D Prompt 紧预算 | 2/3 · 2/3 | 3/3 · 3/3 |
| E 误召回 | 4/5 | 4/5 |

本轮修复使用同一冻结题库复评，指标是本地回归证据。E2 已无送模片段，E1、E3、E4、E5 仍有误召回。剩余 B 类漏题如下。

- B1 CVS 通常多大，多长时间营业？
- B4 闪电仓常规下单后多久送到？

## 千页性能

`node --import tsx scripts/bench-1000-pages.ts` 退出码 `0`。实际读写 1,000 份隔离合成 FMCG Markdown，重建索引 6,000 块，用时 **1,421.91 ms**。计时包含文件读取、解析、哈希、切块、中文分词、写库和切换。两引擎按同一顺序使用正式详细接口查询，分别预热 5 次、测量 30 次，命中非空且没有降级。

| 引擎 | 查询平均 ms | P95 ms |
| --- | ---: | ---: |
| Legacy | 461.78 | 527.15 |
| SQLite | **15.87** | **28.00** |

## 检查和回滚

`node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=2 tests/search-runtime.test.ts tests/provider01-entry.test.ts tests/search-chunking.test.ts tests/search-sqlite-index.test.ts` 通过 28/28。覆盖词元和特殊符号安全、块坐标、增量保存与删除、删库同结果重建、故障降级、期间持续查询，以及正式问答和 Prompt 引文与预算。

`npm run typecheck`、`npm run format:check`、`npm run lint`、`npm run guard`、`npm run build` 均退出码 `0`。全量测试使用 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx`，**1,099/1,099 通过**，0 失败、0 跳过。检查使用临时数据目录、缺失的隔离 Provider 配置及仅对子进程有效的 Git `safe.directory`。ESLint 为 0 错误、770 条既有告警，Vite 构建 269 个模块并保留入口产物超过 500 kB 的告警。

隔离回滚手工演练采用两次实际 `node --import tsx server/index.ts --production` 起服，操作由本机临时脚本 `node --import tsx .scratch/batch-1a4-rollback.mjs` 驱动。先以 `SEARCH_ENGINE=sqlite_fts` 启动并确认索引存在，完成问答并停服。再删除临时根中的 `state/search-index.sqlite`，用 `SEARCH_ENGINE=legacy_scan` 启动同一数据根。两个随机回环端口的健康、Wiki 读取和正式问答均返回 HTTP 200，回答完成、引文逐字验证通过。第二次为 `legacy_scan` 且 `degraded=false`，SQLite 文件保持缺失，正式 Wiki 字节哈希一致。两次启动均无 stderr，模拟回环 Provider 收到 2 请求，外部模型请求为 0。

## 施工文件

| 路径 | 职责 |
| --- | --- |
| `scripts/bench-1000-pages.ts` | 一千页正式 Markdown 建索引及详细接口双引擎压测。 |
| `scripts/run-retrieval-eval.ts` | 校验冻结语料、调用生产路径、评价实际送模证据、生成报告。 |
| `evals/retrieval-baseline.json` | 25 题、题库原文件清单、金标准、选页和评分规则。 |
| `evals/fixtures/batch-1a-long.ts` | 三篇长页的九处合成锚点与可复建正文。 |
| `evals/reports/batch-1a-baseline.md` | 本次对照快照。 |
| `services/search/fts-retriever.ts`、`services/search/tokenizer.ts` | 独立长问题的相关性过滤及有效词权重。 |
| `tests/search-runtime.test.ts` | 增加正负相关性回归。 |
| `tsconfig.json`、`.gitattributes` | 检查新脚本类型并保留冻结文件的跨平台指纹。 |
| `docs/reports/1A-4-builder.md` | 施工与自查证据。 |
