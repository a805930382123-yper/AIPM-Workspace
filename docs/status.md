# 工程状态

<!-- ENG03 inserted:start -->
## 当前状态摘要

- **FE05 待远端 CI 与最终签发**。Wiki 页面入口缩至 223 行，14 份定向回归 58/58，真实浏览器桌面和窄屏验收通过。[任务卡](handoffs/FE05-20261128-task.md)。

- **FE04 Raw 页面拆分整体 PASS（2026-11-28）**。入口从 2,513 行减至 289 行，保留 3 项公开导出。17 份定向回归 85/85、全量 1,210/1,210、三条离线 eval 和真实 Edge 桌面/窄屏验收通过。产品提交 `96e88ed` [Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46155209728) · [Round 2 签发](reports/FE04-20261128-review.md) · [任务卡](handoffs/FE04-20261128-task.md)。

- **BE05 整体 PASS，波次 3 后端核心 BE01–BE05 五批全部收官（2026-11-28）。** PDF 清理拆为 7 个无环模块，8 段提示词逐字节一致；定向 78/78、全量 1,205/1,205、三条离线 eval 通过，全仓告警 754 → 750。`d186a7c` [Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46151190883) · [Round 2 签发](reports/BE05-20261128-review.md) · [任务卡](handoffs/BE05-20261128-task.md)。

- **BE04 整体 PASS（2026-11-28）**。会议存储拆为 6 个无环模块，保留 17 个公开方法和 Raw 结算失败恢复行为。定向 68/68、全量 1,187/1,187、三条离线 eval 通过，全仓 ESLint 告警从 765 降至 754。产品提交 `625d8b2` 的 Windows Node 22/24 CI 双绿。[任务卡](handoffs/BE04-20261128-task.md) · [Round 2 签发](reports/BE04-20261128-review.md) · [产品 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46142839190)。

- **BE03 整体 PASS（2026-11-28）**。知识工作流拆为 7 个无环模块，14 个公开方法保持兼容。定向 173/173、全量 1,177/1,177、三条离线 eval 通过。历史 KB02 两例与基线一致。`61fd31c` [Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46137473165) · [Round 2 签发](reports/BE03-20261128-review.md) · [任务卡](handoffs/BE03-20261128-task.md)。

- **BE02 整体 PASS（2026-11-28）**。草稿存储与审阅拆为 7 个无环模块，全仓 1,173/1,173。PA01 八项历史失败与基线一致。产品提交 `20f5a78` 的 Windows Node 22/24 CI 通过。[Round 2 独立签发](reports/BE02-20261128-review.md) · [产品 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46133059890)。

- **LLM-Wiki 3-3 与 Batch 3 整体 PASS（2026-11-28）**。Wiki 列表、分类和首页 Wiki 统计读取可重建索引，沿用当前来源权限；索引失效时回退 Markdown。冻结 25 问的 100 条对照与 3-2 一致，本轮补充 5 问全部通过。全仓 1,163/1,163，产品提交 `f99edfe` 的 Windows Node 22/24 CI 通过。[整批独立验收](reports/3-3-review.md) · [逐题评测](reports/3-3-eval.md) · [产品 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46128912910)。

- **LLM-Wiki 3-2 PASS（2026-11-28）**。跨模型检查点续跑、草稿人工提示、主备健康与离线操作验收通过，两项回归已关闭。`ceff6cc`，1,156/1,156，CI 通过；[验收](reports/3-2-review.md) · [任务卡](handoffs/LLMWIKI-3-2.md) · [CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46030737982)。

- **LLM-Wiki 3-1 PASS（2026-11-27）**。主备 Provider、重轻分档与独立 Embedding 接入，分端账本记录尝试。`59261d5`，1,153/1,153。[验收](reports/3-1-review.md) · [任务卡](handoffs/LLMWIKI-3-1.md) · [施工](reports/3-1-builder.md)。

- **LLM-Wiki Batch 2B 整体 PASS（2026-11-27）**。关系反链、一跳检索、普通 Raw 草稿向量查重签收。`098fb5a`，1,151/1,151。[任务卡](handoffs/LLMWIKI-2B-3.md) · [施工](reports/2B-3-builder.md) · [验收](reports/2B-3-review.md)

- **LLM-Wiki 2B-2 / 2B-1 PASS（2026-11-27）**。`dbd7b4d`（1,148/1,148）实现有界一跳邻页检索与关闭开关（[2B-2](reports/2B-2-review.md) · [施工](reports/2B-2-builder.md) · [卡](handoffs/LLMWIKI-2B-2.md)）；`4263606` 实现 Wiki 反链与离线回退，冻结 25 问双路 50 行一致（[2B-1](reports/2B-1-review.md) · [施工](reports/2B-1-builder.md) · [卡](handoffs/LLMWIKI-2B-1.md)）。

