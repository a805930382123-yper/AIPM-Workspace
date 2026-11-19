# UIFIX01 独立验收报告（Independent Review）

- **批次 ID**：`UIFIX01`（UI 交互分批优化第一批）
- **基线提交**：`54df7b63eab1d15181e0f8288530164dd87bdc8a`（分支 `main` + 工作区未提交交付物）
- **任务卡**：[UIFIX01-20261119-task.md](file:///e:/AI/Work/AIPM%20Workspace/docs/handoffs/UIFIX01-20261119-task.md)
- **施工报告**：[UIFIX01-20261119-builder.md](file:///e:/AI/Work/AIPM%20Workspace/docs/reports/UIFIX01-20261119-builder.md)
- **独立验收脚本**：[uifix01-review-browser.mjs](file:///e:/AI/Work/AIPM%20Workspace/tests/acceptance/uifix01-review-browser.mjs)
- **验收日期**：2026-11-19

## 最新最终裁决（Round 2 返修复验）

1. **本轮施工范围内的缺陷是否修复成功**：**是（PASS）**。`DraftReviewPage.tsx`（含 `!view` 加载/错误兜底态、`view.input`、`outcomeMode`、`view.maintenance` 与默认分支）、`RawOutcomeReview.tsx` 与 `KnowledgeMaintenanceReview.tsx` 已完整透传可选 `backLabel` 并保持无参默认兼容性；真实浏览器 Edge 实测在后端返回 `outcomeDigest` 路径下从自动化进入草稿审核时返回按钮已正确显示 `返回自动化` 并可返回自动化收件箱。
2. **`UIFIX01` 批次整体是否满足验收标准**：**`PASS`（整体验收通过）**。全部 12 个允许修改产品文件及新增 `tests/uifix01-ui.test.tsx` 的 SHA-256 指纹与施工报告 100% 一致，15 个 JSDOM/回归测试文件 58/58 通过，`typecheck` 通过，独立隔离 Edge（`1440x900` & `390x844`）全量实测 8 项桌面检查与 5 项移动端零溢出检查全部通过，零真实外部请求，零 `pageErrors`。

---

## Round 2：返修复验记录（2026-11-19）

### R2-1. 最新交付物 SHA-256 独立核验与所有权审计

独立运行 `Get-FileHash -Algorithm SHA256` 校验更新后任务卡允许的 12 个修改产品文件及 `tests/uifix01-ui.test.tsx`，与施工报告第 3 节指纹 **100% 一致**：

| 变更类型 | 文件路径 | 独立实测 SHA-256 | 与施工报告一致 |
| --- | --- | --- | --- |
| 修改 | [app/App.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/App.tsx) | `B98F6B9953611DF9E094D8A0E0AA8660A67035336DE81A6E1D827ED412956D9F` | 是 |
| 修改 | [app/components/Icon.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/components/Icon.tsx) | `328C52705EDB339397C7B132F987EF7B6FB32D71C966E927892FE9FEF12BB471` | 是 |
| 修改 | [app/pages/DraftReviewPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/DraftReviewPage.tsx) | `4EC5A5A8C0EBEC81BC587156398792F9F8FD25ABC575244D61B50E34EC0CC973` | 是 |
| 修改 | [app/pages/RawOutcomeReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawOutcomeReview.tsx) | `E9DFBD68B61DD079B38A2279BF11BAA3790E116E7E14AF5E330270D55969A020` | 是 |
| 修改 | [app/pages/KnowledgeMaintenanceReview.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/KnowledgeMaintenanceReview.tsx) | `FA09F690FD9613E4B5E5B12BCA7A936C273A2FB81736663D33DE0D3E878788E8` | 是 |
| 修改 | [app/pages/RawPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/RawPage.tsx) | `E4C692842164105A409DC54C44EC2DDBCF83AC15EF72B443F047AB2441EC7DEE` | 是 |
| 修改 | [app/pages/WikiPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/WikiPage.tsx) | `4C9BF2DAC9A426F916BFBDCE69E352A156F567DEB99B079DBD9F888B06FE7941` | 是 |
| 修改 | [app/pages/PromptLibraryPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/PromptLibraryPage.tsx) | `0ECF528EF15399B7E2E95DCFF86CC9F9FC262B00A81AB432F8031BB975E08055` | 是 |
| 修改 | [app/pages/NewsPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/NewsPage.tsx) | `0337EC4040D433C39338627172862C8DA4A1F8D3E068C7F7C1A54AE568C36E7B` | 是 |
| 修改 | [app/pages/SettingsPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/SettingsPage.tsx) | `0D7030C68F8BE3445A8089CD3270F943433CA0539CC5A4A871BBE1DF2EC75000` | 是 |
| 修改 | [app/styles.css](file:///e:/AI/Work/AIPM%20Workspace/app/styles.css) | `BD855D8A20CE9707D73A0C7522DF8AA0F3A6BEE510CAFE6812AA59F393E29747` | 是 |
| 修改 | [app/news.css](file:///e:/AI/Work/AIPM%20Workspace/app/news.css) | `EBA9AC2F28EBA0B5A3373E4930DE55625F13C3957FDBDFE6437D93677818CD23` | 是 |
| 新增 | [tests/uifix01-ui.test.tsx](file:///e:/AI/Work/AIPM%20Workspace/tests/uifix01-ui.test.tsx) | `855FC1C48A886A3B59F744A2A95DD8585B284573DC5E9C39DB45E3ECC63C819E` | 是 |

- **文件所有权审计**：`git diff --stat -- app/` 仅包含上述 12 个产品文件（200 insertions, 41 deletions）；未改动 `server/`、`services/`、`workspace/`、`.env.local` 或任何禁止修改的既有未提交文件；复验全程未对产品代码与既有单元测试做任何写入，未执行 git 写命令。

### R2-2. 返修差异代码审计
- `app/pages/DraftReviewPage.tsx`：移除 `backLabel` 默认参数以免覆盖显式/隐式判别；`!view` 加载/错误兜底返回按钮使用 `{backLabel ?? '返回'}`；`view.input`、`outcomeMode` 与 `view.maintenance` 均透传 `backLabel={backLabel}`；默认分支使用 `{backLabel ?? '返回 Raw'}`。
- `app/pages/RawOutcomeReview.tsx`：`Props` 新增可选 `backLabel?: string`，第 303 行渲染 `{backLabel ?? '返回'}`，保持直接挂载不传 `backLabel` 时的 `'返回'` 默认行为不变。
- `app/pages/KnowledgeMaintenanceReview.tsx`：新增可选 `backLabel?: string`，第 32 行渲染 `{backLabel ?? (view.input ? '返回知识库' : '返回 Raw')}`，兼容不传 `backLabel` 的原有上下文回退。
- `tests/uifix01-ui.test.tsx`：新增 `'U1-01 返修：真实服务端带 outcomeDigest 草稿进入 RawOutcomeReview，KnowledgeMaintenanceReview 与加载兜底均透传 backLabel'` 用例，完整覆盖真实 `outcomeDigest` 路径、`!view` 兜底态、`view.maintenance` / `view.input` 透传以及直接挂载 `RawOutcomeReview` 默认 `'返回'` 兼容性。

### R2-3. 返修后独立测试与隔离浏览器全量实测结果

| 验证项目 | 执行命令 | 环境与退出码 | 结果摘要 |
| --- | --- | --- | --- |
| 15 个测试文件回归 + 新增测试 | `node --import tsx --import ./tests/support/css-stub.mjs --test tests/uifix01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/app-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx tests/provider-config-ui.test.tsx tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news08-ui.test.tsx tests/ui01-interface.test.tsx tests/ui02-interface.test.tsx tests/ui03-interface.test.tsx tests/ui04-interface.test.tsx tests/wiki-selection.test.tsx tests/prompt-ui.test.tsx` | 退出码 `0` | `tests 58` / `pass 58` / `fail 0`（耗时 `12608.4607ms`） |
| 全量类型检查 | `npm.cmd run typecheck` | 退出码 `0` | `tsc -b` 零错误通过 |
| 隔离真实 Edge 浏览器全量复验 | `node --import tsx tests/acceptance/uifix01-review-browser.mjs` | 退出码 `0` | 基于最新 12 个产品文件重新打包 238 模块（`index-BxcjB3_6.js`），Edge `157.0.4341.60` 在隔离目录 `C:\Users\80593\AppData\Local\Temp\uifix01-review-5oUqJL`（`apiPort: 63792`, `uiPort: 63793`）实测通过：<br>- `U1-01-workflow`：`工作空间 / 更新与综合审阅`，点击 `工作空间` 退回工作台；<br>- `U1-01-automation-draft`：`hasOutcomeDigestFromServer: true`，页面标题 `整理成果`，按钮文案 **`返回自动化`**（`hasExpectedBackLabel: true`），点击 `返回自动化` 与点击面包屑 `工作空间` 均返回自动化收件箱；<br>- `U1-02`：侧栏主导航 `7/7`、全部侧栏 `8/8` SVG 图标互不重复；<br>- `U1-03`：Raw `SynthesisDialog` 使用 `.modal-scrim`（`position: fixed`, `1440x900`）且视口绝对居中（`left: 355, top: 254, width: 730, height: 392`），焦点捕获、`Escape` 关闭与焦点还原通过；Raw `DeleteDialog`、Wiki `WikiDeleteDialog`、Prompt `PromptDeleteDialog` 均支持 `Escape` 关闭与焦点还原；<br>- `U1-04`：NewsPage 存在 `返回工作台`、`#news-section-fmcg` / `#news-section-ai` 锚点，检查中显示 `正在检查更新…` / `正在补抓失败来源…`；<br>- `U1-05`：SettingsPage 编辑未保存时禁用 `测试连接` 并展示 `有未保存的修改，请先点击「保存配置」后再测试连接。`；<br>- `390x844` 移动端：设置（含未保存提示）、首页、每日资讯、Raw、Raw `SynthesisDialog`（`dialogFitsViewport: true`）全部 `scrollWidth === 390 <= innerWidth`；<br>- 零未拦截外网请求（`blockedBrowserExternalRequests: []`），`pageErrors: []`，全部隔离进程已关闭（`browser: true, ui: true, api: true`）。 |

---

## Round 1：历史初检 FAIL 记录（保留归档）

> 以下为首轮独立验收时的历史记录，该轮发现的 `U1-01` 真实运行态阻断已在 Round 2 返修中彻底修复并复验通过。

- **初检日期**：2026-11-19
- **初检局部结论**：施工方按当时 10 个产品文件任务卡完成修改且 49 项 JSDOM 测试（当时 `tests/uifix01-ui.test.tsx` SHA-256 `3B4248AC0E2547E2B8FBA7279E0AB9D91687C7A0774F17FFFA462D192A6719B9`、`DraftReviewPage.tsx` `81811E04370FE188E8E7C2EDA2555462D05AA4D343BBABABA0DCB7F502FBCEED`）与 `typecheck` 通过。
- **初检批次结论**：**`FAIL`**。
- **初检阻断原因与实测证据**：
  - 初检复现命令 `node --import tsx tests/acceptance/uifix01-review-browser.mjs`（首次沙箱运行曾触发 Vite `realpath` `EPERM`，随后 `task-176` 在隔离目录 `C:\Users\80593\AppData\Local\Temp\uifix01-review-wDvcgw` 构建运行，退出码 `1`）。
  - 真实服务端 `DraftStore.view`（[services/wiki/drafts.ts#L908](file:///e:/AI/Work/AIPM%20Workspace/services/wiki/drafts.ts#L908)）返回 `outcomeDigest`，`DraftReviewPage.tsx#L237,L350` 提前路由至 `RawOutcomeReview`，而当时 `RawOutcomeReview.tsx` 未在任务卡范围且第 303 行硬编码 `返回`，导致 Edge 实测 `U1-01-automation-draft` 失败（`hasOutcomeDigestFromServer: true`, `actualHeading: "整理成果"`, `actualBackLabel: "返回"` ≠ `"返回自动化"`）。
  - 初检 JSDOM 13 个文件 `tests 49` / `pass 49` / `fail 0`、`typecheck` 退出码 `0`；Edge 中 `U1-02`、`U1-03`、`U1-04`、`U1-05` 及 `390x844` 移动端已于初检阶段先行通过，并在 Round 2 全量复测中保持通过。

---

## 遗留与范围外观察（非本批阻断）

- 经全局检索，[app/pages/MeetingPage.tsx](file:///e:/AI/Work/AIPM%20Workspace/app/pages/MeetingPage.tsx) 第 74、88、102 行仍存在 3 处未接入 `useDialogFocus` 与 `Escape` 监听的 `.modal-scrim` 弹窗；该文件不属于 `UIFIX01` 任务卡允许修改的 12 个产品文件范围，不影响本批 `PASS` 结论，建议留待后续 UIFIX 批次统筹完善。
