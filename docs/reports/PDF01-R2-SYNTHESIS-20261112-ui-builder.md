# PDF01 R2 主题写作浏览器交接

基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加现有工作树。实际 Chrome、真实产品 API 和本机 fake Provider 通过三页合成资料，生成待审草稿。[指纹](PDF01-R2-SYNTHESIS-20261112-ui-fingerprints.json)

- 三处等义材料合为一条 173 家门店的 AI 整理段落，引用同时链接第 1、2、3 页。南区 2028 年预测 181 家另列，875 位新增用户仍有独立候选。[同义材料及不同预测](PDF01-R2-SYNTHESIS-20261112-ui-evidence/01-written-paragraph-and-distinct-forecast.png) · [新增用户](PDF01-R2-SYNTHESIS-20261112-ui-evidence/03-new-users-kept.png)
- 覆盖候选的四条完整依据可展开，实际打开原 PDF 第 3 页。Logo、页码和推广有持久写作归属及理由，没有独立候选。正式 Wiki 文件摘要、原件、Raw 和页理解在验证前后一致，浏览器未发送确认请求。六次模型请求均打到本机模拟端点。[完整依据](PDF01-R2-SYNTHESIS-20261112-ui-evidence/02-all-source-material.png) · [机器记录](PDF01-R2-SYNTHESIS-20261112-ui-evidence/browser-result.json)
- 首轮紧凑卡片带上新版来源脚注，已扩现 PDF 摘要剥离规则。仅重建前端并重开同一草稿，卡片保留事实句，展开正文保留来源标签与链接。Chrome 定向复验零 POST、零新增模型请求，截图已亲看。[最终摘要](PDF01-R2-SYNTHESIS-20261112-ui-evidence/summary/04-summary-without-citation-text.png) · [摘要记录](PDF01-R2-SYNTHESIS-20261112-ui-evidence/summary/browser-result.json)

完整 Chrome 链路实际使用 `pdf-cleanup.ts` SHA `5bb49ced…4ce0`、`pdf-topic-writing.ts` SHA `242d0d00…6c1e`、`render.ts` SHA `0d3acb4a…14cd`。后端冻结后 cleanup 和 writer 变为 `a4a8944e…79b1`、`a18090d6…0958`，涉及护栏、较大主题分批 ID 和旧版本分支。渲染器 SHA 相同。最终版启动及空 envDir 构建通过，按验收分工复用浏览器行为证据，最终后端变化由专项和独立复审覆盖。

复跑入口是 `node --import tsx tests/acceptance/pdf02-consolidation-isolated.ts --synthesis`，随后执行 `node tests/acceptance/pdf02-synthesis-browser.mjs <isolated-session.json> <evidence-dir>`。若已有待审草稿，可附 `--summary-only` 验证摘要。`node --import tsx --import ./tests/support/css-stub.mjs --test tests/pdf02-ui.test.tsx tests/ui01-interface.test.tsx tests/kb03-confirm-ui.test.tsx` 通过 7/7，产品与新增入口共 50 个 TypeScript 根文件零诊断，空 envDir 构建 233 个模块。