- **LLM-Wiki Batch 2A 整体 PASS（2026-11-26）**。2A-3 复核工作台贯通 Raw/提醒/人工处理，冻结 25 问双路 50/50 一致，1,139/1,139（[2A-3](reports/2A-3-review.md) · [施工](reports/2A-3-builder.md) · [卡](handoffs/LLMWIKI-2A-3.md)）；`2A-2`（[验收](reports/2A-2-review.md)）与 `2A-1` 1,136/1,136（[验收](reports/2A-1-review.md) · [施工](reports/2A-1-builder.md) · [卡](handoffs/LLMWIKI-2A-1.md)）均通过。

- **LLM-Wiki Batch 1B 整体 PASS（2026-11-26）**。`74be77d`，阈值 0.42 下真实 Hybrid A/B/C/D 为 7/7、4/5、5/5、3/3，E 误召回 4/5，B1 命中、E2 空，长页 9/9、纯向量引文 20/20，基准与回滚达标。[实测](../evals/reports/batch-1b-final-live.md) · [终验](reports/1B-final-review.md) · 历史：[1B-1](reports/1B-1-review.md) · [1B-2](reports/1B-2-review.md) · [1B-3](reports/1B-3-review.md) · [实测](../evals/reports/batch-1b-real.md) · [0.36](../evals/reports/batch-1b-real-036.md) · [返修](reports/1B-fts-repair-review.md)。

- **RAWOCR05–06 微信图片处理（PASS）**：执行链路（`8f4e7ba`）与筛选精读（`17ab0bc`）通过独立验收，正文图 1–2 精读、推广图 3–6 跳过，原文与六图哈希一致。[卡](handoffs/RAWOCR05-runtime-task.md) · [一轮](reports/RAWOCR05-review.md) · [整单](reports/RAWOCR06-review.md)

- **LLM-Wiki Batch 1A（PASS）**：A/B/C/D 7/7、3/5、5/5、3/3，E 4/5；长页 9/9，千页建库 1,584.05 ms、P95 32.29 ms，1,099/1,099；B1/B4 漏检与 4 负样本留档。[卡](handoffs/LLMWIKI-1A-4.md) · [快照](../evals/reports/batch-1a-baseline.md) · [验收](reports/1A-4-review.md)

- 工作台结项（`aff5b32`，109 项通过，[交付矩阵](delivery-matrix.md) · [复核](reports/CLOSE01-review.md)）。LLM-Wiki Batch 3、FE03、BE01、[BE02](handoffs/BE02-20261128-task.md) 已签收。
- **工程批次结论**：
  - **BE01 PASS**。正式 Wiki 提交拆为 5 个模块，保留事务、锁与恢复语义。`83c4af4` [Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46039895051) · [独立验收](reports/BE01-20261128-review.md)。
  - **FE03 PASS**。Prompt 与草稿页入口 315/458 行，1,143/1,143。[验收](reports/FE03-review.md) · [卡](handoffs/FE03-task.md)。
  - **FE02 PASS**。Inbox 与会议页拆为 8 模块，定向 44/44。[验收](reports/FE02-20261125-review.md)。
  - **`ENG05`（2026-11-24，PASS）**：清零 3 类 9 处疑点（`770 → 761`、`0` 错），6 规则升回 `error`，校准 `acceptance.md` 锚点，`fae6724` [CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45420321416) 全绿（[施工](reports/ENG05-20261124-builder.md) · [验收](reports/ENG05-20261124-review.md)）。
  - **`FE01`（2026-11-24，PASS）**：`api.ts` 按域拆为 8 模块、轻路由与异步 Hook 落地、6 文件告警 `55 → 0`，`check` 1,062/1,062，`e528039` [CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45213208538) 全绿（[施工](reports/FE01-20261123-builder.md) · [验收](reports/FE01-20261123-review.md)）。
  - **`CLOSE01`（2026-11-23，PASS）**：63 A + 46 R 核对通过，恢复门禁通过（[复核](reports/CLOSE01-review.md)）。
- **维护与业务待办**：[拆分清单](reports/ENG04-20261122-split-plan.md)后续波次待用户决策。`tests/prompt-ai-http.mjs` B08 mock 漂移与 `docs-archive-check` 基线既有 `architecture:8` 10 B 漂移留档；62 页 PDF 草稿待决定入库，正式写入须人工确认。
- **规范与归档索引**：[证据规范](evidence-policy.md) · [2026-10](archive/status-2026-10.md) · [2026-11 初](archive/status-2026-11a.md) · [2026-11 中](archive/status-2026-11b.md)

