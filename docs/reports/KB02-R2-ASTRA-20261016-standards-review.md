# KB02-R2 Standards：FAIL

2026-10-16，独立 Astra Standards 审查。按 code-review 技能的双轴分工，本报告只裁决 Standards；受控 Spec、完整 suite/build、更新证据链及总体裁决由主审合并。产品只读，未施工、提交、部署或真实外发。PA01 最新 PASS 保留，不重开其历史问题。

依据为当前 status/coordination、KB02-R2 任务卡、冻结接口、20261016 审查入口、R1 剩余三项返修要求及 builder-handoff/scope。以 builder-baseline 的本轮 11 产品影响面为范围；旧源副本已不可用，不能重建每个增量 hunk，也不把 git HEAD 之前的共享变更算为本轮。主审已核验最终 97 产品/59 默认测试指纹和 1967 旧保护文件一致，本分支不重复宣称独立完成该完整性核验。

## S01 / P2：预算耗尽的显式重规划仍返回启动成功，并销毁原覆盖诊断

位置：`services/llm/jobs.ts:152` 的 planningRetry 前置条件没有检查剩余预算；`:159–162` 先写 running/processing 并后台启动。真正预算门禁在 `:177–178`。在触达该门禁前，`services/llm/knowledge-extraction.ts:147` 已把 checkpoint.lastError 清空。

最小复现完全通过真实本地 HTTP 正常流程，不手工篡改检查点：

1. 一个两句虚构 Raw（1 chunk），fake 提取返回两个合法 atom，规划始终漏第二个 fact。
2. 首轮提取+规划共 2 次，随后显式 planningRetry 4 次，使累计 attempts=6，仍是合法覆盖失败，diagnostic.missing=`f-c1-2`。
3. 再 POST `/api/raw/:id/extract` `{planningRetry:true}`。该任务上限 `min(128,2*1+4)=6` 已耗尽。

实际 HTTP 返回 **202，status=running**；后台随后变为 failed/LLM_ATTEMPT_LIMIT。没有第七次 Provider 调用，但 checkpoint、job、raw-state 的三个文件均改写，原 coverage diagnostic 被只有预算错误的 lastError 替换。精确输入、调用和前后哈希比较由独立脚本执行，JSON S01 保存结果。

依据：审查入口要求检查“预算用尽、规则版本不兼容的 409 和原字节保留”，冻结接口要求显式重规划沿用成功块和累计账本。预算确实没有被突破，但这不是一个可执行的恢复请求，不应启动后再清掉恢复依据。该问题属于本轮新增 planningRetry 的边界，不能用普通恢复过去已有相同顺序抵消本轮显式契约。建议在任何 checkpoint/job/state 写入前预检预算，拒绝并保留原覆盖诊断；后台预算检查继续保留作防线。

## 已运行的通过项

S02：实际 HTTP 先制造覆盖失败，再显式重规划；在本地 fake planner 挂起时发 cancel，随后释放迟到的成功回复。结果 cancelled、累计 attempts=3、仅 1 次规划调用、没有 plan、没有 Draft，Raw 回到 unprocessed。取消没有接受迟到规划结果。

## 静态覆盖与边界

读过知识 atoms/coverage helper、checkpoint 读写/完整性、jobs 恢复与账本、knowledge-extraction 新 wire/规划/恢复校验、rules 版本绑定、server extract 参数门禁、RawPage 显式按钮与 API 传参。

可见实现包括：诊断仅 ID/页位置且有界；覆盖失败计划不落盘；只有 planningRetry 显式携带 coverageFeedback；同 job 串行和运行中复用；规则/pipeline/provider/Raw/分块不兼容前置拒绝；恢复时复验原文 atom/locator/evidence/summary；AI-bearing 检查点字段按当前凭证扫描；新 wire 不接受模型自由事实 text/offset；片段强制 ambiguous。未发现另一个已证实的 Standards 缺陷。未单独重跑主审负责的原 HTTP4、组件5、离线 sequence39/40、249默认测试或 build，以上静态结论不冒称动态 PASS。

本轮 fake/localhost 不能签新规则真实语义质量；KB02 真实调用累计 40/40，新增 0 次，真实质量 BLOCKED，实际浏览器本分支 NOT_RUN。没有读取真实凭证。完整更新 evidenceId/旧 Workflow 兼容由另一审查轴覆盖。

命令：`node --import tsx tests/acceptance/kb02-r2-astra-20261016-standards-probes.mjs`。默认 sandbox 首次因临时目录 Wiki index rename EPERM 未启动产品；按权限流程获准用相同命令重跑，最终 S01 FAIL / S02 PASS，自有服务全部关闭。脚本 exit=0 表示取证运行完成，不表示业务门禁通过。

产物：`tests/acceptance/kb02-r2-astra-20261016-standards-probes.mjs`、`docs/reports/KB02-R2-ASTRA-20261016-standards-probes.json`。最终 **Standards FAIL（S01 P2）**；本分支停止，不自动施工。
