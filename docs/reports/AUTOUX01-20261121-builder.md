# AUTOUX01 施工与自查报告

- **批次 ID**：`AUTOUX01`
- **基线提交**：`d981debabf6bac1b64546f9c1274c0fc3340693e`（分支 `main`）
- **施工角色**：`AUTOUX01 Frontend Builder`
- **状态**：施工与定向回归/类型检查/构建自查完成，已停写产品与测试代码，待独立验收。

## 1. 交付项实现对照（A1-01 ～ A1-05）

| 交付项 | 实现位置 | 核心变更摘要 |
|---|---|---|
| `A1-01` 顶部紧凑控制横幅 | `app/pages/AutomationPage.tsx`, `app/automation.css` | 收口「调度状态」为紧凑横幅 `<section className="panel automation-banner" data-tone={bannerTone}>`（`muted`/`danger`/`warning`/`ok`）；左侧含 `.automation-dot`、状态摘要与 3 项指标（上海时间下次运行、24 小时失败、当前待处理 = 待确认资讯数 + 未读提醒数）；右侧含暂停/恢复与二次确认 `.automation-confirm`；低频进程信息（模式/PID/端口）默认折叠在 `<details className="automation-process-info">` 中。 |
| `A1-02` 3-Tab 分段架构与深链路由 | `app/pages/AutomationPage.tsx`, `app/automation.css` | 新增 `role="tablist"`（`流程与计划`、`待处理收件箱`含 `.automation-tab-badge`、`运行记录`），支持 `ArrowLeft`/`ArrowRight`/`Home`/`End` 切换与焦点同步；`remindersView` 与 `candidates`/`candidateDate` 提升至顶层单路轮询，严格保留 `showHealth`、`Boolean(onOpenWorkItem)`、`hasPipeline` 与 `hasWeeklyReview` 守卫；支持 `candidateFilter`、`focusReminders`、`initialRunId` 自动路由；`#automation-run-detail` 保留 `scrollIntoView({ block: 'nearest' })`、标题聚焦与关闭时 `isConnected` 焦点恢复。 |
| `A1-03` 5 组业务流程卡片与 3 段流程图 | `app/components/automation/automationMeta.ts`, `app/components/automation/WorkflowsTab.tsx`, `app/automation.css` | 按任务存在情况渲染 5 组业务流程卡（每日资讯、合并「知识库结构/主动巡检」双轨卡、工作事项提醒、每周工作回顾、工作台系统自检）及未知任务兜底卡；保留对应任务 `aria-label`、`编辑计划`、`立即运行`、`最近结果`；实现 3 段流程条与跨 Tab/页面跳转（资讯节点 ②/③ 跳收件箱并设置对应筛选、提醒节点 ③/「前往提醒」切收件箱并聚焦 `#automation-reminders`、知识库卡合并巡检摘要与回调跳转）。 |
| `A1-04` 每周工作回顾流程闭环 | `app/components/automation/automationMeta.ts`, `app/components/automation/WorkflowsTab.tsx`, `app/pages/AutomationPage.tsx` | 接入 `weeklyReviews()` 与 `updateWeeklyReviewSettings()`；提供 `lastCompletedIsoWeek()` 按上海时区计算上一完整自然周用于无归档时回退跳转；卡内新增 `.automation-weekly-setting`「启用自动 AI 周报总结」开关（携带 `X-FMCG-Automation-Token`，支持 `409` 版本冲突提示与「重新读取设置」按钮），不触发真实模型请求。 |
| `A1-05` 样式、既有测试对齐与新增测试 | `app/automation.css`, `tests/autoux01-ui.test.tsx`, `tests/run01-ui.test.tsx`, `tests/pipe01-ui.test.tsx`, `tests/uifix02-ui.test.tsx` | 全部新增样式加 `.automation-page` 前缀，`@media (max-width: 640px)` 下 `.automation-flow-strip` 垂直堆叠并隐藏 `›`；最小化为 3 个既有 UI 测试补入 Tab 切换前置动作并完整保留原断言；新增 `tests/autoux01-ui.test.tsx` 覆盖横幅色标、3-Tab 键盘导航、5 组流程卡跳转、每周回顾开关/409 冲突及 3 条深链。 |

