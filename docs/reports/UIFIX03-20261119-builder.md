# UIFIX03 施工报告（Builder）

- **批次 ID**：`UIFIX03`（UI 交互分批优化第三批）
- **基线提交**：`2b99daf6588c9423680534c18e2ad44e878fbcb2`（分支 `main`）
- **任务卡**：[UIFIX03-20261119-task.md](file:///e:/AI/Work/AIPM%20Workspace/docs/handoffs/UIFIX03-20261119-task.md)
- **施工日期**：2026-11-19
- **状态**：已完成 U3-01 ～ U3-05 施工与自测，任务卡第 4.1 项定向测试（36/36）、`typecheck` 与 `build` 均已通过；真实 Edge 浏览器验收（`1440x900` & `390x844`）交由独立验收者执行。

---

## 1. 交付项实现摘要（U3-01 ～ U3-05）

### U3-01：Raw 左侧列表搜索、状态筛选与独立滚动容器
- [RawPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawPage.tsx)：
  - 新增 `rawQuery` 与 `rawStatusFilter`（`'all' | RawStatus`）状态，基于 `processing[item.id]?.status ?? 'unprocessed'` 筛选状态，并按关键词不区分大小写匹配 `item.title`、`item.sourceName`、`sourceLabels[item.sourceType]` 与 `item.tags`；保留 `selected` 从完整 `items` 解析。
  - `.raw-list-panel` 中 `.list-title` 计数支持 `{items.length} 条` 与 `{filteredItems.length} / {items.length} 条` 切换；`items.length > 0` 时渲染 `.raw-list-filters`（搜索框 `aria-label="搜索原始资料"`、状态下拉 `aria-label="筛选资料处理状态"`、激活筛选时显示 `重置筛选`）；零匹配时渲染 `<p className="raw-filter-empty" role="status">没有匹配的原始资料。</p>` 代替空 `.raw-list`。
- [raw.css](file:///e:/AI/Work/AIPM%20Workspace/app/raw.css)：
  - 新增 `.raw-list-filters`、`.raw-list-filter-row`、`.raw-filter-empty` 样式，并为桌面端 `.raw-page .raw-list-panel>.raw-list` 增加 `max-height: 680px; overflow-y: auto`（在 `@media(max-width:800px)` 内保持移动端 `.raw-list-panel` 统一滚动）。

### U3-02：导入对话框新增显式「网页链接」Tab（严格兼容既有测试）
- [RawPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawPage.tsx)：
  - 将 `Mode` 扩展为 `'paste' | 'file' | 'url'`，在 `ImportDialog` 的 `.dialog-tabs` 新增第 3 个 `role="tab"` 按钮「网页链接」（切换至 `'url'` 时调用 `removeFile()` 防止隐藏文件覆盖 URL 提交）。
  - 保留严格兼容的物料与 `urlOnly` 判定，并在 `submit` 中针对 `mode !== 'url' && file` 与 `material === 'url'` 分支做防御，确保 `'url'` 模式下隐藏 `.body-field` 与 `.file-picker`、保留元数据及中文翻译复选框、并将「原始链接」标为必填（`<em>*</em>`、`required={mode === 'url'}`、`placeholder="https://…"`），同时保留已填入的 `form.url` 与 `form.body`，`'paste'` / `'file'` 模式行为保持 100% 兼容。
- [raw.css](file:///e:/AI/Work/AIPM%20Workspace/app/raw.css)：
  - 为 `.dialog-tabs` 增加 `flex-wrap: wrap`，`.dialog-tab` 设置 `flex: 1 1 140px; min-width: 0; padding: 6px 10px;`，并补充 `@media(max-width:760px)` 下表单栅格与底部操作栏换行保护，保证 `390px` 视口无横向溢出。

### U3-03：成果审核页吸顶减负、全选与门禁提示
- [b04.css](file:///e:/AI/Work/AIPM%20Workspace/app/b04.css)：
  - 优化 `.draft-page .outcome-confirm` 吸顶样式（`padding: 12px 16px; margin-bottom: 0; border-color: #d8d1fb; box-shadow: 0 4px 12px rgba(23, 32, 51, 0.06);`），新增 `.outcome-cards-heading` 与 `.maintenance-gate-hint`。
- [RawOutcomeReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawOutcomeReview.tsx)：
  - 计算 `selectablePageIds` 与 `allSelectableChosen`，在 `<section className="outcome-cards">` 首个子 `div` 保留 `.outcome-cards-heading` 包装以维持 `.outcome-cards > div:first-child` 跨双列规则，并在 `selectablePageIds.length > 0 && !(view.maintenance && view.discardedAt)` 时在右侧渲染「全选可选主题（N 项）/ 取消全选主题」按钮。
- [KnowledgeMaintenanceReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/KnowledgeMaintenanceReview.tsx)：
  - 在顶部操作区计算 `gateHint`（覆盖编辑候选正文、深度笔记未保存、跳过已单独告警的 `unresolved > 0`、笔记未核对、未接受任何变更、依赖项未一并接受、已接受项未勾选「我已核对」），非空时于顶部渲染 `<p className="notice-warn maintenance-gate-hint" role="status">{gateHint}</p>`。

### U3-04：工作事项列表搜索与类型/状态筛选
- [WorkItemsPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/WorkItemsPage.tsx)：
  - 在 `WorkItemsPage` 列表模式新增 `searchQuery`、`kindFilter`（`'all' | WorkItemKind`）与 `statusFilter`（`'all' | 'active' | 'closed'`），更新计数展示（`{items.length} 项` / `{filteredItems.length} / {items.length} 项`），在 `items.length > 0` 时渲染 `.work-list-filters` 与「重置筛选」，零匹配时展示 `<p className="work-note" role="status">没有匹配筛选条件的工作事项。</p>`。
- [styles.css](file:///e:/AI/Work/AIPM%20Workspace/app/styles.css)：
  - 新增 `.work-list-filters` 及 `@media (max-width: 620px)` 移动端折行适配样式。

### U3-05：工作事项详情页删除入口收拢与未保存修改返回防丢
- [WorkItemsPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/WorkItemsPage.tsx)：
  - 将「删除事项」触发按钮移入 `.page-heading` 右侧 `.work-buttons`，首屏隐藏「删除工作事项」面板，仅在 `deleteConfirm || deleteError` 时展开，保留原有 `取消删除`、`确认删除事项` 文案与 `remove()` 成功后直接 `onBack()` 行为。
  - 计算 `currentDirty`、`historyDirty`、`reportDirty` 与 `anyDirty`，分别在 `#work-current` 与 `#work-history` 标题旁通过 `.work-section-title-group` 渲染 `<span className="work-dirty-badge" role="status">有未保存修改</span>`；新增 `leaveConfirm` 状态，在 `anyDirty` 为真时点击「返回工作事项」展开 `role="alert" aria-label="未保存修改确认"` 内联确认面板（「继续编辑」/「放弃修改并返回」），当保存或撤销修改使 `anyDirty` 变为 `false` 时自动复位 `leaveConfirm`。
- [styles.css](file:///e:/AI/Work/AIPM%20Workspace/app/styles.css)：
  - 新增 `.work-section-title-group`、`.work-dirty-badge` 与 `.work-leave-confirm` 样式。

---

## 2. 变更文件清单与 SHA-256

| 变更类型 | 文件路径 | SHA-256 |
| --- | --- | --- |
| 修改 | `app/pages/RawPage.tsx` | `3321D0170E71E3989FEDEFEFB3878BFDD4C193B69236F0974EB0B1E2476338C3` |
| 修改 | `app/pages/RawOutcomeReview.tsx` | `AB450DBDA886968B5B61A406D4600484ADC03C601BA418FB51307D4E9D22F3BC` |
| 修改 | `app/pages/KnowledgeMaintenanceReview.tsx` | `D49A275745E3449736813B43A63F713C63A85458634B79BA72A605F57440ED15` |
| 修改 | `app/pages/WorkItemsPage.tsx` | `4E3991338D4F7E8A8C2C4D48A4120D276799FF7701BC943494D55BA06FF95EF7` |
| 修改 | `app/raw.css` | `5B350AFA5DC4C2B5069B1A63C6042DEE3A3B4E6DB7E4CBF630A6C1F3A60CC9CA6` |
| 修改 | `app/b04.css` | `AAD4DD3EDFAC78A1EDFCC48196C3328596199266EADFAD49DC185CAD8182B909` |
| 修改 | `app/styles.css` | `E1AD4B7138AAD7B44E6A87A615B93F9A9A5CF7A8E952F0E99093446544E3FF2B` |
| 新增 | `tests/uifix03-ui.test.tsx` | `301D8CD25F2D031606CD2CECB7F85B4E95420B1D8D0E35EAABD50725EB7DCE04` |

（严格遵守文件所有权：仅修改白名单内 7 个产品文件并新增 [uifix03-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix03-ui.test.tsx) 与本施工报告，未修改任何后端、工作区或既有未提交文件，未执行 `git commit` / `git push`，未启停 `4317`/`5151`/`5173` 服务。）

---

## 3. 自检命令与实测结果（最终编辑完成后执行）

1. **任务卡第 4.1 项定向测试（新增 + 回归）**：
   ```powershell
   node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix03-ui.test.tsx tests/ui02-interface.test.tsx tests/ui04-interface.test.tsx tests/rawurl01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf01-ui.test.tsx tests/pdf02-ui.test.tsx tests/work-delete.test.ts tests/customer-reply.test.ts tests/uifix01-ui.test.tsx tests/uifix02-ui.test.tsx
   ```
   - **结果**：`tests 36` / `pass 36` / `fail 0`（退出码 `0`，耗时 `3338.553ms`；其中 [uifix03-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix03-ui.test.tsx) 5 项测试覆盖 U3-01 ～ U3-05，全部通过，全部使用本地 mock，零真实网络或大模型请求）。

2. **全产品类型检查**：
   ```powershell
   npm.cmd run typecheck
   ```
   - **结果**：退出码 `0`，`tsc -b` 零错误通过。

3. **前端生产构建**：
   ```powershell
   npm.cmd run build
   ```
   - **结果**：退出码 `0`，`tsc -b && vite build` 转换 238 个模块并完成打包（`dist/index.html` 0.54 kB、`dist/assets/index-BG2sk7xy.css` 108.61 kB、`dist/assets/index-YKQqu2MW.js` 829.14 kB，耗时 `1.68s`）。

---

## 4. 遗留与未测项（交由独立验收阶段）

- **真实 Edge 浏览器验收（`1440x900` & `390x844`）**：本阶段仅完成 JSDOM 单元/集成测试（本地 mock）、TypeScript 类型检查与生产构建；任务卡第 4.3 项的隔离端口与临时 `FMCG_DATA_DIR` 启动、真实浏览器交互核验及 `390x844` 零横向溢出检查交由独立验收者执行。
- **已停写全部产品与测试文件，未触碰任何 git 写命令。**
