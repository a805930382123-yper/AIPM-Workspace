# KB02 FIELDS 计划审查

**通过，可按既定最小范围交Luna施工。** 本次仅计划审查，未改产品/default tests，未执行工程或真实验收；F-KB02-EDGE-PLAN-01尚未修复，KB02整体仍未通过，两层结论不混用。

基线HEAD `ea36a52ff81ab751149ca3a1d970803b02eca18a`，产品提交 `420e123997c9fffc179af7bf32bd361ed341b9a9`。已读取AGENTS新增分层要求、Astra的TYPE独立裁定和当前源码/枚举；沿用确认方案，不重做诊断或扩大方案。

## 精确施工范围

- `services/llm/knowledge-extraction.ts`：仅规划system增加独立职责说明，type为知识形态、category为业务主题。各自从当前schema/FMCG定义生成允许项与相应标签；不得把source/synthesis混入可提取type。增加内容无关的metric/metric、concept/ai_application等合法配对示例，示例须按当前枚举检查；不同字段可同值也可异值，不强制AI主题总是concept。不引用seq148的Raw、ID或特定业务文本，不覆盖原unit/来源/全覆盖指令。
- `services/llm/rules.ts`：revision9→10；不改wire、schema、Provider模式、响应内容、atom/分块/单位成员、持久结构、预算或重试。
- 仅6个既有默认测试必要迁移当前revision断言：llm、kb02-extraction-contract、kb02-classification-priority、kb02-final-classification、kb02-planning-context、kb02-edge-extraction。**旧revision8/9夹具和测试名称保持其真实旧版本含义**，只更新“新restart使用当前规则”的断言，不全局替换旧版本标识。新增 `tests/kb02-planning-fields.test.ts`；其它文件确需修改先报主Agent。
- 施工资产KB02-FIELDS-20261022；独立资产KB02-FIELDS-AUDIT-20261022。本审查者不施工产品/default tests；Luna交接冻结后再独立验收。搜索乱序旁支不修、不冒称通过。

## 可测量门槛

1. 原seq148响应仍严格LLM_SCHEMA_INVALID，提取/Raw不变，无plan或草稿；字段互换、category-only填type、source/synthesis、未知值仍拒绝，不做映射或静默修补。
2. 捕获真实规划请求，核对两组动态枚举/语义标签与schema一致，配对例合法；合法交叉组合被接受。示例仅解释字段独立，不能替代模型主题判断；受控假响应通过不作为真实质量成功。
3. 当前坏持久plan恢复409；**真实revision9未完成记录**409零调用、原job/cp/raw-state字节保留；显式restart不复用旧块；旧完成草稿可读/复用。普通显式继续保留提取并只增一次规划，专用planningRetry仍只允许覆盖错误，不能为类型失败扩大门禁。
4. unit全覆盖/同源归属、秘密/192KiB、预算/取消/恢复回归；默认完整0skip、tsc/Vite、实际旧Node24.19受影响/SR01及历史独立probe。交接附失败、修正、范围与冻结SHA，未实测项单列。
5. 冻结后独立工程通过才由主Agent放行真实：原短文→Chrome明确创建metric并保留人工备注→106400字符14区域正常新流程→补充候选/明确选旧目标→更新预览，核20%/30%冲突、共同观点双侧证据、双Raw来源/旧正文/备注后明确确认、刷新及持久回读与幂等；新旧Wiki同项点击复验。不得用替代目标或单来源创建代替更新。

真实预算待主Agent实际门禁：必要20、拟阶段24，从163累计至最多187/200；旧余7不迁移，余量不自动重试，Prompt15/24不变。同核心修后再失败立即停盲试，回报主Agent重新裁定。

实际审查命令：读取AGENTS/TYPE裁定与status/agent-control，`rg -n 'kb02-atoms-planning-9|revision8|revision9' tests -g '*.test.ts' -g '*.test.tsx'`准确找到上述6文件；`git rev-parse HEAD`得到ea36a52，`git status --short`审查开始时干净。上述为计划核对证据，不构成修复或批次PASS。
