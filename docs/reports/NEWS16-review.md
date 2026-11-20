# NEWS16 独立验收

工程版本 `bb0eb2335ea5002762a9f2bd709ed74108ec4dc8`。本轮改动通过。八个新增 AI 来源的标题与摘录支持中文阅读、原文切换及按原始条目保存。NEWS16 整批通过。

- 独立运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news16-translations.test.ts tests/news16-ui.test.tsx tests/news13-integration.test.tsx`，6/6 通过。覆盖已展开条目、跨来源筛选、原文变更与内容缓存、并发去重、部分失败后手动重试、历史回退及 Raw 关联。
- 从 11 月 20 日期刊按原始标题和摘录计算 SHA-256，21/21 条对应缓存均有中文摘录，覆盖五个有材料的新增来源。抽查 Anthropic 的安全评估结论、Simon 的测试条件及「不到 10%／约 75%」、Karpathy 视频的章节与时间、X 的 4.7 万个视频和 3 分钟，以及 GitHub 的 nanochat 项目名和 100 美元。译文忠实保留了这些内容。其余三个渠道当期无真实条目可抽查。现有 21 条为本次预备缓存，未来条目的自动翻译另行验证。
- 真实模型验证通过项目代理入口 `scripts/start_with_proxy.ps1 node_modules/.cache/news16-independent/review.mjs` 运行。每次使用新建 TEMP 数据目录，冷缓存向真实 HTTP 接口提交一条 Karpathy X 资讯。首次请求 200，条目列入 failedIds；首次响应仅有失败条目标识，具体原因未记录。独立直连产品翻译类与现有 Provider 成功，再从全新隔离 HTTP 服务重试同一条目，200、1 条译文、0 条失败。Provider 正常结束，译文保留两个链接、专名、4.7 万、3 分钟和一次生成。此次成功说明实际产品路径可用，首次失败原因仍未确定。
- 从隔离构建首页打开「阅读资讯」，进入 AI 前沿并展开来源。Edge 157.0.4341.60 显示新生成的中文，切回原文后逐字比对摘录，再切回中文并保存到隔离 Raw，GET 返回正文与英文原摘录完全一致。随后选择历史日期、模拟今日采集失败，两个页面均显示同条中文。证据位于本机 TEMP 的 `news16-independent-hz9SLc/history.png`、`real.json` 和 `trace.txt`。验收仅只读抽查正式期刊和准备好的缓存；浏览器保存与故障回放均在临时数据目录。
