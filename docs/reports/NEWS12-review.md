# NEWS12 独立验收

验收版本 `577c248b442886366136f2d96a1f1b9f456872e6`。局部结论 PASS。NIQ 目录发现、材料类型、业务排序、满额后的候选保留与手工确认均通过。批次整体 PASS，按 NEWS12 冻结卡及以下复核范围裁定。

## 真实来源与浏览器

复核主会话本次真实抓取的隔离期刊 `news12-live-edition-hyT7Kc/state/news/2026-11-20.json`。六源中 NIQ 为 ok，17 个候选、2 个合格、2 个重复；Mintel 为 failed。精选 5 条，另有《中国购物者报告，系列一》保留为候选。真实抓取由主会话执行，独验读取原始期刊，并复制到另一 TEMP 数据目录回放。

独立运行隔离 API（4396）与 Vite（5196），使用空配置路径，通过 Chrome 首页点击「阅读资讯」。首条为 10 月 23 日即时零售场景经营白皮书，第三条为 9 月 8 日 NIQ 即时零售洞察报告。两张卡均可见 NIQ、原文、PDF 链接、实际摘页（第 10、2 页）、推荐理由、应用问题和保存按钮。第四条 Worldpanel 卡显示推荐理由，未生成应用建议。页面显示 5/5 及覆盖不完整提示。没有在正式工作区保存 Raw。

## 独立对照与回归

使用 `node --import tsx --input-type=module` 调用 evaluateResearchValue，按四个独立样本实测。国内即时零售饮料货盘、带 42% 数据和 300 家门店样本的研究优先级 12；仅有定性观察的全球饮料趋势为 2；相同数据加「转载」或「品牌上新」标题均被排除。联合 PDF、同档按日期、历史 Raw、候选的真实隔离落盘与手工确认保存另由下列回归覆盖。

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news12-niq.test.ts tests/news12-overflow.test.ts tests/news12-ranking.test.tsx`，9/9 通过。覆盖目录结构回放、PDF/正文/摘要和仅下载、请求预算、部分失败、同源超限、重试、去重、手工确认和 UI 保存引用。
- PowerShell 展开 `Get-ChildItem tests/news*.test.*` 后执行同一 Node 测试入口，58/58 通过。全量与定向有重叠。
- `npm run typecheck`，退出 0。
- 主会话另报 daily 回归 70/70，归档脚本 17/22；5 项旧断言在基线同样失败。该项为主会话对照，本报告未独立重跑归档基线。

隔离期刊和浏览器验证覆盖此次抓取日及该批规则。外部目录会变动，Mintel 当次失败在页面与期刊中均有记录。

冻结版第二次实采由主会话执行，独验另读 news12-frozen-zerNwF 的期刊。六源全部 ok，Mintel 恢复。精选仍为 5 条，白皮书升降至第二位（第 10 页），另一份 NIQ 仍第三（第 2 页），另有 5 条溢出。上文 Chrome 回放的是第一次实采。
