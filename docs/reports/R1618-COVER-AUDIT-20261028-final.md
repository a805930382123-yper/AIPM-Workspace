# R16/R18 COVER：独立准备验收

2026-10-28，Astra medium `r1618_retest_plan`，Sol High正式停写交接后依据[任务卡](../handoffs/R1618-COVER-20261028-task.md)及[冻结计划](R1618-COVER-20261028-plan.md)裁定。基线 `a77bcff8a3a906ba3c79ac6025e474c72eac32fe` 加入口及C fixture差异；最终提交由主Agent关联。评分0/2/2/2=6，B模式。

**零调用准备PASS，无必须返修项。** 两个固定profile从prepare→session校验→release绑定→实际fixture读取→attempt序号→结果起账一致；C六句逐字符合计划，P原六句SHA未变。产品revision15未改，冻结含任务卡、计划、两fixture及产品依赖。没有新增任意预算参数、跨会话调度器、超时或重试。

**C/P真实质量尚未执行；旧FAIL及整项未通过保持。** 本轮真实/config0，知识248/500、Prompt15/24。P会话预定250起账并非实际消费；fake输出与C语义无关，只证明机制，不能签Concept或动作状态质量。旧246/248 Q02 FAIL、R16/R18/B09整体未通过保持。

## 独立证据及复用

- 实际 `git diff -- tests/acceptance/R1618-QUALITY-20261027-run.mjs`、`Get-Content`任务卡/C fixture/builder，核两profile常量、所有依赖映射与smoke断言。两fixture固定，profile通过Object.hasOwn检查，session起账/序号/路径核对应常量，release增profile绑定；每会话仍最多2次，预占先于真实Provider。主Agent依C质量判定签P release，入口不自行判断跨会话语义，符合方案。
- 实际PowerShell逐两会话freeze.files执行`Get-FileHash`：各66项、漂移0，包含计划；两根目录均仅drafts、knowledge、prompts、freeze.json、session.json，没有release/attempt/run-started/result。聚合重算复用施工同版记录，本实例只独立核文件逐项与聚合字段一致。
- 实际`Get-FileHash`核入口及两fixture，`git rev-parse HEAD`核上述基线。C原文/元数据与计划一致；P摘要与历史相同。
- **复用同版可信执行**：[builder](R1618-COVER-20261028-builder.md)记录唯一 `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke` exit0、1.349秒、4fake/0real/config0，四类检查覆盖两个profile。独立核受测SHA及断言后采信；不重复smoke、prepare、产品测试、tsc或浏览器。两次prepare各成功一次的命令/结果亦复用builder，独立实查其产物。

初次读取builder时文件尚未落盘，随后在正式停写后已成功读取；不是产品或测试失败。独立未执行真实run、读取.env.local或配置值，只写本报告，未改冻结文件及外部AGENTS/AGENT-ROUTER工作。

| 对象 | 本轮核实值 |
| --- | --- |
| C root / session | `.scratch-R1618-COVER-20261028-DzxR8N` / `b9ef29c9-bdf7-4f2b-bd1a-5f8a3f691b54`；concept、248、249/250 |
| P root / session | `.scratch-R1618-COVER-20261028-Gjkejk` / `473bb246-562c-46f9-8b48-1d96f5875551`；process、250、251/252 |
| 共同66项聚合SHA256 | `aff901d1c4bb8d4f89f352cdbdb4d5a63a39f8a981b8298466bdc71298d772bb` |
| 入口SHA256 | `a9671e50474bf65541933da951fe57f692ca8d6b0a8754cdae06e16245aecebb` |
| C fixture SHA256 | `dbaf4a0b704012b004a5b9e895324855a29e5647a3748aa927039905432d8c82` |
| P fixture SHA256 | `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7` |

准备可交付。下一步向用户一次确认总预算最多4次及现有配置使用：C249–250通过才运行P251–252，任何执行失败、质量FAIL或目标缺证即停止，不重试。outputs省略仍记目标缺证；question-only仅实际出现才补证。各样本只要求自身目标类型，不追改旧标准。主Agent放行前核冻结，并按builder命令逐会话运行；本报告不构成真实调用授权。
