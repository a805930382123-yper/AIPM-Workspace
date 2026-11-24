# LLM-Wiki 1A-3 独立验收

本轮结论为 **FAIL，需返修**。隔离库中的正式问答在自动降级与显式回滚时均接受了已经从磁盘消失的引文；从问答生成维护草稿仍将完整召回页送给模型。Batch 1A 整体待验收，1A-4 未启动。

冻结基线为 `9bf9bdee44eb4295e111b87fe86c3038503cda68` 加施工工作树。用 `Get-FileHash` 核对的 SHA-256 为 `services/llm/knowledge-answers.ts` 的 `31a015a2c8960c6354e8bf1b8249dda0434183fed59dae046d8838a60afb87ca`，以及 `services/search/fts-retriever.ts` 的 `49201aeb5a244bb602096d8f7018f04078cfa44edc60c4e831cd6573100b5df3`。运行环境 Node 24.18.0。

## 需要返修

1. **P1，问答发布过期证据。** 独立执行 `node --import tsx --input-type=module`，使用 `lwFixture`、临时正式库和 `KnowledgeAnswerService.ask`。三次分别新建正文为 `marginprobe oldvalue` 的页，询问 `marginprobe`。在模拟 Provider 的 `complete` 中将正式 Markdown 中的 `oldvalue` 原位替换成 `newvalue`，返回旧引文 [12,20)。正常 SQLite 返回 `failed / ANSWER_BASIS_CHANGED`，引用为空；显式 legacy 及调用 `index.markDirty` 的自动降级都返回 `completed`，引用为 `oldvalue`。问答第 514 行把模型响应后的磁盘核验和权限检查都限制在 SQLite 分支。所有引擎应在采用响应前核验当前依据及权限，保留两条回归。
2. **P2，从问答生成维护草稿绕过块检索。** 静态沿 `KnowledgeAnswerService` 保存路径检查，`services/llm/knowledge-answers.ts` 第 798 行直接调用旧数组接口，第 822 行将该数组原样传给 `answer_maintenance`。正常 SQLite 模式的该入口仍使用旧扫描、发送完整正文，且超长相关页可能在整页预算筛选时直接消失。应让首次维护提议接收命中块，保留本地完整基准，更新时单独读取目标并校验版本及权限。

## 独立实测与覆盖

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/search-runtime.test.ts` 通过 6/6。用例通过实际服务方法、隔离 Markdown 和模拟 Provider 核对分词与别名、长页九处位置、来源拒绝、手工增删改与故障恢复、问答拒绝引用未送块、巡检和 Prompt 上下文，以及提取提议到确认落盘后的增量索引。提取路径完整目标复核保留了未召回的人工正文。代码检查确认索引 FTS 使用绑定参数，标题/元信息/正文 BM25 为 6/3/1，Top-30 后重排；作业在调用前保存 attempts 并重新核对维护上下文。

施工报告记录 better-sqlite3 12.11.1、隔离千页建索引 2491.33 ms、查询 P95 12.18 ms 和全量 1093/1093。本次独立验收复跑上述六项并执行三种引擎的磁盘变更探针；千页和全量数字来自施工记录。25 问 A–E 分类与 B 类具体漏题尚未测定，留给 1A-4。

## 返修后独立复验

**本轮两项缺陷均关闭，1A-3 阶段 PASS。Batch 1A 整体待验收。** 上面的 FAIL 对应返修前冻结的代码；1A-4 千页和 25 问双引擎最终验收尚待执行。

仍以提交 `9bf9bdee44eb4295e111b87fe86c3038503cda68` 加返修工作树为准。返修后的 `services/llm/knowledge-answers.ts` SHA-256 为 `d50bfeb658b256889aada22c21bc8cc5f73eacbb5ea7bf0adf2d1b42e57d09ee`，`tests/search-runtime.test.ts` 为 `c0c87c052fa2c34915d8fe473d1549468e545e710d73aac4c9834c4fa2abf33d`。

- 独立运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/search-runtime.test.ts`，11/11 通过，跳过 0。
- 用 `node --import tsx --input-type=module` 在内存中取上述用例的正式问答与维护场景，替换查询为 `largerprobe`、引文与等长替换值为 `🧾alpha7` 与 `🧾delta9`，并替换未发送区段标记。5/5 通过，包含三种引擎子用例。响应期间外改正文一律得到 `ANSWER_BASIS_CHANGED`；改底源为 restricted 一律得到 `MEETING_SOURCE_RESTRICTED`，记录中均无引用。
- 维护保存探针分别选中检索命中页及无匹配词的显式长页。两次实收请求都有定位块、无完整 body，序列化上下文不超过 48,000 字符。草稿保留完整目标快照，候选正文逐字等于完整旧正文、两个换行和新增段落；正式页仍为原版本。响应期间另行编辑显式目标，保存失败且草稿总数保持两份。

主 Agent 收尾实测：返修冻结版在独立临时数据目录、无真实 Provider 配置、进程级 Git safe.directory 下执行 node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx，1,098/1,098 通过，0 失败、0 跳过，216.36 秒。
