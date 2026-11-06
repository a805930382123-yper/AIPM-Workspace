# WORK03–WORK05 独立方案审查

本次**方案交付通过**。方案审查发现的来源继承、复核重复请求及验收覆盖缺口均已在任务卡中关闭。WORK03 和 WORK04 已具备可派工的接口、边界及验收标准，仍须按顺序取得各自施工授权。WORK05 的使用评估和试点边界明确，外部来源、权限、运行方式等尚未冻结，不能立即派产品施工。

**产品施工、运行验收和实际模型质量验证均未执行。** 本次真实模型请求为 0，未使用正式数据、配置或用户服务；本报告不签任何产品批次通过。任务卡内的未来质量预算为建议，未授予新额度。

审查者为独立 GPT-6.1 Sol High 实例 `/root/work03_05_review`，未修改受审路线图、任务卡及状态索引。受审材料为[总体方案](../batches/WORK03-WORK05-plan-20261107.md)、[WORK03](../handoffs/WORK03-20261107-task.md)、[WORK04](../handoffs/WORK04-20261107-task.md)、[WORK05](../handoffs/WORK05-20261107-task.md)及[工程状态](../status.md)、[项目总控记录](../agent-control.md)的本次入口。WORK02 功能证据来自 `5fe56f0` 和[历史独验](WORK02-20261107-review.md)。规划起点 `9cc9e1add6861f6ef1355d4b0d3ca04b7bd8b3e2`；本次最终静态复验 HEAD 为 `c31aa22`，同期 QAUI01 变更不在受审产品范围。

| 审查项 | 静态结论 |
|---|---|
| WORK03 续轮、历史及发送边界 | 基线只发送已保存的四项分析字段及本轮选中的 Raw，阶段成果不随请求发送。方案用 `baseRevision` 加追加历史下标定位一条明确选中的已保存成果；v2 单列本轮问题、摘要和主题，并保留 v1 请求、结果及备份读法。AI 承接来源 ID 在本机继承，只用于检查现有来源能否发送；缺失或受限会阻止该次发送。不会拼送旧输出、旧 Raw 原文或全历史。W03-01～04 给出发送核对、无效输入拒绝、中断、证据定位及新旧备份回读的实际检查路径。 |
| WORK04 A 复核原依据 | 使用原轮实际输入及输出，当前来源只作门禁判断；原草稿与人工字段保持原样。W04-A1 明确覆盖 v2 摘要、主题、原观察与 v1 历史兼容。修订后的 A 接口先按目标轮次占位，拦截并发；已有记录时，无参 POST 只返回原状态。仅最新失败或中断的 `retryFromReviewId` 可显式新建一次尝试；陈旧、非法或不可读记录不会新增发送。W04-A2 把挂起并发、快速失败后迟到的首试、显式重试及陈旧重试分别写成了可观察的请求计数断言。 |
| WORK04 B 推进建议 | 以已保存事件和当前状态推导建议，定义了何时出现、消失及如何在刷新后重算。应用走现有 `PUT` 的 `baseRevision`，预览后才提交；关闭、重开、保存冲突、未保存输入和状态控件的同步都有验收项。新 Raw 建议只定位原事项，不发起分析或改动首页提醒。 |
| WORK05 条件式试点 | 先记录实际补料卡点和可重复的来源，再定一个来源、一个已有事项与获批权限。候选方案复用 Raw、事项关联与备份，明确重复投递、写 Raw 后中断、停用和停服边界。总览与任务卡均说明当前候选只在本机服务运行时处理；若确有停服仍需运行的需求，再选能实证该能力的方式。真实来源验证单列，无证据则保留待验证，不扩展通用任务引擎。 |

实际检查为静态阅读与 Git/链接核对：

- 用 `Get-Content -LiteralPath` 阅读受审文档、WORK02 任务卡与报告、`services/work-items/{analysis-runs,types,store}.ts`、`server/work-items-api.ts`、`app/pages/{WorkAnalysisPanel,WorkItemsPage}.tsx` 相关段落；用 `rg -n` 核对 `server/index.ts` 的 Provider 接线、Meeting 来源门禁、备份目录以及返修后的 `retryFromReviewId`、W04-A1/A2 和总览停止条件。
- 用 `git rev-parse HEAD` 和 `git diff --name-status 5fe56f0..HEAD -- app server services scripts` 确认基线与同期已提交 QAUI01 变更；`git diff --name-status HEAD -- app server services scripts tests` 仅列出既有 RAWZH 验收脚本差异。`git diff --check -- docs/status.md docs/agent-control.md` 未发现空白错误，仅有本机换行转换提示。
- 用 PowerShell 提取本次新增内容中的相对 Markdown 链接并以 `Test-Path -LiteralPath` 检查目标，同时核对行尾空白。未执行产品构建、浏览器、HTTP、模型或外部接入测试。