## 工程整固历史完成摘要（ENG03–FE02，均 PASS）

FE02、ENG05 与 FE01 详见上表。ENG04 拆分计划（`6a5eff6`）和 ENG03 状态归档（`3c9c273`）已通过独立验收。[ENG04](reports/ENG04-20261122-review.md) · [ENG03](reports/ENG03-20261122-review.md)。
<!-- ENG03 inserted:end -->
## ENG02 工作区清理与同步核实完成（PASS，2026-11-22）

按[任务卡](handoffs/ENG02-20261122-task.md)及用户 G3 决策（D1–D10 默认、授权清理失效代理与修复回归）执行。Agent Router 评分 `1/0/1/1 = 3`（A 标准，验收先审计划）：主会话规划协调，施工子 Agent（`c49fa5ca-2510-4577-8823-7c662930a67e`，`Model: inherit`）完成 G2 清点、G4/G5 施工与阻塞 3 返修，独立验收子 Agent（`c1451d75-cd00-4b8a-a5a9-8626802c8dd2`，`Model: inherit`）先审计划并完成 4 轮独立复验。

双层独立结论（见[施工报告](reports/ENG02-20261122-builder.md)、[独立验收报告](reports/ENG02-20261122-review.md)）：
- **本轮施工与返修范围内交付**：全部 **`PASS`**（主交付 `9136910`、阻塞 3 自动化页返回 Tab 与 `uifix01-ui` 回归返修 `ad86f7e`、阻塞 2 远端同步与 CI 核验 `1a7c445`、阻塞 1 经管理员 `chkdsk` 修复磁盘找回 D1 7 文件后工作树归零）。账本 A 541 项守恒闭环（提交 D4/D5 共 2 项、归档 526 项 SHA-256 526/526 匹配、恢复完整 13 项），账本 B 214 个根目录临时目录（4.10 GiB）清零（归档 169 个、删除可再生 45 个）；已删除合入分支 `codex/quickux01-delivery`；新增 `.scratch/` 忽略、`docs/testing.md` 临时数据约定及 `npm run hygiene`（`scripts/workspace-hygiene.ts`）；全部交付文件 ENG02-05 扫描 0 凭据 / 0 本机路径 / ≤1MB。
- **ENG02 批次整体**：**`PASS`**（ENG02-01 ～ ENG02-07 全部 **7 / 7 `PASS`**，0 `FAIL`、0 `BLOCKED`）。移除 `.git/config` 失效代理 `127.0.0.1:58319` 后推送与 `.githooks/post-commit` 自动同步恢复，提交 `ad86f7e` 的[远端 Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45029169276) 两个作业全部 `success`（含 `typecheck`、`npm test`、3 条 `eval` 与 `build`）；工作树与根目录临时目录均归零，`docs-link-check` 901 文件 0 断链 0 告警。本批停止交付，待用户明确授权后方可开启 [ENG03](handoffs/ENG03-20261122-task.md)。

## 工程整固 ENG02–ENG04 任务卡规划（2026-11-22）

根据只读项目评审的建议 1–4，规划三批不改变产品行为的整固工作：

- [ENG02 工作区清理与同步核实](handoffs/ENG02-20261122-task.md)
- [ENG03 证据存放规范与文档瘦身](handoffs/ENG03-20261122-task.md)
- [ENG04 代码格式化与静态检查基线](handoffs/ENG04-20261122-task.md)

三批暂定都是 3 分 A 标准，按 ENG02 → ENG03 → ENG04 的顺序执行。基线数据、共同约束和启动前待用户决定的 D1–D5 见[路线图](batches/ENG-HYGIENE-ROADMAP-20261122.md)。

这次只写了规划文档：没有派发施工，没有改产品代码，真实模型调用为 0。工作区里原有的未提交和未跟踪改动保持原样。各批需用户逐批明确授权后才启动。

## AUTOUX02 自动化页收件箱漏斗、运行主从双栏、滑出抽屉与弹窗统一完成（自动化 UI 两批重构全部收官，2026-11-21）

