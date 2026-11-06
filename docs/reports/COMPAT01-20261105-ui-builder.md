# COMPAT01 UI 施工交接（2026-11-06）

Sol High `/root/compat_ui` 完成 UI 施工自查，交 Astra 独立复验。main / HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b` 加当前工作树。以下结果覆盖本工单 UI 范围，完整默认测试及批次结论由协调者汇总、独验。

## 实际变更

- `app/components/useDialogFocus.ts` 在 effect 中以弹层的 `ownerDocument` 捕获和恢复触发焦点，并在同一文档中判断 Tab 边界。服务端渲染期间没有 DOM 读取。保留原 Tab 范围与 Escape 行为。
- `app/pages/RawPage.tsx` 经协调者追加单行所有权，将导入标题输入框的 React `autoFocus` 换为 hook 可识别的 `data-autofocus`。React 的自动聚焦早于 effect，先把活动元素移进弹层会让 effect 丢失触发按钮。由 hook 先捕获外部焦点再聚焦标题，保持可见行为并恢复关闭后的焦点。
- `tests/app-navigation.test.tsx`、`tests/kb02-human-ui.test.tsx`、`tests/kb02-storage-ui.test.tsx`、`tests/kb03-review-ui.test.tsx`、`tests/ui-b04.test.tsx` 按当前导航、实际维护审核和阶段预算迁移断言。`tests/ui.test.tsx` 保留原 SSR 测试，SHA 与基线一致。
- `tests/acceptance/lw02-review-copy.tsx` 仅删除未使用的 React 导入，保留完整 tsconfig 检查。
- 新增 `scripts/compat01-ui-isolated.ts` 和 `tests/acceptance/compat01-ui-browser.mjs`。使用真实打包 App、B04/Knowledge/Home 路由、runner 和 stores，两份合成 Raw 由本地 fake 返回确定结果。测试仅需 `node tests/acceptance/compat01-ui-browser.mjs`，使用本机现有 Chrome 和 Playwright。子进程通过 Express 随机 loopback 端口同时提供静态前端和 API，使用新 TEMP 数据根、新空 envDir 及 TEMP 构建目录。清除继承 Provider 变量，配置加载器未接入，浏览器阻断并记录外部地址。

## 逐项失败归因

原始结果见 [COMPAT01 初始 npm test](COMPAT01-20261105-builder-evidence/npm-test-baseline.txt)。下表列出 UI 所属十项，行号指原始日志错误详情。组件测试原始执行结果见 [28 项测试日志](COMPAT01-20261105-ui-evidence/component-tests-initial.txt)。

| 日志 | 测试 | Actual / expected 或签名 | 根因、合同及验证 |
| --- | --- | --- | --- |
| 769 | App侧栏导航：草稿→Raw清除审核覆盖，工作流→首页/Raw退出工作流且Raw选择保留 | 等待首页 `.pending-knowledge-workflows button` 超时 | 陈旧交互。首页使用行动事项列表和带版本 token 的详情入口，Raw 仍保留工作流列表。测试点击行动按钮，断言实际请求及审阅组件打开，再确认侧栏退出覆盖、Raw 选中项保留。 |
| 858 | HUMAN React + real HTTP saves selection, resolves units, reviews every page, invalidates edits, refreshes then explicitly commits | 等待两颗旧“确认本页主题与归属”超时，实际打开“审核知识变更” | 陈旧交互。用真实标准提取和维护接口生成两个变更，经 UI 逐项接受、归属移除和恢复、核对、编辑、重审及刷新。验证只有受编辑项的审批失效，确认前正式 Wiki 和提交请求为零，显式提交后两页加 Source 写入、Raw 不变。 |
| 1062 | SR01 start failure reload is actionable and late storage response cannot change a different Raw selection | 旧“AI 整理知识”找不到，`undefined !== true` | 陈旧交互。当前整理入口在存储故障期间禁用并且没有审核入口。保留延迟回复不得覆盖另一条 Raw 选择、回调数为零、模型调用为零。 |
| 1081 | SR01 App recovers coverage storage failure then polls same-job explicit planning retry through draft review | 累计调用 `4 !== 3` | 陈旧阶段预算。真实失败前提取和规划各一次，存储恢复零调用，显式重试仅重新规划并生成维护提案各一次。检查标准重试 payload、原作业 ID、累计 4 次、唯一草稿、默认暂缓且正式写入禁用。 |
| 1582 | KB03 React real HTTP table editing/delete supplement/questions survives refresh, report stale and actual second offset highlighted | 累计调用 `6 !== 5` | 陈旧阶段预算和旧审批入口。走真实深度维护，断言提取、规划、大纲、成文、质量及维护各一次。通过 DOM 完成变更审批和深度报告双告知，再验证表格编辑、删除补充、人工问题、报告过时、变更审批摘要失效和笔记审批清除，刷新仍阻止提交。第二个重复原句仍精确高亮 `[512, 1024)`。 |
| 1599 | KB03 Raw React defaults/boundaries and explicit standard selection reset per Raw | 点击旧“AI 整理知识”时 `assert(button)` | 陈旧交互。点击现入口并验证仅发送 `{ mode: 'standard' }` 和实际作业完成，保留长文 30,001 字符不能选 deep、返回短 Raw 重置为 deep。 |
| 2137 | B04 Raw 详情：五种状态与 AI 整理/取消/继续审核入口 | 找不到旧“AI 整理知识” | 陈旧交互。验证现入口发送精确 deep 默认 payload 并传回作业 ID，继续审核传回正确草稿 ID，同时保留处理中、取消、失败与已生成的状态检查。 |
| 2154 | 粘贴导入对话框保留原有文本流程与字符上限 | `ReferenceError: document is not defined` | SSR 产品缺陷。修复 hook，原粘贴渲染断言原样通过。 |
| 2168 | 文件上传对话框提供四种格式、20 MiB 与 500,000 字符边界 | `ReferenceError: document is not defined` | 同一 SSR 产品缺陷，原文件上传 SSR 断言原样通过。 |
| 2182 | 导入入口渲染出对话框，空列表也有导入按钮 | `ReferenceError: document is not defined` | 同一 SSR 产品缺陷，原 Raw 页带弹层 SSR 断言原样通过。 |

## 验证和截图

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/ui.test.tsx tests/app-navigation.test.tsx tests/kb02-human-ui.test.tsx tests/kb02-storage-ui.test.tsx tests/kb03-review-ui.test.tsx tests/ui-b04.test.tsx` 退出 0，28/28，0 跳过、取消、todo。原始日志第 708 行和本轮组件测试都有 React controlled/uncontrolled 提示。Chrome 当前维护链路只记录下面预期的 409。
- `node node_modules/typescript/bin/tsc --noEmit` 退出 0，无诊断，按当时共享工作树的完整 tsconfig。`node --check tests/acceptance/compat01-ui-browser.mjs` 与 UI 跟踪文件 `git diff --check` 退出 0。
- `node tests/acceptance/compat01-ui-browser.mjs` 最终退出 0。先以空 envDir 及 `configFile:false` 构建 226 模块，再启动完整 App/API，Chrome 156.0.8078.80、1440×1000。执行结果及 SHA 在 [浏览器记录](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/result.json)，构建输出与随机端口在 [服务日志](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/server.txt)。

