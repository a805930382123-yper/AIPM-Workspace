# OpenAI strict schema 与知识流程第一小批

2026-10-29。用户已明确授权补齐 B09 遗留验收与修复。本卡冻结第一工程批；基线 2fe5318e70e188cf28c15af7867aacf460213d66。需求0、耦合2（Provider/知识抽取规划/恢复指纹）、风险2（事实完整性）、历史2（结构失败复现）=6，B模式。Astra规划/独立验收、Sol High施工，不同实例；主线程统一记录状态与提交。

## 已证事实与目标

当前 provider.ts 的 json_object 只对指定 GLM host/model 的 knowledge/prompt 生效；官方 api.openai.com + gpt-6.1-terra 目前仅省略 temperature，并没有该 JSON 模式。旧契约报告不得推及现在的 OpenAI 请求。新批增加指定 OpenAI 路径的 wire strict schema，不追认旧 schema 拒绝是解析缺陷。

官方依据（本轮已搜索并打开）：https://developers.openai.com/api/docs/guides/structured-outputs 。Chat Completions 使用 response_format.type=json_schema，json_schema 含 name/strict/schema。对象禁止额外属性，全部属性 required；可选值需用 nullable 联合模拟。服务端原业务校验仍保留。主线程已核官方模型页 https://developers.openai.com/api/docs/models/gpt-6.1-terra 明示支持 Structured outputs；账户实际请求仍以实测为准，失败如实停止。

## 工程范围与接口

只适配 KB02 facts 与 planning 两个实际调用点，分别由 bundle.kb02FactsSchema、bundle.kb02PlanningSchema 提供契约。LlmCompletionRequest 增加可选结构输出描述，由调用点显式传入，禁止从提示文本抽取 schema。仅精确官方 host + gpt-6.1-terra + knowledge + 显式描述启用；连接测试、Prompt、其他 Provider 保持原样，不自动降级或重试。

规划 schema 有可选 templateFields 及其可选栏目，不能直接原样套 strict，也不能把所有栏目强制产出事实。以现有 schema 为源生成 wire 契约：对象闭合、required 全集，仅原可选属性允许 null；保留原必填属性非空/类型/枚举等约束。回包先验证 wire 形状，再仅将契约声明的可选 null 映射为省略，之后走原 exact、引用归属和事实完整性校验。禁止通用删 null、删非法页、容错字符串页或修补事实。校验未知内容只在此边界一次；不得扩展原业务 validator 接受 null/anyOf。可实现小型专用适配模块承载递归 wire 转换与逆映射，不能构建通用 schema 框架。

检查 facts 实际 schema 的可选字段并同样映射；planning 中加载后产生的实际 schema 才是依据，不能只读静态 JSON（例如 question-only 的动态允许条件）。保存原始 Provider 响应证据，语义规范化不伪装原文。拒绝/refusal、截断、HTTP/格式错误必须失败且不重试。改变规则版本或等价的既有指纹输入，使旧未完成检查点不得按新 wire 契约恢复；已完成草稿保持可读。不得修改 Raw/历史响应/业务模板规则或追加 O/Q 特例提示。

## 文件所有权

Sol：services/llm/provider.ts、knowledge-extraction.ts、rules.ts；必要时新增 services/llm/openai-structured.ts；tests 中既有 Provider 与 KB02 定向测试及必要新增 strict 适配测试；既有 tests/acceptance/R1618-QUALITY-20261027-run.mjs 的新会话/profile/冻结绑定；本批 builder 报告。沿用现有 O/Q fixture 原文，不修改旧账本会话。新增文件仅限上述模块、测试和本批证据。若实现需改变其他产品模块，先向主线程报告接口原因。

本规划实例只拥有此卡。独立验收者只写本批 audit；主线程拥有 status/验收总表/Git。共享工作区不得覆盖外部 AGENTS.md、AGENT-ROUTER-20261023-packaging.md 或他人改动。交接后施工停写。

## 冻结验收

