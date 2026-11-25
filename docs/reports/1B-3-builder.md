# LLM-Wiki 1B-3 施工自查

候选基于 `2bf4294`。本轮完成离线基准、检索评测工具和进程级回滚验证。真实模型评测按本轮授权暂缓，Batch 1B 整体仍待真实质量验收。[任务卡](../handoffs/LLMWIKI-1B-3.md) · [逐题快照](../../evals/reports/batch-1b-hybrid.md)

## 变更范围

| 文件 | 用途 |
| --- | --- |
| `scripts/bench-vector-1000.ts`、`tsconfig.json` | 千页持久化加载与 50 次各路压测，纳入严格 TypeScript 检查。 |
| `scripts/run-retrieval-eval.ts`、`evals/reports/batch-1b-hybrid.md` | 复跑 Legacy、SQLite 基线，支持显式真实 Hybrid 评测、逐题定位与诊断。 |
| `services/search/fts-retriever.ts` | 在时延热点处先按既有 BM25、访问范围、稳定次序选 30 个候选，再关联正文和元数据。 |
| `services/search/vector-retriever.ts` | 将长向量点积分为四组独立累加，随后合计。奇数维尾项仍逐项累计。 |
| `services/llm/knowledge-maintenance.ts` | 并行读取首批候选页文件。仍按排序逐页验证原文件哈希、来源权限和引用，执行原有页数和字符预算。 |
| `tests/search-embeddings.test.ts` | 对比标量和四组累加的排名及误差，增加三次实际服务进程启动的切档与删库回滚用例。 |

## 冻结语料与离线评测

`node --import tsx scripts/run-retrieval-eval.ts workspace` 在临时目录校验并复制 95 篇正式 Wiki 和 9 份关联 Raw，再加入 3 篇合成长页。正式语料 898 块，合成长页 156 块。冻结题库、生成器与评分口径沿用 1A。对比 50 条 Legacy、SQLite 逐题记录，命中、章节、误召回、证据、上下文页数与字符数和实际发送上下文 SHA-256 均一致。计时值按本轮重测。

| 类别 | Legacy | SQLite | 口径 |
| --- | ---: | ---: | --- |
| A | 3/7 | 7/7 | Hit@8 与章节 |
| B | 0/5 | 3/5 | Hit@8 与章节 |
| C | 0/5 | 5/5 | Hit@8 与章节 |
| D | 2/3 | 3/3 | 实际 Prompt 发送内容的 Hit@8 与章节 |
| E | 4/5 | 4/5 | 误召回 |

SQLite 三篇合成长页九点均正确，B1/B4 仍漏检，E2 拒绝误召回。真实 Hybrid、B1/B4 的向量归因、五条 E 类阈值前余弦、真实引用结果、预算漏失率和重排序判断待验证。0.42 为实现默认最低余弦阈值，校准待验证。宿主未发现 Embedding 模型配置，本轮真实请求数为零。95 页真实模型名、向量维度、耗时、Token 和 Query Embedding 网络延迟待验证。

真实评测入口使用 `node --import tsx scripts/run-retrieval-eval.ts <冻结本地快照> <输出.md> --live`，后续校准由 `--threshold=<值>` 重跑并保留独立报告。真实开销按 95 页正式库、3 篇合成长页和查询三个阶段记账，Provider 响应无 Token 数据时标为缺失。实际 Prompt 出参评分后，诊断复用此前获得的同一真实查询向量，直接调用既有候选与融合代码，比较最低余弦阈值、RRF 灰区和最终预算三个位置。诊断时延未混入主调用计时。

无配置时显式传入 `--live`，Legacy 与 SQLite 仍生成报告，脚本返回 2 并提示 Hybrid 跳过。另以临时生成的合成语料和回环接口检查真实运行分支的技术流程，收到 40 次本地请求，其中 34 次为 Query Embedding。验证了用量记录、B 类纯向量证据、E 类阈值前余弦和预算诊断。合成探测无外部请求，正式语料仅用于离线基线。

## 千页压测

执行 `node --expose-gc --import tsx scripts/bench-vector-1000.ts`。Windows x64、Node v24.18.0、SQLite 3.53.2。随机向量用固定种子并按主题生成，1,000 页、6,000 块、每块 1,536 维。先将向量 BLOB 写入磁盘并关闭连接，再另开连接调用生产缓存加载。输出前后均主动 GC，记录进程内存增量。进程内查询替身交付向量并执行生产授权回调，无套接字延迟。

每组预热 5 次。内存组 50 次扫描全部 6,000 块。混合组计时跨越 FTS、向量、RRF、文件读取、权限、预算和上下文返回，含 25 次标准 48,000 字符查询和 25 次六页限定、12,000 字符查询。每次断言实际 Hybrid、双路有命中、无越权出块及预算正确。P95 采用最近秩。

首轮在同一语料测得 dot 13.03 ms，混合 74.39 ms。隔离 CPU profile 复现后，FTS 栈约 3.28 s、内存 rank 约 1.26 s。两阶段关联和四组点积降低开销，加入候选正文并行读取后共同达到门槛。复测保留查询、夹具、候选限制和预算。

最终独跑 SQLite 到内存加载 318.12 ms。进程 RSS 增量 86.68 MiB、V8 heap 使用增量 2.33 MiB、ArrayBuffer 增量 68.83 MiB。向量净载荷 35.16 MiB，ArrayBuffer 增量含 SQLite BLOB 与解码缓冲。

