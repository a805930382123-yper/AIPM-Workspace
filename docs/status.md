# 工程状态

<!-- ENG03 inserted:start -->
## 当前状态摘要

- **当前阶段**：个人知识库配图优化第 2 轮 RAWOCR02 首次独立验收 **FAIL**。图片位置有效时，精读、草稿续跑、问答补读与确认通过。人工改写图片标记后仍可能外发旧 OCR，移除标记后旧图片仍可能被新草稿引用。[任务卡](handoffs/RAWOCR02-task.md) · [施工自查](reports/RAWOCR02-builder.md) · [独立验收](reports/RAWOCR02-review.md)。
- **最近 5 个批次结论**：
  - `RAWOCR01`（2026-11-23，**PASS**）：有无空格的榜单反例均命中高乱码，正常技术术语保留。独立定向回归 22/22，本机中英文 OCR 与 HTTP 隔离复验通过。[验收报告](reports/RAWOCR01-review.md)。
  - `ENG04`（2026-11-23，**PASS**）：锁定接入 Prettier/ESLint 并串联至 `check`/CI，纯格式化 `02ab4ca`（411 文件）树哈希 100% 复现、核心文件 `esbuild` 等价、长行 `1,434 → 47`、产出 26 份大文件拆分与状态治理方案；[Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45050613788)（`6a5eff6`）双作业全绿（[施工报告](reports/ENG04-20261122-builder.md) · [验收报告](reports/ENG04-20261122-review.md)）。
  - `ENG03`（2026-11-22，**PASS**）：新增证据规范与 `npm run guard` 并接入 CI，8 个 >1 MiB 文件迁出归档，4 份核心台账无损瘦身；[Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45036760169)（`3c9c273`）双作业全绿（[验收报告](reports/ENG03-20261122-review.md)）。
  - `ENG02`（2026-11-22，**PASS**）：工作树归档守恒闭环、根目录 214 个临时目录清零，远端代理与 Windows Node 22/24 CI 通过（[验收报告](reports/ENG02-20261122-review.md)）。
  - `AUTOUX02`（2026-11-21，**PASS**）：自动化收件箱漏斗、主从运行记录、滑出详情抽屉与统一弹窗上线并通过双尺寸 Edge 验收（[验收报告](reports/AUTOUX02-20261121-review.md)）。
- **开放阻塞与待用户确认**：ENG04 发现的 9 项 ESLint 疑似缺陷与[拆分方案](reports/ENG04-20261122-split-plan.md)推荐的下一批候选（首选 `FE01` / 备选 `BE01`）待用户决策；`PDF01-GLOBAL` 62 页草稿仍待确认入库；正式 Wiki/Prompt 写入仍须用户明确操作。
- **下一步**：本轮汇报后停止。建议先修复正文编辑后的历史转录隔离与失效图片定位，复验单图请求、草稿及问答补读。第 3 轮待第 2 轮通过且用户授权。
- **规范与归档索引**：[证据存放规范](evidence-policy.md) · [2026 年 10 月](archive/status-2026-10.md) · [2026 年 11 月初](archive/status-2026-11a.md) · [2026 年 11 月中（2026-11-20 及更早条目）](archive/status-2026-11b.md)

## ENG04 代码格式化与静态检查基线完成（PASS，2026-11-23）

引入精确版本 Prettier（`3.10.1`）与 ESLint 扁平配置（`10.15.0`、`typescript-eslint@8.73.0`、`react-hooks@7.1.1`、`eslint-config-prettier@10.1.8`）并新增 `.editorconfig`、`.git-blame-ignore-revs` 与 `scripts/format-equivalence.ts`；三段提交落地（`2c1a4d7` 工具配置、`453db99` 3 处测试 `// prettier-ignore`、`02ab4ca` 411 文件纯格式化、`6a5eff6` blame/CI/文档与拆分方案），`app/server/services` 超 200 字符行由 `1,434` 降至 `47`；父提交两遍重跑树哈希 100% 复现，6 份核心文件 `esbuild` 复算一致、21 份 `.tsx/.css` 归一化等价，ESLint `0 errors / 825 warnings` 并单列 9 项疑似缺陷，产出 26 份大文件[拆分与状态治理方案](reports/ENG04-20261122-split-plan.md)。本地隔离 `npm run check` `1012/1012 PASS`、3 条 `eval` 100% 一致、真机 Edge 5 页 0 错，提交 `6a5eff6` 的[远端 Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45050613788) 双作业全绿。见[施工报告](reports/ENG04-20261122-builder.md)与[独立验收报告](reports/ENG04-20261122-review.md)。

## ENG03 证据存放规范与文档瘦身完成（PASS，2026-11-22）

新增[证据存放规范](evidence-policy.md)与体积守护 `npm run guard`（`scripts/repo-guard.ts` + 70 条存量豁免清单 + 6 项隔离单测）并接入 `npm run check` 及 CI；8 个 >1 MiB 历史大文件（55.5 MiB）核对 SHA-256 迁至仓外归档并仅机械修正 2 处断链；`status.md`（109,715 B → 14,594 B）、`agent-control.md`（62,490 B → 6,845 B）、`acceptance.md`（54,056 B → 34,555 B）、`architecture.md`（29,521 B → 28,587 B，附 9 条不变量定位表与 7 条源码核对）完成无损瘦身并由 `docs-archive-check.ts` 4/4 重构匹配；同步刷新 `README.md`、`docs/agent-quickstart.md` 与 `docs/coordination.md` 条目模板，未修改 `AGENTS.md`。本地隔离 `npm run check` `1012/1012 PASS`，主交付 `3c9c273` 的[远端 Windows Node 22/24 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/45036760169) 全部 `success`。见[施工报告](reports/ENG03-20261122-builder.md)与[独立验收报告](reports/ENG03-20261122-review.md)。
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

