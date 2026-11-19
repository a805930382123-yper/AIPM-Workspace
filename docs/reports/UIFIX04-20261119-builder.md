# UIFIX04 施工报告（Builder）

- **批次 ID**：`UIFIX04`（全站 UI 交互分批优化第四批 / 收官批次）
- **基线提交**：`79e4dda5b35f097bdc6441e03c064c06bf7bb5`（分支 `main`）
- **任务卡**：[UIFIX04-20261119-task.md](file:///e:/AI/Work/AIPM%20Workspace/docs/handoffs/UIFIX04-20261119-task.md)
- **施工日期**：2026-11-19
- **状态**：已完成 U4-01 ～ U4-05 施工与自测，任务卡第 4.1 项定向测试（53/53）、第 4.2 项 `typecheck` 与 `build` 均已通过；真实 Edge 浏览器验收（`1440x900` & `390x844`）交由独立验收者执行。

---

## 1. 交付项实现摘要（U4-01 ～ U4-05）

### U4-01：知识库 Markdown 原文「选段提交 Audit」交互顺畅化
- [WikiPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/WikiPage.tsx)：
  - `WikiDetail` 向 `<AuditPanel>` 新增传入 `onClearAnchor={() => setAnchor(null)}`。
  - `AuditPanel` 新增 `pendingAnchor`、`focusCommentRequest` 与 `commentRef = useRef<HTMLTextAreaElement>(null)`（绑定至反馈 `<textarea>`）：
    - 在 `item.id` 变更或 `selectedAnchor === null` 时同步清空 `pendingAnchor`；
    - 监听 `audit:create-paragraph` 事件且校验 `anchor?.text` 非空时立即设置 `setExpanded(true)` 与 `setPendingAnchor(anchor)`；当 `comment.trim()` 非空时直接调用 `void create('paragraph', anchor)`，当 `!comment.trim()` 时不直接报错，清除既有错误 `setError('')` 并递增 `focusCommentRequest`，由 `useEffect` 在面板展开后调用 `commentRef.current?.scrollIntoView?.({ block: 'nearest' })` 与 `commentRef.current?.focus()`；
    - 基于 `activeAnchor = pendingAnchor ?? selectedAnchor` 在 `.audit-create` 顶部渲染 `.audit-bound-anchor`（`role="status"`）绑定提示与「改为整页 Audit」清除按钮，操作区 `.audit-create-actions` 在绑定段落时提供主按钮「提交选中段落 Audit」与次按钮「提交整页 Audit」，未绑定时保留单一主按钮「提交整页 Audit」；
    - `create('paragraph', ...)` 提交成功后自动清空 `pendingAnchor` 并触发 `onClearAnchor?.()`。
- [wiki.css](file:///e:/AI/Work/AIPM%20Workspace/app/wiki.css)：
  - 新增 `.audit-bound-anchor` 与 `.audit-create-actions` 换行与防溢出样式。

### U4-02：知识库待审提示前置与主动检查面板范围搜索/清空
- [WikiPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/WikiPage.tsx)：
  - 在 `#wiki-view-overview` 中将 `pendingWorkflows`（待审核更新与综合）与 `pendingDrafts`（待审核草稿）两个 `<section>` 移至 `{error && ...}{notice && ...}` 之后、`.wiki-workspace` 上方，并在 [wiki.css](file:///e:/AI/Work/AIPM%20Workspace/app/wiki.css) 为 `.wiki-page .pending-knowledge-workflows` 与 `.wiki-page .pending-wiki-drafts` 补充底部外边距 `14px`。
- [WikiInspectionPanel.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/components/WikiInspectionPanel.tsx)：
  - 新增 `scopeQuery` 状态并按 `p.title` 不区分大小写计算 `filteredItems`（保留未展示在当前过滤结果的已选 ID）。
  - 在 `<fieldset>` 内 `<legend>` 与 `.inspection-scope-picker` 之间新增 `.inspection-scope-toolbar`，提供 `input[type="search"][aria-label="搜索检查范围知识页"]` 与在 `selected.length > 0` 时展示「清空已选（N）」按钮；零过滤结果时展示 `<p className="muted-copy" role="status">没有匹配该关键词的知识页。</p>`。未新增任何额外 `input[type=checkbox]`，保持与 [lw03-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/lw03-ui.test.tsx) 100% 兼容。
- [wiki.css](file:///e:/AI/Work/AIPM%20Workspace/app/wiki.css)：
  - 新增 `.inspection-scope-toolbar` 样式及移动端换行适配。

### U4-03：会议档案列表滚动、纪要默认展开、弹窗焦点/Escape 与 URL 参数清理
- [meeting.css](file:///e:/AI/Work/AIPM%20Workspace/app/meeting.css)：
  - 增加 `.meeting-page .meeting-list-panel > .meeting-list { max-height: 680px; overflow-y: auto; }`，保留 `@media(max-width:760px)` 与 `@media(max-width:800px)` 中 `.meeting-list-panel` 响应式滚动规则。
- [MeetingPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/MeetingPage.tsx)：
  - 为「本地会议纪要」`<details>` 设置 `key={\`minutes-group:${detail.meeting_id}:${detail.imports.length > 0 ? 'has' : 'empty'}\`} open={detail.imports.length > 0}`，切换会议或首次导入后准确同步默认展开/折叠状态。
  - 引入 [useDialogFocus.ts](file:///e:/AI/Work/AIPM%20Workspace/app/components/useDialogFocus.ts) 接入 `MeetingEditor`、`PolicyDialog` 与 `CatalogDialog`，三者均绑定 `useDialogFocus<HTMLElement>()`、`tabIndex={-1}` 与 `Escape` 键关闭（在非 `saving`/`busy` 时生效），并为 `PolicyDialog`、`CatalogDialog` 的 `.modal-scrim` 补充 `onMouseDown` 点击遮罩关闭（`!busy` 时生效）。
- [App.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/App.tsx)：
  - 定义 `MEETING_QUERY_KEYS = ['meeting', 'mq', 'mt', 'mg', 'mc', 'mp', 'ml', 'mo']`，在 `nav(destination, preferredRawId)` 切换至 `destination !== 'meeting'` 且 `window.location.search` 存在上述任意会议参数时，使用 `window.history.replaceState` 精准移除会议参数并保留其他查询参数及 `window.location.hash`。

### U4-04：会议纪要编辑工作副本增加就近保存按钮
- [MeetingMinutes.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/MeetingMinutes.tsx)：
  - 在 `editing` 状态的 `.meeting-minute-actions` 内、「取消编辑」左侧新增 `<button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? '正在保存…' : '保存工作副本'}</button>`，完整保留底部 `.meeting-minute-save` 的「保存会议档案」按钮、禁用逻辑及状态提示（100% 兼容 [meetui01-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/meetui01-ui.test.tsx)）。
- [meeting.css](file:///e:/AI/Work/AIPM%20Workspace/app/meeting.css)：
  - 为 `.meeting-page .meeting-minute-actions` 补充 `flex-wrap: wrap;`。

### U4-05：Prompt 生成/优化保存后直达模板库及筛选栏对齐
- [PromptAiWorkbench.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/PromptAiWorkbench.tsx)：
  - 将 `Props.onLibrary` 扩展为 `(promptId?: string) => void`，并将顶部「返回模板库」按钮改为 `onClick={() => onLibrary()}` 防止误传 `MouseEvent`。
  - 新增 `savedPromptId` 状态，在 `edit()`、`runBrief()`、`generate()`、`optimize()`、`recoverDraft()` 重置为 `null`，在 `save()` 提交确认与异常对账确认分支分别写入 `result.prompt.id` 与 `details.promptId`。
  - 将 `.prompt-message.success-message` 调整为 `<div>` 容器并在 `confirmed && savedPromptId` 时展示「在模板库中查看」按钮（`.prompt-view-library`），同时在 `.editor-footer` 的 `confirmed && savedPromptId` 分支渲染主按钮「在模板库中查看」。
- [PromptLibraryPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/PromptLibraryPage.tsx)：
  - 更新 `<PromptAiWorkbench>` 的 `onLibrary` 回调：切回 `'library'`，若存在 `promptId` 则清空 `query`、`category`、`tag`、`favoriteOnly`（同步更新 `conditionsRef.current`），调用 `selectId(promptId)` 并执行 `void refreshList()`。
- [prompt.css](file:///e:/AI/Work/AIPM%20Workspace/app/prompt.css)：
  - 第 20 行调整为 `.prompt-page .field.prompt-tag-filter input { height: 36px; padding: 0 10px; }`（优先级 `(0, 3, 1)`，稳压在 `main.tsx` 较晚引入的 `styles.css` 第 58 行 `.field input, .field select { height: 35px; padding: 0 10px; }` 优先级 `(0, 1, 1)` 与 `.prompt-page .field input` 优先级 `(0, 2, 1)` 之上），并补充 `.prompt-message` 换行及 `.prompt-view-library` 防换行挤压样式。

---

## 2. 变更文件清单与 SHA-256

| 变更类型 | 文件路径 | SHA-256 |
| --- | --- | --- |
| 修改 | `app/pages/WikiPage.tsx` | `EC70F04D971162052416CC13FB8A4CFFF951510751268DE7DD42B5D9476ACEE5` |
| 修改 | `app/components/WikiInspectionPanel.tsx` | `63EDC077E3E9C120FAEAC1C144BD950ADC442F381AE025E074DCA94199CF0D1D` |
| 修改 | `app/pages/MeetingPage.tsx` | `A1F2997478AABE7F49A61E33006F3411E9C9A221F1C59C0225F9162D4148CD3E` |
| 修改 | `app/MeetingMinutes.tsx` | `D078357C6E52C70D2DEF4841F625C7BBBE3864DCAB8C9DCD390A5DB47ED36347` |
| 修改 | `app/pages/PromptLibraryPage.tsx` | `222A485B83D028D48EAE6E94AD07FB4C8E7896355F5F973F71EB65B7A01D34D6` |
| 修改 | `app/pages/PromptAiWorkbench.tsx` | `2DD9E79D44CA1F5DE8D3DA13C6B888DC4CE514C8B5A3C6F2161467C15F64F9F2` |
| 修改 | `app/App.tsx` | `5248AF90E2330B758F9A3575C936A15BEE3758B660A0734B5B0269544CE06BD7` |
| 修改 | `app/wiki.css` | `5D22B4952F12785C697CFAD1895D66128EE20A5E46804E10C16C17A30181ABAF` |
| 修改 | `app/meeting.css` | `7284DA92B438EAB27F2DE6B83C3C45B6B5DE0E89B95F2249B4733EFB650A2B50` |
| 修改 | `app/prompt.css` | `7216255AC2EA2D8A3440CFFEC6393EFB47A3EDD67A1BAF030BBBF29B21267745` |
| 新增 | `tests/uifix04-ui.test.tsx` | `37A466D74E009EAF550508EAF01D478BB845D54446E00C3CD215748A00ED6700` |

（严格遵守文件所有权：仅修改白名单内 10 个产品文件并新增 [uifix04-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix04-ui.test.tsx) 与本施工报告，未修改任何后端、工作区或既有未提交文件，未执行 `git commit` / `git push`，未启停 `4317`/`5151`/`5173` 服务。）

---

## 3. 自检命令与实测结果（返修最终编辑完成后执行）

1. **任务卡第 4.1 项定向测试（新增 + 回归）**：
   ```powershell
   node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix04-ui.test.tsx tests/wiki-selection.test.tsx tests/lw03-ui.test.tsx tests/meeting-ui.test.tsx tests/meetui01-ui.test.tsx tests/meeting-raw-ui-m04.test.tsx tests/meeting-integration-m05.test.tsx tests/prompt-ui.test.tsx tests/lifeos-l4-guidance-ui.test.tsx tests/uifix01-ui.test.tsx tests/uifix02-ui.test.tsx tests/uifix03-ui.test.tsx
   ```
   - **结果**：`tests 53` / `pass 53` / `fail 0` / `cancelled 0` / `skipped 0`（退出码 `0`，耗时 `11992.8042ms`；其中 [uifix04-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix04-ui.test.tsx) 3 项集成用例完整覆盖 U4-01 ～ U4-05 并校验 `prompt.css` 第 20 行选择器优先级规则，全部基于 JSDOM 与本地 mock，零真实网络或大模型调用）。

2. **全产品类型检查**：
   ```powershell
   npm.cmd run typecheck
   ```
   - **结果**：退出码 `0`，`tsc -b` 零错误通过。

3. **前端生产构建与产物 CSS 规则核查**：
   ```powershell
   npm.cmd run build
   ```
   - **结果**：退出码 `0`，`tsc -b && vite build` 转换 238 个模块并完成打包（`dist/index.html` 0.54 kB、`dist/assets/index-Csz9gSal.css` 109.90 kB、`dist/assets/index-C7Zaefdv.js` 832.32 kB，耗时 `1.70s`）。
   - **CSS 产物核实**：`dist/assets/index-Csz9gSal.css` 中已输出 `.prompt-page .field.prompt-tag-filter input{height:36px;padding:0 10px}`（优先级 `(0, 3, 1)`），高于其后出现的 `.prompt-page .field input`（`(0, 2, 1)`，未设 `height`）与 `.field input,.field select{height:35px;padding:0 10px}`（`(0, 1, 1)`）。

---

## 4. 返修记录（R1）与遗留未测项

- **R1 返修关闭说明**：已按独立验收反馈修复 [prompt.css](file:///e:/AI/Work/AIPM%20Workspace/app/prompt.css) 第 20 行被 `styles.css` `.field input` 覆盖的问题，并在 [uifix04-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix04-ui.test.tsx) 补充静态规则回归断言，重新跑通 `typecheck`、`build` 与 53 项定向回归测试。
- **真实 Edge 浏览器验收（`1440x900` & `390x844`）**：返修后真实浏览器实测 `getComputedStyle(tagFilterInput).height === '36px'` 及整批再验交由独立验收者执行。
- **已停写全部产品与测试文件，未触碰任何 git 写命令，未修改 `tests/acceptance/uifix04-review-browser.mjs`。**