| 计时范围 | 次数 | 平均 ms | P95 ms |
| --- | ---: | ---: | ---: |
| 内存余弦 | 50 | 10.08 | 12.64 |
| 完整本地混合 | 50 | 21.40 | 33.38 |
| 标准范围，混合子组 | 25 | 30.22 | 33.62 |
| 六页限定范围，混合子组 | 25 | 12.57 | 14.52 |

按任务卡的两项 50 次均值门槛，内存余弦低于 15 ms，完整本地混合低于 30 ms。标准范围子组均值为 30.22 ms。

## 工程验证与回滚

严格类型检查 `node node_modules/typescript/bin/tsc --noEmit` 通过。`npm run format:check`、`npm run lint`、`npm run guard`、`npm run build` 均通过。Lint 为 0 错误、761 条存量告警。生产构建保留原有分包体积提示。

`node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` 全量 1,116/1,116，通过，0 失败、0 跳过。测试进程使用新建系统临时数据根和缺失的模型配置路径，已清除宿主模型凭据及搜索配置。

`node --import tsx --test --test-concurrency=3 tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts` 通过 42/42。其中隔离实际服务进程依次以 Hybrid、SQLite、Legacy 启动，三个健康、Wiki 读取和问答请求均通过。Hybrid 的问题只有回环向量召回，前两档发块、Legacy 发正文，同一 UTF-16 原句在每档都通过实际问答校验。切 Legacy 前删除隔离库，调用后未重建。三个进程均正常退出，正式 Wiki SHA-256 一致。回环收到 3 次 Chat 和 2 次 Embedding，禁用向量的后两档无 Embedding。

既有离线专项回归复核了超时、断线、HTTP 500、未配置和 SQLite 故障，召回按各自实际状态降级。模型或维度改变时，旧版本不混查，补算后恢复 Hybrid。两块合成页面单段改写只发一个新块，另一块 BLOB 字节相同。标题改变会改变发送文本前缀，两个块都重算。选页用例验证无库外出块、显式空选页无上下文。

## 交接指纹

基线为 `2bf4294`，表中为施工候选文件在交接时的 SHA-256。

| 文件 | SHA-256 |
| --- | --- |
| `scripts/bench-vector-1000.ts` | `14dbe35b5e4402308fd4f4f714ea06dde180dd95da20a6ef44bd7de67d87ce2b` |
| `scripts/run-retrieval-eval.ts` | `d279fbc8403a15237aa439eb6ea6a00506a211e45e2d313b4337e20100872509` |
| `services/search/fts-retriever.ts` | `f069dbfd8728b57726c415213e40ddcc7af760e9b46c2ceac99c6a432f566d17` |
| `services/search/vector-retriever.ts` | `1c54df8e2c047cfc5548940a4fdc8583197d197c3162910f87a35a6492f4a756` |
| `services/llm/knowledge-maintenance.ts` | `cafecd1c3610a22c5e2a6be8a0c405d3ea81a4038c80631495d75d39d17b215c` |
| `tests/search-embeddings.test.ts` | `65ddfbe0045d1eb8a2fb9a1eb6011f4af916634b386168019913a2f10fb24b57` |
| `tsconfig.json` | `99d1b6cdef4767815c55f15de0c7e118f3f70686b9488d13cd5881d046fba5c6` |
| `evals/reports/batch-1b-hybrid.md` | `30e29cbcd6bace8a17a4194ec6de1be9659fb9521a2e1357405113be52f87976` |

## R1 质量门槛返修

新增 `scripts/retrieval-quality-gate.ts`，以独立验收过的 1A SQLite 结果固定参照。每次重跑 SQLite 均核对原 25 题成绩及九个长页定位。Hybrid 的 A/C/D 须逐题同时命中和定位，B 须保留 B2/B3/B5 且至少 4/5，E 误召回最多 4/5，另核对九点长页和纯向量逐字引文。报告列出未满足的条件，进程退出码为 1。正常离线运行只裁决 SQLite 对照，Hybrid 标待验证。请求真实评测且缺配置时返回 2。

`node --import tsx --test tests/retrieval-quality-gate.test.ts` 通过 5/5。`node node_modules/typescript/bin/tsc --noEmit` 通过。仅用合成语料和回环接口运行三次 CLI 探针，控制组返回 0，将 Hybrid 的 A1 章节改错返回 1，将两路的 D2 同步降为未命中也返回 1。两次失败报告均明确列出题号和未通过条件。真实 25 问仍只跑离线两路，全部 50 条上下文与 1A 冻结快照一致。本轮真实模型请求为零。

R1 交接指纹如下。首轮表中未列为 R1 的文件继续适用。

| 文件 | SHA-256 |
| --- | --- |
| `scripts/run-retrieval-eval.ts` | `185d9a6325635761964cefb169f66cef6793bb4a114af16206846aa811a0c895` |
| `scripts/retrieval-quality-gate.ts` | `59e6cbb3b3823fae3cdd9f15e4b2cf4ab30060d9c0b4e5abd02fa19ccf3f91e5` |
| `tests/retrieval-quality-gate.test.ts` | `2efac2405fda5e46b2f0723087e4a06dd54452c02ec202df70f35b06c22b0c86` |
| `evals/reports/batch-1b-hybrid.md` | `c301ad984c24b0536128c65d5bbd80497aa03937ec44beeb2cb40841e200152d` |

主 Agent 收尾记录：R1 最终冻结版隔离全仓测试 1,121/1,121 通过，0 失败、0 跳过，216.812 秒；严格类型、格式、Lint、guard 与生产构建均退出 0。