6 张截图均已查看。首张能看到人工编辑内容和取消勾选，禁用确认按钮由浏览器断言验证。正式回读图右栏可见人工内容和来源关联，截图时左栏尚在加载。

- 从首页生成第一条 Raw 草稿，审核勾选后编辑，保存清掉审批。再次勾选后刷新，从首页行动事项重开，正式提交返回 201，回读原主题和 Source。 [编辑清审批](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/01-edited-approval-cleared.png) [正式页回读](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/02-formal-wiki-after-refresh.png)
- Raw 页用键盘打开导入，焦点进标题，首元素 Shift+Tab 到末元素，末元素 Tab 返回首元素，Escape 维持既有行为。关闭后回到导入按钮，重开后焦点进入标题，取消再恢复。 [初始焦点](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/03-dialog-initial-title-focus.png) [反向 Tab](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/04-dialog-reverse-tab-wrap.png) [恢复触发焦点](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/05-dialog-focus-restored.png)
- 从 Raw 入口生成第二条标准维护草稿，审核后并发人工更新正式目标页。确认返回 `409 WIKI_REVISION_CONFLICT`，屏幕显示失败，草稿保持待确认，正式 Wiki 文件 SHA 与拒绝前相同。两条合成 Raw 文件全程 SHA 不变。 [实际冲突提示](COMPAT01-20261105-ui-evidence/browser-2026-11-05T16-17-06-337Z/06-confirmation-conflict-retained.png)

浏览器假调用 6 次，两条标准链各一次提取、规划和维护。真实模型请求、外部浏览器请求、正式 workspace 读写、真实配置或凭据读取均为 0。无 pageerror，console 唯一错误为预期的确认 409。最终独立端口 55931，空 envDir 复查为零条目。4 次尝试的自有服务进程均退出、浏览器均关闭，TEMP 和证据保留。三次早期记录分别是异步受控复选框脚本等待、复用的旧启动器 Vite 加载超时，以及测试定位范围偏浅，均保留在本批证据目录。

[前后文件 SHA256](COMPAT01-20261105-ui-evidence/fingerprints.json) 对照本批冻结基线，包含新增脚本、追加所有权的 RawPage 及零改动的 SSR 测试。施工完成后停写，供 Astra 独立复验。真实模型语义仍为 NOT_RUN。本工作区状态未提交、推送或部署。
