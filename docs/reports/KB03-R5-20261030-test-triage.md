# KB03 R5 默认测试失败独立分类

2026-10-30，只读核施工初次npm-test-before.txt（TEMP kb03-r5-builder-7b175490-c6c0-4924-a54b-748205680022）。实际601项529PASS/72FAIL，不是最终结果，未提前归为全历史失败。

| 文件组 | 数量 | 最小修复方向/限制 |
|---|---:|---|
| kb02-classification-priority/edge-extraction/extraction-contract/final-classification/planning-budget/planning-fields/r2/source-assignment | 31 | 多处planner fixture缺必填source_level，补合法D使原反例到目标校验；192KiB规划输入失败需按真实字节与测试目的另核，不增产品预算。 |
| kb02-semantic-review | 28 | 旧整链期待第三次模型审核与现HUMAN N+1不符；reviewKnowledgePlan模块严格schema/secret/timeout等仍应直接测试，新链明确无第三次且未审，不skip整组或删安全断言。 |
| kb02-human-ui | 1 | 已独立基线复现旧synthesis协议fixture失配，按当前版本修fixture保留审核流程断言。 |
| kb02-storage-ui | 1 | 旧按钮“继续提取”已是“显式继续提取”，更新定位，仍验禁用/恢复/0新增请求。 |
| kb03-structured-note | 1 | R1永久拒绝文案被R4未审门禁替换；保留未审拒绝及正式无写，改实际文案/阶段语义。 |
| llm.test | 2 | 规则revision13旧正则；测试复制rules缺source-policy.yaml造成提前ENOENT。使用现revision并保留hash模式/漂移负例，补文件不放宽规则。 |
| audit/wiki/llm-http | 8 | 多处cwd E盘临时根rename EPERM，先移系统TEMP再重跑，不放宽故障断言。HTTP“无配置”actual configured=true需先隔离真实配置来源。 |

合计72。建议上述16测试文件归Sol最小修复所有权，由主线程确认；不改产品、不改历史报告、不重写无关测试。

安全关键：tests/llm-http.test.ts子进程cwd项目根且继承process.env，server/index.ts默认读.env.local。无配置断言true说明本轮默认测试可能读取实际配置；本次未读取任何密钥，不能据此断言已发生真实外发，也不能笼统记本轮配置读取0。测试需FMCG_LLM_CONFIG_FILE指向空TEMP配置并清环境覆盖，仅注入fake；主线程另核实际外发是否发生。历史B04/KB02报告输出移TEMP，避免默认测试改历史证据。

真实工具准备可并行；真实release前需安全关键测试隔离/来源/secret门禁核好。剩余真实产品失败仍须证据诊断，不能全部当fixture问题消音。
