# UIFIX03 独立验收报告（Independent Reviewer）

- **批次 ID**：`UIFIX03`（UI 交互分批优化第三批）
- **基线提交**：`2b99daf6588c9423680534c18e2ad44e878fbcb2`（`main` + 当前工作树 UIFIX03 修改）
- **任务卡**：[UIFIX03-20261119-task.md](file:///e:/AI/Work/AIPM%20Workspace/docs/handoffs/UIFIX03-20261119-task.md)
- **施工报告**：[UIFIX03-20261119-builder.md](file:///e:/AI/Work/AIPM%20Workspace/docs/reports/UIFIX03-20261119-builder.md)
- **验收日期**：2026-11-19
- **独立性声明**：本报告由独立验收子 Agent（`0503a0d3-e9d9-42e1-8cc3-2c1d8d2dba66`）在施工 Agent（`6982b921-c9bb-41df-be71-25c2a6c20b4a`）停写后独立执行，未直接采信施工方自测描述，全部哈希校验、代码审阅、回归单测、构建与隔离 Edge 浏览器端到端验证均独立重新执行。未修改任何产品代码，未执行 `git commit` / `git push`。

---

## 1. 双项验收结论

1. **本轮施工范围内的缺陷（`U3-01` ～ `U3-05`）修复结论**：**PASS**（全部 5 项均已按任务卡规格正确实现并通过 JSDOM 单测及隔离真实 Edge 浏览器桌面/移动端实测）。
2. **`UIFIX03` 当前批次整体是否满足验收标准**：**PASS**（文件边界合规、8/8 变更与新增文件 SHA-256 与施工报告完全一致、定向回归 36/36 通过、`typecheck` 与 `build` 零错误通过、隔离真实 Edge `1440x900` 与 `390x844` 零报错零外网请求通过）。

---

## 2. 文件边界审计与 SHA-256 独立重算

通过 `git status --short app/ server/ services/ workspace/ tests/ .env.local` 与 `git diff --name-only app/ server/ services/ workspace/` 核查：
- `app/` 仅修改任务卡白名单内的 7 个产品文件，无 `server/`、`services/`、`workspace/` 或 `.env.local` 变更；
- `tests/` 仅新增施工单测 [uifix03-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix03-ui.test.tsx) 与本轮独立浏览器验收脚本 [uifix03-review-browser.mjs](file:///e:/AI/Work/AIPM%20Workspace/tests/acceptance/uifix03-review-browser.mjs)，既有工作区未提交测试文件（`AUTO01-review-actions.test.ts`、`rawzh01-builder-browser.mjs`、`rawzh01-ui.test.tsx`、`news01-sources.test.ts`）未受影响。

独立运行 `Get-FileHash -Algorithm SHA256` 结果逐条比对如下：

| 变更类型 | 文件路径 | 独立重算 SHA-256 | 与施工报告比对 |
| --- | --- | --- | --- |
| 修改 | [RawPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawPage.tsx) | `3321D0170E71E3989FEDEFEFB3878BFDD4C193B69236F0974EB0B1E2476338C3` | 一致 |
| 修改 | [RawOutcomeReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawOutcomeReview.tsx) | `AB450DBDA886968B5B61A406D4600484ADC03C601BA418FB51307D4E9D22F3BC` | 一致 |
| 修改 | [KnowledgeMaintenanceReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/KnowledgeMaintenanceReview.tsx) | `D49A275745E3449736813B43A63F713C63A85458634B79BA72A605F57440ED15` | 一致 |
| 修改 | [WorkItemsPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/WorkItemsPage.tsx) | `4E3991338D4F7E8A8C2C4D48A4120D276799FF7701BC943494D55BA06FF95EF7` | 一致 |
| 修改 | [raw.css](file:///e:/AI/Work/AIPM%20Workspace/app/raw.css) | `5B350AFA5DC4C2B5069B1A63C6042DEE3A3B4E6DB7E4CBF630A6C1F3A60CC9CA6` | 一致 |
| 修改 | [b04.css](file:///e:/AI/Work/AIPM%20Workspace/app/b04.css) | `AAD4DD3EDFAC78A1EDFCC48196C3328596199266EADFAD49DC185CAD8182B909` | 一致 |
| 修改 | [styles.css](file:///e:/AI/Work/AIPM%20Workspace/app/styles.css) | `E1AD4B7138AAD7B44E6A87A615B93F9A9A5CF7A8E952F0E99093446544E3FF2B` | 一致 |
| 新增 | [uifix03-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix03-ui.test.tsx) | `301D8CD25F2D031606CD2CECB7F85B4E95420B1D8D0E35EAABD50725EB7DCE04` | 一致 |
| 验收新增 | [uifix03-review-browser.mjs](file:///e:/AI/Work/AIPM%20Workspace/tests/acceptance/uifix03-review-browser.mjs) | `89612A26A6BB1B3155FA17FC2BBD2745F3C94676F75C1EBE301A005A712FD06B` | 本轮验收脚本 |

---

## 3. 代码与测试审查要点

- **U3-01（`RawPage.tsx` / `raw.css`）**：`filteredItems` 基于 `processing[item.id]?.status ?? 'unprocessed'` 与 `item.title`、`item.sourceName`、`sourceLabels[item.sourceType]`、`item.tags` 不区分大小写匹配；`selected` 仍从完整 `items` 解析，左栏筛选或零匹配（展示 `.raw-filter-empty` 替代 `.raw-list`）时不丢失右栏当前选中详情。桌面端 `.raw-page .raw-list-panel>.raw-list` 设置 `max-height: 680px; overflow-y: auto`，并在 `@media(max-width:800px)` 内恢复 `max-height: none; overflow-y: visible` 由 `.raw-list-panel` 统一滚动，移动端适配准确。
- **U3-02（`RawPage.tsx` / `raw.css`）**：`ImportDialog` 新增第 3 个 `role="tab"`「网页链接」（切换至 `'url'` 时调用 `removeFile()` 清除隐藏文件），隐藏 `.body-field` 与 `.file-picker` 且标记「原始链接」为 `required`。在 `'paste'` 与 `'file'` 模式下，`material` 与 `urlOnly` 自动判定保持兼容（含空正文/无文件时填入 URL 走 `/api/raw/import`），且保留用户已填 `form.url` 与 `form.body`。`.dialog-tabs` 添加 `flex-wrap: wrap`，`@media(max-width:760px)` 保护栅格和底栏在 `390px` 视口折行不溢出。
- **U3-03（`RawOutcomeReview.tsx` / `KnowledgeMaintenanceReview.tsx` / `b04.css`）**：
  - `RawOutcomeReview` 将 `<section className="outcome-cards">` 首个子元素保留为 `<div className="outcome-cards-heading">`，确保 `.outcome-cards > div:first-child { grid-column: 1 / -1; }` 继续跨双列；`selectablePageIds` 排除 `!disabled`、`!editing`、`!adjustment`、`!change?.committedOperationId` 与无 `change` 时的 `reviewDecision === 'update'` 卡片，支持「全选可选主题（N 项）/ 取消全选主题」切换。
  - `KnowledgeMaintenanceReview` 与真实路由核对：`DraftStore.view`（[drafts.ts](file:///e:/AI/Work/AIPM%20Workspace/services/wiki/drafts.ts#L897-L916)）对非问答/检查草稿必返 `outcomeDigest`，对 `isQuestionDraft`（`question_answer` / `inspection`）不返回 `outcomeDigest`；[DraftReviewPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/DraftReviewPage.tsx#L236-L355) 先按 `view.input` 路由至 `KnowledgeMaintenanceReview`，其次按 `outcomeMode` 路由至 `RawOutcomeReview`。`KnowledgeMaintenanceReview` 顶部 `gateHint` 覆盖 `editingCount > 0`、`noteDirty`、`unresolved > 0`（跳过以防重复提示）、`noteUnapproved`、`accepted.length === 0`、`missingDeps`、`unapprovedCount > 0`，且提交按钮 `disabled` 中的 `noteUnapproved` 与 `StructuredNoteEditor` 的 `!view.input && view.structuredNote` 渲染门禁完全对齐。
- **U3-04 & U3-05（`WorkItemsPage.tsx` / `styles.css`）**：
  - 列表模式支持关键词、事项类型、进展状态（进行中/已关闭）组合筛选，空匹配展示「没有匹配筛选条件的工作事项。」及「重置筛选」。
  - `WorkItemDetail` 首屏不渲染独立的「删除工作事项」面板，「删除事项」触发按钮置于 `.page-heading .work-buttons`，点击后展开确认面板（取消可收起，确认删除后直接返回列表）。
  - `anyDirty = currentDirty || (!product && (historyDirty || reportDirty))` 精确覆盖「当前情况」（含 `closing && closureReason.trim()` 与 `product && analysisDirty`）与客户问题的「处理记录 / 手工技术反馈」，`useEffect` 在 `!anyDirty` 时自动收起 `leaveConfirm`，并保留「继续编辑 / 放弃修改并返回」内联确认面板。
- **测试质量审查（`tests/uifix03-ui.test.tsx`）**：5 项测试覆盖全部 `U3-01` ～ `U3-05` 交付点与关键状态分支，无跳过（`skip`/`todo`）或空壳断言，全部基于 JSDOM 交互事件与本地 mock `fetch`。

---

## 4. 独立回归测试、类型检查与前端构建结果

1. **定向新增与回归测试（11 个测试文件）**：
   ```powershell
   node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix03-ui.test.tsx tests/ui02-interface.test.tsx tests/ui04-interface.test.tsx tests/rawurl01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf01-ui.test.tsx tests/pdf02-ui.test.tsx tests/work-delete.test.ts tests/customer-reply.test.ts tests/uifix01-ui.test.tsx tests/uifix02-ui.test.tsx
   ```
   - **实测结果**：退出码 `0`，`tests 36` / `pass 36` / `fail 0` / `skipped 0`（耗时 `3365.7769ms`）。

2. **全产品类型检查**：
   ```powershell
   npm.cmd run typecheck
   ```
   - **实测结果**：退出码 `0`（`tsc -b` 零诊断）。

3. **前端生产构建**：
   ```powershell
   npm.cmd run build
   ```
   - **实测结果**：退出码 `0`（`tsc -b && vite build` 转换 `238` 个模块，`dist/index.html 0.54 kB`、`dist/assets/index-BG2sk7xy.css 108.61 kB`、`dist/assets/index-YKQqu2MW.js 829.14 kB`，耗时 `1.71s`）。

---

## 5. 独立真实 Edge 浏览器隔离端到端实测

- **执行命令**：
  ```powershell
  node --import tsx tests/acceptance/uifix03-review-browser.mjs
  ```
- **隔离环境**：
  - 临时数据目录（`FMCG_DATA_DIR`）：`C:\Users\80593\AppData\Local\Temp\uifix03-review-bLz6Er\data`
  - 隔离随机端口：API `64336`、UI Preview `64337`（未触碰用户运行中的 `4317` / `5151` / `5173`，未读写 `workspace/`）
  - 浏览器版本：Microsoft Edge `157.0.4341.60`
  - 外部请求防护：服务端 preload 拦截并记录全部非 localhost 出站请求，浏览器路由阻止全部非 `uiBase` 请求；实测 `blockedBrowserExternalRequests: []`、`serverExternalRequests: []`。

### 桌面端 `1440x900` 实测断言摘要
- **U3-01（Raw 列表筛选与独立滚动）**：初始 `10 条`；`.raw-page .raw-list-panel > .raw-list` 计算样式 `maxHeight: "680px"`、`overflowY: "auto"`，实测 `clientHeight: 680`、`scrollHeight: 936`（真实触发列表内滚动）；选中「UIFIX03 华东渠道调研样本」后，分别按关键词「待审目标」（`1 / 10 条`）、状态 `pending_confirmation`（`1 / 10 条`）、`unprocessed`（`6 / 10 条`）及无匹配关键词（`0 / 10 条`，展示「没有匹配的原始资料。」且不渲染 `.raw-list`）筛选，右栏始终保留已选中详情未丢失；点击「重置筛选」恢复 `10 条`。
- **U3-02（ImportDialog 3 Tab 交互）**：3 个 Tab 正常切换；在「上传文件」选入 `u302-sample.txt` 后切至「网页链接」，`.body-field` 与 `.file-picker` 及 `.file-picked` 均隐藏/清理，链接输入 `required: true`、`placeholder: "https://…"`、标签含 `原始链接 *`，中文翻译复选框与「从网页导入 Raw」主按钮直接可见；填入 `https://uifix03-fixture.invalid/article` 后切回「粘贴文本」，URL 原样保留且恢复 `.body-field`（链接恢复可选）；填入正文提交「仅保存 Raw」（`POST /api/raw` 返回 `201`），列表增至 `11 条` 且详情正确显示。
- **U3-03a（`RawOutcomeReview` 吸顶与全选）**：`.draft-page .outcome-confirm` 计算样式 `position: "sticky"`、`top: "8px"`、`padding: "12px 16px"`、`boxShadow: "rgba(23, 32, 51, 0.06) 0px 4px 12px 0px"`；`.outcome-cards > div:first-child` 含 `.outcome-cards-heading` 且实测 `sectionWidth: 1096`、`headingWidth: 1096`、`singleCardWidth: 544`（确认为双列全宽）；对含 2 项可选 + 1 项 `reviewDecision: 'update'`（checkbox 为 `disabled` 且未勾选）的真实草稿，点击「全选可选主题（2 项）」联动为「取消全选主题」与「确认所选成果入库（2）」（按钮可用），再次点击恢复未选与禁用状态。
- **U3-03b（`KnowledgeMaintenanceReview` 门禁提示与解锁）**：通过真实 `KnowledgeAnswer` 与 `DraftStore.createQuestion` 构造含依赖项（`chg-1` 依赖 `chg-2`）的问答维护草稿并打开审核页；实测验证 `gateHint` 在「请至少接受 1 项知识变更后再确认写入。」→ 未归属时（`unresolved > 0`）不重复渲染（仅展示未归属告警）→ 恢复归属后仅接受 `chg-1` 时提示「已接受变更存在未一并接受的依赖项，请先接受对应依赖项。」→ 接受 `chg-2` 后提示「尚有 2 项已接受变更未勾选底部「我已核对」复选框。」→ 核对 `chg-1` 后变为 `尚有 1 项` → 编辑 `chg-2` 候选正文时切换为「有 1 项候选正文正在编辑中，请先保存编辑并重新审核。」→ 保存编辑并核对 `chg-2` 后 `gateHint` 消失且「确认写入 Wiki（2）」按钮解锁；实际点击提交返回 `201`，展示「已保存本次 2 项变更」。
- **U3-04 & U3-05（工作事项筛选、删除收拢与未保存防丢）**：初始 `4 项`；关键词「分析」（`1 / 4 项`）、类型 `customer_issue`（`2 / 4 项`）+ 状态 `closed`（`1 / 4 项`）、零匹配显示「没有匹配筛选条件的工作事项。」（`0 / 4 项`），「重置筛选」恢复 `4 项`。打开详情首屏无 `section[aria-label="删除工作事项"]`，「删除事项」位于头部操作区，展开后可「取消删除」；无修改直接返回列表；输入未保存文字后 `#work-current` / `#work-history` 出现「有未保存修改」徽标，点击「返回工作事项」弹出 `未保存修改确认` 面板，「继续编辑」保留输入，保存后自动收起 `leaveConfirm` 与徽标，「放弃修改并返回」回到列表；产品分析修改后撤销自动消除徽标，并经头部「删除事项」→「确认删除事项」（`DELETE` 返回 `200`）真实验证删除后列表减至 `3 项`。

### 移动端 `390x844` 响应式实测结果
全部 9 个关键页面与弹窗状态均满足 `document.documentElement.scrollWidth === 390 === window.innerWidth`（无整页横向溢出）：

| 检查页面 / 状态 | `innerWidth` | `scrollWidth` | 整页横向溢出 |
| --- | --- | --- | --- |
| `work-items-list-filters` | 390 | 390 | `false` |
| `work-item-detail-dirty-leave` | 390 | 390 | `false` |
| `raw-list-with-filters` | 390 | 390 | `false` |
| `raw-list-filter-empty` | 390 | 390 | `false` |
| `raw-import-dialog-paste` | 390 | 390 | `false` |
| `raw-import-dialog-file` | 390 | 390 | `false` |
| `raw-import-dialog-url` | 390 | 390 | `false` |
| `raw-outcome-review` | 390 | 390 | `false` |
| `knowledge-maintenance-review` | 390 | 390 | `false` |

- **运行稳定性与清理**：全程 `pageErrors: []`、`consoleErrors: []`、`httpErrors: []`、`blockedBrowserExternalRequests: []`、`serverExternalRequests: []`；浏览器、预览服务与隔离 API 子进程全部正常关闭（`closed: { browser: true, ui: true, api: true }`）。（附注：`evidence.json` 显示 `knowledge-maintenance-review` 内既有 `.draft-card-body` 容器因原有 `.draft-select { white-space: nowrap; }` 样式存在 `scrollWidth: 368 / clientWidth: 356` 局部裁剪，但 `right: 374 <= 390` 且未引起页面级横向溢出，属原有样式范围，不影响 UIFIX03 交付。）
