# PDF01-LONG Chrome 验证

基线 `d6a93bd2936f32b31324032b3aa9fce81c708a32` 加现有工作树。隔离 Chrome 实测四页合成资料，包括文字层、扫描和矢量页。真实产品 API 与本机 HTTP fake Provider 进入长报告 revision 6。[代码及截图指纹](PDF01-LONG-20261112-ui-fingerprints.json)

- 1,042 个原单位经 22 批清理，两个完整主题标签经一次索引归为一条待审主题。写作使用 14 个证据包和两次请求，用户 JSON 分别为 21,623、21,630 字节。核对包内原句全集与清理处置全集相等，草稿保留 1,042 条原页依据。[完整主题](PDF01-LONG-20261112-ui-evidence/01-full-topic-after-cleanup.png)
- 同一个第 2 页证据包指向 181 家预测和 175 家实际两个独立段落。第 3 页定性方法及第 4 页 875 位用户尾项留在同一候选。实际点击第 2、4 页依据，Chrome 打开原 PDF 对应页码。[两个段落](PDF01-LONG-20261112-ui-evidence/02-same-pack-two-paragraphs.png) · [尾项](PDF01-LONG-20261112-ui-evidence/03-tail-result-in-the-same-topic.png) · [末页依据](PDF01-LONG-20261112-ui-evidence/04-tail-source-available.png)
- 勾选该主题后确认按钮可用，浏览器请求记录无确认。正式 Wiki 文件摘要与处理前一致，原件字节、Raw 和四页理解均相同。四页理解、22 次清理、一次索引及两次写作共 29 次本机模拟请求。[机器记录](PDF01-LONG-20261112-ui-evidence/browser-result.json)

启动命令为 `node --import tsx tests/acceptance/pdf02-consolidation-isolated.ts --long`，随后运行 `node tests/acceptance/pdf02-long-browser.mjs <isolated-session.json> <evidence-dir>`。实际 Chrome 通过，约 6.4 秒。四张截图已亲看。浏览器脚本语法检查和隔离 TypeScript 检查通过，空 envDir 构建 233 个模块。自有浏览器、隔离服务、模拟端点与 API 子进程已关闭。真实 62 页结果和最终批次结论交独立复审。

最终 `pdf-cleanup.ts` 为 `f86bf5be…9f07`，`pdf-topic-writing.ts` 为 `533daf0f…2b8d`。Chrome 运行时对应 `924e7473…21f5` 与 `79293433…8abc`。最终文件增加遇表格、推断或待核条目时的断包、4 KiB 单元限制和旧检查点请求计数一致性检查。用 `node --import tsx --input-type=module` 离线读取同一 TEMP 的 Raw、页理解及写作检查点，调用最终版 `pdfPageUnits`、`longWritingBatches` 和 `readWriting` 核验。1,042 项全部为保留内容，单项最大 39 字节，表格、推断、问题均为零，已存 22 个清理批与 25 次请求计数相符。最终版复算仍为 14 包、两次请求，字节数与浏览器记录一致，两份已存写作结果均通过最终校验。渲染及 UI 文件指纹相同，沿用原 Chrome 操作和截图证据。离线核对期间无服务启动或模型请求。[实际版本及复核结果](PDF01-LONG-20261112-ui-fingerprints.json)
