# PDF01 R2 归并返修浏览器交接

基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加现有工作树。本轮增加两份隔离验收脚本，直接复用现有成果审核、PDF 证据入口及正式读器。受验后端、读器、脚本和结果绑定 [SHA-256 指纹](PDF01-R2-CONSOLIDATION-20261110-ui-fingerprints.json)。

## 实际验证

- `node --import tsx tests/acceptance/pdf02-consolidation-isolated.ts` 以空 Vite envDir 构建 233 模块，启动真实 `server/index.ts`、本机 fake HTTP Provider 和完整 App。项目正式资料与配置均未使用。
- `node tests/acceptance/pdf02-consolidation-browser.mjs <isolated-session.json> docs/reports/PDF01-R2-CONSOLIDATION-20261110-ui-evidence/final-check`，Chrome 约 5 秒完成。原文字层与页图重述归到同一主题，待审正文有且仅有一条代表，并同时列第 1、2 页链接。不同年份、规模、抽样条件，以及新增商户数与购物者数各自保留。原六条证据与清理处置可展开，实际打开两页原件链接均验证 inline PDF 及页锚。原件字节、Raw、页理解和正式 Wiki 磁盘快照保持一致。勾选草稿后确认按钮可用，浏览器请求记录中无确认调用。[机器记录](PDF01-R2-CONSOLIDATION-20261110-ui-evidence/final-check/builder-browser-result.json)
- 本地 fake HTTP 共 6 次，分别为三次 R1、一次清理、一次带完整样本索引和一次展示。清理、索引、展示的用户 JSON 分别为 757、401、845 字节。生成草稿和读证据无额外调用。该合成样本只能证明产品按预设响应运行，真实六页质量仍待独验。
- 浏览器脚本 `node --check` 通过。隔离脚本使用项目 `tsconfig.json` 编译选项单独作 TypeScript 检查，零诊断。前置试跑修了 fixture 的空 R1 响应、索引取样假设和折叠面板选择器，旧截图保留。本轮未重跑全仓基线损坏测试。

亲看最终三张图：[清理处置](PDF01-R2-CONSOLIDATION-20261110-ui-evidence/final-check/builder-01-cleanup-original-decisions.png) · [待审正文](PDF01-R2-CONSOLIDATION-20261110-ui-evidence/final-check/builder-02-draft-consolidated-content.png) · [双页原始依据](PDF01-R2-CONSOLIDATION-20261110-ui-evidence/final-check/builder-03-dual-original-evidence.png)。
