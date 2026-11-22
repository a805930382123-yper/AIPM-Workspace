# QUICKUX01 任务卡：长草稿主题筛选/单卡忽略与轻量快速捕获

本卡将「建议 1（P0）」中需要产品代码落地的两项日常降摩擦优化打包为一个**纯前端、零后端改动、低风险**小批次：
1. **对应 1.2（长草稿审核降摩擦）**：在既有「分批勾选入库 + 稍后处理 + 结束选择」能力之上，为 `RawOutcomeReview` 补齐**主题卡片搜索/状态筛选**与**单卡「暂不采纳 / 恢复待选」**，解决 62 页 38 主题这类大草稿跨天分批审阅时难翻找、难区分“看过不要 vs 尚未看”的问题。
2. **对应 1.3（轻量快速捕获）**：在全局顶栏（支持 `Alt+N`）与首页增加极简「快速记一条」弹窗，支持 5 秒速记笔记（默认 `note` / `个人速记`、留空标题自动取首行）与公开网页链接捕获，**100% 复用现有 `POST /api/raw` 与 `POST /api/raw/import`**，不打断当前页面上下文。

---

## 1. 基本信息与协作调度（Agent Router）

- **批次 ID**：`QUICKUX01`
- **规划基线提交**：`61a1fd6c74de7eb0dd116d7b52bd70c55c646844`（分支 `main`；施工前由 Codex 主线程核对最新 `HEAD`）
- **四维风险评分**：
  - 需求明确度 `0`（交互细节、复用 API、存储策略、边界与验收项均在本卡冻结）
  - 模块耦合度 `1`（涉及 `App.tsx`、`HomePage.tsx`、`RawOutcomeReview.tsx` 与新增 `QuickCaptureDialog.tsx`，纯前端，零后端路由与持久化格式变更）
  - 变更风险 `1`（触及首页壳层、Raw 保存入口与成果审核卡片，需严格保持既有回归测试与 `outcomeDigest` 门禁兼容）
  - 历史失败 `0`（无同类失败记录）
  - **总分 = `2 分`，A 标准**：规划者（本卡冻结方案，Codex 规划者可做最小补充）→ 施工者（Terra High）→ 独立验收者（不同实例 Sol High）。
- **调度约束**：按项目 `AGENTS.md` 与 Codex 用户级 `$agent-router` 的「已授权执行闭环」执行；施工者与最终验收者必须是不同实例；本批完成后汇报并停止，不自动推进其他批次。

---

## 2. 核心不变量与关键避坑约束（必读）

1. **零后端与零存储格式改动**：不改 `server/`、`services/`、`rules/`；Raw 原文仍不可由 AI 改写；快速捕获保存笔记 0 模型调用；正式 Wiki/Prompt 写入仍严格走既有人工审核确认门禁；不绕过 Meeting 来源限制或 `server/validation.ts` 字段校验。
2. **【避坑 1】严禁复用后端 `change.decision === 'defer'` 作为单卡忽略态**：
   - `services/raw/pdf-cleanup.ts` 新建 PDF 维护草稿时，每条 `change.decision` 初始值本身就是 `'defer'`（见 `pdf-cleanup.ts:1052` 与 `tests/rawedit01-ui.test.tsx:75`）。
   - 因此本批单卡「暂不采纳」**严禁修改或依赖 `change.decision`**，也不改动 `draft.revision` / `outcomeDigest` / 后端草稿文件，而是采用浏览器本机 `localStorage`（按 `draftId` 隔离，不可用时自动降级为内存状态）保存本机阅读忽略列表。
3. **【避坑 2】严禁破坏 `.outcome-cards > div:first-child` 跨双列规则**：
   - `app/b04.css` 依赖 `.outcome-cards > div:first-child { grid-column: 1 / -1; }` 实现双列卡片头部通栏。
   - 新增的主题筛选工具条 `.outcome-cards-filters` **必须包裹在 `.outcome-cards` 的首个子 `<div>` 内部**（紧接 `.outcome-cards-heading` 之后），不能作为第二个独立 `<div>` 破坏双列布局。
