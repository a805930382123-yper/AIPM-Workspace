# R16/R18 真实自动字段质量：准备与施工记录

2026-10-27。Sol High 按 Astra 已审方案完成两文件准备入口及一次定向 fake smoke，已停写交独立复核。未读取实际配置、未调用真实模型。用户已要求开始下一步；具体真实调用上限仍待确认，不因账本有余量自动放行。施工者不签批次最终验收。

## 基线与最小目标

当前 HEAD 为 `130e440c3669b839ce433ddbd31d6f886a8637d9`。相对上一工程提交 `a064ebc2574e79ff1052559683372c2d37e196e9`，仅 agent-router、coordination 和 agent-control 规则变更，产品未变；A 模式施工模型改为 Terra High，本批沿 B 模式不受影响。已有 AGENTS.md 和 AGENT-ROUTER 打包报告为外部工作，不修改、不回退。

沿最新状态，本轮先交付可运行的真实原稿质量验证准备，只验证固定短资料在现有新链自动生成的语义字段、引用与未知边界及真实 outcome→Draft/渲染。已通过工程连接、人工字段 F04、保存回读和控件保存刷新证据复用，不重复真实 UI 或正式提交。R22、全产品四链、旧 Provider 错误矩阵不进入本轮。

## 固定资料与候选 oracle

复用 `tests/r1618-auto-fields.test.ts` 的现有六句资料，顺序及正文逐字固定，连接方式沿原工程夹具 `quotes.join('')`，避免通过换输入制造改善：

1. 【虚构】门店补货是根据门店库存与需求补充商品的业务活动。
2. 【虚构】门店补货的目的是降低缺货风险。
3. 【虚构】当门店库存低于安全库存时，由店长发起补货申请。
4. 【虚构】店长提交补货单，库管核对可用库存后安排发货。
5. 【虚构】AI尚未上线，仅为未来建议，收益未知。
6. 【虚构】异常审批负责人未知。

原稿验收按真实含义而非逐字答案：Concept 一句解释/定义包含库存、需求、补商品的业务活动，重要性以降低缺货风险为目标；Process 角色为店长与库管，步骤是提交补货单→核对库存→安排发货，触发来自低于安全库存。未知异常负责人不可补写；AI 机会保持分析建议且保留未来、未上线、收益未知。“AI 辅助核对”不在来源中，若提出只可作为明确分析建议，不能成为来源事实。未提供的系统、量化指标、分类、关系等不硬编。逐字段断言必须由该页所引原 fact/evidence 支持；引用覆盖整段不能代替对断言的语义核对。AI 来源标签、人改 AI 标记、人工说明独立和原始 Raw/fact/evidence 不变沿原要求。Oracle 仅存本报告及独立审查证据，不进入 fixture，也不传给模型；不以 fake 字段输出作为质量真值。

两类型覆盖由模型原稿实物裁定；不通过人工补成两类型或补填字段后签自动质量通过。若模型只产单类型，需如实区分已测类型与另一类型缺证，交独立审查裁定；不追加抽样碰运气。最终 oracle 由 Astra 方案审查确认。

## 调用预算及停止门槛（建议，尚未放行）

六句为单 chunk。产品 `runKnowledgePipeline` 正常路径为抽取一次、planning 一次，自动字段复用这次 planning，不增加请求；`OpenAiCompatibleProvider.complete` 内部无自动重试。因此一轮完整新链的最小预算是 **2 个实际 Provider 请求**，建议唯一序号 245（extracting）、246（planning），知识累计起 244/500、最高 246/500，Prompt 保持 15/24。

此处仅明确执行所需上限，不是已获调用授权。真实放行须主 Agent 确认具体上限、固定 Raw/正文 SHA、当前源码及执行入口冻结、独立工程审查证据与会话绑定。每个请求都在实际外发前以独占创建并 fsync 写入 pending attempt；失败、超时、未知结果均占该序号，不重建会话或解锁旧账本绕过。只安排一次完整流程，无自动重试；抽取失败即停，不消耗 planning。原稿语义失败即保留原稿停止，不先人工修好再改判质量通过。

## 最少文件落点与复用方式（待批准实施）

| 新增文件 | 责任与边界 |
| --- | --- |
| `tests/acceptance/R1618-QUALITY-20261027-fixture.json` | 仅固定六句原文及资料元数据；没有 oracle、实际业务数据或凭证 |
| `tests/acceptance/R1618-QUALITY-20261027-run.mjs` | 仅 prepare/run/smoke：复用产品 runKnowledgePipeline、checkpoint 和 DraftStore；一次流程两个实际请求的独占预占、原始请求/响应与草稿证据导出，不改产品 |
| 本报告 | 实际修改、自查命令、结果、冻结及剩余项 |

不复制 K204 的四件大套工具。K204-B 虽导出 Engine，但序号 225/226、B 阶段、CARD_SHA、PREP verifyInputs 和旧冻结都硬编码于模块闭包，不能用导出函数注入新参数；直接复用需要改旧文件或运行时替换，反而增加范围。SYN01 的 Engine 也硬编码单次综合请求，不能直接当知识新链入口。最少必要独立代码参考其独占 `wx` + `fsync` pending 机制：prepare 写固定 Raw 和冻结绑定；run 校验主 Agent release 后直接运行产品 pipeline，在每次 provider.complete 外发前预占序号、懒读配置并保存请求及原响应；成功保存原始 Draft 和证据，任何失败停。无 HTTP/Vite/browser，不新增调度框架。冻结只覆盖实际依赖、入口、固定资料和任务卡，不引入无关旧 PREP 工具。

