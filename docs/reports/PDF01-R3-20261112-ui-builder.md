# PDF01 R3 Chrome 验证交接

基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加现有工作树。使用真实 Chrome、隔离产品 API 和本机 HTTP fake Provider。脚本、产品文件与各次截图的实际版本见 [冻结指纹](PDF01-R3-20261112-ui-fingerprints.json)。

- 混合 PDF 的第 3 页受控失败。刷新时模型计数一致，点击继续只重试第 3 页。清理只选第 1–2 页。写作受控失败，刷新后显式继续仅重试写作，清理和索引各运行一次。[缺页与范围](PDF01-R3-20261112-ui-evidence/02-partial-understanding-and-missing-page.png) · [失败与继续](PDF01-R3-20261112-ui-evidence/03-writing-failure-and-explicit-resume.png)
- 点第 2 页证据查看实际页图，返回后焦点回到原证据按钮，理由折叠区域仍打开。保存人工编辑并只选一项，正式 Wiki 在确认前的文件摘要一致。确认后有且仅有一个正式主题及来源笔记，未选主题没有正式记录。Wiki 阅读视图显示人工编辑和第 1、2 页引用。PDF 原件字节、Raw 与页理解前后一致。[返回证据](PDF01-R3-20261112-ui-evidence/05-back-to-original-evidence-focus.png) · [正式读回](PDF01-R3-20261112-ui-evidence/07-formal-wiki-readback.png)
- 扫描 PDF 保留空文字层和原件，实际启动页图理解，之后清理按钮可用。完整链共九次本机 fake 调用。[扫描理解](PDF01-R3-20261112-ui-evidence/09-scan-page-understood.png) · [完整链机器记录](PDF01-R3-20261112-ui-evidence/browser-result.json)
- 完整链后发现混合 PDF 导入表单仍给出旧自动生成主按钮。修复后重建前端，用同一隔离环境实际重新导入混合和扫描两种 PDF。两种都以「仅保存 Raw」为主按钮，保存后进入逐页阅读，浏览器只发两次导入 POST，模型计数与 Wiki 摘要一致。[混合 PDF 最终导入](PDF01-R3-20261112-ui-evidence/final-import/mixed-pdf-import-primary-save.png) · [扫描 PDF 最终入口](PDF01-R3-20261112-ui-evidence/final-import/scan-pdf-entry-after-import.png) · [最终导入机器记录](PDF01-R3-20261112-ui-evidence/final-import/browser-result.json)

完整链的 `PdfPages.tsx` SHA `5349a0b7…3aab` 与最终版一致。`RawPage.tsx` 完整链 SHA `02fd779c…528f`，中间入口 SHA `f4a4cd43…3b2`，最终导入 SHA `9b61f88a…41d1`。中间版校验了旧任务恢复调整后的顶部入口，最终版复验了导入按钮及保存结果，保留三轮各自的证据。

使用 `node --import tsx tests/acceptance/pdf02-consolidation-isolated.ts --r3` 启动空 envDir 构建，再用 `node tests/acceptance/pdf03-browser.mjs <isolated-session.json> <evidence-dir>` 跑完整链。`--import-entry-only` 只复验实际导入。浏览器脚本语法检查和隔离 TypeScript 检查通过，最终构建 233 模块。隔离服务、模拟端点和 API 子进程已关闭。正式验收结论由 Astra 独立给出。
