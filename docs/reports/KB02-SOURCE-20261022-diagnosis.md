# KB02 同源跨页错归离线诊断与窄方案

诊断执行：`node --import tsx tests/acceptance/KB02-SOURCE-20261022-diagnose.mjs`。无网络、真实调用0。首次沙箱PowerShell写脚本被拒、随后apply_patch成功，诊断命令按批准路径提权成功；原失败不隐藏。

## 真实离线复现

依据只读 `KB02-PLAN-AUDIT-20261022-provider-trace.jsonl` seq121、long-checkpoint.json、same-source-split.json、quality.json。输出证据 `KB02-SOURCE-20261022-diagnosis.json`：79事实、25问题、42来源区间；当前coverageDiagnostic所有missing/duplicate/unknown/duplicateTitles均空，错误pages与持久checkpoint完全一致。48个重复分配组中仅一个跨页：s-45613-45652/facts/kind=fact，f-c6-3与f-c7-1精确文本均为区域07的17%事实，被分至区域06/07。

## 根因与可证明边界

sourceId、同源ID及原文上下文已完整发送，故不是缺少上下文。输出仍以机械chunk绑定的单ID自由分配；同源规则只有自然语言，schema及coverage并未表达同一等价记录不能被拆分的硬契约。持久恢复只检查原ID覆盖，能重放错误计划。无法据此证明模型内部注意力或chunk锚定是唯一原因。

## 最小方案（待主Agent最终开工裁定）

1. 在发送前按精确Raw位置、精确text、分栏和事实kind生成确定性分配unit，固定member IDs。仅语义等价的重复全文记录同unit；同文异位置、fact/ambiguous及facts/questions均独立。原记录不删、不改。
2. 采用清晰version3输出，pages引用factUnitIds/questionUnitIds；不允许旧v2回退。模型只决定每个unit的唯一页归属，禁止独立拆分unit成员。
3. 严格schema、ID语法、unit未知/重复/遗漏及标题门禁全部通过后，才按外发前固定members展开原ID，再作原ID完整覆盖校验。展开是输入契约，不是遗漏后的补ID。
4. 持久plan保留原结构；恢复重建unit并检查同unit成员归属一致，严格页面元数据可按当前wire schema作无损反向投影验证。规则revision升级，旧未完成checkpoint明确409；旧完成草稿按既有链兼容。
5. 所有unit/context/feedback纳入原秘密及192KiB完整请求检查；不自动重试、不变预算，不新增Provider调用。

同一atom可能包含多个业务断言，但当前产品只保存整段精确text，没有语义projection；一段原文记录本来即只能一个主归属。重复整段且同kind不能伪装不同业务projection而合法跨页。不同业务记录（不同text/位置）、事实与问题及不同kind可合法分主题。该方案不声称能够通用判定页面标题是否正确；把整个unit分至错误区域仍需独立真实质量验收，拒绝坏响应不是质量完成。

## schema消费者与精确拟修改范围

产品4文件：services/llm/knowledge-planning.ts、knowledge-extraction.ts、rules.ts、rules/kb02-planning.schema.json。schema生产消费者仅loadExtractionRules（校验与版本指纹）、runKnowledgePipeline（Provider输出）、validateKnowledgeCheckpoint（持久plan兼容投影）；legacy locator提取/merge仍使用独立wiki schema，不改变其协议。

测试直接契约适配：tests/support/fake-llm.ts、tests/support/kb02-storage-fixture.ts、tests/kb02-planning-budget.test.ts、kb02-pipeline.test.ts、kb02-r2.test.ts、kb02-planning-context.test.ts、kb02-extraction-contract.test.ts、kb02-final-classification.test.ts、kb02-classification-priority.test.ts；tests/llm.test.ts仅revision断言。tests/llm-flow.test.ts若新system仍保留原ID输入说明可不改原factIds检查。历史acceptance probes与旧夹具只读不改。

新增默认入口tests/kb02-source-assignment.test.ts；新增本轮真实夹具与本前缀诊断/运行/冻结脚本。旧seq100/104响应不再当有效v3：仍测试原严格遗漏拒绝语义，旧v2原响应独立断言schema拒绝；另把错误规划投影为完整v3遗漏单元响应，保留漏ID/无plan/提取不变与显式恢复断言，不删断言。

必测原seq121/全ID、重复unit/未知/遗漏、完整组错页反例（不谎称已识别通用语义）、多业务atom、fact/question/kind、异位置相同文本、当前规则损坏plan恢复、旧版本409/完成草稿兼容、秘密与192KiB、默认完整/tsc/Vite、旧Node24.19原SR01及相关套件、历史独立probe单列。
