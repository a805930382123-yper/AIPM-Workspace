# WORKAUTO01 事项到期提醒、桌面通知与新资料提示 任务卡

属于 [阶段 2 自动化路线图](../batches/AUTO-STAGE2-ROADMAP-20261120.md) 第二批。目标：在后台常驻模式下主动扫描未结工作事项，把**到期/逾期跟进**、**久未推进事项**以及**产品事项未分析新 Raw**汇聚为可去重、可延后的站内提醒，并支持通过 Windows 原生桌面通知（Toast）提醒用户；全程 0 模型调用、绝不自动修改事项状态或发起 AI 分析。

## 评分与模式

需求明确度 1（提醒分类、去重、免打扰与隐私边界已冻结）/ 模块耦合 2（调度器、WorkItemStore、WorkAnalysisRuns、Windows Toast 投递、自动化页、首页与工作事项导航）/ 变更风险 1（零模型调用、不改业务数据，风险集中在通知隐私、重复弹窗防轰炸与非桌面 CI 测试隔离）/ 历史失败 0 = **4，A 标准（Sol High 先审计划）**：Astra Medium 规划，Sol High 先审计划，Terra High 施工，不同实例 Sol High 独立验收。（若规划审查认为跨进程通知与持久化边界风险需升格，可改 B 并说明。）

依赖：RUN01、WORK01–WORK04（已 PASS）；建议在 KBMAINT01 通过后施工，避免 `AutomationPage.tsx` 与 `server/automation-api.ts` 并发冲突。

## 已冻结的产品决定

1. **零模型调用、零业务写入**：提醒任务只读 `WorkItemStore`、`WorkAnalysisRun` 与 `RawStore` 来源元数据，写操作仅限于 `state/automation/reminders.json` 与运行账本；绝不自动改写事项状态、下一步、跟进日期或外发消息，绝不自动发起产品事项 AI 分析。
2. **隐私优先的桌面通知**：Windows Toast 只允许显示**事项标题 + 提醒类型标签 + 简短数量**（如“到期跟进：XX 客户问题”或“产品事项有 2 条新资料待分析”），**禁止**包含客户详细沟通正文、Raw 内容、敏感反馈或任何配置/密钥信息。
3. **防轰炸与免打扰**：同一事项、同类型在同一上海自然日（或同一组未分析 Raw 集合）只投递一次桌面通知；支持免打扰时段（默认 `22:00–08:00` Asia/Shanghai），免打扰期间照常更新站内提醒中心，但不弹系统通知。
4. **状态自动消解**：一旦用户关闭事项、将 `followUpOn` 改为未来日期、推进更新了事项，或完成了覆盖新 Raw 的分析轮次，下次扫描自动将该提醒标为 `resolved`，不留僵尸提醒。

## 必做

**W1 提醒扫描定时任务 `work.reminders`（`services/automation/tasks/work-reminders.ts`）。**
- 在调度器注册 `work.reminders`（显示名：`工作事项到期与新资料提醒`），默认 `{ kind: 'interval', minutes: 60 }`、`allowsCatchUp: false`（不补发过期弹窗）、`mayCallModel: false`，默认启用。
- 扫描全部 `status !== 'closed'` 的事项，识别三类确定性条件：
  1. `due_follow_up`（到期/逾期跟进）：存在 `followUpOn` 且 `followUpOn <= 今天（上海日期）`。区分“今日到期”与“已逾期 N 天”。
  2. `stale_item`（久未推进）：`status` 为 `in_progress` / `waiting` / `retest`，且距 `updatedAt` 超过可配置阈值（默认 **7 天**，可在设置中调整 1–90 天或设为 `0` 关闭），且当前未处于 `due_follow_up`（或两类独立去重由规划者冻结，避免同一事项同时弹两条重复提醒）。
  3. `new_raw_ready`（产品事项有新资料待分析）：仅针对 `kind === 'product_analysis'`，复用 WORK04B 判定逻辑——存在已关联、可读、且未进入最新已完成 `WorkAnalysisRun` 的可选 Raw（遵守来源门禁）。
- 若某些事项或分析记录文件损坏无法读取，单条记录到 `issues` 并体现在步骤说明，不中断其他正常事项扫描。

