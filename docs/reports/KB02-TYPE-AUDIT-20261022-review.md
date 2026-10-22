# seq148独立诊断裁定与A/B建议

**确认Sol诊断中的故障机制，建议下一施工采用A模式：Luna施工、Sol先审计划并独立验收。当前仅诊断，未授权施工。** 精确缺陷四维评分3/8；广义历史4/8有背景依据但不宜用来宣称本缺陷修复后复发，两种分数均落在通用规则的“优先A、Sol先审计划”。未发现需要直接B的重大跨模块数据完整性、安全或新兼容机制风险。

## 两层状态

1. **本轮缺陷状态：未修复。** F-KB02-EDGE-PLAN-01/P1的观察机制已被独立确认，但本轮无产品/default tests修改、无真实模型对照；不能标修复PASS，也不能承诺候选Prompt根治。
2. **KB02整体：未通过。** 原短文规划失败无草稿，完整补充更新链仍NOT_RUN。前轮空白sourceNotes与Wiki同项缺陷在原报告有限范围内关闭，未因本次新故障重开；搜索乱序P2旁支仍未修、不纳候选范围。

代码基线HEAD **b852904d3cacbb97205f57d425e0746cf47c802d**；对应产品提交 **420e123997c9fffc179af7bf32bd361ed341b9a9**。独立执行 `git diff 420e123 HEAD -- services rules app` 无差异；工作区产品/default tests无改动。新增AGENTS的两层结论及命令/提交证据要求已遵守。

## 已证明及不可证明的边界

原seq148 HTTP200/stop响应第二页的type为ai_application；该值是category合法项，不是type合法项。原请求内嵌schema、当前加载schema、FMCG枚举一致，type正确限制concept/entity/business_process/metric。4事实unit与1问题unit可从原checkpoint精确重建，请求逐字一致，响应没有unit未知/遗漏/重复。因此本例直接结构阻断点是一个type枚举错误，不能归为ID覆盖丢失、错误枚举发送、空白atom或网络问题。

实际Provider在完全内存fetch拦截下重建相同wire，temperature0、reasoning_effort low、response_format json_object；未发送json_schema协议约束。适配器原样返回content，没有字段映射。`services/llm/knowledge-extraction.ts`先严格schema校验再展开unit、保存plan及组装，故坏响应不进入草稿。测试夹具单独把type改concept能通过，只证明观察到的结构阻断局限在该字段；不是产品修补，也未证明concept为此主题的最佳语义类型。

可直接观察到规划Prompt侧重unit/覆盖，type/category除schema外没有独立职责说明及配对示例。**这只是合理改进位置，不是模型内部因果证明。** 不能从一个样本断定注意力、AI主题词或复制category是唯一根因；也不能保证temperature0/json_object或增加示例后不再出错。供应商结构化schema能力未验证，不能作为既成修复方案。

## 恢复语义独立核实

- 普通显式继续 `{}` 对当前兼容记录复用同job和成功提取块，每次只做1次规划，累计2→3→4，无新提取、无后台补发；失败仍无plan/draft。返回reused=false表示本次执行启动，不能解读为未复用提取块。
- `{planningRetry:true}` 仅用于完整提取且带coverage diagnostic的LLM_PLAN_COVERAGE_INVALID。本例LLM_SCHEMA_INVALID不满足门槛，409 LLM_PLANNING_RETRY_UNAVAILABLE，调用0且job/checkpoint/raw-state三文件不变。
- 规则不兼容的普通继续409且调用/写入0；坏type持久plan恢复409 LLM_CHECKPOINT_CORRUPT。未来Prompt revision变化仍需显式restart，不可手工重绑定旧checkpoint绕过兼容门禁。

上述由源码 `services/llm/jobs.ts` 的startOnce/resume/专用入口条件及独立本地Runner重放同时支持。Sol首败对reused的误读已纠正，原首败保留；最终证明不依赖该错误标志假设。

## 独立评分与模式

| 维度 | 分数 | 证据 |
|---|---:|---|
| 需求明确度 | 0 | 字段合法枚举、严格拒绝、无自动修补及完整质量门槛明确。 |
| 模块耦合度 | 1 | 最小候选触及规划Prompt与已有规则指纹，须回归恢复兼容；不改Provider/存储协议。 |
| 修改风险 | 1 | 文本变化会影响全部规划输出并令旧未完成记录不兼容，但已有显式restart机制，无拟议新增兼容机制。 |
| 历史失败 | 1 | 此精确type/category缺陷第一次观察，尚无针对此缺陷施工后再失败；不能将不同核心缺陷计为其复发。 |
| 合计 | **3/8** | A，Sol先审计划后Luna施工，Sol独立验收。 |

