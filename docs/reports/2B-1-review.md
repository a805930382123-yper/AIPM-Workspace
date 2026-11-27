# LLM-Wiki 2B-1 独立验收

验收对象为产品提交 `4263606`，施工前基线 `e9e4f12`。本阶段按任务卡检验正式 Wiki 正文关系、详情反向链接及派生索引重建。

## 本轮结论

- 2B-1 **PASS**。正式入口增删改、目标重命名及同名冲突的解除均能更新反链。SQLite 写入故障后，文件保存成功，详情仍能从当前 Markdown 算出反链。首轮浏览器预验使用前一日的旧构建，重新构建后通过。未发现待返修的产品缺陷。
- Batch 2B **尚未整批验收**。一跳检索与重复提示属于后续阶段。

## 独立验证

1. 在新建的系统临时目录配置数据根与不存在的模型配置，清除继承的模型和 embedding 环境变量。执行 `node --import tsx --test tests/search-sqlite-index.test.ts tests/wiki-freshness.test.ts tests/wiki-review-http.test.ts`，18/18 通过，无跳过。正式 HTTP 操作覆盖先写源后建目标、去重、自引、行内及块代码、同名目标从唯一变歧义再恢复、源和目标改名、删除出边及 SQLite 事务失败，另有受限来源排除断言。
2. SQLite 模拟从 v3 启动升级，及删除数据库后重建。关系、含 CRLF 与 emoji 的块记录及原文件字节符合断言。抽查实现确认 SQL 留在 SQLite 封装，索引以 JS trim 后的精确标题判定唯一目标。
3. 执行 `node --import tsx --input-type=module` 运行既有 `tests/acceptance/wiki-review-2a3-edge.mjs` 的内存变体。给“无触发历史页”写入指向“银杏窗端架补货口径”的唯一引用，独立核对详情 API 的源页 ID/标题；在 Edge 158.0.4370.33 的生产页面打开目标，点击“反向链接 · 1”下的源页按钮，核对源页详情标题。两页 Markdown 字节相同，浏览器错误、外部浏览器请求及模型调用均为 0。首次等待反链超时，当时 dist 仍是 11 月 26 日旧版，11 月 27 日构建后复测退出 0。

## 回归与基准

- 主 Agent 运行 `node --import tsx scripts/run-retrieval-eval.ts workspace <临时目录>/retrieval.md --fts-repair`，冻结 25 问、两路 50 行除耗时外与 1B 修复版相同，报告 SHA-256 为 `d54486b6c909a981661cef9687217bad14eddd043b81582d41f059d5804104e0`。
- 主 Agent 运行 `node --import tsx scripts/bench-1000-pages.ts`，Node v24.18.0、SQLite 3.53.2 下，1,000 页、6,000 块重建 4,136.96 ms；30 次 FTS 查询均值 22.99 ms、P95 38.59 ms，Legacy 均值 977.96 ms、P95 1,080.82 ms。
- 施工方执行隔离全仓 `npm run check`，退出 0，1,145/1,145 通过，无跳过；guard 0 项，lint 0 错误、761 项告警，主 Agent 已核对。独立验收者复跑上述定向套件与浏览器操作。
