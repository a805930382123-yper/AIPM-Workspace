# LLM-Wiki 3-3 与 Batch 3 独立验收

范围基线 `61799a9`，3-2 产品对照 `ceff6cc`，含并行 BE01 的集成父版 `a15470a`。按[冻结任务卡](../handoffs/LLMWIKI-3-3.md)执行，规划及独立验收由同一 GPT-6.2-Astra medium 实例承担，产品与评测由各自的 GPT-6.2-Sol high 实例施工。已重算[产品交接](3-3-builder.md)包含的十项 SHA-256，均匹配。

## 真实浏览器与生产接口

独立探针在系统临时目录创建合成 Wiki、来源失效页和当天静态资讯，用随机回环端口启动生产服务。浏览器、服务器均限制外部访问。Node v24.22.1、Edge 158.0.4370.45。仓外探针 `wiki33-independent-ui.mjs` 的 SHA-256 为 `449e2e95647796dada646e1dbcc30f10235f5a00ecc3080042a6e48ba354032f`。分别指定 `WIKI33_REVIEW_ENGINE=sqlite_fts`、`legacy_scan`，执行 `Get-Content -Raw -Encoding utf8 (Join-Path $env:TEMP 'wiki33-independent-ui.mjs') | node --import tsx --input-type=module -`，两次退出 0。

| 独立场景 | SQLite 与扫描模式的实际结果 |
|---|---|
| 首页 Wiki 数、点击进入知识库 | 3 个文件，首页与可见列表均为 2；分类数之和为 2。基线同样种子的首页曾报 3。 |
| 关键词、分类与详情 | 输入别名“溪桥”和正文子串“QX7”，选择“行业基础”，命中 1 页，打开详情看到“封箱码 QX77”。筛选未改变全库分类数。 |
| 来源失效与历史日志 | 受限搜索串返回 0 页。给当前公开 ID 写入一条带旧敏感标题、不同类型与演示标记的合成历史事件。首页返回当前标题、类型与演示状态，保留旧事件日期、动作和版本 17。 |
| 运行中撤销 | 改变公开页的来源为缺失 ID，下一请求的首页和列表减至 1。旧查询清空，详情返回 409，首页近期变化收回该页。 |
| 正常索引与回退 | 监测生产进程 Wiki Markdown 的 readFile。无筛选列表、带筛选列表、首页统计各发一次。SQLite 为 0、0、0 次，扫描为 3、3、3 次。两种模式均无外部请求。 |

## 评测与跨阶段复验

- 独立运行 `node --import tsx scripts/eval-wiki-batch-3.ts`，五题全过。F1、F2、F4 的进程内问答捕获各送出一个金标页。F3 的无模型问答如实返回 LLM_NOT_CONFIGURED，本地 FTS 取到原文。F4 受限同名冲突页、F5 唯一受限页进入原始候选后均被排除。F5 上下文为空，误召回 0。五题真实模型调用 0。
- 核对[评测逐题报告](3-3-eval.md)的 100 行。一跳开关各 50 行，FTS 与 Legacy 的非耗时字段同各自 3-2 重跑结果完全一致；长页 9/9。FTS 的 B4 仍漏检，两路 E 类均有 4/5 误召回。四次 25 问运行及千页数据复用评测与产品交接证据。
- 千页 HTTP 夹具含 1,000 页，正常索引与回退均返回 999 个可见页，分类 499/500，组合筛选 19 页；预热后每路 15 次对比完整响应。[产品基准](3-3-builder.md)
- 独立执行 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=1 tests/provider-router.test.ts tests/provider01-entry.test.ts tests/kb03-deep.test.ts tests/search-sqlite-index.test.ts tests/wiki-freshness.test.ts tests/wiki-review-http.test.ts`。57/57 通过，0 失败、跳过或取消。覆盖 3-1 主备路由及分账、3-2 标准与深度续跑和旧检查点、3-3 数据库迁移、来源重新鉴权和脏索引回退。其余既签发能力复用[3-1](3-1-review.md)与[3-2](3-2-review.md)的证据，包括生产 PDF 续跑、Edge 人审及离线编辑、复制和导出。

## 签发结论

独立核验 `git show -s --format='%H %T %P' f99edfe`，产品提交 `f99edfe522d98251324ab75f1307ac29c7a8a80c`，Git 树 `336216910ca0665b5a482b9736a3bb197f7d28b2`，父提交 `a15470a789e9bea17a3ca04af8ff90efff928af8`。

同版全仓门禁复用主 Agent 记录。Node 24.22.1 六并发测试 1,163/1,163，0 失败、跳过或取消，耗时 178.41 秒，测试日志 SHA-256 为 `861fc0200b3af670a8b9216cbaa75c882cebf0487752589eb1da1cf81d5b56b4`。类型、格式、lint、guard 与生产构建均通过。lint 0 错误、769 条警告，与 3-2 一致；暂存树 guard 检查 6,281 份、0 违规。产品提交的 [GitHub Actions](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46128912910) 已通过，[Windows Node 22.x](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46128912910/job/140929561341) 与 [24.x](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46128912910/job/140929561057) 均成功。

**局部缺陷与 3-3 阶段 PASS。** 基线的失效来源页进入首页 Wiki 数，已在两种引擎下复验关闭。公开列表、分类、统计、当前权限及历史展示、就绪索引与故障回退均满足冻结标准，25+5 问和千页门禁通过。

**Batch 3 整体独立验收 PASS。** 3-1 的分档、主备及分账，3-2 的续跑、草稿标记、健康抽屉与无模型操作，3-3 的索引列表、统计及整批回归均已签收。真实外部模型表现沿用已有明确归属的历史记录，本次整批验收使用本地生产服务、Edge、隔离回环与冻结检索语料。
