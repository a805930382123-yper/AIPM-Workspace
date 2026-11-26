# LLM-Wiki 1B SQLite FTS 返修施工记录

2026-11-26，施工起点 `fece070e066972c9f4027990fd641756338b724e`。冻结语料、25 问题库、金标准原文坐标、Hit@8、章节评分规则和长页夹具沿用 1A。本轮 SQLite FTS 命中由 B 组 3/5 增至 4/5，E2 仍无送出上下文。真实 Hybrid 质量以既有未通过记录为准，返修后的真实质量待复验。[1A 历史快照](../../evals/reports/batch-1a-baseline.md) · [本轮离线快照](../../evals/reports/batch-1b-fts-repair.md) · [上次真实 Hybrid 评测](../../evals/reports/batch-1b-real.md)

## 漏检位置

在隔离目录按冻结清单校验并复制 95 篇正式 Wiki、9 份关联 Raw，加上三篇合成长页建索引。用原查询的 MATCH、来源页过滤、BM25 权重与 30 块限制复算，B1 的金标准块在 BM25 第 25，分数约 −6.7067。唯一覆盖组是 `cvs / 便利 店`，权重 3。「多大、多长时间营业」被拆成五组表面词，门槛因此为 5.5。原文用面积单位和按小时运行来表达，没覆盖这些询问词。前 30 块最高覆盖权重为 5，B1 在 FTS 覆盖过滤后无结果。E2 复算最高为 6，门槛为 7，仍走原有覆盖过滤。

## 实现与验证边界

- 单条独立查询的各分句均明确询问目标店型的面积或营业时段时，SQLite 以店型完整词组及其已有别名，与正文事实提示词作交集。后续校验原文量纲，面积需要相应面积单位，营业需要与开店、营业或运营关联的时长或时钟。事实中的明确主语优先，句内分句可继承当前主语，页名或别名只补足省略的主体或正文中「门店」一类的指代。两个事实分属同页不同章节时均可送出。
- 常规词面覆盖规则继续用于配送、责任等其余查询。定向用例覆盖折扣超市、会员制超市、仓储会员店和社区生鲜店问法，校验营业或面积证据的页、章及 UTF-16 逐字引用。负例覆盖同篇无关店型、货架面积、平方公里、距离、配送时限和本人验收责任。
- 针对第一轮独立验收发现的归属误判，定向复测药店巡检记录中隔壁咖啡店的面积及营业时长、药店资料里的货架占地。新增另一种门店的独立例，眼镜店页里的百货店营业时间和展台占地被排除，正文省略店名的眼镜店营业时长及药店以「门店」指代的营业面积仍可引用。[第一轮独立验收](1B-fts-repair-review.md)
- 生产检索仍用同一页范围、来源权限、引用坐标和上下文预算。FTS 查询沿用原索引词元和模式，现有索引可直接使用。产品默认相似度阈值 0.42、RRF 及 Hybrid 语义门槛沿用原值。实际模型调用为 0。

## 冻结 25 问差分

对比 1A 和本轮报告，忽略耗时。表中“同”表示命中、定位、误召回、页数、JSON 字符数、证据及送出上下文 SHA-256 均相同。SQLite 的其余 24 个上下文、Legacy 的 25 个上下文逐条相同。

| 题号 | Legacy | SQLite FTS |
| --- | --- | --- |
| A1 | 同 | 命中及定位，同 |
| A2 | 同 | 命中及定位，同 |
| A3 | 同 | 命中及定位，同 |
| A4 | 同 | 命中及定位，同 |
| A5 | 同 | 命中及定位，同 |
| A6 | 同 | 命中及定位，同 |
| A7 | 同 | 命中及定位，同 |
| B1 | 同 | 0 页 → 2 页，新增命中及定位 |
| B2 | 同 | 保留命中及定位，同 |
| B3 | 同 | 保留命中及定位，同 |
| B4 | 同 | 仍漏检，同 |
| B5 | 同 | 保留命中及定位，同 |
| C1 | 同 | 命中及定位，同 |
| C2 | 同 | 命中及定位，同 |
| C3 | 同 | 命中及定位，同 |
| C4 | 同 | 命中及定位，同 |
| C5 | 同 | 命中及定位，同 |
| D1 | 同 | 命中及定位，同 |
| D2 | 同 | 命中及定位，同 |
| D3 | 同 | 命中及定位，同 |
| E1 | 同 | 仍有误召回，同 |
| E2 | 同 | 送出 0 页，无误召回，同 |
| E3 | 同 | 仍有误召回，同 |
| E4 | 同 | 仍有误召回，同 |
| E5 | 同 | 仍有误召回，同 |

