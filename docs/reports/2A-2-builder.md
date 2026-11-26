# LLM-Wiki 2A-2 施工记录

基线 `0ab22c6`。本阶段交付 Step 3–4、Lint 时效汇总与集成验证。独立验收及代码提交由主 Agent 汇总。2A-3 前端、全批验收和实盘回滚演练待后续阶段。[任务卡](../handoffs/LLMWIKI-2A-2.md)

## 行为与接口

- Raw 创建和正文修订在正式 Raw 写入成功后触发异步提醒。正文修订使用正式 Wiki 的 Raw 关联，冲突和未改正文的保存不新增提醒。创建使用 Hybrid 排序，向量不可用时沿用 SQLite FTS。候选需要高相似的标题、别名、正文或至少 0.60 的余弦相似度，最多选三个不同的旧页。提醒保存 Raw ID、正文版本、日期和原因，分别标为系统提醒或系统推断。受限来源排除在外，向量请求派发前复查 Raw 许可与版本。通知写入失败记录警告，Raw 正式保存仍完成。
- `GET /api/wiki/review-queue?view=pending|snoozed` 提供复核列表，每个视图最多五页，按优先级排序。页面与提醒所指 Raw 的来源检查在排序和输出前执行。Wiki 列表、详情、检索包装接口、问答引用提供读时 `freshness`。问答保存的快照、引文 UTF-16 坐标、送模预算和结构 Lint 原有计数继续使用原口径。单独的 Lint 时效汇总也随自动巡检快照保存。
- `POST /api/wiki/:id/review/confirm`、`/snooze`、`/cycle` 都校验 `baseRevision`，使用正式 Wiki 写锁。核验采用上海自然日，核验日与提醒位置随同一次 Markdown 修订提交。当天随后记录的提醒仍会出现。暂缓在独立状态中保留 30 天，只影响队列。周期操作的 `reviewCycleDays` 接受正整数、`0`、`null`。时效编辑保留 Frontmatter 各元数据值及完整正文后缀，YAML 表现形式可能被格式化。
- SQLite schema v3 投影确认时的提醒位置。状态文件 v3 保留 v1/v2 日期记录，事件原子追加并按 Raw 身份和修订去重。损坏的状态文件不会被覆盖。确认在读取损坏状态时保留旧 Wiki，Raw 保存及现有检索可继续。关闭 `WIKI_FRESHNESS_ENABLED=0` 隐藏新增时效信息和人工操作，停止新增提醒，保留已存核验数据及来源权限检查。

## 首轮缺陷与返修

独立验收发现 Wiki 列表和普通搜索仍走存量未授权过滤的读路径。R1 按同一次来源校验取可见页面，再筛选关键词和分类、计算全库可见分类计数。列表保持既有返回结构和排序。详情、导出、入链和详情中的链接候选使用同一来源权限，包括关闭时效功能时。以同一受限页的合成正文标记核对全列表、查询、分类数、详情、导出、引用及复核队列。

R2 在新 Raw 的向量派发检查中复用已知密钥扫描。读取当前环境和历史本地配置的主模型密钥，即使主模型未配置完整。已知密钥命中或无法读取配置时，匹配降级为本地 FTS，Raw 保存照常完成。以独立的回环向量密钥、合成当前及历史主密钥复测。普通 Raw 的实际向量请求在回环服务被挂起时，HTTP 保存已返回成功且可读回正文。回环放行后写出语义提醒。含两种合成密钥的 Raw 各自写出本地词面提醒，向量请求增量为零。

## 施工验证