4. **【避坑 3】保持 `HomePage` 与 `RawOutcomeReview` 既有测试 100% 兼容**：
   - `HomePage` 新增 prop `onQuickCapture?: () => void` 必须为**可选**；入口按钮放在 `.page-heading` 右侧（与「周期回顾」并排），**不得**放进 `.home-quick-actions`（`tests/homeui01-ui.test.tsx` 校验该区域不含重复保存入口）。
   - `RawOutcomeReview` 默认筛选态必须为 `all`（全部主题），在未输入关键词且未标记忽略时，页面可见卡片与「全选可选主题（N 项）」文案/行为与 `UIFIX03`（`U3-03`）完全一致。
5. **【避坑 4】网页链接导入必须调用真实存在的 `POST /api/raw/import`**：
   - 后端并无 `/api/raw/import-url`；请严格复用 `RawPage.tsx:529` 的 `api<RawUrlImportResult>('/api/raw/import', { method: 'POST', body: JSON.stringify({ metadata, translateToChinese }) })`。

---

## 3. 交付项明细（Q1-01 ～ Q1-04）

### Q1-01：长草稿主题卡片关键词搜索与状态筛选（对应 1.2）
- **文件**：`app/pages/RawOutcomeReview.tsx`、`app/b04.css`
- **需求明细**：
  1. 在 `RawOutcomeReview` 新增前端筛选状态：
     - `topicQuery: string`（默认 `''`）
     - `topicFilter: 'all' | 'pending' | 'selected' | 'committed' | 'dismissed'`（默认 `'all'`）
  2. 为每张卡片计算清晰状态分类：
     - `committed`：`Boolean(change?.committedOperationId)`
     - `dismissed`：`!committed && dismissedIds.includes(page.pageId)`
     - `pending`：`!committed && !dismissed`
     - `selected`：`chosen.includes(page.pageId)`
  3. 关键词匹配（不区分大小写，匹配 `title`、`excerpt`、`page.one_line_definition`、`change?.reason`、动作标签 `change ? actions[change.action] : '新建主题'`）。
  4. 当 `cards.length > 0` 时，在 `.outcome-cards` 的首个子 `<div>` 内（`.outcome-cards-heading` 下方）渲染 `.outcome-cards-filters`：
     - 标题/计数副标：未筛选时显示原说明；有筛选或有已忽略项时展示简明统计（如 `显示 X / 共 Y 项 · 已入库 A · 已忽略 B`）；
     - 搜索框：`<input type="search" aria-label="搜索主题成果" placeholder="搜索主题标题、摘要或理由…" />`；
     - 状态筛选：`<select aria-label="筛选主题状态">`，选项包含：
       - `all`：`全部主题（${cards.length}）`
       - `pending`：`待处理（${pendingCount}）`
       - `selected`：`已勾选（${chosen.length}）`
       - `committed`：`已入库（${committedCount}）`
       - `dismissed`：`已忽略（${dismissedCount}）`
     - 当 `topicQuery.trim() || topicFilter !== 'all'` 时，显示 `<button type="button" className="text-button">重置筛选</button>`。
  5. 当 `cards.length > 0 && filteredCards.length === 0` 时，在 `.outcome-cards` 内渲染跨列空态 `<p className="outcome-filter-empty" role="status">没有符合当前筛选条件的主题成果。</p>`（并保留「重置筛选」可用）。
  6. **重要**：筛选仅控制当前展示卡片，**不清除**用户已在其他筛选视图勾选的 `selection`（确认条顶部始终展示真实已选 `chosen.length` 项）。

