# QUICKUX01 施工报告

基线为 `main` 的 `61a1fd6c74de7eb0dd116d7b52bd70c55c646844`。施工内容以工作树 SHA-256 为准，提交由主线程完成。[冻结任务卡](../handoffs/QUICKUX01-20261120-task.md)

## 交付

- Q1-01 主题卡支持按标题、摘要、定义、理由和动作搜索，以及全部、待处理、已勾选、已入库、已忽略筛选。筛选工具位于双列网格的首个通栏内，统计和确认条继续反映真实显示量与已选量。编辑或调整期间锁定筛选，避免隐藏正在编辑的卡片。
- Q1-02 「暂不采纳」折叠卡片、取消勾选并记录到当前草稿的浏览器存储。「恢复待选」恢复正常卡片，用户可以重新勾选。不可用的存储回退到当前组件内存，已经入库或已经不存在的主题会从存储清走。本机忽略和恢复产生 0 次 API 请求。当前筛选视图的全选和取消全选均保留视图外已选主题。
- Q1-03 速记复用 `POST /api/raw`，默认来源为个人速记并保留正文空白；网页链接复用 `POST /api/raw/import`，默认关闭翻译。单行链接提示只预填 URL。弹窗在提交期间锁定关闭，服务端请求失败后保留表单。已保存的 Raw 即使后续刷新失败也进入结果态，应用维持既有刷新错误提示。
- Q1-04 顶栏、首页标题区和 `Alt+N` 打开快速捕获。输入控件或已有对话框会拦截快捷键。关闭弹窗后恢复触发焦点。保存后刷新 Raw 和统计，点击结果中的「打开这条 Raw」才切到该条 Raw。

## 施工验证

在 `git archive HEAD` 解包后的隔离快照覆盖并逐一校验下列八个文件，使用空 Vite `envDir`、临时数据和临时构建输出。验收夹具使用合成草稿、JSDOM 与本地 Fetch 模拟。真实模型、公网抓取和对用户现有服务的操作均为 0。正式 `workspace/` 和 `.env.local` 未读取或写入。

| 实际命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 退出码 0。 |
| 下方定向命令 | 38/38 通过，失败、跳过和取消均为 0。其中 7 项是新增用例。 |
| `npm run build -- --configLoader native` | 退出码 0，Vite 6.4.3 转换 249 个模块并生成产物。Vite 提示输出目录位于项目根外，以及主包超过 500 kB。 |

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --test --test-reporter=tap tests/quickux01-ui.test.tsx tests/homeui01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/rawurl01-ui.test.tsx tests/uifix01-ui.test.tsx tests/uifix02-ui.test.tsx tests/uifix03-ui.test.tsx tests/uifix04-ui.test.tsx
```

定向回归覆盖六张主题的匹配和五种状态、筛选前后选集、同一草稿重新进入和跨草稿隔离、入库清理、多种存储错误、Unicode 自动标题、默认及手填速记请求、双模式切换、失败保留、保存期关闭保护和首页刷新。批次整体验收、全量测试和 1440 × 900、390 × 844 的真实浏览器验证由独立验收者完成。

初次构建因沙箱 TEMP 源码路径中的 `#` 无法解析入口，随后嵌套在 `node_modules` 的快照也无法加载 Vite 配置。最终构建使用被 Git 忽略的 `.scratch-quickux01-builder-*` 快照，空 `envDir` 和输出仍在 TEMP。该快照的 Vite 配置启用 `resolve.preserveSymlinks` 后绕过 Windows 沙箱的 `realpath EPERM`，仓库产品配置没有变更。

## QU1-04 遮罩关闭返修

独立 Edge 验收发现，点击顶栏入口后通过遮罩关闭，焦点未回到顶栏按钮。关闭处理器现在取消遮罩自身 `mousedown` 的默认动作，再关闭弹窗，以便焦点钩子恢复的焦点能在浏览器中保留。

新增断言按顶栏点击、遮罩关闭的顺序检查事件取消、弹窗卸载和触发按钮焦点。修复前运行 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-reporter=tap '--test-name-pattern=全局及首页入口' tests/quickux01-ui.test.tsx`，该用例因 `defaultPrevented` 为 `false` 失败。修复后用下列最终指纹的隔离快照重跑上表命令，类型检查和生产构建均退出 0，定向回归 38/38，构建转换 249 个模块。真实 Edge 复测由独立验收者记录。

## 交接指纹

| 文件 | SHA-256 |
| --- | --- |
| `app/App.tsx` | `d18ed9e1bde3db5069c6f2594441cc2d5da6086dc43310140ec8c0da51fef076` |
| `app/b04.css` | `b3614a8e2d578e1a953860bd7eec588f888fcb1b7e78f490ddd185578cf322c4` |
| `app/home.css` | `bd9f4b1d4ff5d2a6793728ba0ac1c7df370de4ac24309df26e48f077b163bb5c` |
| `app/pages/HomePage.tsx` | `33190c1c93da8e04a650264a6392678bed0cb8806a9d75ecc241ab4b58383970` |
| `app/pages/RawOutcomeReview.tsx` | `f16687c82691a692ebae8e6e0e5d3067b2bc51477db1005c8bd47abb0050bfc9` |
| `app/styles.css` | `b88838e901443eccc8cac2331cb9af724276f161459a80aca11f70ed6e8d0c43` |
| `app/components/QuickCaptureDialog.tsx` | `e9fa9be8355368bc775addcb65accc9f7074eec435d2e3a3e76dffa227d02b3c` |
| `tests/quickux01-ui.test.tsx` | `ecc482489e497015e4040ee028f208ba761cdb565459c1ce1d27043a6d5599a8` |