Node 24.18.0 和 SQLite 3.53.2。产品和全仓测试使用系统临时数据目录，清除继承的模型、向量、检索和时效环境变量。默认配置路径不存在，R2 用例明确写入临时合成主密钥。HTTP 问答和向量测试仅连接本机回环假 Provider。真实 Provider 请求为零。冻结评测从正式目录只读核验 95 篇 Wiki 和 9 条 Raw 的固定哈希，在单独的临时副本中运行。

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=3 tests/wiki-review-http.test.ts tests/wiki-freshness.test.ts tests/search-sqlite-index.test.ts tests/search-runtime.test.ts` | 30/30。用实际服务验证两类 Raw 触发、同日确认后提醒、30 天规则、三项人工接口、损坏状态、受限列表路径及开关。验证 UTF-16 引文回读和模型请求隔离。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-review-http.test.ts` | R2 实际 HTTP 3/3，包括主模型未就绪时的两类密钥和普通 Raw 的异步向量路径。 |
| `node --import tsx --input-type=module`（从标准输入运行 Hybrid 探针） | 回环向量请求悬置时 Raw 已保存并可回读。回环响应释放后命中语义提醒。受限会议 Raw 触发向量请求 0 次。 |
| `node --import tsx scripts/run-retrieval-eval.ts workspace <temp-report> --fts-repair` | R2 退出 0。对比历史 1B FTS 结果，Legacy 25/25、FTS 25/25 的评分、证据、页数、字符数与送出上下文 SHA-256 相同，长页引用 9/9。报告 SHA-256 `d3573c4b6add4e02eb4c1bda29974f867e642168d421f4957dd34f00ec815632`。 |
| `npm.cmd run typecheck`、`npm.cmd run guard` | 退出 0。Guard 使用当前进程的 Git 工作区所有权配置。 |
| `node node_modules/prettier/bin/prettier.cjs --check <本轮 TypeScript 文件>` 和 `node node_modules/eslint/bin/eslint.js <本轮 TypeScript 文件>` | 格式通过。ESLint 0 错误，21 条存量警告。 |
| `npm.cmd run build` | R2 TypeScript 与 Vite 构建退出 0，275 个模块，有存量分包体积提示。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` | R2 全量 1,139/1,139，0 失败，0 取消，0 跳过，304.64 秒。 |
| `git -c core.safecrlf=false diff --check` | 退出 0。 |

首轮全量 1,136/1,138，EVAL01 两项子进程被 Git 工作区所有权检查拦截。设置仅对本次进程生效的 `safe.directory` 后，两项定向复跑通过；R1 同环境的全量 1,138/1,138，0 失败，0 跳过。

冻结评测 SQLite FTS 的 A/B/C/D 命中与定位分别为 7/7、4/5、5/5、3/3，E 误召回 4/5。B1 保留命中与定位，B4 保持漏检，E2 送出 0 页。[历史 FTS 对照](../../evals/reports/batch-1b-fts-repair.md)

### 冻结源文件 SHA-256

```text
394ad69bce9513a9d304886dc9e6a764650dc8d1cb6a06776f7369e50e72904a server/audit-api.ts
a2367dd9e802948bec160429bacf1c6ad0866029b6077cc43da68a132b77be8e server/index.ts
d35df44a3cb0a9a703f854ac96660533e0e095c78f1f37c195c5baf658066841 server/knowledge-api.ts
3eb26ee9cede6191553ba6779f3c35cfc5c38a2c719d95bcd354b9e38dcc9494 services/audit/lint.ts
0cdd6a92754aae87b5dd14ca51379446bb5d5d34412777176f40519e6449d2ce services/automation/tasks/wiki-lint.ts
7333472278404e2f2fb078cce286b3bb320ef6d3588d51c0ddda8c45c8a85e3f services/llm/knowledge-answers.ts
b68d8595ed62d3f80cf124a6c4468dbec3dab935ded9788c7e51ee82f81240c2 services/llm/knowledge-inspections.ts
52d2024c17bf46fd62bbda5c19cfb1500fe01cd261874da72d240470785d58e6 services/llm/knowledge-maintenance.ts
0351a95d06206d2cfd000d406662f812ef1e5d506a7155c91a447b6a86bc1310 services/raw/pdf-cleanup.ts
5de7cf19f90748312455869a5ff5936de4004689141e5944389f1e76a72e12b0 services/raw/store.ts
758dc15006c2c22bc603f16c927c0754532b0f73b79a738b97f0f451d581e91c services/search/fts-retriever.ts
6e825984df93c76265dd67764d6732e371b62c029f825a7ce54db303f7f10cbf services/search/sqlite-store.ts
cbd780647825eea7ae6365516c777ff99d5fefdee6a4b17f212b5204f1536420 services/wiki/freshness.ts
2900359e47fd2ecc89ddfcc7ecbba6078b7ca850239a058fdff5b9bfe69a139e services/wiki/review-service.ts
9f29bddfd4d668289d873267748535e6a5f6f60d857da660f93b712858636546 services/wiki/review-triggers.ts
6aa70e2df17871a9a233c04f556de121c2db6eaadd7c583417ccaa2a09ad18ce services/wiki/store.ts
7250c9954111ce370a023e80751703e2850250bd02e747c44dc4339ca7da6746 tests/search-runtime.test.ts
02cf55abaacd0e4549548e6fa1f49786b495bbc1455d291f54208bcfbf262123 tests/search-sqlite-index.test.ts
c1294b65bfbdc4ee92d71a149b67d41b4e687281e57b8debd212ef20ba469e0d tests/wiki-freshness.test.ts
57783c501ecc6640b6b178b3dfe64448b071f8c61123bfcfea831eb4607ac388 tests/wiki-review-http.test.ts
```