## 2. 变更文件清单与 SHA-256 指纹

| 文件路径 | 变更类型 | SHA-256 |
|---|---|---|
| `app/pages/AutomationPage.tsx` | 修改（产品） | `BDB4DBB9EEA38EC56BA51870563F726617E223B98AEF995F92D07389AEA9A08D` |
| `app/components/automation/automationMeta.ts` | 新建（产品） | `B8E4CDA1C5775E413B6179DCF34D81AA082EEA63BCDA57196544C5E917130558` |
| `app/components/automation/WorkflowsTab.tsx` | 新建（产品） | `35C8BB9CA6121424F2750EC63DF896957EEEA1BC949F41616F07989E249F3E05` |
| `app/automation.css` | 修改（样式） | `1BEF06A36AFE029F8EF9283F403FBF2D7F7DD92375A877CFBACD7F4A1B4B4817` |
| `tests/autoux01-ui.test.tsx` | 新建（测试） | `DE4A7D671C1E3458377A8AC7ED33D0FD5A94CF00C280CA65B654491DFB37C341` |
| `tests/run01-ui.test.tsx` | 修改（测试 Tab 对齐） | `CB6938F916CF6F7E979DCC6FD23EBC57EE39E066BA6C26883BC079106AFC66F9` |
| `tests/pipe01-ui.test.tsx` | 修改（测试 Tab 对齐） | `D36C46D488DB0C14D1837521A40623E5394040037150FD880113AC37D3E2D0EF` |
| `tests/uifix02-ui.test.tsx` | 修改（测试 Tab 对齐） | `0F5EEBC3B4E9F0F47C91F05657A18C237A3E956D2B508E7C0975A68B68F670D8` |

> 范围核对：未修改 `app/App.tsx`、`app/pages/HomePage.tsx`、`app/components/PeriodReview.tsx`、`server/`、`services/` 及任何无关未提交文件；未触碰正式 `workspace/`、未操作运行中的 `4317/5151/5173` 服务、未执行 `git commit` / `git push`。

## 3. 自查命令与实测结果

1. **定向回归 + 新增单测**：
   - 命令：`node --import tsx --import ./tests/support/css-stub.mjs --test tests/autoux01-ui.test.tsx tests/run01-ui.test.tsx tests/pipe01-ui.test.tsx tests/uifix02-ui.test.tsx tests/homeui01-ui.test.tsx tests/review01.test.ts tests/kbmaint01.test.ts tests/workauto01.test.ts`
   - 结果：exit code `0`，共 `35` 项测试全部通过（`pass 35, fail 0, skipped 0`），其中 `autoux01-ui.test.tsx` 新增 3 项用例全通过，既有 UI 与自动化后端回归用例全通过。
2. **TypeScript 类型检查**：
   - 命令：`npm.cmd run typecheck`（`tsc -b`）
   - 结果：exit code `0`，无类型错误。
3. **前端生产构建**：
   - 命令：`npm.cmd run build`（`tsc -b && vite build`）
   - 结果：exit code `0`，`251 modules transformed`，生成 `dist/index.html`、`dist/assets/index-CK-zLBFe.css`（142.31 kB）、`dist/assets/index-DJ6MQa0l.js`（927.95 kB）。

## 4. 遗留与待独立验收项

- **真实浏览器（Edge `1440×900` 与 `390×844`）端到端验收**：依据 `docs/handoffs/AUTOUX01-20261121-task.md` 分工，由独立验收者（Reviewer）在隔离临时数据目录下启动生产构建完成实测并裁决。