此前4/8把“整个规划质量链多轮失败”计历史2，作为未定位前的保守背景有证据；诊断后以本次最小工作单元评分3更精确。降低一分不是否认历史失败，也不放宽长文/更新链门槛。若用户另行明确选择B则遵从用户选择，当前不因上一轮B而永久锁定。

升级触发：同一type/category核心缺陷修复后真实再次失败，立即停盲试，由Sol诊断后重新评分/交Astra重规划；若要改变Provider结构化模式、共享六链、schema/存储/自动重试/兼容策略，必须重开范围并评估B，重大完整性或安全风险直接B；若业务类型含义出现关键歧义，先Astra澄清再施工。无证据不得提高调用上限碰运气。

## 候选最小范围与验收门槛（待施工确认）

产品候选仅2文件：`services/llm/knowledge-extraction.ts` 的规划system构造，`services/llm/rules.ts` revision9→10。说明type为知识形态、category为业务主题，各自从当前schema/FMCG生成允许项与适当语义标签；给metric/metric和concept/ai_application等有效配对例，示例以当前枚举验证。不同值例用于解释字段独立，不强制AI主题总是concept，不把例子变成覆盖业务判断的硬编码，不引用seq148 Raw/ID。

不得改atom提取、unit v3、Provider、schema、响应值、持久结构、预算/重试、UI或搜索旁支。额外helper/文件须先说明再裁。必要默认测试候选新增 `tests/kb02-planning-fields.test.ts`；既有revision迁移限 `tests/llm.test.ts`、`tests/kb02-extraction-contract.test.ts`、`tests/kb02-classification-priority.test.ts`、`tests/kb02-final-classification.test.ts`、`tests/kb02-planning-context.test.ts`、`tests/kb02-edge-extraction.test.ts` 中实际需要的**6处文件**，不能沿用“只有5文件”的旧数量漏掉EDGE新增的revision9断言。历史夹具/报告不改，旧规则测试保留真实旧版本含义。

离线门槛：原seq148响应仍拒绝且提取/Raw不变无草稿；动态枚举及配对例一致；互换/非法type、合法交叉组合、unit全覆盖和同源归属；当前坏持久plan、旧revision9未完成409/零写入、显式restart、旧完成草稿兼容；普通继续与专用入口区别，秘密/192KiB/计数预算/取消恢复；完整默认0skip、tsc/Vite、旧Node和历史独立probe。不得将测试假响应通过当模型质量通过。

真实门槛：原短文2调用→真实Chrome明确创建metric并人工备注→原106400字符14块提取+规划15调用→补充2→明确选旧目标/更新预览1，独立核对20%/30%冲突、共同观点双侧证据、原文/双来源/人工备注后显式确认与刷新持久回读。全部ID、主体/日期/数值和不同位置/kind/栏位独立保留。因整体revision变化和规划提示改变，本建议不通过改旧checkpoint只重放1次来代替产品正常新流程的15次长文验收。

**调用仅估算：必要20次，从163预计到183/200。** 可供主Agent考虑阶段硬上限24（最多187），余量不自动重试；这是建议而非放行，当前0外发，Prompt15/24不变。工程冻结及独立通过后仍须主Agent真实门禁与具体阶段批准；同核心失败停试，依赖链失败不得建替代目标。

## 实际独立命令与保护

使用已读code-review技能分开核对Standards/Spec：Standards无产品越界、历史改写或角色自签；Spec确认上述可证明机制，并指出候选测试文件计数应为6而非沿用5。没有修复成功主张。

`node tests/acceptance/KB02-TYPE-AUDIT-20261022-run.mjs` exit0，内部实际命令：

- `node --import tsx tests/acceptance/KB02-TYPE-AUDIT-20261022-replay.mjs` exit0：原wire/文本/schema/单错误、10字段反例、管道、坏plan/旧规则门禁通过。
- `node --import tsx tests/acceptance/KB02-TYPE-AUDIT-20261022-recovery.mjs` exit0：本地Runner普通继续/专用入口/不兼容门禁与三文件字节检查通过，临时fixture已清理。

为防覆盖Sol报告，先复制探针至独立AUDIT前缀再执行，原DIAG文件全量纳哈希保护；没有网络入口，Provider调用均为内存fake。已知Windows沙箱rename限制通过正常工具审批执行离线临时fixture，不修改ACL。完整[运行/保护记录](KB02-TYPE-AUDIT-20261022-verification.json)核对3404文件，变化0；独立[replay](KB02-TYPE-AUDIT-20261022-replay.json)/[recovery](KB02-TYPE-AUDIT-20261022-recovery.json)及日志保留。未重跑无代码变化的全套工程；当前新增真实0、累计163/200。未启动服务/浏览器，未写status/agent-control或提交Git。
