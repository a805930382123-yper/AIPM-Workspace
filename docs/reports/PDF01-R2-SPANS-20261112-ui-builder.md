# PDF01 R2 第四版浏览器验证

基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加现有工作树。两页合成资料经 Chrome 上传到隔离的真实产品 API，再走页理解、清理、索引、归并展示及生成待审草稿。[冻结指纹](PDF01-R2-SPANS-20261112-ui-fingerprints.json)

- 第 2 页的一个 AI 段被切为三个可原样拼回的片段，分别归入试点覆盖、新增用户、商户规模。173 家门店在完整候选正文中只出现一次，保留 AI 解读身份并链接第 1、2 页。875 位新增用户单列，61 家商户与 43 家活跃商户并列。三个候选都保存同一份完整父段、来源页码及结果摘要，证据面板可实际打开原 PDF 第 2 页。[覆盖正文](PDF01-R2-SPANS-20261112-ui-evidence/01-coverage-once-two-pages.png) · [新增用户](PDF01-R2-SPANS-20261112-ui-evidence/02-users-with-full-parent-evidence.png) · [商户数据](PDF01-R2-SPANS-20261112-ui-evidence/03-merchant-counts-with-parent-evidence.png)
- 首轮截图发现紧凑卡片读取完整父段作摘要，造成不同候选都预览门店规模。经批准改用 PDF 候选实际正文的第一条有效事实，保留完整依据面板。仅重建前端并重开同一草稿，三卡分别显示 173、875 和 61。最终 Chrome 摘要核对零 POST、零新增模型调用，正式 Wiki 文件摘要一致。[修复后摘要](PDF01-R2-SPANS-20261112-ui-evidence/summary/04-scoped-candidate-summaries.png) · [摘要机器记录](PDF01-R2-SPANS-20261112-ui-evidence/summary/browser-result.json)
- 原件、Raw、R1 第 2 页理解和正式 Wiki 文件摘要在完整链路前后一致。完整链路共五次本机 fake HTTP 调用，真实模型调用为零。截图亲看，待审草稿未发送确认请求。早期三张正文和证据截图摄于摘要修复前。[完整链路机器记录](PDF01-R2-SPANS-20261112-ui-evidence/browser-result.json)

隔离入口为 `node --import tsx tests/acceptance/pdf02-consolidation-isolated.ts --spans`。新根完整复跑为 `node tests/acceptance/pdf02-spans-browser.mjs <isolated-session.json> <evidence-dir>`。已生成草稿时可附 `--summary-only` 定向验证摘要。空 envDir 构建通过，233 个模块。

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/pdf02-ui.test.tsx tests/ui01-interface.test.tsx tests/kb03-confirm-ui.test.tsx` 通过 7/7，产品及新增入口 50 个 TypeScript 根文件零诊断。真实资料质量及正式验收由独立复审裁决。
