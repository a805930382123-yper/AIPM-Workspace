# KB02-R2 独立验收：FAIL

2026-10-18 完成续审。依据 KB02-R2 任务卡、冻结接口及 20261016 Astra 审查入口，合并主审与独立 Standards / Spec 证据。仅审查，不修改产品、不自动施工。PA01 已有独立 PASS 保留；KB02/FULL3 未完成项不关闭。

| 裁决轴 | 结论 | 依据与限制 |
|---|---|---|
| Standards | FAIL | S01/P2：预算耗尽的显式重规划未前置拒绝，改写状态并清掉覆盖诊断 |
| 受控 Spec | FAIL | 同一 S01 违反指定的 409/原字节保留行为；其余已运行的确定性探针通过 |
| 新规则真实质量 | BLOCKED | 工程门禁未过，不满足追加 24 次的使用条件；本轮真实调用 0 |
| 实际浏览器 | NOT_RUN | React+HTTP jsdom 已运行，但不等同实际浏览器验收 |

## 唯一已证实产品缺陷：S01 / P2

`services/llm/jobs.ts:152` 检查 planningRetry 资格时未检查剩余预算，159–162 行先将 job/Raw 状态设为运行中；异步管线在 `services/llm/knowledge-extraction.ts:147` 清空 lastError，随后才触发 jobs.ts:177–178 的累计调用限制。

实际本地 HTTP 正常流程复现：一个 chunk、两个 fact，fake planner 持续遗漏第二个 fact。初次提取和规划消耗 2 次，再显式重规划 4 次，累计 attempts=6（上限6）。此时覆盖诊断仍有 missing `f-c1-2`。再次请求 `{planningRetry:true}`，预期立即 409、零新增调用、checkpoint/job/raw-state 原字节不变；实际返回 202/running，随后 failed/LLM_ATTEMPT_LIMIT，三个文件均变化，原覆盖诊断丢失。

**没有发生超预算的第七次 Provider 调用。** 缺陷是不可执行请求被接受并破坏恢复诊断，不是额度突破。该反例不篡改检查点，不依赖真实模型。独立 [Standards 报告](KB02-R2-ASTRA-20261016-standards-review.md) 与 [运行记录 S01](KB02-R2-ASTRA-20261016-standards-probes.json) 可复查；主审已核对执行顺序及冻结代码。最小修复要求见 [返修卡](KB02-R2-ASTRA-20261018-repair.md)。

## 验证证据

以下 20261016 证据由独立审查执行，不采用施工自测代签。20261018 重新核验 97 产品/59 默认测试文件均无字节变化，故复用同冻结证据，不无谓重复完整测试。

| 检查 | 结果 | 证据 |
|---|---|---|
| 同冻结逐字节可写临时副本完整默认测试 | 249/249，0 skip | [结果](KB02-R2-ASTRA-20261016-main-tests-writable-copy.json) |
| 同副本 tsc / Vite | PASS | [构建](KB02-R2-ASTRA-20261016-main-build.json) |
| 实际隔离 HTTP / 原 trace39、40 离线回放 | 4/4 | [HTTP](KB02-R2-ASTRA-20261016-main-http-initial.json) |
| React+实际隔离 HTTP，jsdom | 5/5 | [组件](KB02-R2-ASTRA-20261016-main-component-initial.json) |
| 新增预算边界 / 取消迟到规划 | S01 FAIL / S02 PASS | [Standards](KB02-R2-ASTRA-20261016-standards-probes.json) |
| atoms、摘要恢复、更新目录/兼容 | 6 项机制 PASS，另1项语义依赖观察 | [Spec](KB02-R2-ASTRA-20261016-spec-review.md) / [记录](KB02-R2-ASTRA-20261016-spec-probes.json) |
| 20261018 受影响安全 / Meeting | 28/28 | [安全回归](KB02-R2-ASTRA-20261018-main-security.json) |

