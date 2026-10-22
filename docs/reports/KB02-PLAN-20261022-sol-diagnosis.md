# KB02 规划返修：Sol 有界诊断与最小方案（2026-10-22）

阶段为诊断完成、待 Astra 审定具体实现；未改产品或默认 tests，不签批次验收。实际真实调用新增0，累计仍104/200；Prompt15/24。本轮仅读取原始虚构资料及本机离线重放。

## 接手与证据

基线 `KB02-PLAN-20261022-sol-baseline.json`：99产品、72默认测试支持、2806历史报告/验收脚本/正式数据保护文件、6根配置摘要、62正式workspace文件。不展示密钥；主Agent可变文件为status/agent-control/coordination。Git发现大量既有未提交变更，仅用进程级safe.directory读取，不修改全局配置或回滚。

依据：KB02任务卡、interface、architecture相关段、coordination、agent-control与原 `KB02-FINAL-REPAIR-AUDIT-20261022-acceptance.md`；原 quality/trace/checkpoint/raw 均只读。诊断脚本 `tests/acceptance/KB02-PLAN-20261022-sol-diagnose.mts` 与候选助手 `...-context-poc.ts`，结果 `KB02-PLAN-20261022-sol-analysis.json` 含全部106条长文和6条补充记录的原文[start,end)、原ID/分类/文本、预期区域、实际页名及错归标记。候选输入完整保留于 `...-seq100-candidate-input.json` 和 `...-seq104-candidate-input.json`。

## 事实证据与原因边界

1. seq100规划输入与checkpoint映射逐项相等：81事实/25问题，输入仅id/text/kind，所有精确位置与原文上下文均未传入。25问题文本完全相同，但来自14个不同原文位置。省略主体的“此区域”“异常审批负责人未知”不能从其文本唯一定位区域。
2. 原始响应14页按chunk编号归组，13页共50条记录错归到相邻区域标题。页面区域01包含区域02的f-c1-4及其省略主体约束；此后相同模式延续。原始响应漏q-c6-1/q-c6-2；程序严格拒绝正确。
3. 按精确atom全局位置与分栏统计，同源跨块重叠50组、50额外记录（全部保留在本次方案中）。现有evidenceSignature含chunk-local atomId和locator区间，实际同一atom位置在相邻chunk的这两项不同，无法识别同源；仅删除atomId仍不足以处理不同locator边界。相同文本不等于相同位置。
4. seq104输入4事实/2问题均存在，遗漏f-c1-2是业务口径边界；响应保留同一原文的q-c1-1，却漏事实ID。事实和问题在同一原文双栏出现合法，两种ID必须分别覆盖。没有证据支持将其降为非业务声明。
5. 已用实际runKnowledgePipeline和离线Provider原响应重放两失败，均得到LLM_PLAN_COVERAGE_INVALID、无plan，诊断与原cp一致。不修改原错误响应。

可证实根因是规划输入移除了已验证来源位置/上下文与同源关系，ID含chunk而请求未明确禁止以chunk号作为主体，造成可避免的歧义与分组诱因；具体模型内部为何漏某ID不能从日志证明。seq104的业务/待确认引导与双栏竞争是合理推断，而非已证实唯一原因。扩大推理档/Provider、自动重试或过滤业务记录不属于方案。

## 最小实现方案（待主Agent审定）

- 新窄模块 `services/llm/knowledge-planning.ts`：由已验证atom映射精确位置，生成sourceId=s-start-end；facts/questions保留每一原ID/text/kind并引用sourceId。sourceContexts按原位置排序，包含start/end、contextStart/contextEnd、连续原文text和同原文位置的全部factIds/questionIds。不根据业务词、区域编号或标题解析主体；不删记录、不改Raw、不更改事实分类。
- 上下文仅前256/后128个UTF-16代码单元，必要时各扩1单元避免切断代理对；区间不越Raw，逐条原样切片。上下文只帮助模型定位，不转为新事实，不发送整块或全部Wiki。同文本不同位置使用不同sourceId。
- `knowledge-extraction.ts`仅接线规划输入与规划指令。强调chunk号不代表业务主题、跨块同源ID全部归于相同主题、不同原文位置不可合并丢ID、ambiguous/否定/未来/待确认业务边界也必须保留，同源双栏必须分别覆盖。保留响应schema和coverageDiagnostic原校验，严禁响应后补ID。
- 新增上下文属于新发送内容，完整planning payload（含可选coverageFeedback）发送前执行已知秘密扫描与192KiB检查；失败在Provider/外发记账前停止，已有提取cp保留。零预算公式或存储队列变动。
- `rules.ts`仅revision6→7，让旧未完成检查点明确409、保留原字节、用户显式restart重建。persisted checkpoint/pipeline kb02-2、DraftRecord、API/UI、更新双侧约束均不改，旧完成草稿可读。

候选助手已实际运行：长文42个sourceContexts，65149 UTF8字节（旧10670）；补充5个，3701字节（旧741），均低于196608。18项检查全部通过，包括原失败重放、全部ID/text/kind逐字保留、精确上下文/范围、全部106长文记录局部前文可见其实际区域、不同位置同文不混并。候选payload未送真实Provider，因此不能证明真实模型将正确规划，仍需独立真实复验。

## 文件与回归范围

产品限定上述3文件；新默认 `tests/kb02-planning-context.test.ts`。旧 `tests/{kb02-classification-priority,kb02-extraction-contract,kb02-final-classification,llm}.test.ts` 仅迁移revision断言，共5处。旧报告/脚本/fixture不改；新增独立前缀脚本和报告可继续记录。

新回归覆盖：精确上下文及UTF16边界；同文不同位置/同位跨块/事实问题双栏；所有输入完整可定位；原seq100/104坏响应仍拒且无草稿；受控全覆盖14区域跨chunk组装；业务口径保留；192KiB完整payload超限和上下文含秘密均Provider前拒；规划失败显式仅重规划及预算不回退；旧规则cp拒绝/显式restart/旧完成草稿兼容。定向回归分类、双侧更新、S01、SR01读写存储与安全链，最终同字节隔离副本完整工程test/tsc/Vite。fake仅证明数据流与门禁；原106400长文及补充更新浏览器完整链留Astra独立真实验收。

## 操作校准与剩余风险

最初新完整性脚本有多余括号，运行在baseline前报语法错误，修正后基线成功；首次只读trace探查误用seq字段（实际sequence）报TypeError。均无Provider调用。普通沙箱写新脚本修正被拒，按工具require_escalated获准后仅写本轮前缀；未更改ACL。

扩大上下文会增加规划字节/Token，仍必须按原上限拒绝，不能截断或抽样；一般资料主体可能不在有界窗口内，不能承诺所有语义主体可由程序识别。保留全部重叠ID会保留既有重复事实显示行为，本方案只提供同源关系帮助规划，不引入事实去重或更改历史数据。真实漏ID/区域错归关闭仍待Astra独立证据，施工者不得自签PASS。
