# AUTOUX02 施工与自查报告

- **批次 ID**：`AUTOUX02`（自动化模块 UI 重构第二批 / 收官批次）
- **基线提交**：`17e244e776e3b288629b4b9d270d114a5ac3e2f2`（分支 `main`）
- **施工角色**：`AUTOUX02 Frontend Builder`
- **状态**：施工与定向回归/类型检查/构建自查完成，已停写产品与测试代码，待独立验收。

## 1. 交付项实现对照（A2-01 ～ A2-05）

| 交付项 | 实现位置 | 核心变更摘要 |
|---|---|---|
| `A2-01` 待处理收件箱结构化与资讯 5 阶段可点击漏斗条 | `app/components/automation/InboxTab.tsx`, `app/pages/AutomationPage.tsx`, `app/components/automation/automationMeta.ts`, `app/automation.css` | 抽离 `InboxTab`；仅当 `showReminders && hasPipeline` 同时为真时在顶部渲染 `.automation-subtabs`（`role="tablist"`、`资讯候选（待确认 N）` / `事项提醒（未读 M）`、方向键导航），单源不显示多余切换条；由 `AutomationPage` 受控联动 `inboxSection` 与焦点跳转（`#news-candidate-title` / `#automation-reminders`）；`#news-candidates` 顶部新增 5 阶段可点击漏斗条 `.automation-funnel`（`已抓取` › `待确认` › `整理中` › `待审草稿` › `失败` 及 `收件箱（全部未忽略）`、`已忽略` 快捷芯片），与第 2 个 `<select>`（支持 `'drafts'`）双向同步，二次点击已激活阶段恢复 `'all'`；候选卡片 `.news-candidate` 收敛为紧凑徽章行 `.automation-candidate-pills`，保留 `/未预筛.*本批读取失败/u` 文本、`.candidate-low` 默认折叠及全部操作按钮。 |
| `A2-02` 工作事项提醒分类过滤与视觉强化 | `app/components/automation/InboxTab.tsx`, `app/components/automation/automationMeta.ts`, `app/automation.css` | `#automation-reminders` 顶部新增 `.automation-filter-chips`（`全部`、`到期跟进`、`久未推进`、`新资料待分析`，均含计数与 `aria-pressed`）；当前分类为空但总提醒非空时显示「当前分类暂无提醒。」与 `显示全部提醒` 按钮；列表项设置 `data-status` 与 `data-tone`（未读按类型展示左侧 3px 语义色条：`danger`/`warning`/`accent` 与语义徽章；已读/延后降噪为 `muted` 样式）。 |
| `A2-03` 3 处自动化设置与入库确认统一为标准模态弹窗 | `app/components/automation/AutomationDialogs.tsx`, `app/components/automation/WorkflowsTab.tsx`, `app/components/automation/InboxTab.tsx`, `app/pages/AutomationPage.tsx`, `app/automation.css` | 新建统一模态外壳 `AutomationModal`（`.automation-modal`/`.automation-dialog`，接入 `useDialogFocus`、统一 `×` 关闭、`Escape` 与遮罩关闭）；收敛 `ScheduleEditorDialog`、`PipelineSettingsDialog`、`ReminderSettingsDialog`、`CandidateConfirmationDialog`（保留 `#automation-editor-title`、`#candidate-confirm-title`、首个 `<input>` 与 `<select>` 顺序）；`WorkflowsTab` 资讯卡新增 `流水线设置`、提醒卡新增 `通知设置`，与 `InboxTab` 头部按钮共开同一弹窗并完整保留 `409` / `revision` 冲突与 `发送测试通知`；`readPipelineSettings` 与 `automationCandidates` 在 `AutomationPage` 按 `if (!hasPipeline) return;` 严格守卫，零多余请求。 |
| `A2-04` 「运行记录」主从双栏布局与垂直时间线 Stepper | `app/components/automation/RunsTab.tsx`, `app/components/automation/RunDetailView.tsx`, `app/automation.css` | 抽离 `RunsTab` 与 `RunDetailContent`；`>= 960px` 采用 `.automation-runs-layout` 主从双栏（左栏 `#automation-history` + 3 个筛选 `<select>` + `.automation-runs-scroll` `max-height: 680px` 独立滚动，每行含 `.automation-run-dot`、语义徽章与 `.is-selected` 高亮；右栏在 `selectedRunId` 为空时展示占位卡片且 DOM 无 `#automation-run-detail`，选中后渲染详情）；步骤升级为 `.automation-stepper` 垂直时间线，用量整合为 `.automation-usage-grid`（保留全部 5 项字段），产物升级为 `.automation-artifact-chips`，下方保留 `LintRunDetails` 与 `InspectionRunDetails`。 |
| `A2-05` 跨 Tab 右侧滑出详情抽屉 | `app/components/automation/RunDetailView.tsx`, `app/pages/AutomationPage.tsx`, `app/automation.css` | 当 `tab !== 'runs' && selectedRunId` 时挂载 `RunDetailDrawer`（`.automation-drawer-backdrop` + `aside.panel.automation-drawer[role="dialog"][aria-modal="true"][aria-labelledby="automation-run-detail"]`，宽 `min(560px, 92vw)`、`<= 640px` 占满视口），自行处理 `Tab`/`Shift+Tab` 焦点循环与 `Escape`/遮罩关闭，不调用 `useDialogFocus` 避免卸载时抢还原焦点；打开时由 `AutomationPage` `useEffect` 滚动并聚焦 `#automation-run-detail`，关闭由 `closeRunDetail` 按 `trigger?.isConnected` 精确恢复焦点；抽屉头部 `在运行记录中查看` 清空旧 `runTriggerRef` 并切入 `runs` Tab 右栏继续查看，整页至多同时存在 1 个 `#automation-run-detail`。 |