B1 在第 2 个送出页 `4ac48c25…` 的「来源事实」块保留完整金标准原文，正文 UTF-16 坐标 `32–68`，锚点 SHA-256 `b44fcb3cea8a682602abfe97f944eded8e72f2dd527115fe7bc63bdf0a273ffd`。A/C/D 的命中及定位分别为 7/7、5/5、3/3。B1/B2/B3/B5 命中及定位，B4 仍漏检。E 误召回 4/5，三篇长页九点原文引用均通过。

## 验证命令与复验入口

环境为 Node v24.18.0、SQLite 3.53.2。命令使用系统临时数据目录和不存在的模型配置文件，清除继承的模型和检索设置。评测脚本只读冻结源文件并写隔离库。

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test --test-concurrency=3 tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts tests/retrieval-quality-gate.test.ts` | 51/51 |
| `node node_modules/typescript/bin/tsc --noEmit` | 退出 0 |
| `node --import tsx scripts/run-retrieval-eval.ts workspace evals/reports/batch-1b-fts-repair.md --fts-repair` | 退出 0，全部冻结文件哈希和评分锚点匹配 |
| `node --import tsx scripts/run-retrieval-eval.ts workspace .scratch/fts-repair-historical.md` | 退出 1，1A 历史模式仅报告 B1 差异 |
| `npm run typecheck`、`npm run format:check`、`npm run lint`、`npm run guard` | 均退出 0，ESLint 0 错、761 项存量警告 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` | 全仓 1,130/1,130，0 失败、0 跳过 |
| `npm run build` | 退出 0，Vite 构建 275 个模块，出现既有大块提示 |
| `git diff --check` | 退出 0 |

首轮 `npm run check` 通过类型、格式、静态检查与体积守护。默认并行运行的 HTTP 服务启动用例达到时限后失败，测试进程在其后未退出，已终止该轮。单独重跑其中的 E04-01 启动用例通过。上述并行度 6 的全仓复跑覆盖首轮失败用例并全部通过。

`--fts-repair` 使用显式 SQLite 返修预期，要求 B1 有原文命中且定位正确，其余 24 问及长页仍需满足 1A 的逐题预期。省略该参数继续核对 1A 历史结果，按预期会报告 B1 的唯一差异。后续获授权的真实 Hybrid 复验可在给出独立报告路径后使用 `--fts-repair --live`，沿用原真实质量门槛。

## 文件摘要

| 文件 | SHA-256 |
| --- | --- |
| `services/search/tokenizer.ts` | `ab80a8324f316451a366ee6438f5b985bb53c26e3a0a38d5969028473647ff23` |
| `services/search/fts-retriever.ts` | `fba8bf6afbd74fcdf5ebd65a54d7f83613e8af1330a92366144ccf507ea734cd` |
| `scripts/run-retrieval-eval.ts` | `39f49c9d1288fd7a15d7135ab2894985952ddeb32d460172ce1f7b96a68558fd` |
| `scripts/retrieval-quality-gate.ts` | `e5b6076b165a14953b967fec8f2a3118399c1a07bdb87de5509ec6954198ad7f` |
| `tests/search-runtime.test.ts` | `bc05b25fcaa359af2bb17af24880323e397b871dfd068f6c15b961b55a203030` |
| `tests/retrieval-quality-gate.test.ts` | `d1e03a17c5222142563df09354a01009377ec7eb989e1ca4a0f07a2bc0d8ce1e` |
| `evals/reports/batch-1b-fts-repair.md` | `7e431d28af14fbe6932ce1749057a6204aae9bcbb5bd3203515f687d179b1257` |
