# KB02-R2 最小返修卡：S01 / P2

本卡只记录审查发现和验收要求，不是自动施工授权。对应 [最终验收](KB02-R2-ASTRA-20261018-acceptance.md)。

## 问题与范围

显式 planningRetry 在累计预算耗尽时仍先返回202，并改写 job、Raw状态和检查点，最终清掉原覆盖诊断。调用额度本身没有被突破。

根因位置：`services/llm/jobs.ts:152–162` 缺少前置预算判断；实际 `beforeCall` 判断晚于 `services/llm/knowledge-extraction.ts:147` 的检查点写入。最小改动应在任何上述持久化写入和后台启动前，根据恢复检查点累计 attempts 与相同预算公式拒绝不可执行的规划重试。保留后台 beforeCall 检查作为实际调用防线，避免前后台公式漂移；不重置 attempts、不换 job、不自动重提取、不伪造或补齐覆盖 ID。

## 必须通过的复验

1. 通过正常 HTTP 提取和连续覆盖失败耗尽1块6次预算，不手工篡改 checkpoint。再次 planningRetry 应立即409，错误明确指向累计预算耗尽及显式重新生成选择。
2. 请求前后 Provider 调用增量0；checkpoint、job、raw-state 三文件 SHA256 完全一致；missing `f-c1-2` 的原覆盖诊断、累计次数、原 job 和成功块保留。重复拒绝仍无写入。
3. 仍有预算时，同 job 只规划、复用成功块、显式反馈和累计账本行为正常；普通继续不暗中携带反馈；显式 restart 按既有契约建立新任务。
4. 取消迟到回复、并发/重放、旧规则不兼容、坏检查点与安全/Meeting 门禁继续通过。补充有意义的默认回归测试，再按新冻结运行完整可写副本 suite（0skip）与 tsc/Vite。

独立复现：`node --import tsx tests/acceptance/kb02-r2-astra-20261016-standards-probes.mjs`，旧脚本及报告不可覆盖；复验先复制到新前缀并保持原断言强度。

工程复验全部通过后，才能使用用户已有条件授权的追加24次真实预算，继续短文、补充更新和十四区域长文质量、实际浏览器验收。当前真实新增0；不得借用Prompt额度或以fake关闭语义质量项。原PA01独立PASS保留，不扩展为其他批次返修。
