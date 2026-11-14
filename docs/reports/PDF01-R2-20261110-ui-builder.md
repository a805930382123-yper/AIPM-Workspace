# PDF01 R2 UI 施工交接

基线 `b4eb4418cc0254ee27d72a0565edcd5ff80b08ae` 加 R1 未提交产物。本轮 UI 施工自查完成，交 Astra 独立验收。产品、验收脚本和最终截图的 SHA-256 见 [冻结指纹](PDF01-R2-20261110-ui-fingerprints.json)。

Raw 详情沿用 PDF 逐页阅读，增加内容清理范围、缺页提示、阶段进度和清理摘要。保留、归并和略过理由可展开，并定位当前文档的对应页。清理完才可生成草稿。草稿沿用成果级编辑与选择，出现目标版本冲突时保留已保存编辑，并提示如何结束旧选择和重新生成。正式 Wiki 阅读复用现有网格渲染，只识别 PDF 标记表段；表头和表行可跳原页。紧凑成果摘要采用证据中的纯文本，详细表格与依据按需查看。

## 实际验证

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/pdf02-ui.test.tsx tests/pdf01-ui.test.tsx tests/ui01-interface.test.tsx tests/kb03-confirm-ui.test.tsx`，最终 9/9，覆盖 PDF 原生表、旧深度表、普通 Markdown、范围门槛和显式续跑。前一版同链加原 Raw 导入及 maintenance/confirm 的定向回归为 30/30。
- `node --import tsx tests/acceptance/pdf02-isolated.ts`，以空 Vite envDir 构建完整 App，233 模块。入口启动真实 `server/index.ts`，TEMP 专用数据目录和 fake Provider 配置，服务只绑定本机。关闭自己的 UI/API 进程，用户服务仍在其原环境。
- `node tests/acceptance/pdf02-builder-browser.mjs <isolated-session.json> docs/reports/PDF01-R2-20261110-ui-evidence/final-grid`，实际 Chrome 通过。四页合成 PDF 的第 4 页受控失败，整份清理被禁用，明确选择第 1–3 页。主题归并失败后刷新零请求，续跑复用已完成清理批，生成或重生草稿零新增请求。确认前、编辑、选择和冲突后核对正式 Markdown SHA；显式确认只更新所选主题及来源。正式页包含人工修订、120/200 两条表行、原页列和单一表注，实际点击表中链接打开原 PDF 第 3 页。原件字节与 Raw 正文摘要保持一致。[Chrome 记录](PDF01-R2-20261110-ui-evidence/final-grid/builder-browser-result.json)
- 采用项目 `tsconfig.json` 的编译选项，以产品、两项新增 TS 入口为根作类型检查，50 根文件、0 诊断。`npx tsc -b --pretty false` 全仓检查报 7 个基线已损坏测试文件的 9 条诊断。`git diff --check` 对本轮受管跟踪文件通过。

亲看了 [紧凑草稿](PDF01-R2-20261110-ui-evidence/final-grid/builder-07a-compact-outcome.png) 和 [正式原生表](PDF01-R2-20261110-ui-evidence/final-grid/builder-11-formal-page-source.png)。同版本另有 [缺页与范围](PDF01-R2-20261110-ui-evidence/final-grid/builder-01-missing-scope.png)、[清理摘要](PDF01-R2-20261110-ui-evidence/final-grid/builder-04-cleanup-summary.png)、[展开略过原因](PDF01-R2-20261110-ui-evidence/final-grid/builder-05-skipped-reasons.png)、[原页依据](PDF01-R2-20261110-ui-evidence/final-grid/builder-07-outcome-and-page-evidence.png) 和 [并发冲突](PDF01-R2-20261110-ui-evidence/final-grid/builder-09-concurrent-conflict.png)。首轮测试的来源锚点断言把来源总范围与主题逐页依据混淆，已校准，早期证据仍保留。浏览器结果使用合成应答，模型质量与长 PDF、取消状态的结论由相应独立验证覆盖。
