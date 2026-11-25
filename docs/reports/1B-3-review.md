# LLM-Wiki 1B-3 独立验收

## 第一轮结论

离线工程交付需返修。基于提交 `2bf4294` 和施工报告列出的候选文件，本轮首次检查发现评测程序的最终裁决遗漏章节指标。Batch 1B 整体待真实语义验收。本轮外部请求数为零。

在 `scripts/run-retrieval-eval.ts` 中，grade 对同一实际出块分别计算 hit 与 heading。若正确原文带有错误章节标签，hit 为真，heading 为假。约第 532–540 行的 retained 和 qualityPass 仅检查命中，且以当次 SQLite 成绩作比较。即使 A/C/D 比冻结的 7/7、5/5、3/3 章节定位成绩退化，仍可能报告通过。应校验冻结基线，并把 A/C/D 命中与章节保持、B 原有三题保留、E 不高于 4/5 纳入结论；用合成评分输入核实错误章节会阻止通过。

## 已执行的独立检查

运行 `node --expose-gc --import tsx scripts/bench-vector-1000.ts`，退出 0。Node v24.18.0，SQLite 3.53.2，1000 页、6000 块、1536 维。SQLite 加载 336.12 ms，RSS/heap/ArrayBuffer 增量 87.33/2.33/68.84 MiB。50 次余弦平均/P95 为 9.59/11.97 ms，50 次本地完整混合为 21.96/33.07 ms。两组混合各 25 次，全库 30.89/33.24 ms，六页范围 13.03/15.43 ms。混合均值门槛按脚本的两类等权查询口径通过。

静态核对 FTS 在 LIMIT 之前应用访问范围、BM25 和稳定次序；首批文件可并发读取，按候选序验证文件哈希和来源再组装预算。按发现缺陷即退回的交接要求停止本轮；独立离线基线复跑、专项和回滚测试留至返修后。真实 Hybrid 命中、阈值、引用与重排诊断待验证。

## R1 独立复验结论

**首轮缺陷已关闭；1B-3 离线工程交付 PASS。Batch 1B 整体待真实语义验收。** 基线提交为 `2bf4294`；实际验收候选的评测入口 SHA-256 为 `185d9a6325635761964cefb169f66cef6793bb4a114af16206846aa811a0c895`，裁决模块与测试指纹与施工报告 R1 表相符。

- `node --import tsx scripts/run-retrieval-eval.ts workspace <临时目录>/review.md` 退出 0。离线复跑 25 题、两档引擎，50 条逐题上下文 SHA-256 和 1A 对照相符。SQLite 的 A/B/C/D 命中及章节分别为 7/7、3/5、5/5、3/3，E 误召回 4/5，长页九点 9/9。Legacy 对应 3/7、0/5、0/5、2/3 和 4/5。Hybrid 25 题均标明待验证。
- `node --import tsx --test --test-concurrency=3 tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts tests/retrieval-quality-gate.test.ts` 通过 47/47，0 跳过。环境使用独立临时数据目录与缺失配置路径，并清除宿主模型及检索配置。专项覆盖排名、访问范围、版本变化、故障降级和断言标量排名等价；三次服务启动验证 Hybrid → FTS → 删除临时索引后 Legacy 回滚、逐字原句和原文件哈希。
- R1 五项裁决测试直接从冻结报告读取期望分数。A/C/D 锚点命中但章节错误、两引擎同时漏 D2 均触发退出码 1；缺少配置的真实评测请求对应退出码 2。静态核实 CLI 同时使用裁决结果生成报告、设置进程退出码。首轮压测候选未因 R1 修改，性能数据见上。
- 真实服务调用数为零。真实模型建库及查询开销、B 类语义增益、E 类阈值、真实向量逐字引用和最终预算漏失率均待验证，暂不能给出重排结论。