HTTP 证据涵盖同 job/成功块/累计账本、普通恢复不携带反馈、显式反馈、重启、并发、坏检查点与旧 pipeline 拒绝、旧 trace 两次均定位 missing `f-c2-3`，以及候选→显式选择旧指标→预览→确认，双来源、20%/30%、KB02_HUMAN 与重放。取消探针确认迟到成功不会生成 plan/draft。

Spec 探针验证服务端精确原文切片、512字符片段强制 ambiguous、sourceNotes 排除于 planner/摘要、摘要/事实恢复篡改拒绝；9类坏目录在 Provider 前拒绝，4类非法 evidenceId 拒绝，重复句第二位置保留，旧兼容 Workflow 存储形状可读改确认重放。

安全回归以虚构长/短凭证，覆盖 extracting/planning/update 三阶段的值、键、转义、嵌套键泄露，共24项；另2个正常更新对照及2个 Meeting 零 Provider 门禁，共28项。只使用本地假服务，未读取实际密钥正文。

沙箱首次在临时目录原子 rename 受 EPERM 限制；构建亦有沙箱依赖解析失败。相关初始报告保留，重要命令按权限流程以相同命令重跑通过，未改 ACL、产品或弱化断言。安全回归首次启动失败见 [保留记录](KB02-R2-ASTRA-20261018-main-security-sandbox-initial.json)，不计为产品失败。所有自有测试服务已按结果记录关闭。

## 三项返修的完成程度与未测边界

- F-K202-R1-01：覆盖诊断和显式只重规划主链路通过，但 S01 仍 OPEN；原真实长文质量尚未复验，不能整体关闭。
- F-K202-R1-02：atom ID wire、精确切片、强制片段歧义与确定性摘要机制通过。业务语义分类仍需真实模型评估，不能据此关闭真实质量问题。
- F-K202-R1-03：目录绑定、evidenceId 派生、受控人工确认闭环通过；真实补充更新质量未测，完整完成状态仍待后续验收。

跨换行条件例如“仅在预算获批时：\n甲区域新增20家。”仍依赖模型完整选择和分类；合法 ID 不保证建议文字的业务含义正确。受控探针只展示此依赖，没有据此推断真实模型已经犯错。后续真实验收须检查上下文限定、未知负责人、未来 AI 边界，以及原106400字符十四区域长文中的区域/11%–24%等指标，不固定页数。

未执行真实短文、补充更新、十四区域长文及实际浏览器，均不标 PASS。完整 suite 覆盖 PA01 回归，但不构成重新认证所有真实业务工作流或其他操作系统。

## 冻结、历史证据与预算

[最终完整性记录](KB02-R2-ASTRA-20261018-main-integrity.json)：97 产品、59 默认测试与本次审查基线一致，正式 workspace 无变更/新增，实际配置哈希不变。比较基准是本批冻结与 builder scope；旧 git HEAD 含此前共享区变更，不将其全部归于本批。接手前源字节副本不可用，不能重建每个历史增量 hunk。

2014 个旧保护文件中，发现4个旧 PA01 文件相对 20261016 主审基线发生摘要变化（完整路径与前后 hash 见完整性记录）。它们在本次续审安全测试前已被发现，原因未知；本轮未恢复或归因于 KB02，不声称“全部旧证据不变”。这些文件不是本次 KB02 PASS 检查的证据来源，不据此推翻 PA01 已有独立验收，但需保留历史证据完整性异常记录。

用户授权“追加最多24次，仅工程门禁通过后使用”。历史 KB02 40/40，本次新增0，条件追加剩余24；累计40/64仅表示含条件授权的总上限，当前不允许启用剩余额度。Prompt仍独立15/24。见 [最终预算账本](KB02-R2-ASTRA-20261018-main-real-budget.json)。

结论：KB02-R2 整体 FAIL，不推进下一批。交付本报告和最小返修卡；未修改产品、自动派工、提交或部署。
