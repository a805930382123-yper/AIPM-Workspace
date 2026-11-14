# PDF01 第一轮后端施工交接

基线 HEAD `234b5222eada2b8fe83ba8dbd515f12f18b6be84`。后端施工已停写，交 Astra 独立验收。[冻结指纹](PDF01-R1-20261109-backend-fingerprints.json) 包含 16 个后端文件。任务卡基线只记录部分路径，`services/llm/jobs.ts` 和 `tests/import.test.ts` 的 `before:null` 表示未采集起始指纹。这两个文件原已存在。

## 交付

- PDF 文件导入保留原始字节和可核对的 SHA-256。有文字的页沿原规则拼入 Raw，记录每页 UTF-16 范围，扫描页记录空范围。经 PDF 解析确认没有文字层的上传可保存空正文及原件。通用 `parseFile` 和普通空输入沿用原门禁，扫描件的旧正文整理接口返回 `PDF_TEXT_LAYER_REQUIRED`。
- PDF 接口按需在本机生成真实 PNG，使用 PDF.js 自带的本机字体、CMap 和 WASM 资源。缓存图像和页理解存于 `state/raw-pdf/<rawId>`，关联原件、Raw 摘要和页号。原件路由返回校验过的原字节和 inline PDF 响应，支持 Chrome `#page=N`。依赖锁仅把原有 `@napi-rs/canvas@1.0.10` 声明为直接运行时依赖，依赖条目数量和版本均未变。
- 显式开始或继续后按页将实际 PNG 和已有原页文字交给模型。每次发送前持久记录尝试次数，成功结果逐页保存。失败、取消或进程中断后可查看已保存页，显式继续处理未完成页。只读查询、翻页、刷新及进程启动均不发模型请求。已知秘密文本、Meeting 来源、原件绑定和继续时的模型身份检查有实测。页理解独立于 Raw 原文和正式 Wiki。

## 实际验证

- `node --import tsx --test tests/pdf01-http.test.ts tests/import.test.ts tests/provider-config.test.ts tests/rawurl01-http.test.ts` 通过 40/40，耗时 16.33 秒。7 个新增 PDF 用例、20 个导入用例、8 个 Provider 用例及 5 个 URL 导入用例。真实 `server/index.ts` 子进程使用 TEMP 配置及本机 fake HTTP Provider。断言原件字节、扫描图、矢量图、逐页文字映射、实发 PNG 哈希、旧纯文本请求形状，以及只读零请求。
- 62 页合成混合 PDF 实际渲染出 62 个本机 PNG，收到顺序为 1 至 62 的 62 个 fake HTTP 请求。每次实际送出的 PNG SHA-256 与对应页持久记录相同。空白页有独立结果，第 62 页结果和原件均可读。
- 中间页失败、图像请求被 Provider 拒绝、取消后的迟到响应、原件损坏和状态路径不可写均按预期处理。杀掉第 2 页请求在途的真实 Node 子进程后，新进程 GET 显示中断状态，保留第 1 页，尝试数为 2，自动外发为 0。显式继续收到第 2、3 页，最终尝试数为 4。
- 首次扩展组合为 39/40。测试生成器把合成 key 放在超出可见区域的文字行，PDF.js 只提取了前缀。调整夹具文字宽度并断言 Raw 确实包含完整合成 key 后，同一边界验证通过。
- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf01-http.test.ts tests/import.test.ts` 退出 0。施工文件的 `git diff --check` 退出 0。
- 全仓 `npx tsc -b --pretty false` 未通过。实际 9 条诊断来自 7 个已有损坏测试文件。下表保留具体位置。按任务卡完成定向回归，本轮未运行完整 `npm test`。
- UI 施工使用空 Vite envDir 构建成功，真实 Chrome 覆盖翻页、原件 inline 跳转、失败保留和继续。[UI 施工证据](PDF01-R1-20261109-ui-builder.md)

| 全仓 TypeScript 诊断文件 | 实际诊断 |
| --- | --- |
| `tests/acceptance/AUTO01-review-actions.test.ts` | 1:1 TS1490 |
| `tests/kb03-review-ui.test.tsx` | 1:1 TS1490 |
| `tests/lw01-raw-ui.test.tsx` | 1:1 TS1490 |
| `tests/rawzh01-http.test.ts` | 1:1 TS1490 |
| `tests/rawzh01-ui.test.tsx` | 1:1 TS1490 |
| `tests/support/compat01-maintenance-reply.ts` | 1:1 TS1490，1:2 TS1128 |
| `tests/ui-b04.test.tsx` | 1:1 TS1490，1:2 TS1128 |

定向原始日志位于 `C:\Users\David.chen\AppData\Local\Temp\pdf01-r1-backend-5ef6c885-3bb5-4ab7-9f71-1a9b865427e6`。首轮为 `targeted.txt`，最终为 `targeted-final.txt`，局部类型检查为 `tsc-scoped.txt`。全仓 TypeScript 诊断来自施工工具输出，上表列出完整诊断位置。

本轮工程证据使用合成 PDF 和 fake Provider。真实模型的图像理解质量及原图中的秘密检测未验。文字层提取继续使用原有 PDF.js 路径，部分合成基础字体夹具仍有提取警告，最终渲染使用独立的本机字体资源。施工未读取用户配置、未使用正式工作区、未提交。