已实现最短路径 `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare|run|smoke`。工程阶段只跑一项 fake smoke，验证实际两请求顺序、字段到草稿和未放行/已有 attempt 拒绝，真实/config 均为 0；未重跑 tsc 或旧矩阵。

## 实际实现、自查与版本

仅新增固定 fixture、单一 run.mjs 和本报告。prepare 生成专属隔离根、Raw、当前 services/rules 全目录及 package/lock/本卡/两入口的冻结表，不读取实际配置。run 要求主 Agent release 文件的准确 SHA，验证 released/budgetApproved、会话、mode、Raw、原文/fixture/源码 SHA 及序号245–246/上限2；一旦 run-started 独占落盘即禁止重派。每次 complete 核请求阶段并独占写 attempt，再进入真实或 fake 分支。真实 loader 仅位于 `s.mode === 'real'` 分支、在首 attempt 落盘后动态调用；fakeReply 分支不导入/调用 loadLlmConfig。prepare 无 provider 调用。由实际执行的 fake/prepare 代码路径可说明本轮配置读取0，不能仅靠结果字段声称。

请求记录仅含 system/user/purpose/timeout/输出上限，不记录凭证/配置；真实配置读取后先用已知秘密扫描请求。原始响应另存 private，再扫描后写可导出响应；草稿与预览同样扫描。命令异常仅打印code，不输出配置或异常原文。候选原稿未编辑、未选中、未审批、未正式提交，不含独立 oracle。

| 实际命令 | 结果与耗时 |
| --- | --- |
| `node --check tests/acceptance/R1618-QUALITY-20261027-run.mjs`；随后 `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke` | 一次完整本地命令1.120秒，exit0；smoke 3检查通过：未放行0调用、两fake请求生成原始草稿、已用会话拒绝重派。真实0/config0 |
| `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare` | exit0、0.508秒；只创建未放行真实会话及冻结，不读取配置，不请求模型 |
| `node -e` 逐句比较 fixture 与原工程测试，再计算连接正文 SHA | 6句均在原工程夹具逐字存在，137字符；正文 SHA见下 |
| 新路径 `git diff --check` 与 SHA256 核对 | exit0；这些新增路径尚未提交，主 Agent 应结合实际新文件审查，不能将未跟踪文件的空 diff 当成完整审查 |

fake 会话保留于 `.scratch-R1618-QUALITY-20261027-YdRrTU`，draftId `b40db4d0-79e9-4e82-897b-5e6c8c1120c6`。其 candidate-original.json 为 fake 工程证据，Raw字节一致，原5事实文本相等，两类型均有AI字段原fact引用，AI机会渲染含分析建议标签；仅245/246两份attempt。未放行时未生成run-started或attempt，已用会话重跑拒绝；没有真实质量结论。

| 冻结对象 | SHA256 |
| --- | --- |
| `tests/acceptance/R1618-QUALITY-20261027-fixture.json` | `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7` |
| `tests/acceptance/R1618-QUALITY-20261027-run.mjs` | `4b97dbf3e51c4b220a6d885e8c1f3aaab13f71190969c9895b71ba3cea0ed3da` |
| 六句连接正文 | `a64ef3745784ea68ceadb7e62d841f537727fcf505a79f918f43507665cb74ef` |
| 当前已准备真实会话的依赖冻结聚合 | `e46227d640f31cf3b78d25a7e331ace7da67008e298f292f4bfb8b3fdd7745e2` |

## 交接：预算确认后的最短路径

已准备且未放行的真实会话根：`E:\AI\Work\AIPM Workspace\.scratch-R1618-QUALITY-20261027-7S9N8T`，sessionId `b1c47757-806d-4b0a-aaa0-07f37bdb39d6`，Raw `0494c3fd-22f4-45d8-bc81-a9d5f8620d92`。无 attempt、run-started 或 release。prepare 输出的 releaseTemplate 具有 `released:false,budgetApproved:false`，不签预先放行。独立审查及用户预算确认后，主 Agent 将该模板对应字段置true、填写issuedAt，并保存精确release文件，计算其SHA，再执行：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run '<会话根>' '<主Agent release.json绝对路径>' '<release文件SHA256>'
```

所有绑定字段必须与prepare输出一致。若实际依赖或本卡改变，旧冻结会拒绝，不通过修改旧session绕过；确认未消耗真实attempt后再准备新会话。run 成功输出原稿证据位置及真实预占累计；`candidate-original.json` 含未编辑Draft、正文预览、outcome、checkpoint、Raw原文。逐请求 `request-245/246.json`、`response-245/246.json` 是供独立核对的无凭证请求/响应；private响应不自动发布。出现错误即保留result/attempt，不重复调用。只保存原稿及渲染，不启动浏览器或正式化。

当前施工自查已完成、停写交 Astra 独立复核。真实调用0、实际配置读取0；知识244/500、Prompt15/24未变。真实原稿质量及R16/R18整项、B09/全产品仍待验证，旧失败保留。平台token计量不可得。