### Q1-02：单卡片「暂不采纳 / 恢复待选」与智能全选协同（对应 1.2）
- **文件**：`app/pages/RawOutcomeReview.tsx`、`app/b04.css`
- **需求明细**：
  1. 本机持久化工具函数（放 `RawOutcomeReview.tsx` 内或小辅助函数）：
     - Storage Key：`aipm.outcome.dismissed.v1:${view.id}`（值为 JSON 字符串数组 `string[]`）；
     - 读取时用 `try/catch` 兜底（无 `localStorage` 或损坏 JSON 时安全降级为空数组 `[]`，绝不抛错），并仅保留当前 `cards` 中存在且尚未 `committed` 的 `pageId`；
     - 当 `view.id` 切换时重新读取对应草稿的 `dismissedIds`；写入时同样 `try/catch`（数组为空时 `removeItem`）。
     - 当卡片确认入库完成后（`committedOperationId` 出现），自动从 `dismissedIds` 中剔除。
  2. 单卡交互：
     - 仅在 `!readOnly && !change?.committedOperationId && !recovering && !deferred && !(view.maintenance && view.discardedAt)` 时，在卡片操作区提供轻量切换按钮：
       - 未忽略时：`<button type="button" className="text-button outcome-dismiss-btn" disabled={disabled || editing || !!adjustment}>暂不采纳</button>`
         - 点击后：将 `page.pageId` 加入 `dismissedIds`，并自动从 `selection` 中移除该 `page.pageId`（确保已忽略卡片不会留在待入库选集中）。
       - 已忽略时：卡片添加 `.dismissed` 样式类（淡化边框/背景、紧凑折叠，不渲染摘要与详情折叠区，避免 38 张卡占屏），标题旁显示 `<span className="tag outcome-dismissed-tag">已忽略</span>`，右侧显示 `<button type="button" className="text-button" disabled={disabled || editing || !!adjustment}>恢复待选</button>`（点击移出 `dismissedIds`；不自动勾选，交由用户决定是否勾选）。
  3. 与「全选可选主题」协同：
     - `selectablePageIds` 排除已忽略卡片（`!dismissedIds.includes(page.pageId)`）；
     - 若存在筛选条件，可按全量未忽略可选卡或当前可见未忽略可选卡操作——**本卡冻结口径**：
       - 无搜索/状态筛选（`!topicQuery.trim() && topicFilter === 'all'`）时，「全选可选主题（N 项）」操作全部**未忽略**可选主题（保持与 `UIFIX03` 100% 兼容）；
       - 处于筛选视图时（如搜“渠道”筛出 4 张），按钮针对**当前筛选出的未忽略可选主题**生效，文案显示 `全选当前筛选（N 项）` / `取消当前筛选全选`，避免误选屏幕外不可见主题！
  4. **不修改后端与 `outcomeDigest`**：标记「暂不采纳」或「恢复待选」产生 **0 次网络请求**、不改 `view.revision`、不触发「内容已变化请重新选择」提示。

