# SYN01-PREP-20261025：双来源综合零调用工程准备

2026-10-25用户明确批准B模式启动零调用工程准备，先不做真实模型调用。沿用[NEXT-PREP下一卡](NEXT-PREP-20261024-next-task.md)固定双Raw全文、oracle和范围，不改原提议卡。当前授权仅本卡工程准备，不授权真实验收或产品返修。

基线ba2d8541d061f06cca27ff7dc729d984472b0854；产品60f83adba102d887fcd925df13a8021ff7669de1。知识241/500，Prompt15/24保持，本轮真实上限0。B评分沿用0/2/2/1=5：需求明确、跨来源/HTTP/组件/事务耦合、未来正式写入数据风险、历史综合超时。Sol High施工，Astra medium独立工程审查，主Agent冻结范围/保护/入口/Git。

## 本轮必做与验收

| ID | 工程准备通过条件 |
|---|---|
| SP01 固定输入 | 原卡两个普通非会议Raw正文/标题精确复制到隔离fixture，独立ID、SHA可追溯；不得先AI提取，不使用正式workspace。 |
| SP02 真实产品接线 | 离线fake走生产createSynthesis与实际公开HTTP、真实React组件依赖；生成→审查→确认→回读可运行。不以手写替代UI或HTTP200代替工程闭环。复用同冻结H09证据并明确新增接线验证。 |
| SP03 来源与门禁 | 同一Raw去重不足2、会议来源、正文hash破坏在fake调用前拒绝；非法schema/来源quote/index失败保留而无正式写入。未审/未解决/陈旧revision拒绝，编辑使审查失效；明确完整审查后才确认。fake恢复、同键幂等/版本日志不增、Raw始终不变。覆盖本次关键风险，已有同冻结工程可引用，不重跑无关全套。 |
| SP04 零真实隔离 | 不加载.env.local/真实Provider/正式workspace，默认fake/offline；未知模式、真实模式及非本轮模型入口fail-closed。本轮不构建或启用可直接真实外发路径。未来真实阶段需新授权、工程放行、主Agent唯一release和最多1请求台账；仅提供未武装模板/说明，不实际release。 |
| SP05 交接可运行 | 精确运行命令、正常/失败/重启与关闭步骤；实际组件验收与未来Chrome真实质量验收分开。输出不含secret，保留失败；源码/fixture冻结+哈希，独立审查复跑窄范围并另写报告。 |
| SP06 双层结论 | 工程准备PASS不等于SYN01真实样本或全产品PASS；真实质量/Chrome仍NOT_RUN。A18/R20/R07综合缺证不提前关闭；R12/模板/来源等级/四链集成不在本轮。 |

## 文件所有权与排除

Sol：仅新增tests/acceptance/SYN01-PREP-20261025-*与docs/reports/SYN01-PREP-20261025-*、被忽略的.scratch-SYN01-PREP-*隔离夹具。可读取复用已有测试helpers，禁止改旧文件/产品/依赖/配置。Astra：仅新增tests/acceptance/SYN01-AUDIT-20261025-*、docs/reports/SYN01-AUDIT-20261025-*独立报告/核验。主Agent：本卡、SYN01-MAIN-20261025-*、status/agent-control/acceptance必要增量及统一提交。

共享工作区不覆盖其他人修改；AGENTS.md/.agents/AGENT-ROUTER包装报告为已有外部任务，保留不提交。产品缺陷若被发现，给最小复现和影响，停止依赖真实放行，不擅自返修产品。隔离接线小缺陷由原Sol在本卡内修正。未知产品接口范围由主Agent裁定，重复核心失败先诊断不盲重试。

施工自查并交接停写，Astra随后独立验收，不自签；主Agent完成保护/精确差异检查/提交/实时远端核对后报告。无产品变更且相关检查通过时无需重新跑历史445/build；所有历史证据标明原版本。关闭全部自有服务。准备完成即停止，不进入真实阶段。后续建议最多1次synthesis仅是建议，当前任何真实调用均未授权。