S01 实际 fetch 捕获两阶段请求：指定模型 strict=true、不同正确 schema、温度省略；非目标 Provider/连接/Prompt 请求维持原行为。
S02 facts/planning 合法结果穿过真实产品管线形成草稿；可选 null 只映射为合法省略。缺必填、错类型、额外属性、字符串 pages、非法引用均拒绝，旧254失败原响应仍拒绝。未知问题不得补答案，原事实/Raw摘要不变。
S03 失败/refusal/截断不出成功草稿、不自动重试；旧未完成指纹拒绝、已完成记录不破坏。
S04 定向测试及 build 通过；记录命令、计数、实际版本/SHA。优先既有 Provider/KB02 测试加增量，用 fake fetch 检查 wire 与产品实际调用；不跑旧全矩阵。独立验收可核同版本可信结果，不重复无关测试。
S05 准备新隔离 O/Q 会话，冻结当前产品、入口、fixture、本卡；零配置读取、零真实调用的 smoke 证明未 release 不请求及序号/首失败停机制。准备独立 PASS 才可由主线程决定真实放行。

## 真实验证建议与预算门禁

旧 O253–254 失败已终止上次4请求授权，不复用余2次。当前知识254/500、Prompt15/24、连接1单列。主线程依据最新B09修复及必要验收授权冻结本次新封顶4次：O255–256（抽取/规划），O技术与独立O01/O02语义通过才放行 Q257–258；最终知识最多258/500。本批4次来自最新范围的有界必要验收，不是旧预算续用；主线程在准备独立PASS后于执行记录明确新批预算及逐会话放行。不得从总额度剩余推导额外授权。

沿 R1618-OQ-20261029-task.md 原文与标准：O自然Process、非空outputs保留安排已编制但尚未发货；Q实际触发question-only且完整保留两项未知问题，不造事实。目标缺证也停止；Q若抽取已能观察不满足条件则不继续规划。实际Draft/文本保真，所有非空栏目逐断言有据。首技术失败、语义FAIL、超时/未知结果或目标缺证立即停止，不重试、不补抽样、不挪预算；每实际请求计账。同核心再失败先零调用诊断。

工程S01–05与真实O/Q分别结论；本批通过不签R16/R18或B09整体通过。旧失败和HUMAN PASS保留；R22、四条完整App链及其他矩阵缺项随后另批，不在此扩展。准备阶段不读密钥、不启动服务、不执行真实API或正式Wiki写入。


## 执行前修订 Q（2026-10-29，真实调用仍为0）

独立准备审查发现旧纯问题Q与既有“整篇无事实拒绝规划”边界冲突。原要求是未知unit本身仅questions、在有事实主题中正确归属，不是新增整篇纯问题成稿能力。此次在任何真实执行前修正样本准备，不改产品或业务标准，不修改原历史fixture/报告。

新Q文件冻结为 `tests/acceptance/OPENAI-STRUCTURED-20261029-question-fixture.json`；保持旧Q title/sourceType/sourceName/joinWith，正文逐字为：

> 【虚构】门店补货流程由门店提交补货单，计划员核对库存后形成补货安排单。【虚构】以下是门店补货流程的待确认问题：异常补货由谁审批？该审批应在提交补货单之前还是之后完成？

第一句为独立业务事实承载主题，随后原两问题保持原样。准备须用现有真实atom切片确认事实与问题可独立选择，不改切片器迎合样本。真实Q要求第一句有事实承载，两问题完整进入question-only units；任何含未知问题的atom同时进入facts均为该目标缺证，停止，不把双轨当通过。仅存在一个不重叠question不能替代两问题完整核验。规划/草稿/渲染保留两个未知，不能把谁审批或先后顺序补成事实。现有 fact 支撑及无事实拒绝保持。

Sol追加唯一新fixture、runner question profile绑定及必要精确gate/smoke，更新builder报告，重新prepare O/Q两个新会话（本卡/runner变更使旧freeze失效），旧准备会话不得release。O原文、O255–256、Q257–258、新4次封顶及首失败停不变。S01–04产品未改可复用本次同版证据；S05需核新原文/atom独立性、两问题门槛、新freeze完整性和无attempt/release再判定。此前smoke成功仅机械入口PASS，旧Q可执行性不通过。
