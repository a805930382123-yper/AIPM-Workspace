# OpenAI KB02 strict schema 施工交接

2026-10-29；Sol High 施工实例，按冻结 `docs/handoffs/OPENAI-STRUCTURED-20261029-task.md`。基线提交 `2fe5318e70e188cf28c15af7867aacf460213d66`，下述文件为工作区差异；施工未提交。Node v24.18.0、npm 11.16.0，build 实际 Vite 6.4.3。

**最新交接：S05 按追加 Q 条款完成返修，自查准备通过，待独立复验。** 新 Q 是独立事实加原两问题，新 smoke 7fake/0real/config0通过；产品未再修改，45/45 与 build 同版结果复用。最新 O/Q 会话分别为 `yO3s6e`、`eklVgy`（完整路径见末尾），无 release/attempt/run-started。真实业务质量仍未执行，不签整体通过。下文首次施工结论、旧会话及旧 SHA 作为历史保留，以末尾返修交接为当前准备依据。

## 首次施工记录（历史）

本轮自查 S01–S04 通过，待 Astra 独立验收；S05 的会话冻结和零调用机械 smoke 通过，**Q 真实可执行性不通过**：主线程/规划者发现原 Q 是全篇纯问题，而既有管线要求至少一个业务事实。fake 为抵达规划机械保留一个事实，不能证明真实分类满足该门槛。主线程将先修订 Q 准备方案，再另派必要 fixture/会话返修；下列 O/Q 会话均保留未放行，当前 Q 禁止放行。真实 O/Q **未执行**，R16/R18 与 B09 整体**未通过**。没有读取 `.env.local`/密钥、启动服务或真实调用，没有修改正式 workspace、Raw 历史、旧会话、status 或验收总表。真实/config/network 请求均 0；知识254/500、Prompt15/24、既有连接1单列不变。外部 AGENTS.md、AGENT-ROUTER 报告及主线程文件排除。

## 实现

- `LlmCompletionRequest.structuredOutput` 由 KB02 facts/planning 两处显式传入，源为本次加载的 bundle schema；不从提示文本解析。Provider 仅官方精确 hostname `api.openai.com`、精确 `gpt-6.1-terra`、knowledge 且显式描述时发送 `response_format.type=json_schema`、`strict=true`。连接、Prompt、其他模型/host及 GLM 既有行为保持。
- 新增小型 `openai-structured.ts`：递归关闭对象、required 全属性，仅原可选属性增加 nullable type（枚举同步允许 null）；原必填类型、枚举、长度/数组数量约束保留。当前 facts schema 没有可选属性；planning 的 templateFields 及其中栏目可选，栏目内部 text/引用仍必填。未修改原 schema 或 validator 支持范围。
- `LlmCompletion.text` 保持原始 Provider content，只增加 `structuredOutputApplied` 标记。管线 parse 原始 content，先验证 wire 形状，仅按原 schema 移除可选 null，再走已有 exact、定位归属、覆盖和事实完整性校验。没有删非法页/字符串页、通用删 null、修补事实或填问题答案。原始响应由 runner 原样捕获，safeRequest 增加结构描述；规范化后的 plan 不冒充原始响应。
- strict refusal、非正常结束、截断和 HTTP/格式错误失败，无自动重试。规则 revision15→16，使旧未完成检查点失效；完成草稿读取和既有 reconciliation 路径保持。
- runner 新前缀隔离会话，冻结本卡、当前入口、产品/rules 与原 O/Q fixture。O255–256 起账254；Q257–258 起账256。首请求失败 smoke 只占首序号、不出候选、不发第二请求。全 questions 原业务门槛未改。
- 定向测试中两处历史 revision13 字符串导致原有断言失真，改为匹配实际加载版本及替换版本数字；不改变业务验收条件。

