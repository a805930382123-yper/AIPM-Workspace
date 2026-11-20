# NEWS14 独立验收

冻结改动对应工程提交 `9fd88928029808fcf953787d875374436d8b9ba0`。

本轮缺陷关闭，PASS。AI 前沿的五条上限现按来源计算。NEWS14 整批 PASS。验收基线为 `cf6631948e188a667a0d30c295f64d6e76d78424` 加已冻结工作树，生产包为 `index-CTuxfCj3.js`。验收前端、服务文件 SHA-256 分别为 `4E3567F0B1207E05599D6D653DD2B4F0F527C3D0CF2B63D3D32EAE93E4881197`、`A329C383C332E5A1F8B7E7F461B3B9D0614AD4BDAD12B8F049E821D74DCBA608`。

- 用 `node node_modules/vite/bin/vite.js build --outDir "$env:TEMP/news14-edge-review/dist"` 独立构建，生产包与主会话一致。只读复制正式服务 GET /api/news/today 的期刊，在临时数据目录用 `node --import tsx server/index.ts --production` 启动 API 4494，隔离 UI 4495。浏览器从首页点击「阅读资讯」，今日实际列出 AIHOT 5、Anthropic 3、Simon Willison 3、Karpathy YouTube 5、Karpathy X 5，共 21 条。
- 将副本日期改成 11 月 19 日，并为 AIHOT 添加一个较新的条目。在阅读日期选中 19 日看到新条目排在 AIHOT 组首，该组仍显示五条。快消历史显示原有 4/5 条及原因。将临时今日 AI 栏置为失败并清空内容，重新进入页面看到「读取失败 · 显示 2026-11-19 的历史内容」以及同样五组、21 条。样本中原有的「本期已满5条」没有显示在 AI 栏。
- 独立运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news13-integration.test.tsx`，3/3 通过。覆盖真实服务隔离更新计数、组件点击手动检查后最新内容置顶、跨列表去重、诊断、旧分析、Raw 入口及仅含来源条目的历史回退。
- 对隔离服务历史期刊同一来源条目连续两次 POST /api/news/editions/2026-11-19/items/save-raw，两次返回同一 Raw ID，created 依次为 true、false。正式工作区仅用于读取当日样本。实时外部采集与真实模型调用不在本轮验收范围。
