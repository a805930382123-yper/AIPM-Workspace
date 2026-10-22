# PA01 2026-10-16 最小返修后的独立审查入口

按用户指定分工，gpt-6.1-sol / high 完成施工后停止产品/tests 写入；用户在新窗口选择 gpt-6-astra / medium 做独立审查。本文是入口，不是验收结论。先检查最新 status 是否已完成交接，不能在施工写入期间裁决。

可在新窗口使用以下任务说明：

> 请独立审查 PA01 的 2026-10-16 两项最小返修。先读 AGENTS.md、docs/status.md、docs/coordination.md、docs/batches/PA01.md、docs/handoffs/PA01-sol-repair-20261016.md、docs/reports/PA01-REVIEW-20261016-repair.md 和 acceptance.md，以及 docs/reports/PA01-SOL-20261016-builder-handoff.md 和该交接明确引用的最终冻结/测试/完整性证据。按 PA01-interface 的 PA01-01–10 独立裁决，施工自测不能代签批次 PASS。
>
> R-01 覆盖真实 Workflow 健康记录派生的 evidence 数组/元素、嵌套结构、kind 必需绑定、实际消费者字段，以及 get/list/scan/patch/confirm：坏记录明确 recovery 错误，坏字节保持，健康邻居继续，修复同 id 后复扫可消除。兼容合法旧 evidence/unused snapshots 省略；不扩改 KB02 算法。
>
> R-02 覆盖 499/500/501/更大数量，API/组件诚实给出已知总数、摘要截断和未返回数量；区分扫描 partial 与结果 truncated，partial 数量只能称下限。隐藏问题持续保留，修复/移除后重扫数量正确；保留文件/字节/观察队列预算和有界返回。重点检查总数不能再用 items.length 代替。
>
> 再做受影响 Prompt 安全/恢复/确认/Meeting 关键回归，以及同冻结逐字节可写副本中的完整默认 suite（0 skip）和 tsc/Vite build。既有审查脚本和历史报告只读；复制到新独立审查前缀后运行，保持断言，不以脚本 exitCode=0 代替逐项业务结果。原独立 HTTP 脚本是观察补证，必须按预期解释字段。
>
> 工程门禁全过后，才按原 PA01-10 执行真实 Brief 编辑生成/显式保存，弱与完整优化保存新项/新版本，六模板+custom 分列和实际浏览器恢复。开始前核对最新 Prompt 账本，当前施工阶段零外发、累计仍0/24，全部阶段/失败/诊断均计入24次预算；只用隔离虚构数据和只读真实配置。KB02 40/40不重置、不挪用，不以fake/jsdom签真实模型/实际浏览器质量。
>
> 分别报告 Standards、受控 Spec、真实质量和实际浏览器 PASS/FAIL/BLOCKED/NOT_RUN。发现问题只写最小返修卡，不自行施工、提交、部署或推进下一批。保护正式 workspace、实际配置和历史证据；原PA01/KB02/FULL3 FAIL 在相应独立裁决前保留。