**W2 提醒状态存储与去重账本（`services/automation/reminders.ts`）。**
- 持久化在 `state/automation/reminders.json`（含 `revision`、用户设置 `settings` 与提醒条目 `items`，原子写入 + `SerialQueue`）。
- 用户设置 `settings`：`desktopNotificationsEnabled`（默认 `true`）、`quietHoursStart`（默认 `22:00`）、`quietHoursEnd`（默认 `08:00`）、`staleDays`（默认 `7`）、`maxToastsPerRun`（默认 `3`，单次扫描超出时合并为一条汇总通知“另有 N 条待跟进事项”，防止开机连弹几十条）。
- 每条提醒字段：`id`、`dedupeKey`（`itemId + kind + conditionKey`）、`itemId`、`itemTitle`、`itemKind`、`kind`（`due_follow_up` | `stale_item` | `new_raw_ready`）、`summary`（不含正文）、`status`（`unread` | `acknowledged` | `snoozed` | `resolved`）、`snoozedUntil`（可选上海日期 `YYYY-MM-DD`）、`firstDetectedAt`、`lastDetectedAt`、`desktopNotifiedAt`、`deliveryStatus`（`pending` | `delivered` | `suppressed_quiet_hours` | `suppressed_disabled` | `suppressed_non_windows` | `failed`）、`deliveryError`。
- 延后（`snoozed`）期内不重复标未读、不弹桌面通知；到期当日恢复为 `unread`。已消解的 `resolved` 记录保留 30 天后随扫描清理。`state/` 已在备份白名单内，验证备份/恢复通过。

**W3 Windows 原生桌面通知适配器（`services/automation/desktop-notify.ts`）。**
- 抽象可注入的 `DesktopNotifier` 接口，便于单测与 CI 100% 离线/无桌面会话测试。
- Windows 真实实现：通过 `powershell.exe -NoProfile -NonInteractive` 调用 WinRT `Windows.UI.Notifications.ToastNotificationManager`（或标准兼容 AppUserModelID）发送纯文本标题+摘要 Toast，**不引入新的第三方 npm 原生依赖**；硬超时 5 秒，执行失败返回明确错误字符串并降级记录为 `deliveryStatus: 'failed'`，绝不导致调度器崩溃。
- 严格 XML 转义标题与文本，并对发往 Toast 的文本做长度截断（如 ≤120 字符）与敏感内容零拼入校验（仅来源自事项标题、日期、计数和固定文案）。
- 非 Windows 环境或测试环境未注入真实适配器时，安全返回 `suppressed_non_windows`，不报错。

**W4 API（`server/automation-api.ts`）。**
- `GET /api/automation/reminders?status=active|all`：返回当前提醒列表、未读数、设置与读取 `issues`。
- `PATCH /api/automation/reminders/settings`：修改桌面通知开关、免打扰时段、久未推进天数、单次通知上限（带 `revision` 并发校验与本机写门禁）。
- `POST /api/automation/reminders/:id/ack`：标记已读（`acknowledged`）。
- `POST /api/automation/reminders/:id/snooze`：延后至指定上海日期（默认明天，须晚于今日）。
- `POST /api/automation/reminders/test-notification`：显式发送一条固定非业务文案的测试桌面通知（“AIPM Workspace 通知测试”），返回真实投递结果，供用户验证 Windows 系统通知权限。

**W5 UI 与导航联动。**
- **自动化页（`AutomationPage.tsx`）**：新增「事项提醒」区，展示活动提醒列表（类型标签、事项标题、摘要、桌面通知投递状态）、支持「已读」「延后一天」「打开事项」，并可展开「提醒与通知设置」（免打扰时段、久未推进天数、桌面通知开关、「发送测试通知」按钮）。
- **首页（`HomePage.tsx`）**：在既有右侧「到期跟进」卡片内，除已有到期项外，补充只读汇总提示“另有 M 项有新资料待分析 / K 项久未推进”（仅非零时显示），点击跳转至对应事项或自动化提醒区，不破坏既有紧凑双栏布局。
- **工作事项跳转（`App.tsx` / `WorkItemsPage.tsx`）**：从 `new_raw_ready` 提醒点击「前往分析」时，打开目标产品事项并聚焦到资料选择区域（复用 WORK04B 规则：不自动勾选 Raw、不自动发起模型调用）。