工程提交紧邻 [AUTOUX01](#autoux01-自动化页顶部状态横幅3-tab-架构与流程与计划可视化完成2026-11-21)（`17e244e`）之后完成全部自动化 UI 收官改造：新增 [InboxTab.tsx](../app/components/automation/InboxTab.tsx) 拆分「待处理收件箱」，双源共存时展示 `.automation-subtabs`（`资讯候选` / `事项提醒`）且单源直接呈现、在 `#news-candidates` 顶部植入 5 阶段可点击漏斗条（`已抓取 › 待确认 › 整理中 › 待审草稿 › 失败` + `收件箱`/`已忽略`）并与状态筛选同步、紧凑化候选相关性与阶段色标徽章；在 `#automation-reminders` 新增类型过滤芯片（含空分类「当前分类暂无提醒。」与复位按钮）及未读左侧 3px 语义色条；新建 [AutomationDialogs.tsx](../app/components/automation/AutomationDialogs.tsx) 以统一外壳收敛计划编辑、流水线设置、提醒与通知设置、入库确认 4 类模态弹窗，并在 [WorkflowsTab.tsx](../app/components/automation/WorkflowsTab.tsx) 与收件箱双入口开放设置；新建 [RunsTab.tsx](../app/components/automation/RunsTab.tsx) 与 [RunDetailView.tsx](../app/components/automation/RunDetailView.tsx) 实现桌面端左列表（`max-height: 680px` 独立滚动）+ 右常驻详情主从双栏、垂直时间线 Stepper、紧凑用量网格、产物芯片，以及跨 Tab 右侧滑出详情抽屉（`Tab`/`Shift+Tab` 陷阱、`Escape`/关闭恢复焦点、「在运行记录中查看」无缝切入主从）；精简 [AutomationPage.tsx](../app/pages/AutomationPage.tsx) 与扩展 [automationMeta.ts](../app/components/automation/automationMeta.ts)、[automation.css](../app/automation.css)。未修改后端代码、壳层文件及既有 4 份自动化 UI 测试。

Agent Router 评分 `0/1/1/0`，共 `2` 分，A 标准。主会话规划与协调（`17e244e776e3b288629b4b9d270d114a5ac3e2f2` 基线），施工子 Agent（`0b3b86ce-347e-4f1a-8c78-8e8ede3859c0`，`Model: inherit`）实现与自查，独立验收子 Agent（`a9a95868-1b4a-48fd-bfde-f5a5914655bc`，`Model: inherit`）独立复验与隔离真机浏览器验收。双层独立裁决：**本轮施工范围内（`A2-01` ～ `A2-05`）交付/缺陷修复 PASS、`AUTOUX02` 当前批次整体 PASS**。9 个产品与测试文件 SHA-256 与施工报告 100% 一致；定向回归与新增单测 `39/39`（含 `autoux02-ui` 及零修改的 `autoux01-ui`/`run01-ui`/`pipe01-ui`/`uifix02-ui` 等）、`npm.cmd run typecheck`、`npm.cmd run build`（255 模块）均退出码 `0`；隔离 `os.tmpdir()` 数据目录与随机端口（`52897`/`52898`，零外网请求、零真实模型请求、未触碰 `workspace/` 与运行中服务）真机 Edge `158.0.4370.33` 在 `1440×900` 与 `390×844` 全部 9 个窄屏态及全桌面交互均实测通过（`scrollWidth === 390`、`pageErrors: []`、`consoleErrors: []`、`httpErrors: []`）。见[任务卡](handoffs/AUTOUX02-20261121-task.md)、[施工报告](reports/AUTOUX02-20261121-builder.md)、[独立验收报告](reports/AUTOUX02-20261121-review.md)与[浏览器验收脚本](../tests/acceptance/autoux02-review-browser.mjs)。至此 `AUTOUX01` ～ `AUTOUX02` 自动化 UI 两批重构计划全部交付并验收通过。

## AUTOUX01 自动化页顶部状态横幅、3-Tab 架构与「流程与计划」可视化完成（2026-11-21）

将 [AutomationPage.tsx](../app/pages/AutomationPage.tsx) 重构为顶部紧凑状态横幅（状态色标/圆点、3 项关键指标与默认折叠的进程信息，保留暂停/恢复二次确认）+ 3 视图互斥分段 Tab（`流程与计划`、`待处理收件箱`含实时待办角标、`运行记录`，支持方向键/`Home`/`End` 键盘导航及首页/周报 3 条深链自动路由）；新增 [WorkflowsTab.tsx](../app/components/automation/WorkflowsTab.tsx) 与 [automationMeta.ts](../app/components/automation/automationMeta.ts)，按 5 组业务域展示 3 段式可视化流程条（自动阶段 → 人工门禁/边界 → 产出落点与跳转），合并原独立「知识库巡检摘要」面板为双轨巡检卡片，并补齐「每周工作回顾草稿」直达周报（含无归档回退上一完整自然周）与卡内「启用自动 AI 周报总结」持久化开关及 `409` 版本冲突处理；[automation.css](../app/automation.css) 对齐首页视觉语义并在窄屏下垂直堆叠流程条、隐藏箭头保证零溢出。不修改任何后端代码与既定数据安全边界。

Agent Router 评分 `0/1/1/0`，共 `2` 分，A 标准。主会话规划与协调（`d981debabf6bac1b64546f9c1274c0fc3340693e` 基线），施工子 Agent（`3249f7b1-f814-48b7-91f8-5ec662d9fb61`，`Model: inherit`）实现与自查，独立验收子 Agent（`be7f3ec7-6c79-4712-a0d7-8e8aab262524`，`Model: inherit`）独立复验与隔离浏览器实测。双层独立裁决：**本轮施工范围内（`A1-01` ～ `A1-05`）交付/缺陷修复 PASS、`AUTOUX01` 当前批次整体 PASS**。8 个产品与测试文件 SHA-256 与施工报告 100% 一致；定向回归与新增单测 `35/35`（`autoux01-ui`、`run01-ui`、`pipe01-ui`、`uifix02-ui`、`homeui01-ui`、`review01`、`kbmaint01`、`workauto01`）、`npm.cmd run typecheck`、`npm.cmd run build`（251 模块）均退出码 `0`；隔离 `os.tmpdir()` 数据目录与随机端口（`50755`/`50756`，零外网请求、零真实模型请求、未触碰 `workspace/` 与运行中服务）真机 Edge `158.0.4370.33` 在 `1440×900` 与 `390×844` 全部实测通过（`scrollWidth === 390`、`pageErrors: []`、`consoleErrors: []`、`httpErrors: []`）。见[任务卡](handoffs/AUTOUX01-20261121-task.md)、[施工报告](reports/AUTOUX01-20261121-builder.md)、[独立验收报告](reports/AUTOUX01-20261121-review.md)与[浏览器验收脚本](../tests/acceptance/autoux01-review-browser.mjs)。`AUTOUX01` 停步交付，待用户确认后方可启动第二批 `AUTOUX02`。

## REVIEW01 每周工作回顾草稿与归档（2026-11-21）

首页「周期回顾」可切换实时查询和自动周报。默认每周一上海时间 09:00 汇总上一完整自然周，先存事实快照，按开关选择是否起草 AI 周报。人工备注和已归档周报受版本保护，可导出 Markdown。周报仅存于自动化档案。

GPT-6.2 Sol High 施工，GPT-6.2 Astra Medium 独立验收。一次合成数据真实调用生成七条事实、一条风险，26 个引用均与快照一致；八个正式和业务文件 SHA-256 保持一致。双尺寸 Edge 操作通过。历史恢复测试夹具的阈值指纹已与原链路对齐，修后本地全量 998/998，三链回放分别为 8/8、12/12、4/4。[独立验收报告](reports/REVIEW01-20261121-review.md)

## F04-08 删除后提取返回 404（2026-11-21）

Raw 删除成功后，标准和深度提取均返回 `404 NOT_FOUND`，任务、草稿和模型请求新增均为 0。提取先受理时，删除继续返回 `409 RAW_ACTIVE_WORK`；现存的受限会议来源继续返回 403。GPT-6.2 Sol High 施工，GPT-6.2 Astra Medium 在独立 TEMP 环境复现了旧版 409，并验证了修后两种操作次序。[独立验收报告](reports/F04-08-20261121-review.md)

## WORKAUTO01 工作事项提醒完成（2026-11-21）

工程提交 `5202f86`。后台每小时扫描到期跟进、久未推进和产品事项待分析的新资料。提醒支持已读、延后、自动消解和按事项跳转。Windows 桌面通知默认开启，上海时间 22:00–08:00 免打扰，单轮默认最多三条，超量合并。扫描不会触发模型或改写事项。

GPT-6.2 Sol High 施工，GPT-6.2 Astra Medium 规划与独立验收。修复 PowerShell 5.1 读取 WinRT 设置为空时中断投递的问题。真实 WinRT 受理了测试通知和四项合并通知，同日复扫零重复；双尺寸 Edge 操作、991/991 全量测试及两套回放通过。工程 CI 的 Node 22 首轮触发已知 F04-08 删除/提取竞态，同提交复跑后 Windows Node 22 和 24 均通过。[独立验收报告](reports/WORKAUTO01-20261121-review.md) · [工程 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44778814872)

