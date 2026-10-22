# KB01真实Provider对照诊断

2026-10-14，主Agent使用FULL3原虚构提取请求，仅通过只读实际配置向原主机发送3次诊断，未改产品/真实配置/正式数据。

| 请求 | 结果 |
|---|---|
| 完全原wire（temperature0，省略reasoning_effort） | 再次60009ms超时 |
| 原wire只加reasoning_effort=low | 40484ms，HTTP200/stop，8页，JSON及完整提取schema通过，reasoning_tokens52 |
| low＋temperature1/top_p0.95/JSON模式 | 51797ms，HTTP200但document增加未允许字段，schema8处错误；不采用 |

这是单一有控制参数的样例对照，支持低推理档可改善当前请求，不证明所有超时唯一根因或通用成功率。schema合法不代签证据/语义，后续真实产品端到端仍必验。

官方依据：[GLM团队README](https://github.com/zai-org/GLM-5/blob/main/README_zh.md)说明5.3/5.3Flash提供low/high/max，省略默认max；[模型官方页](https://docs.z.ai/guides/vlm/glm-5.3-flash)说明thinking只能enabled并支持结构化输出；[JSON模式说明](https://docs.z.ai/guides/capabilities/struct-output)说明JSON对象仍需字段和客户端校验。仅依赖这些一手来源，不依赖第三方建议。

主Agent批准Luna最小施工：LlmRequest显式purpose=knowledge，仅官方host精确open.bigmodel.cn/api.z.ai与精确glm-5.3-flash模型匹配添加reasoning_effort=low。wikiExtract chunk/documentMerge和knowledgeWorkflow update/synthesis传purpose，连接测试/Audit/Brief/Optimizer/其它主机或模型不改原请求行为。原temperature0、超时、取消、JSON/schema/凭证、来源门禁均保留；不放宽证据、不去代码块、不自动retry/fallback、不修改用户配置。

独立报告需用实际服务/请求trace证实作用范围，六链安全/配置快照回归，真短文/更新/长文策略及浏览器闭环分开验收。diag为3次，后续真实child最多21次，合计最多24。