## 2. 变更文件清单与 SHA-256 指纹

| 文件路径 | 变更类型 | SHA-256 |
|---|---|---|
| `app/pages/AutomationPage.tsx` | 修改（产品） | `60EDD3799EA481F689D73FB47A0FBBBF804F42EDBF33AE3B53BB547473180867` |
| `app/components/automation/automationMeta.ts` | 修改（产品） | `A23BC3CEBE4F74F46203707BAC087DDFF92946B9D5A260D9AC671A6F4B497458` |
| `app/components/automation/WorkflowsTab.tsx` | 修改（产品） | `0074FB976EAAF878D600CECE76B77D35D83C87E286FFC71CD819A0137153854D` |
| `app/automation.css` | 修改（样式） | `DF8577EB62B8BF27E1A66ACA523D254EFD247E105E9098F8F0C4C15C85EA1416` |
| `app/components/automation/AutomationDialogs.tsx` | 新建（产品） | `6A97FD82CFDBD7EA1CD6AD72D92DE3869358A1B6791C6106D618A5E849F940B1` |
| `app/components/automation/InboxTab.tsx` | 新建（产品） | `3A73B1A4FA8350136EA17DF888C2E5D51096BCBCAF7FB94AB52B13E8A09D68A7` |
| `app/components/automation/RunsTab.tsx` | 新建（产品） | `6CE3F636F55D56086280AFA1F0F6F85D4B54018AD4DCBA7C28FC0ADC014300F4` |
| `app/components/automation/RunDetailView.tsx` | 新建（产品） | `3BF20A011ABCC7209691C622A996FD275965DF114729328A43C896AA119A2CC8` |
| `tests/autoux02-ui.test.tsx` | 新建（测试） | `20294849BA6D0D77D124EAE1F928EBA527BC4FD6BEF9F363E4186179DEB73C3A` |

> 范围核对：经 `git diff --name-only -- tests/run01-ui.test.tsx tests/pipe01-ui.test.tsx tests/uifix02-ui.test.tsx tests/autoux01-ui.test.tsx app/App.tsx app/pages/HomePage.tsx app/components/PeriodReview.tsx server services` 核实输出为空（零改动）；未修改任何既有测试文件、后端文件及无关未提交文件；未触碰正式 `workspace/` 或运行中的 `4317/5151/5173` 服务；未执行 `git commit` / `git push`。

## 3. 自查命令与实测结果

1. **定向回归 + 新增单测（含 4 份既有自动化 UI 测试零改动通过）**：
   - 命令：`node --import tsx --import ./tests/support/css-stub.mjs --test tests/autoux02-ui.test.tsx tests/autoux01-ui.test.tsx tests/run01-ui.test.tsx tests/pipe01-ui.test.tsx tests/uifix02-ui.test.tsx tests/homeui01-ui.test.tsx tests/review01.test.ts tests/kbmaint01.test.ts tests/workauto01.test.ts`
   - 实测结果：exit code `0`，共 `39` 项测试全部通过（`pass 39, fail 0, cancelled 0, skipped 0`，耗时 `3813.9737ms`），其中 `autoux02-ui.test.tsx` 新增 4 项用例、`autoux01-ui.test.tsx` 3 项、`run01-ui.test.tsx` 2 项、`pipe01-ui.test.tsx` 1 项、`uifix02-ui.test.tsx` 5 项均零改动通过。
2. **TypeScript 类型检查**：
   - 命令：`npm.cmd run typecheck`（`tsc -b`）
   - 实测结果：exit code `0`，无类型错误。
3. **前端生产构建**：
   - 命令：`npm.cmd run build`（`tsc -b && vite build`）
   - 实测结果：exit code `0`，`255 modules transformed`（耗时 `1.95s`），产出 `dist/index.html`（`0.54 kB`）、`dist/assets/index-ZBxhwLqo.css`（`153.47 kB`）、`dist/assets/index-BbpKkCj3.js`（`942.21 kB`）。

## 4. 待独立验收项

- **真实浏览器（Edge `1440×900` 与 `390×844`）端到端验收**：依据 `docs/handoffs/AUTOUX02-20261121-task.md` 分工，已停止对产品与测试文件的修改，交由独立验收者（Reviewer）在隔离临时数据目录下启动生产构建完成实测并独立裁决。
