# R4 GLM JSON模式最小适配决定

主Agent于2026-10-14批准Luna在既有knowledge/官方host/精确glm-5.3-flash条件分支追加 `response_format: {type: 'json_object'}`。普通请求、其它host/model、连接测试及Audit/Brief/Prompt链不变；不调整temperature/top_p、timeout、并发、调用预算、schema或重试。真实配置只读，全部虚构隔离。

此前失败的chunk2原wire仅增加该参数：15493ms、HTTP200/stop、合法JSON、locator-v2完整schema零错误、3页。证据见 `KB01-R4-20261014-json-diagnostic.json`；前一失败 `real-http.json` 与原trace保留。这是一次受控单变量对照，不能推断所有长文或领域输出稳定。

今日一手依据：[结构化输出官方文档](https://docs.z.ai/guides/capabilities/struct-output)说明json_object参数及客户端schema校验；[GLM-5.3-Flash官方页面](https://docs.z.ai/guides/vlm/glm-5.3-flash)标明结构化输出支持。JSON模式不代替本项目字段、枚举、证据与凭证门禁，不接受剥代码块、修补JSON、删错误页或改成首匹配。

累计预算当前21/40：历史12产品+4诊断，R4产品4+本次诊断1；剩19。最终同Raw长文最多14块+1汇总，补充提取及更新最多2次；不再盲目重复全链。最终必须实际测量并保留失败；预算用尽不能补签。
