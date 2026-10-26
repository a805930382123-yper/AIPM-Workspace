# SYN01-RECHECK seq243 原稿独立质量裁定

2026-10-26，Astra medium。**原稿质量未通过，不能继续本轮人审正式化；应保留原稿并停止。** 新v1结构、分类、引用定位已实际通过，但语义完整性和逐条来源支持未通过。SYN01整体未通过，全产品/B09未通过。真实保存/确认/刷新回读 **NOT_RUN**，不得以人工补写掩盖原稿失败，不再调用。

## 证据与版本

只读脱敏 [原稿导出](SYN01-RECHECK-20261026-export-1792985404518.json)，SHA256 `2c7bd005e904ac31c23000cb4b609b7642f1584079c42cd328ceecde5bfbe573`。原候选 `b7573dba-2d3e-4469-9409-7f12b67220db`，revision1/pending_confirmation/approvals0，Wiki为空。导出status记录序号243 completed、real1/config1/fake0、知识243/500、Prompt15/24；completed只表示合法草稿生成，不能表示独立质量通过。pending预占记录保持不可变，不表示尚可重试。

产品提交 `d0553163a09f3ac5f4681430e398e7ef2b2d934a`，产品文件SHA `b3269a215ed042b6822a2b77320d3cd2be60d0c40797b7cce50794e8047efbc9`，新增工程受测基线 `1944a3053df9b966f9cd39b273deec76b4e60f63`；108冻结沿用工程报告 `5c5d46175823a03b1be133a1a15889e2518360c827d53a029d6b4e925a335724`。本轮质量裁定没有再跑工程或读取私有配置/响应。

## 逐项裁定

| 项目 | 结论及依据 |
|---|---|
| v1结构与分类 | 通过：原响应恰好八字段，数值version1、category=metric、五数组存在，9个事实条目均严格text/rawId/locatorId；finishReason=stop。没有补字段或改原响应。 |
| 目录与来源定位 | 通过：9/9 locator与对应Raw ID及正文SHA绑定；保存证据精确等于当前目录的连续原文。A为[0,99)，B为[0,104)，Raw正文与固定fixture一致。请求SHA重算与attempt一致。 |
| 共同100及口径 | 集合内容保留2026年9月、虚构清禾区域、100家和在售/目标门店公式，双来源都有证据；但agreement[0]自身跨来源断言超出单条引用，详见下项。 |
| 双方冲突 | 集合保留A20家/20%和B30家/30%，未平均或静默覆盖。conflicts[0]却仅引用A全文并断言B30%；conflicts[1]仅引用B全文并断言A20%。均未按提示只陈述所附来源支持的最小断言。 |
| 逐条支持 | **未通过**：agreement[0]只附A，却写“资料B同样记录……”；上述两conflicts同样复合了另一来源事实。跨条集合存在B/A不能使单条证据自动支持另一Raw。宽locator不跨Raw，不能借它消除该缺陷。 |
| 未知/推断区分 | 采样日是否一致、异常审批负责人未确认都保留在openQuestions；负责人也作为“尚未确认”的来源陈述保留。采样时间/门店范围可能不同写入inferences并要求验证，没有改成已证实原因。“需指定责任人”为问题中的行动建议，未伪造已指定责任人。 |
| 未来AI边界 | **未通过**：五个语义section的所有text/字符串均遗漏“AI辅助审批仅为未来分析建议、尚未上线、收益未知”。这些字句仅被整篇Raw的宽quote被动带入，不是综合正文有意保留，不能当作该固定oracle通过。 |

agreement[1]的B目标100及B公式可由B原文支持，suggestedAdditions五条均可由各自附Raw支持；这些局部通过不抵消上述缺陷。没有将“遗漏未来AI”夸称为模型明确声称AI已上线；实际问题是规定内容缺失。

## 实际离线核验

执行 `Get-Content docs/reports/SYN01-RECHECK-20261026-export-1792985404518.json` 阅读完整原稿，并通过PowerShell here-string管道执行一次 `node --input-type=module` 离线断言，exit0/工具0.687秒。检查逻辑为：

```javascript
// e为唯一脱敏导出，req为request.user，o为response.text，c为candidate-original。
assert.deepEqual(Object.keys(o).sort(), ['synthesis_format_version','title','category','suggestedAdditions','conflicts','agreement','inferences','openQuestions'].sort());
assert.equal(o.synthesis_format_version,1);
assert(req.categories.some(x=>x.id===o.category));
// 对3事实数组全部9条：严格条目字段；在对应Raw目录查locator；
// 重算body SHA及raw-${SHA(JSON.stringify([raw.id,raw.bodySha256]))}-1；
// 核candidate同section/index的text/rawId/quote/start/end完全相等及slice===quote。
// 对双Raw核固定fixture全文相等；核原候选无approval且wiki.length===0。
```

实际输出：bindingCount9、全部valid=true；五section语义字符串 `semanticMentionsFutureAI=false`；原导出SHA如上；重算请求SHA `0aa1be08b66290f03fb651c1e55fbf0e2c75a4294f90567c69d5d76193a2936b` 与attempt一致；revision1/approvals0/wikiCount0。exit0表示这些离线事实断言完成，**不是质量PASS**。语义结论来自逐条对照完整正文，不仅依赖关键词检测。

## 双层结论与下一步

局部：前轮F01–F05工程及本轮新入口工程通过保持；本次真实证明结构/分类/定位契约可生成合法草稿。新的真实语义完整性、逐条支持仍失败，本轮未修产品，不能称全部缺陷关闭。

整体：SYN01本次原稿质量未通过，正式确认回读不执行；旧242失败原件与本次243失败原件都保留，全产品其他阻塞不变。主Agent已收到立即停止正式化的消息。人工编辑/补写 **NOT_RUN**，没有人工版本可评通过。

下一最小建议为先基于243固定原响应做零调用语义根因诊断，区分遗漏必保内容与单证据复合断言，再裁定最小方案；不直接再次真实尝试或继续调整提示追求通过。本报告不授权新施工/预算。主Agent收尾export/status/stop并关闭自有Chrome，记录实际服务退出与零正式写入；当前真实额度已用尽，后续授权0。