### Q1-03：独立组件 `QuickCaptureDialog`（对应 1.3）
- **文件**：新增 `app/components/QuickCaptureDialog.tsx`、`app/styles.css`
- **需求明细**：
  1. Props 契约：
     ```ts
     export type QuickCaptureDialogProps = {
       onClose: () => void;
       onCaptured: (raw: Raw) => Promise<void>;
       onOpenRaw: (rawId: string, translation?: RawTranslation) => void;
     };
     ```
  2. 模态框无障碍与关闭规则（对齐 `UIFIX01`/`UIFIX04`）：
     - 使用 `.modal-scrim` + `useDialogFocus<HTMLElement>()` + `role="dialog"` + `aria-modal="true"` + `aria-labelledby="quick-capture-title"`；
     - `saving === false` 时支持 `Escape` 键、右上角关闭按钮、点击遮罩关闭；`saving === true` 时禁止关闭并设置 `aria-busy="true"`。
  3. 双模式 Tab（`role="tablist"`）：
     - **Tab 1：`速记笔记`（默认激活）**
       - **正文（必填，自动聚焦 `data-autofocus`）**：`<textarea aria-label="速记内容" placeholder="记一条快消业务灵感、客户原话、指标口径或会议碎片…（Ctrl+Enter 快速保存）" maxLength={MAX_BODY_CHARS} />`；
       - 键盘快捷提交：在正文框按 `Ctrl+Enter`（或 macOS `Meta+Enter`）且非 `saving` 时触发提交；
       - **单行 URL 检测轻提示**：若正文 `trim()` 后仅 1 行且匹配 `/^https?:\/\/\S+$/iu`，在正文下方展示提示条 `检测到公开网页链接，是否直接抓取网页原文？` + `<button type="button" className="text-button">切到网页链接模式</button>`（点击后将链接带入 URL 框并切到 Tab 2，**绝不自动发请求**）；
       - **标题（可选）**：`<input aria-label="标题（可选）" maxLength={300} placeholder="留空自动取第一行作为标题" />`；
         - 自动标题推导规则（纯函数，单测覆盖）：取正文首个非空行，`trim()` 后替换连续空白为单个空格，截取前 60 个字符（UTF-16 安全不截断代理对，或按 `[...line].slice(0, 60).join('')`）；若用户显式填了标题则原样使用用户标题。
       - **标签（可选）**：`<input aria-label="标签（可选）" placeholder="用逗号或顿号分隔，例如：渠道、动销、客户反馈" />`（沿用 `[，,、;；]+` 分隔符）；
       - **来源设置（紧凑折叠或单行可选，默认零填写即可提交）**：
         - `sourceType` 默认 `'note'`（个人笔记），可选 `sourceLabels` 全部 8 种类型；
         - `sourceName` 默认 `'个人速记'`（最大 300 字符；若用户清空则校验提示或回填默认，提交前确保非空以满足 `server/validation.ts`）；
       - 提交请求：`POST /api/raw`（JSON `{ title, sourceType, sourceName, tags, body }`），**零模型调用**；
       - 底部明确提示：`保存为 Raw 原文，不自动调用 AI，也不写入正式 Wiki。`
     - **Tab 2：`网页链接`**
       - **公开网页链接（必填）**：`<input type="url" aria-label="公开网页链接" placeholder="https://…" required />`；
       - **标题（可选）**与**标签（可选）**：留空时由后端从网页提取；
       - **翻译开关**：`<input type="checkbox" /> 翻译成中文（会调用已配置模型）`——**默认不勾选（`false`）**，避免快速收集链接时意外消耗模型额度；
       - 提交请求：`POST /api/raw/import`（JSON `{ metadata: { url, sourceType: 'article', title: title || undefined, tags }, translateToChinese }`）。
  4. 结果态与错误保输入：
     - 保存成功后先调用 `await onCaptured(raw)` 刷新全局 `raws`/`stats`，弹窗切换至简洁成功态（不强制跳离当前页面）：
       - 展示 `已保存到 Raw`、标题、来源类型与来源名称；
       - 提供 3 个操作按钮：`继续记一条`（重置表单并聚焦输入框）、`打开这条 Raw`（调用 `onOpenRaw(raw.id, translation)` 并关闭弹窗）、`关闭`（留在当前页面）；
     - 请求失败时展示 `role="alert"` 错误信息，**完整保留用户已输入的全部内容**，允许修改后重试。

