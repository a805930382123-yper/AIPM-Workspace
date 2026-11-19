# UIFIX01 施工报告（Builder）

- **批次 ID**：`UIFIX01`（UI 交互分批优化第一批）
- **基线提交**：`54df7b63eab1d15181e0f8288530164dd87bdc8a`（分支 `main`）
- **任务卡**：[UIFIX01-20261119-task.md](file:///e:/AI/Work/AIPM%20Workspace/docs/handoffs/UIFIX01-20261119-task.md)
- **施工日期**：2026-11-19
- **状态**：已完成首轮施工与 `U1-01` 运行态返修（覆盖 `RawOutcomeReview`、`KnowledgeMaintenanceReview` 与 `!view` 兜底态），全部 58 项 JSDOM 回归、`typecheck` 与 `build` 已通过；独立浏览器复验留待独立验收者执行。

---

## 1. 交付项实现摘要（U1-01 ～ U1-05，含首轮返修）

### U1-01：全屏审核覆盖视图与子页面返回路径及面包屑修正
- `app/App.tsx`：
  - 更新 `.breadcrumb` 逻辑：`currentBreadcrumb = workflowId ? '更新与综合审阅' : reviewDraftId ? 'AI 知识整理预览' : pageTitle`。
  - 当处于可返回的覆盖视图或子页面（`Boolean(workflowId || reviewDraftId || page === 'news')`）时，将前缀渲染为 `<button type="button" className="text-button breadcrumb-back" onClick={handleBreadcrumbBack}>工作空间</button>`，按 `workflowId` → `reviewDraftId` → `page === 'news'` 顺序逐层返回；其余主导航页面保持纯文本 `工作空间`，`.breadcrumb` 文本始终保持 `工作空间 / ${currentBreadcrumb}`。
  - 将 `<AutomationPage>` 的 `onOpenDraft` 从 `{ nav('home'); setReviewDraftId(id); }` 改为 `id => setReviewDraftId(id)`，保持当前 `automation` 页面上下文。
  - 为 `<DraftReviewPage>` 传入动态 `backLabel`（`home -> '返回工作台'`、`automation -> '返回自动化'`、`wiki -> '返回知识库'`、其余 `'返回 Raw'`）。
  - 为 `<NewsPage>` 传入 `onBack={() => nav('home')}`。
- `app/pages/DraftReviewPage.tsx`（含首轮返修）：
  - Props 增加可选 `backLabel?: string`（不设参数默认值，以区分调用方是否显式指定上下文文案）。
  - 第 233 行（`!view` 加载/错误兜底态）返回按钮使用 `{backLabel ?? '返回'}`；
  - 第 236 行（`view.input` 分支）向 `<KnowledgeMaintenanceReview>` 透传 `backLabel={backLabel}`；
  - 第 350 行（`outcomeMode` 分支）向 `<RawOutcomeReview>` 透传 `backLabel={backLabel}`；
  - 第 355 行（`view.maintenance` 分支）向 `<KnowledgeMaintenanceReview>` 透传 `backLabel={backLabel}`；
  - 第 368 行（默认分支）返回按钮使用 `{backLabel ?? '返回 Raw'}`。
- `app/pages/RawOutcomeReview.tsx`（首轮返修新增）：
  - `Props` 增加可选 `backLabel?: string`，第 303 行返回按钮改为 `{backLabel ?? '返回'}`（未传入时保持 `'返回'`，兼容直接挂载 `RawOutcomeReview` 的既有测试）。
- `app/pages/KnowledgeMaintenanceReview.tsx`（首轮返修新增）：
  - Props 增加可选 `backLabel?: string`，第 32 行返回按钮改为 `{backLabel ?? (view.input ? '返回知识库' : '返回 Raw')}`。
- `app/styles.css`：
  - 新增 `.text-button.breadcrumb-back` 及 `:hover` 样式（继承字号与颜色，无内边距，悬停使用 `--accent` 与下划线）。

### U1-02：侧边栏专属图标区分
- `app/components/Icon.tsx`：
  - 保留既有 7 个图标（`home`、`book`、`file`、`calendar`、`code`、`settings`、`upload`），新增 `work`（任务清单 SVG）和 `automation`（时钟运行 SVG）。
- `app/App.tsx`：
  - 侧边栏“工作事项”切换为 `<Icon name="work" />`，“自动化”切换为 `<Icon name="automation" />`，主导航 7 项（及设置共 8 项）图标完全去重。

### U1-03：多来源综合弹窗样式修复与全站弹窗焦点/Escape 统一
- `app/pages/RawPage.tsx`：
  - 将原内联 `.modal-backdrop` / `.confirm-dialog` 区域重构为独立子组件 `SynthesisDialog`（仅 `synthesisOpen === true` 时挂载），采用 `.modal-scrim` + `section.panel.import-dialog.synthesis-dialog`（`role="dialog" aria-modal="true" aria-labelledby="synthesis-dialog-title"`、`tabIndex={-1}`），接入 `useDialogFocus<HTMLElement>()`；内部维护 `synthesisBusy` 与防重入 ref，请求期间禁用关闭按钮、`取消`、复选框、提交按钮并阻止 `Escape` 与遮罩关闭。
  - 为 `DeleteDialog` 接入 `useDialogFocus<HTMLElement>()`、`tabIndex={-1}` 及 `!deleting` 守卫下的 `Escape` / 遮罩 / 右上角关闭。
- `app/pages/WikiPage.tsx`：
  - 将 `deleteTarget` 删除确认弹窗提取为独立子组件 `WikiDeleteDialog`，接入 `useDialogFocus<HTMLElement>()`、`tabIndex={-1}` 及 `!busy` 守卫下的 `Escape` / 遮罩关闭；并在 `requestDelete` 预检引用阶段使用 `deleteCheckInFlight` ref 代替 `setBusy(true)` 禁用触发按钮，确保弹窗挂载时焦点仍留在触发按钮上以便关闭后准确还原焦点。
- `app/pages/PromptLibraryPage.tsx`：
  - 将 `deleteTarget` 删除确认弹窗提取为独立子组件 `PromptDeleteDialog`，接入 `useDialogFocus<HTMLElement>()`、`tabIndex={-1}` 及 `!busy` 守卫下的 `Escape` / 遮罩关闭。
- `app/styles.css`：
  - 补充 `.synthesis-dialog .raw-list`（`max-height: min(52vh, 420px); overflow-y: auto; padding: 12px 20px;`）、`.synthesis-dialog .dialog-footer`（`margin: 0;`）与 `.synthesis-dialog .form-error`（`margin: 12px 20px 0;`）。

### U1-04：每日资讯返回入口、栏目锚点与手动检查更新加载态
- `app/pages/NewsPage.tsx`：
  - Props 增加可选 `onBack?: () => void`，传入时在 `.page-heading` 右侧渲染 `<button type="button" className="secondary-button" onClick={onBack}>返回工作台</button>`。
  - `.news-toolbar` 内新增 `<nav className="news-jump" aria-label="栏目定位"><a href="#news-section-fmcg">快消研报与洞察</a><span aria-hidden="true">·</span><a href="#news-section-ai">AI 前沿</a></nav>`，两个主栏目 `<section>` 均增加 `id={`news-section-${n}`}`。
  - 将 `checking` 状态升级为 `Partial<Record<NewsSectionName, NewsCheckMode>>`，`controls()` 中“检查更新”进行中显示 `正在检查更新…`，“仅补抓失败来源”进行中显示 `正在补抓失败来源…`。
- `app/news.css`：
  - 补充 `.news-toolbar`、`.news-toolbar label/select`、`.news-jump`、`.news-section` 与长标题/链接断行样式，避免 `390px` 视口水平溢出。

### U1-05：设置页未保存修改时明确提示不可测连接原因
- `app/pages/SettingsPage.tsx`：
  - 保持现有 `window.confirm` 与 `disabled={... || changed}` 逻辑完全不变；当 `changed && !configLoading && !configBusy` 为真时，在 `.settings-config-actions` 下方渲染 `<p role="status" className="field-help settings-unsaved-hint">有未保存的修改，请先点击「保存配置」后再测试连接。</p>`。

---

## 2. 首轮返修记录（针对验收报告第 3 节 `U1-01` 真实运行态阻断）

- **返修原因**：真实服务端 `DraftStore.view` 对 `DraftRecord` 均返回 `outcomeDigest`，导致 `DraftReviewPage` 进入 `RawOutcomeReview` 分支而非旧第 368 行分支；`RawOutcomeReview`、`KnowledgeMaintenanceReview` 与 `!view` 加载兜底态原先未接收 `backLabel`。
- **返修修改**：
  - 将 `backLabel?: string` 从 `App` -> `DraftReviewPage` 统一透传至 `RawOutcomeReview`、`KnowledgeMaintenanceReview` 与 `!view` 加载/错误兜底按钮，并移除 `DraftReviewPage` 参数默认值以准确区分是否显式指定上下文。
  - 在 `tests/uifix01-ui.test.tsx` 补充包含真实 `outcomeDigest` 的草稿夹具测试（验证从自动化收件箱打开后渲染 `整理成果`、`RawOutcomeReview` 返回按钮为 `返回自动化` 且点击退回自动化页面），同时覆盖 `!view` 兜底、`KnowledgeMaintenanceReview`（`view.maintenance` / `view.input`）透传与直接挂载 `RawOutcomeReview` 默认 `'返回'` 兼容性。

---

## 3. 变更文件清单与最新 SHA-256

| 变更类型 | 文件路径 | SHA-256 |
| --- | --- | --- |
| 修改 | `app/App.tsx` | `B98F6B9953611DF9E094D8A0E0AA8660A67035336DE81A6E1D827ED412956D9F` |
| 修改 | `app/components/Icon.tsx` | `328C52705EDB339397C7B132F987EF7B6FB32D71C966E927892FE9FEF12BB471` |
| 修改 | `app/pages/DraftReviewPage.tsx` | `4EC5A5A8C0EBEC81BC587156398792F9F8FD25ABC575244D61B50E34EC0CC973` |
| 修改 | `app/pages/RawOutcomeReview.tsx` | `E9DFBD68B61DD079B38A2279BF11BAA3790E116E7E14AF5E330270D55969A020` |
| 修改 | `app/pages/KnowledgeMaintenanceReview.tsx` | `FA09F690FD9613E4B5E5B12BCA7A936C273A2FB81736663D33DE0D3E878788E8` |
| 修改 | `app/pages/RawPage.tsx` | `E4C692842164105A409DC54C44EC2DDBCF83AC15EF72B443F047AB2441EC7DEE` |
| 修改 | `app/pages/WikiPage.tsx` | `4C9BF2DAC9A426F916BFBDCE69E352A156F567DEB99B079DBD9F888B06FE7941` |
| 修改 | `app/pages/PromptLibraryPage.tsx` | `0ECF528EF15399B7E2E95DCFF86CC9F9FC262B00A81AB432F8031BB975E08055` |
| 修改 | `app/pages/NewsPage.tsx` | `0337EC4040D433C39338627172862C8DA4A1F8D3E068C7F7C1A54AE568C36E7B` |
| 修改 | `app/pages/SettingsPage.tsx` | `0D7030C68F8BE3445A8089CD3270F943433CA0539CC5A4A871BBE1DF2EC75000` |
| 修改 | `app/styles.css` | `BD855D8A20CE9707D73A0C7522DF8AA0F3A6BEE510CAFE6812AA59F393E29747` |
| 修改 | `app/news.css` | `EBA9AC2F28EBA0B5A3373E4930DE55625F13C3957FDBDFE6437D93677818CD23` |
| 新增 | `tests/uifix01-ui.test.tsx` | `855FC1C48A886A3B59F744A2A95DD8585B284573DC5E9C39DB45E3ECC63C819E` |

（均严格遵守更新后任务卡的文件所有权：仅修改允许的 12 个产品文件并新增/更新 `tests/uifix01-ui.test.tsx` 与本施工报告，未修改任何后端/工作区/既有未提交文件，未操作 git，未启停 4317/5151/5173 服务。）

---

## 4. 最新自检命令与实测结果（返修后全量执行）

以下 3 项命令均在最终返修编辑完成后实测通过（退出码 `0`）：

1. **新增测试 + 定向回归测试（含 `rawedit01-ui` 与 `pdf02-ui`）**：
   ```powershell
   node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/app-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx tests/provider-config-ui.test.tsx tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news08-ui.test.tsx tests/ui01-interface.test.tsx tests/ui02-interface.test.tsx tests/ui03-interface.test.tsx tests/ui04-interface.test.tsx tests/wiki-selection.test.tsx tests/prompt-ui.test.tsx
   ```
   - **结果**：`tests 58` / `pass 58` / `fail 0`（退出码 `0`，耗时 `12083.094ms`；其中 `tests/uifix01-ui.test.tsx` 6 项测试全部通过，`tests/rawedit01-ui.test.tsx` 与 `tests/pdf02-ui.test.tsx` 及全部回归测试通过）。

2. **全产品类型检查**：
   ```powershell
   npm.cmd run typecheck
   ```
   - **结果**：退出码 `0`，`tsc -b` 零错误通过。

3. **前端生产构建**：
   ```powershell
   npm.cmd run build
   ```
   - **结果**：退出码 `0`，`tsc -b && vite build` 转换 238 个模块并完成打包（`dist/index.html`、`dist/assets/index-BZGfReRh.css`、`dist/assets/index-BxcjB3_6.js`，耗时 `1.71s`）。

---

## 5. 遗留与未测项（交由独立验收阶段）

- **真实浏览器（Edge `1440x900` & `390x844`）复验**：返修后施工阶段已通过 JSDOM 全量单测（含带 `outcomeDigest` 路径）、TypeScript 类型检查与 Vite 生产构建；真实浏览器下从自动化收件箱点击 `审核草稿` 后返回按钮呈 `返回自动化` 并点击退回自动化的端到端复验留待独立验收者执行。
- **返修后已停写全部产品与测试文件，未触碰任何 git 写命令。**
