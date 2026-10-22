# PA01 Sol 返工后的新窗口审查入口

2026-10-16 最新两项最小返修的独立复验请从 [新入口](PA01-astra-review-20261016.md) 开始，并先核对 status 已完成交接。以下保留 2026-10-15 交接说明。

按用户最新分工，返修施工使用 GPT-6.1 Sol High；用户在新窗口选择 GPT-6 Astra 中（gpt-6-astra / medium）执行独立批次审查。此文是交接入口，不是验收结论；选择窗口实际模型由用户控制。

可在新窗口使用以下任务说明：

> 请独立审查当前 PA01 六项返修的 Sol High 交付。先读 AGENTS.md、docs/status.md、docs/coordination.md、docs/batches/PA01.md、docs/handoffs/PA01-sol-rework.md、docs/reports/PA01-SOL-20261015-builder-handoff.md 与该交接所列最终冻结指纹、测试证据。按照 docs/reports/PA01-20261015-repair.md 的 F-PA01-01–06、docs/handoffs/PA01-interface.md 的 PA01-01–10 及 docs/acceptance.md 独立检验实物。施工自测只能作为输入，不代替独立复验。记录同一冻结版本的 Standards、受控 Spec、真实质量及实际浏览器结果，分别裁决 PASS/FAIL/BLOCKED/NOT_RUN，并给出最小复现和证据。原批次 FAIL 在独立裁决前保留。
>
> 优先覆盖恢复版本冲突/目标缺失、旧检查与迟到响应隔离，get/list/rewrite/replay/confirm 的完整快照和已知凭证边界，真实 DraftStore/提交清单/Workflow 执行前严格校验，以及坏记录复扫持续告警和健康邻居。核对错误诊断和完整同源契约，验证旧 Library/已完成草稿兼容与确认/来源/Meeting 门禁。保护历史验收报告与主验收脚本，新增审查证据使用独立新前缀，完整 suite 用逐字节副本避免旧 B04 脚本覆盖报告。
>
> 真实 Prompt 账本目前累计 0/24，全部阶段、失败与诊断均计入上限；只有工程门禁通过后才按原授权使用隔离虚构资料与只读真实配置取证，发起前核对最新账本及无其他并行调用。不得把 fake 或 jsdom 当真实 Provider/实际浏览器验收。KB02 已 40/40 用尽，不挪用本批预算；KB02 算法、其他批次、正式数据与实际配置不在本轮修复范围。本窗口执行审查，发现问题记录返修要求，不自行施工、提交、部署或推进下一批。

如果最新 status 仍显示施工中或冻结指纹不匹配，先核实交接状态，不在施工继续写入时签验收。最终施工结果以 builder-handoff.md 及其明确引用的最终报告为准；保留首跑失败和夹具校准记录，不混用旧成功计数。