### Q1-04：全局壳层（顶栏 + `Alt+N`）与首页接入（对应 1.3）
- **文件**：`app/App.tsx`、`app/pages/HomePage.tsx`、`app/styles.css`、`app/home.css`
- **需求明细**：
  1. **`app/App.tsx`**：
     - 新增 `quickCaptureOpen` 状态；
     - 在顶栏 `.topbar` 右侧，将按钮与 `.local-badge` 放入 `.topbar-actions` 容器：
       - `<button type="button" className="secondary-button topbar-capture-btn" title="快速捕获到 Raw（Alt+N）" onClick={() => setQuickCaptureOpen(true)}>快速记一条</button>`
       - 原有 `<div className="local-badge"><i />本地工作区</div>` 保持不变；
     - 注册全局 `keydown` 监听响应 `Alt+N`（`event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'n'`）：
       - 当焦点位于 `<input>`、`<textarea>`、`<select>` 或 `isContentEditable` 元素内时**忽略**；
       - 当页面已有弹窗（`document.querySelector('[role="dialog"]')` 或 `quickCaptureOpen`）时**忽略**；
       - 否则 `event.preventDefault()` 并 `setQuickCaptureOpen(true)`。
     - 挂载 `{quickCaptureOpen && <QuickCaptureDialog onClose={() => setQuickCaptureOpen(false)} onCaptured={async raw => { setRaws(prev => prev.some(x => x.id === raw.id) ? prev : [raw, ...prev]); await refresh(); }} onOpenRaw={(id, translation) => { setQuickCaptureOpen(false); nav('raw', id); /* 若需打开原文视图保持既有行为 */ }} />}`（注意：若 `onOpenRaw` 需支持 `translation`，可只跳转到 `nav('raw', id)`，因 `RawPage` 会通过 `GET /api/raw/:id/translation` 自动加载译文状态，无需破坏 `RawPage` 既有 props）。
     - 传给 `HomePage` 新增可选回调 `onQuickCapture={() => setQuickCaptureOpen(true)}`。
  2. **`app/pages/HomePage.tsx`**：
     - `HomePage` Props 新增可选 `onQuickCapture?: () => void`；
     - 在 `.page-heading` 右侧新增 `.home-heading-actions` 包装：当 `onQuickCapture` 存在时渲染 `<button type="button" className="primary-button" onClick={onQuickCapture}>快速记一条</button>`，紧邻原有 `<button className="secondary-button" onClick={() => setReviewOpen(true)} disabled={reviewOpen}>周期回顾</button>`；
     - **不改动** `.home-entry-grid`（4 项入口）和 `.home-quick-actions`（4 项更多工具）。
  3. **响应式布局（1440px 与 390px）**：
     - `390px` 手机视口下 `.topbar`、`.home-heading-actions`、`.outcome-cards-filters`、`QuickCaptureDialog` 均无水平溢出（`scrollWidth <= innerWidth`），弹窗完整落于视口内可滚动操作。

---

## 4. 文件所有权与明确排除

- **允许新增的产品文件（1 个）**：
  - `app/components/QuickCaptureDialog.tsx`
- **允许修改的产品文件（仅限以下 5 个）**：
  - `app/App.tsx`
  - `app/pages/HomePage.tsx`
  - `app/pages/RawOutcomeReview.tsx`
  - `app/styles.css`
  - `app/b04.css`
  - `app/home.css`（仅需 `.home-heading-actions` 样式时修改，合计最多 6 个既有产品文件）
- **允许新增的测试与报告文件**：
  - `tests/quickux01-ui.test.tsx`（施工者编写的单元测试与 JSDOM 交互测试）
  - `docs/reports/QUICKUX01-20261120-builder.md`（施工报告）
  - `docs/reports/QUICKUX01-20261120-review.md`（独立验收报告）
  - `tests/acceptance/quickux01-review-browser.mjs`（独立验收真实浏览器脚本）
- **明确排除与禁止**：
  - 严禁修改任何后端代码（`server/`、`services/`、`rules/`）。
  - 严禁修改工作区既有未提交文件（`docs/reports/RAWZH01-*`、`tests/acceptance/AUTO01-*`、`tests/acceptance/rawzh01-*`、`tests/rawzh01-ui.test.tsx`、已删 `AUTO01-20261106-review-evidence` 等）。
  - 严禁读写正式 `workspace/`、`.env.local`，严禁调用真实外部模型或真实外部网页，严禁停止/重启用户当前运行的服务（`4317`/`5151`/`5173`）。
  - 施工者与验收者均不执行 `git commit` / `git push`，统一交由主线程验收通过后按 `AGENTS.md` 只提交本批白名单文件。

---

## 5. 验收项与必须验证命令（QU1-01 ～ QU1-06）

