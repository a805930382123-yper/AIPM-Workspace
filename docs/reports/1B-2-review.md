# 1B-2 独立验收

## 首轮结论

阶段未通过。Step 4 要求平滑常数 k 可配置，冻结版本仅支持固定值 60。另有一个合法阈值会把满分纯向量结果全部丢弃的边界缺陷。Batch 1B 整体未通过，尚缺本阶段返修及 1B-3 的千页基准、25 问对照和最终校准。

核验基线为 4b4081ad2b5a7f7facaa1b396aff2d79232a5b17。按施工报告逐一用 Get-FileHash 核对 17 个 SHA-256，全部一致。融合器 SHA-256 为 9026cb6891c80e4eda28d7a10da555a93603abcbd16225c35d8c7449701b34b6。独立验收者未修改产品代码。

## 单路探针及返修要求

以下命令以合成的最高分向量和空词法结果调用实际融合器。在 PowerShell 中执行：

```powershell
node --import tsx --input-type=module -e "import {rankHybridChunks} from './services/search/hybrid-retriever.ts';const index={isDirty:false,rankVectorChunks:async()=>[{chunk:{chunkId:'v',score:1},exactName:false}],read:fn=>fn({prepare:()=>({all:()=>[]})})};for(const [k,s] of [[60,.42],[10,.42],[10,.99]]){process.env.SEARCH_RRF_K=String(k);process.env.SEARCH_VECTOR_MIN_SCORE=String(s);console.log(k,s,(await rankHybridChunks(index,[{title:'test',content:'',tags:[]}],{},()=>{})).map(x=>x.chunk.rrfScore));}"
```

- 两次默认阈值查询的结果均为 1/61。源码中的 RRF_K 被直接赋值为 60，没有读取运行配置或参数。原始 Step 4 明确要求 k 可配置，但未指定配置名称。增加配置入口，默认仍为 60，并覆盖改变 k 后单路与双路分数。
- 设 minScore=0.99 时结果为空。rankHybridChunks 对单路强制要求分数达到 1.05，余弦最高为 1。建议把单路实际门槛封顶为 1，测试配置 0.99 时满分候选以及低于最低线的候选。

## 独立实测

| 命令 | 结果与覆盖 |
|---|---|
| node --import tsx --test --test-concurrency=3 tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts | 40/40 通过，26.06 秒。包括真实服务启动的回环调用、页增删改、重建、模型/维度切换、白名单与排序、RRF 默认值、纯向量引用、回退及正式保存。 |
| node --import tsx --test --test-name-pattern='public PDF cleanup preserves\|PDF cleanup rejects restricted' tests/pdf02-http.test.ts | 2/2 通过，14.37 秒。合成 PDF 通过 HTTP 生成草稿并选择性提交，受限来源及已知凭据被拦截。该组未启用向量。 |

六条业务路径均在实际调用方核对。问答与 Prompt 的合成查询走回环 Embedding，实际模型入参分别核对了出块和显式选页。纯向量引用实测验证 UTF-16 原句、变更时标脏及来源撤权后拒绝。提取、维护、巡检和 PDF 草稿沿既有业务入口通过回归；这些回归不能单独证明各路径的有效向量召回。源码检查确认这些调用分别传入来源/依据复核，实际 provider 派发前在 Wiki 锁内再次执行，缓存内部按入选页、排除页和来源类型过滤后才做点积。集成测试覆盖未配置、无有效向量、请求超时、提供方失败、SQLite 错误、串联故障及显式回滚。使用合成数据、本地测试替身与回环 HTTP，未运行收费模型、千页性能或真实 25 问评测。

## R1 独立复验及阶段结论

**首轮两项缺陷均已关闭，LLM-Wiki 1B-2 阶段通过。** Batch 1B 整体验收仍待 1B-3 的千页性能、25 问三引擎对照及最终校准。

复验基线提交仍为 4b4081ad2b5a7f7facaa1b396aff2d79232a5b17。用 Get-FileHash 核对 R1 施工报告列出的全部 17 个文件，全部一致。实际融合器 SHA-256 为 7beef1d19ceaa49224c2f70a971b9def3b8af7a5a90325bba3299f5248c2b972，向量集成测试 SHA-256 为 741f3887a0ea33cf01019b2bf8ae5564615cd8666ae164e7c6229d8a58cca4be。

复跑上文的 node --import tsx --input-type=module 单路探针，并把循环输入扩展为 `[[60,.42],[10,.42],[10,.99],['bad',.99],[0,1]]`。五次分别得到 1/61、1/11、1/11、1/61、1/61。阈值 0.99 及 1 均保留满分项，无效 k 恢复默认。另运行 `node --import tsx --test --test-name-pattern='hybrid runs RRF' tests/search-embeddings.test.ts`，1/1 通过，包含双路非默认 k 的分数、弱纯向量裁切与可配置阈值的实际回环检索。

首轮的实际引用、权限、缓存、回滚及 PDF 证据见上文。R1 施工者在同一指纹下记录的 42/42 定向回归和严格类型检查作为补充证据。本轮复验只写验收报告。
