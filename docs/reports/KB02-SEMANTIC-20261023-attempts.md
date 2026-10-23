# KB02 SEMANTIC 施工首失败与处置

以下为实际观察，未将已修的夹具/环境问题冒作模型语义证明。

- baseline 首次沙箱写报告 EPERM，尚未改已有产品；按授权范围提权同一脚本成功。两新增产品文件在成功落 baseline 前已创建，此限制在交接披露。
- 首次 `npm run build` exit1：`tests/kb02-pipeline.test.ts(1,1): error TS6133: 'semanticReviewReply' is declared but its value is never read.` 初始工具输出保留；两个 pipeline fake 补审核分支后修正。
- related-first exit1，完整 stdout/stderr 保留。新增调用使旧 fake 按提取/规划两类解析失败，或旧次数断言差1；预算原“剩一可规划”断言须按已批准“至少预留两次”新契约调整，保留成功块/同job/coverage诊断与零写入检查。
- `adapt-counts.mjs` 首次 exit1：`tests/kb02-source-assignment.test.ts missing assert.equal(f.requests.length,1);}\n await validateKnowledgeCheckpoint`。只有先前明确匹配的直接测试已更新，无产品改变；source/SR01 后续以精确锚点局部修正。
- related-second exit1，仅剩 EDGE 三个新增调用次数断言；精确+1修正，不改原文/ID/UTF16/证据断言。
- semantic-first exit1：错误地断言 Provider 在序列化前持有的对象应被冻结。产品实际对严格解析后对象冻结，测试改为原对象篡改不影响审核/保存，并另直接实测真实候选深冻结与跨候选必须重新调用。
- build-second exit1：新语义测试未使用的 `validateKnowledgeCheckpoint` 导入；移除后最终 tsc/build通过。
- semantic-second exit1：单unit正例分号被原 atom 规则拆为2个unit；用不含句内分隔符的同义虚构正例验证单unit，Astra冻结203字符正例仍原样保留并单独验证完整ID。
- semantic-capacity exit1：初始30句夹具加候选仍未达到审核192KiB边界；调整为固定33句后原规划可容纳、审核超过上限，断言零审核调用/计账、完整块保留；semantic-capacity-second实测通过，最终完整默认也覆盖该项。
- full-first exit1：414/420，0skip；1新正例夹具（上述已修）、4新增调用计数（UI/HTTP/repair3）与1源目录配置影响的无配置断言。原断言保留，必要fake/count适配后，隔离副本不含正式配置，最终424/424通过。
- full-first 写历史 `B04-http-evidence.json` 的偏差已立即报告主Agent。生成字节另存，原字节经 baseline/HEAD双核一致后单文件恢复；后续默认/build/Node24/历史全部隔离。见sideeffect-restoration.json及closure.json，不覆盖无关修改。

最终必要运行均exit0、零跳过，完整日志/耗时/命令在各JSON和同名log；无真实模型调用。无新增自动重试或第二审核器，施工完成不构成独立验收通过。