官方文档本轮打开核验：[Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。账户真实支持与业务语义留待主线程逐会话放行。

## 实际检查

```powershell
node --import tsx --test tests/openai-structured.test.ts tests/provider-knowledge-reasoning.test.ts tests/kb02-pipeline.test.ts tests/kb02-planning-attribution.test.ts tests/kb02-planning-context.test.ts
npm run build
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare output real
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare question real
git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check
```

最终定向 **45/45 PASS，exit0，约1.254秒**。其中新增 strict17项，捕获实际 fetch 两阶段不同 schema/strict/温度；正例 nullable 整对象与嵌套栏目形成实际 Draft；错必填/null必填/错类型/额外属性/遗漏 wire slot/字符串 pages/非法 atom及unit引用均拒绝；历史254仍按实际管线拒绝；Raw、来源事实、程序摘要及未知问题保真；refusal/截断/HTTP/格式错误首请求即停；旧未完成指纹拒绝且完成记录可读。既有 Provider、KB02 pipeline、规划归属和上下文回归通过，其中已有完成 revision6 草稿 HTTP 可读且零调用复用通过。

`npm run build` **exit0**，TypeScript 通过，Vite 214 modules、2.40秒；仅既有大 bundle 提示。`diff --check` exit0（有工作区 LF→CRLF 提示，无空白错误）。

开发期间首次新增15测试为13/15，原因是测试误把原子末尾换行计入事实预期，已按实际切片修正；随后15/15。加入剩余测试后首次45测试为43/45，两处上述历史版本硬编码已修；最终45/45。首次 build 仅新增测试的 DraftRules 缺少显式枚举类型，已修，最终 exit0。没有将失败试跑记成通过。

smoke **exit0**，5 fake / 0 real / config0；两个成功fake各2请求、一个首失败fake仅1请求。检查未放行无 run-started/attempt、会话与序号绑定、原始草稿捕获、重复使用拒绝和首失败停。fake 是机械检查，不是质量结论。

- O fake：`.scratch-OPENAI-STRUCTURED-20261029-Dz6U0C`
- Q fake：`.scratch-OPENAI-STRUCTURED-20261029-DXgoJ0`
- 首失败 fake：smoke 创建的第三会话，result 为 `SMOKE_FIRST_FAILURE`、reserved=sent=1、configReads=realCalls=0，无 attempt-256/candidate-original。

## 新未放行真实会话

| 项目 | O | Q |
|---|---|---|
| root | `E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-WVcVbB` | `E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-FW1KWe` |
| session ID | `83d29e84-b496-44ee-b660-a075fe0eccef` | `5963a79f-80c3-465f-8f9b-1dfed4b91a05` |
| Raw ID | `03408072-e5ba-45ed-8ca9-2d66132a569d` | `27110887-4c16-4d8d-a35e-0782bab546ed` |
| Raw body SHA | `b96e695868d988b832303c361ffa76ccee62dd21e304b5b0b27e6c80936b5e52` | `4f737bfbf39f5529c35a172d82c037fce5abe79f53ab7d5be43d952dfcd7b65e` |
| fixture SHA | `438fabab09a21ecfb1ad57896216d90544a066bb3b7ac09500941e179ca55e2d` | `0a7d5c9c0e6d739e14211324ede375f9bd9616956685385bbcf951ebd88b5188` |
| knowledgeBefore / seq | 254 / 255–256 | 256 / 257–258 |

共同 freeze SHA：`2192f2adac318de88eec72005cfcad6ea4f80d4a700f9508ef7f5a72b5baa929`。各67项冻结文件逐项 SHA 复核 drift0；无 release、attempt、run-started。mode=real、maxCalls=2、promptUsed=15。prepare 只 stdout 给 released=false/budgetApproved=false 模板，无批准文件。所有隔离 scratch 均不提交。

当前 Q 纯问题 fixture 必须先修订并重新冻结，下面 Q 命令仅记录已准备会话，不构成可执行性通过或放行建议。主线程在修订准备独立 PASS 后，按冻结卡明确新4次封顶预算和逐会话 release。O技术及独立O01/O02语义通过才可放行Q；首失败/目标缺证停，不续用旧余量，不重试。运行命令如下，release 文件必须由主线程生成并匹配 session 所有绑定字段及原字节SHA：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-WVcVbB" "<O批准release绝对路径>" "<release原字节SHA256>"
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-FW1KWe" "<Q批准release绝对路径>" "<release原字节SHA256>"
```

## 交接文件 SHA256

| 文件 | SHA256 |
|---|---|
| services/llm/provider.ts | `7c1403e7b5aef91fbd78b857a376bfb05fbb7f03d76991ca13fa5aba91823a1e` |
| services/llm/knowledge-extraction.ts | `16b505f5e8fc576e73a86c5064a64c27c9380b17a91594466bd42da86db46923` |
| services/llm/rules.ts | `4aca99d67d2ed7ea8c62f18facda352db03f31f9b4d0ef353008596dcdd52a91` |
| services/llm/openai-structured.ts | `c757901e907bd5ce848ecafb35b408d5c366430fa087a3fd0d051d47347baac3` |
| tests/openai-structured.test.ts | `cc8bf2841e79a33177f4d86b24e82aee8b987317c29c6e27f6e475159a6790c1` |
| tests/kb02-planning-attribution.test.ts | `3dd8851a88519a6ba5116fdd19f6dd2c570ecab3287499eedc274bc76a765736` |
| tests/kb02-planning-context.test.ts | `e9b91eab3bc8b0bb3745f75a9b81f5c4031bf4052ef48490aaafb8759a90b8b4` |
| tests/acceptance/R1618-QUALITY-20261027-run.mjs | `1d2282ce96f8c9270f1fc26332b1c662a36bdead85769c672868188f42cc4337` |

以上8个产品/测试/runner文件及本报告归本施工实例；任务卡归规划，status及提交归主线程。交接后停写，等待独立验收或明确返修任务。

## S05 执行前 Q 返修交接（当前）

依据规划者追加的“执行前修订 Q”，本轮仅新增 `tests/acceptance/OPENAI-STRUCTURED-20261029-question-fixture.json`，修改 runner 的 question profile、机械 atom 独立性核对、精确 gate 和 smoke，以及本报告。没有改产品代码、旧 fixture、旧会话或旧证据。7个既验产品/定向测试文件 SHA 与首次施工一致，45/45、build 及 Astra S01–04 PASS 可复用；本轮不重跑。

新 fixture 的 title/sourceType/sourceName/joinWith 与旧Q完全一致，quotes 后两项与旧Q原字节内容一致；拼接正文与追加任务卡引用逐字一致。实际现有切片器确认三 atom，fragment 全 false：

| atom | 区间 | 原文 / 目标 |
|---|---|---|
| c1-a0001 | [0,35) | 【虚构】门店补货流程由门店提交补货单，计划员核对库存后形成补货安排单。 / 独立业务事实 |
| c1-a0002 | [35,64) | 【虚构】以下是门店补货流程的待确认问题：异常补货由谁审批？ / 第一个完整未知 |
| c1-a0003 | [64,83) | 该审批应在提交补货单之前还是之后完成？ / 第二个完整未知 |

prepare 新 Q 另存 `question-atom-targets.json`。规划前 gate 要求第一 atom 存在事实unit；两个问题分别且完整存在精确 source/text 的 question unit，且该 source 不存在任何 fact unit。结果记录 `question-only-gate.json`，不再以“有一个不重叠问题”代替双问题核验。失败发生在规划真实请求预约/配置读取之前。fake 现只把独立业务事实atom分类为fact，两个问题均只分类为question；未改产品提示或规则。

实际命令：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare output real
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare question real
git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check
```

唯一新 smoke exit0（约1.740秒），**7 fake / 0 real / config0，8类机械检查通过**。成功 O/Q 各2请求；首技术失败1请求；Q缺第二问题及Q第一问题双轨两个反例各1请求，均 `QUESTION_ONLY_TARGET_NOT_OBSERVED`，无 attempt-258 或 candidate-original。成功Q的units为 `fu-0-35-fact`、`qu-35-64`、`qu-64-83`，gate passed=true，两个questionOnly=true；Draft/open_questions及renderedBody保留两问题，source_facts只有独立事实，不补答案。fake不证明真实模型会遵循。

- 新 O fake：`.scratch-OPENAI-STRUCTURED-20261029-g0r7z5`
- 新 Q fake：`.scratch-OPENAI-STRUCTURED-20261029-wL3eGG`
- 缺第二问题 fake：`.scratch-OPENAI-STRUCTURED-20261029-BZbDF0`
- 问题双轨 fake：`.scratch-OPENAI-STRUCTURED-20261029-9lTAAL`

新真实会话（均仅准备，未放行）：

| 项目 | O | Q |
|---|---|---|
| root | `E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-yO3s6e` | `E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-eklVgy` |
| session ID | `5a9ebe21-1138-4ccc-9ca2-6051e681ab70` | `f8fc6440-3848-41fd-9b0d-e02503950f5e` |
| Raw ID | `23cc2c38-ea97-4ed0-b876-b86755db0bab` | `a17bb134-3a7d-4dd0-b550-f8b4cb44070f` |
| Raw body SHA | `b96e695868d988b832303c361ffa76ccee62dd21e304b5b0b27e6c80936b5e52` | `50cb67d17bcdb4affbe5d914c06aee967f02d047bb03b52ba018398547fbb47a` |
| Raw file SHA | `946dc7dc264d72ec487c9c04f34ae289dd82541e2dd57c0e6edbc323e0cd1b99` | `1510ef6482460efc539e8dfffb67ca6e69ffa53bb772d172414dde8dc8e371a9` |
| fixture SHA | `438fabab09a21ecfb1ad57896216d90544a066bb3b7ac09500941e179ca55e2d` | `29f7b7e28498895c5f8508711f939540b6c37c1c1607c5e6dd1dcc48c088e623` |
| knowledgeBefore / seq | 254 / 255–256 | 256 / 257–258 |

共同新freeze SHA `5ba9e4499e01326f3232605b734ff4a68344037967211ef6b448384dd6c6d75d`，各67项冻结逐SHA复核 drift0，无release/attempt/run-started。任务卡 SHA `14a43d95c70670c451d030904832470fc9eb792838a93bed2c6e47acb0047b8f`；runner新SHA `9db4f0056ea75d385f34efbc69a0909ee53373471fc84ebb915022abdc34d524`；新Q fixture SHA见表。旧 `WVcVbB` / `FW1KWe` 两会话保留，无release/attempt/run-started，旧freeze失效不得放行。

独立准备 PASS 后，仅由主线程按既定四次新预算、O技术/语义通过后才放行Q及首失败停机制执行：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-yO3s6e" "<O批准release绝对路径>" "<release原字节SHA256>"
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-OPENAI-STRUCTURED-20261029-eklVgy" "<Q批准release绝对路径>" "<release原字节SHA256>"
```

真实/config0，知识254/500、Prompt15/24及连接1单列不变。施工返修完成并停写，交 Astra S05 独立复验；真实O/Q及R16/R18/B09整体结论保持未通过。
