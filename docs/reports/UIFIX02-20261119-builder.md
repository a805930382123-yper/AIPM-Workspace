# UIFIX02 施工报告（Builder）

- **批次 ID**：`UIFIX02`（UI 交互分批优化第二批）
- **基线提交**：`695877816c50af7cca871e3307d09fe0761061a3`（分支 `main`）
- **任务卡**：[UIFIX02-20261119-task.md](file:///e:/AI/Work/AIPM%20Workspace/docs/handoffs/UIFIX02-20261119-task.md)
- **施工日期**：2026-11-19
- **状态**：已完成 U2-01 ～ U2-05 施工与自测，任务卡定向 JSDOM 测试（26/26）、补充 UI 回归（12/12）、`typecheck` 与 `build` 均已通过；真实 Edge 浏览器验收（`1440x900` & `390x844`）交由独立验收者执行。

---

## 1. 交付项实现摘要（U2-01 ～ U2-05）

### U2-01：首页「待审核」统计卡与顶部「审核草稿」筛选状态统一 + 筛选计数文案明确
- [HomePage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/HomePage.tsx)：
  - `cards` 数组中「待审核」统计卡 `action` 更新为 `() => { setPipelineReview(false); setReviewFilter(true); document.getElementById('home-actions')?.scrollIntoView?.(); }`，保留原有 `value: stats.pendingConfirmationCount` 与 `detail: 'AI 知识草稿等待你审核'`。
  - `#home-actions` 面板副标题 `<p>` 更新为：
    - `pipelineReview` 为真时保持 `'今日资讯待审草稿'`；
    - 否则当 `actions` 已加载且 `reviewFilter` 为真时显示 ``当前筛选待审草稿与工作流 ${currentActions.length} 项（共 ${actions.items.length} 项） · 稍后处理 ${deferredActions.length} 项``；
    - 否则当 `actions` 已加载（默认全量视图）时显示 ``当前待处理 ${currentActions.length} 项 · 稍后处理 ${deferredActions.length} 项``；
    - `actions` 未加载时保持 `actionError ? '事项暂不可用' : '正在读取事项…'`。

### U2-02：首页「最近更新」已删除 Wiki 条目禁止点击跳转 404
- [HomePage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/HomePage.tsx)：
  - 「最近更新」渲染 `stats.recentChanges.slice(0, 4)` 时增加 `disabled={change.action === 'delete'}`；
  - `onClick` 增加守卫 `onClick={() => { if (change.action !== 'delete') onOpenWiki(change.id); }}`；
  - `change.action === 'delete'` 时类型文案显示为 `'删除 Wiki（已移至回收区）'`（后接 `· 第 ${change.revision} 版`）。
- [home.css](file:///e:/AI/Work/AIPM%20Workspace/app/home.css)：
  - 补充 `.home-page .recent-row:disabled { cursor: not-allowed; opacity: 0.68; }` 与 `.home-page .recent-row:disabled:hover .recent-copy b { color: var(--ink); }`。

### U2-03：首页「周期回顾」修改日期后的空白面板反馈与起止日期校验
- [PeriodReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/components/PeriodReview.tsx)：
  - 新增 `loading` 状态（初始为 `true`），在 `load(a, b)` 发起请求前置 `setLoading(true)`，`finally` 中当 `current === generation.current` 时置 `setLoading(false)`；在 `change(fn)` 中置 `setLoading(false)` 并保留 `generation.current++`、`setData(null)`、`setError('')`（且不自动发起请求）。
  - 计算 `const invalidRange = Boolean(start && end && start >= end);`，并在 `load(a = start, b = end)` 开头增加 `if (a && b && a >= b)` 守卫（`generation.current++; setLoading(false); setData(null); setError(''); return;`）。
  - 仅在 `invalidRange` 时禁用「刷新回顾」按钮（`disabled={invalidRange}`），按钮文案保持 `'刷新回顾'`。
  - 当 `invalidRange` 为真时显示 `<p className="form-error" role="alert">开始日期需早于结束日期。</p>`；当 `!invalidRange && !error && !data` 时显示 `<p className="review-status-hint" role="status">{loading ? '正在读取周期回顾…' : \`日期范围已调整为 \${start} 至 \${end}，请点击「刷新回顾」加载该周期数据。\`}</p>`。
- [home.css](file:///e:/AI/Work/AIPM%20Workspace/app/home.css)：
  - 补充 `.period-review .review-status-hint` 样式（含 `overflow-wrap: anywhere` 以保证窄屏无溢出）。

### U2-04：自动化页待审资讯候选支持「全选可确认项 / 取消全选」
- [AutomationPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/AutomationPage.tsx)：
  - 在 `NewsInbox` 中计算 `confirmableVisible = [...visible, ...(expandedLow ? low : [])].filter(canConfirm)` 与 `allConfirmableSelected = confirmableVisible.length > 0 && confirmableVisible.every(row => selected.includes(row.id))`。
  - 在 `.automation-filters` 中（`batch.length > 0` 之前）渲染切换按钮：`allConfirmableSelected ? '取消全选' : \`全选可确认项（\${confirmableVisible.length} 条）\``，保留原有 `'批量确认入库（N 条）'` 按钮不变。
- [automation.css](file:///e:/AI/Work/AIPM%20Workspace/app/automation.css)：
  - 补充 `.automation-page .automation-filters .primary-button, .automation-page .automation-filters .secondary-button { max-width: 100%; white-space: normal; }`，确保 `390px` 视口按钮可正常换行且不溢出。

### U2-05：自动化页运行详情面板打开时的滚动定位与关闭后的焦点恢复
- [AutomationPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/AutomationPage.tsx)：
  - 新增 `const runTriggerRef = useRef<HTMLElement | null>(null);`。
  - 更新 `chooseRun(id: string, run: AutomationRun | null = null, trigger?: HTMLElement | null)` 与 `NewsInbox` 的 `onOpenRun: (id: string, trigger?: HTMLElement | null) => void`（调用处透传 `(id, trigger) => chooseRun(id, null, trigger)`），在「查看详情」「最近结果」「查看运行」「立即运行」（异步前同步捕获 `event.currentTarget`）传入触发元素，未传入时回退采集非 `document.body` 的 `document.activeElement`。
  - `useEffect` 在 `selectedRunId` 变化且存在时执行 `detailHeading.current?.scrollIntoView?.({ block: 'nearest' });` 与 `detailHeading.current?.focus();`。
  - 「关闭详情」点击时清零 `selectedRunId`、`detail` 与 `runTriggerRef.current`，若原触发元素 `trigger?.isConnected` 为真则调用 `trigger.focus()` 恢复焦点。

---

## 2. 变更文件清单与 SHA-256

| 变更类型 | 文件路径 | SHA-256 |
| --- | --- | --- |
| 修改 | `app/pages/HomePage.tsx` | `8EA7B9C2F3D254CF3FB3CA85853AD228B35BF3B427A7462199C48EA1E91C2412` |
| 修改 | `app/components/PeriodReview.tsx` | `4193A71BF8DFC5866A14684B54DCB27CA729E884A9F8EB0FDE3C5194A8F1FBFC` |
| 修改 | `app/pages/AutomationPage.tsx` | `A39320C3E48C713DAB24F67BC6414EF171A2ACF9EA4439876D1FB039C0B36B17` |
| 修改 | `app/home.css` | `7D928E227470CAEB93BCD9107F962C1BB807CF7ED21A7F993D68979EF1F9044D` |
| 修改 | `app/automation.css` | `8F7D9692BC94387DE004788E1F1FB19B73661E9DFB44B79DDB69FC66E2E20945` |
| 新增 | `tests/uifix02-ui.test.tsx` | `596CDD0CDE232AB481F1926FD72DE6D9F97B1F67DCBCD0338B1C08AB4CCD7F2A` |

（严格遵守文件所有权：仅修改白名单内 5 个产品文件并新增 `tests/uifix02-ui.test.tsx` 与本施工报告，未修改任何后端、工作区或既有未提交文件，未操作 git，未启停 4317/5151/5173 服务。）

---

## 3. 自检命令与实测结果（最终编辑完成后执行）

1. **任务卡第 4.1 项定向测试（新增 + 回归）**：
   ```powershell
   node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix02-ui.test.tsx tests/homeui01-ui.test.tsx tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l6-review-ui.test.tsx tests/run01-ui.test.tsx tests/pipe01-ui.test.tsx tests/ui.test.tsx tests/ui-interaction.test.tsx
   ```
   - **结果**：`tests 26` / `pass 26` / `fail 0`（退出码 `0`，耗时 `2600.4242ms`；其中 [uifix02-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix02-ui.test.tsx) 5 项测试覆盖 U2-01 ～ U2-05，全部通过）。

2. **补充 UI 导航与布局回归测试**：
   ```powershell
   node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix01-ui.test.tsx tests/ui01-interface.test.tsx tests/app-navigation.test.tsx tests/lifeos-l2-status-ui.test.tsx tests/lifeos-l3-navigation.test.tsx
   ```
   - **结果**：`tests 12` / `pass 12` / `fail 0`（退出码 `0`，耗时 `2431.0049ms`）。

3. **全产品类型检查**：
   ```powershell
   npm.cmd run typecheck
   ```
   - **结果**：退出码 `0`，`tsc -b` 零错误通过。

4. **前端生产构建**：
   ```powershell
   npm.cmd run build
   ```
   - **结果**：退出码 `0`，`tsc -b && vite build` 转换 238 个模块并完成打包（`dist/index.html` 0.54 kB、`dist/assets/index-DPm-4mIP.css` 106.34 kB、`dist/assets/index-DUg6Mkap.js` 823.43 kB，耗时 `1.71s`）。

---

## 4. 遗留与未测项（交由独立验收阶段）

- **真实 Edge 浏览器验收（`1440x900` & `390x844`）**：本阶段仅执行 JSDOM 单元/集成测试（本地 mock）、TypeScript 类型检查与生产构建；任务卡第 4.3 项的隔离端口生产产物启动、真实浏览器交互及 `390x844` 零横向溢出核验留待独立验收者执行。
- **已停写全部产品与测试文件，未触碰任何 git 写命令。**