**W6 文档。** `docs/architecture.md` 新增 WORKAUTO01 小节；`README.md` 补充桌面通知开关、免打扰时段与隐私边界说明。

## 排除

- 不自动修改工作事项状态、不自动发送邮件/微信/钉钉、不自动发起产品事项 AI 分析。
- 不实现 WORK05 外部事件接收（属阶段 3）。
- 不新增第三方通知 npm 包、不做系统托盘常驻图标。
- 不修改周报回顾（属 REVIEW01）与工作区中其他未提交任务文件。

## 文件所有权

施工：`services/automation/tasks/work-reminders.ts`、`services/automation/reminders.ts`、`services/automation/desktop-notify.ts`、`server/automation-api.ts`、`server/index.ts`（最小装配改动）、`app/api.ts`、`app/pages/AutomationPage.tsx`、`app/automation.css`、`app/pages/HomePage.tsx`（最小汇总提示）、`app/App.tsx` 与 `app/pages/WorkItemsPage.tsx`（最小跳转定位参数）、`tests/workauto01*`、`docs/architecture.md`、`README.md`、WORKAUTO01 施工报告。
验收：只写验收报告与验收脚本。主线程：status、提交推送与远程 CI 核验。

## 验收项

- **WKA-01 扫描与分类准确性（假时钟单测）**：验证到期、逾期、久未推进、产品事项有未分析新 Raw 四种场景精确识别；已关闭事项、未到期事项、已完成分析覆盖全部 Raw 的产品事项不产生提醒；0 模型调用；事项记录与分析记录文件 SHA 不变。
- **WKA-02 去重、延后与自动消解**：同一日重复扫描不重复产生新提醒、不二次调用 `DesktopNotifier`；单次超过 `maxToastsPerRun` 时合并为汇总通知；免打扰时段（含跨午夜 `22:00–08:00`）仅落站内不发 Toast；`snooze` 期间静默、到期日恢复未读；事项关闭或完成新一轮分析后自动 `resolved`。
- **WKA-03 隐私与安全边界**：单测验证传入 `DesktopNotifier` 的全部标题与内容不含事项 `feedback`、客户沟通历史、Raw 正文或密钥；XML 特殊字符（`<`, `>`, `&`, `"`）安全转义；notifier 抛错或超时降级为 `failed`，不中断扫描与其他提醒落盘。
- **WKA-04 备份与容错**：`reminders.json` 原子写入与 `revision` 409 冲突处理；损坏事项文件单条上报不阻塞其余事项；`backup_workspace` 导出/恢复包含提醒状态并校验通过。
- **WKA-05 真实 Windows 桌面通知验证**：验收者在隔离 TEMP 端口调用「发送测试通知」及触发一次真实 `work.reminders` 扫描，验证 PowerShell Toast 命令退出码 0、投递状态 `delivered`（若当前受控桌面会话禁用系统通知则如实记录系统返回与降级结果，不伪造成功）。
- **WKA-06 真实浏览器 UI（1440px 与 390px）**：隔离生产构建下验证自动化页提醒列表、已读、延后、修改免打扰与设置、点击直达工作事项与产品事项资料区（确认 0 模型调用）、首页侧栏汇总提示；无水平溢出、控制台 0 报错、截图存证。
- **WKA-07 全量回归与远程 CI**：`npm run check`、既有回放评估与推送后 GitHub Actions Windows Node 22/24 CI 全部通过（CI 中使用注入 fake notifier，零桌面依赖）。

## 需用户决定（施工中遇到再问，不阻塞开工）

- 桌面通知是否希望默认开启（本卡默认开启且带 `22:00–08:00` 免打扰，用户可在界面一键关闭）。
- “久未推进”的默认天数 7 天是否需要按客户事项 / 产品事项分别配置（首版统一 7 天，避免设置过碎）。

## 规划补充

（Codex 规划者在此补充冻结的细化接口，不得改变上文目标、必做与验收项。）