- **QU1-01（长草稿筛选与搜索）**：在 6+ 主题的 `RawOutcomeReview` 中测试关键词搜索、5 种状态切换（全部/待处理/已勾选/已入库/已忽略）、空态提示与重置筛选；验证切换筛选不丢已选中的 `chosen` 计数，且 `.outcome-cards` 双列布局不被破坏。
- **QU1-02（单卡暂不采纳持久化与全选协同）**：点击单卡「暂不采纳」→ 自动取消勾选、折叠淡化、写入 `localStorage`、产生 0 次网络请求；卸载并重新挂载同 `draftId` 后忽略态保持；点击「全选可选主题」不误选已忽略卡片；筛选态点击「全选当前筛选（N 项）」仅选当前可见未忽略卡；点击「恢复待选」恢复正常态；验证 `rawedit01-ui.test.tsx` / `pdf02-ui.test.tsx` / `uifix03-ui.test.tsx` 全绿。
- **QU1-03（QuickCaptureDialog 速记与网页链接双模式）**：
  - 速记模式只输入正文（留空标题）按 `Ctrl+Enter` 或点击保存 → 验证 `POST /api/raw` 收到 `sourceType: 'note'`、`sourceName: '个人速记'`、标题为首行截断，正文原样保留；
  - 粘贴单行 `https://...` 触发链接提示条，点击后切换至网页链接模式，默认 `translateToChinese: false`，提交调用 `POST /api/raw/import`；
  - 失败（如 HTTP 500/400）时保留全部用户输入并显示 `role="alert"`；
  - 成功后可「继续记一条」「打开这条 Raw」「关闭留在当前页」。
- **QU1-04（全局壳层、快捷键与首页集成）**：顶栏与首页均可打开 `QuickCaptureDialog`；`Alt+N` 在普通页面可打开，在输入框聚焦或弹窗已打开时不误触发；`Escape`/遮罩可关闭且焦点还原到触发按钮；保存后首页与 Raw 列表/统计实时刷新，不破坏 `homeui01-ui.test.tsx` 与 `uifix01/02-ui.test.tsx`。
- **QU1-05（全仓检查与回归）**：
  ```powershell
  npm run typecheck
  node --import tsx --import ./tests/support/css-stub.mjs --test tests/quickux01-ui.test.tsx tests/homeui01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/rawurl01-ui.test.tsx tests/uifix01-ui.test.tsx tests/uifix02-ui.test.tsx tests/uifix03-ui.test.tsx tests/uifix04-ui.test.tsx
  npm run build
  ```
  独立验收者另需执行隔离全量 `npm test`（或在报告说明与 CI 核验结果）。
- **QU1-06（真实浏览器隔离实测）**：在隔离 `FMCG_DATA_DIR` TEMP 目录与全新随机端口启动真实服务（零真实模型/外网调用，URL 导入可用本机隔离假响应或路由验证），用真实 Edge/Chrome 在 `1440x900` 与 `390x844` 实测 `QU1-01`～`QU1-04` 主链路，确认 `pageErrors: []`、390px 无水平溢出（`scrollWidth <= 390`），关键界面截图存证。

---

## 6. 交付与结束条件

1. 施工者交付：变更文件清单与 SHA-256、新增测试与回归结果、`typecheck`/`build` 结果、施工报告 `docs/reports/QUICKUX01-20261120-builder.md`，停写交接。
2. 独立验收者交付：核对指纹与源码差异、独立跑测试/构建/隔离真实浏览器验收、分别给出「本轮施工范围内交付项（Q1-01～Q1-04）」与「QUICKUX01 批次整体」双项裁决，写 `docs/reports/QUICKUX01-20261120-review.md`。
3. 全部必选验收项 PASS 后，主线程更新 `docs/status.md` 顶部新条目、仅提交本批白名单文件并推送至 `origin/main`、核验远端 GitHub Actions CI 结果，然后汇报停止，等待用户下一步指示。

---

## 7. 规划补充

（Codex 规划者如在施工前发现细微 DOM 类名或测试夹具需对齐，可在此节补充并冻结，不得扩大范围或修改第 2 节不变量。）
