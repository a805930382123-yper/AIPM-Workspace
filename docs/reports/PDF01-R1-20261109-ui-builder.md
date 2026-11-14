# PDF01 第一轮 UI 施工交接

基线 `234b5222eada2b8fe83ba8dbd515f12f18b6be84`。UI 施工范围内的检查已完成，交 Astra 独立验收。冻结文件和最终证据的 SHA-256 见 [UI 指纹](PDF01-R1-20261109-ui-fingerprints.json)。

Raw 详情的 PDF 面板显示单页本地图像、原页文字层和独立的 AI 页理解。前后翻页、页码选择和原件链接使用同一页号。开始或继续前提示未完成页的图像及已有文字会发给已配置模型。运行时显示页数进度和取消操作，失败时保留成功页并提供显式继续。空正文扫描件沿原导入表单保存原件，即使点「保存并生成 Wiki 草稿」也会在成功页引导去 PDF 阅读，跳过旧正文整理。

## 实际验证

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/pdf01-ui.test.tsx tests/ui.test.tsx tests/ui-interaction.test.tsx`，17/17。新增三项覆盖扫描导入跳过旧整理、单页只读导航、失败页显式继续。
- `node --import tsx tests/acceptance/pdf01-isolated.ts`，空 Vite envDir 构建成功，实际 App 使用真实导入与 PDF 路由、TEMP 文件及 fake Provider。向下游传递的图像是实际 PDF 页 PNG。Vite 报告现有 bundle 大小提示，构建产物可运行。
- `node tests/acceptance/pdf01-builder-browser.mjs <isolated-session.json> docs/reports/PDF01-R1-20261109-evidence/final`，真实 Chrome 通过。扫描原件和混合原件逐字节一致；扫描保存后无旧整理请求；只读浏览和刷新零模型请求；混合 PDF 第 2 页故障后累计请求页序 `1,2,2,3`，每次送出的 PNG 与同页浏览端点 SHA-256 相同。实际点原件链接打开 Chrome 新页，收到 inline PDF 响应，地址包含 `#page=3`。测试期间无外站请求和页面异常。[Chrome 机器记录](PDF01-R1-20261109-evidence/final/builder-browser-result.json)
- TypeScript 按现有 `tsconfig.json` 编译选项、以 `app`、`services`、`server`、新增 UI 测试及隔离入口为根做独立类型检查，50 个根文件、0 诊断。全仓 `npx tsc -b --pretty false` 遇到基线已损坏的测试文件，包括 `tests/rawzh01-http.test.ts`、`tests/rawzh01-ui.test.tsx`、`tests/acceptance/AUTO01-review-actions.test.ts`，整仓结果由主审汇总。

亲看了 [导入入口](PDF01-R1-20261109-evidence/final/builder-01-import-scan.png)、[纯扫描页](PDF01-R1-20261109-evidence/final/builder-03-scan-page-original.png)、[混合 PDF 的扫描页](PDF01-R1-20261109-evidence/final/builder-04-mixed-raster-page.png)、[失败与保留结果](PDF01-R1-20261109-evidence/final/builder-07-failed-retained.png) 和 [矢量图与独立结果](PDF01-R1-20261109-evidence/final/builder-08-complete-vector-and-ai.png)。早期脚本因等待与产品不一致的提示文案超时，保留了 [首轮断言现场](PDF01-R1-20261109-evidence/builder-failure.png)。最终截图重新使用新 TEMP 根，包含后端本机字体修复。浏览器验证使用合成响应，取消、长文档、真实配置入口及模型能力的结论不由这套截图覆盖。
