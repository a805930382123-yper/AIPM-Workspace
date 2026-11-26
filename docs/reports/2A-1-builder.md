# LLM-Wiki 2A-1 施工记录

基线 `6491849`。本轮范围为数据与规则底座。

## Step 0 勘察

- `services/wiki/store.ts` 的 `parseWikiMarkdown` 通过 `js-yaml` 读 YAML 对象，保留未知键及对象键顺序，分离首段标题与正文。`frontmatter` 经对象展开和 `yaml.dump` 序列化，不主动排序。已有手工 `update` 从可编辑字段重建记录，会丢弃未知元数据。`js-yaml` 会把未加引号的日期读成 Date，并可能归一化不存在的日历日期，新增日期字段须按原始字面值校验。
- `rules/fmcg-schema.yaml` 和 `WikiType` 接受五个基础类型 `source`、`concept`、`entity`、`business_process`、`metric`，另有 `synthesis`。十三个分类为 `industry_basics`、`category`、`channel`、`sales`、`store`、`distributor`、`supply_chain`、`product`、`metric`、`ai_application`、`company_business`、`customer`、`other`。`sources` 是 Raw ID 列表，`source` 恰好关联一个。`WikiStore.referencesToRaw` 只扫描正式页，`pdfDerivations` 等保留独立来源信息。来源允许性由 `assertRecordSourcesAllowed` 和检索时的来源校验执行。
- 手工 `create`、`update`、`delete` 走 `WikiStore.commitChange` 的 pending 记录和原子文件提交，随后增量同步索引及 Wiki 日志。人工确认的草稿与工作流用 `WikiStore.withLock` 内的 `writePageLocked`，先原子写正式 Markdown，再 `syncPage`。`commits.ts` 和 `knowledge-workflows.ts` 的已有页更新从旧对象展开。
- `services/raw/store.ts` 的 `createWithId` 在新文件上记录 `importedAt` 和正文 SHA-256，临时文件改名提交，会议登记另有受限入口。`server/index.ts` 在 Wiki 锁内调用人工 `updateBody`，校验期望正文 SHA 和 revision，先归档旧文件原字节，再原子替换当前记录，递增 `bodyRevision` 并记录 `bodyEditedAt`。正式 Wiki 在这条路径不自动改写。资讯登记与媒体处理可能有独立阶段，未来 Raw 触发接入须依成功提交点为准。
- `services/search/sqlite-store.ts` 持有索引 SQL，原 schema 版本为 1，`better-sqlite3` 固定 12.11.1。`services/search/indexer.ts` 管理单根目录串行写入、内容哈希对账、原子换库，以及 `syncPage` 和 `removePage`。`services/llm/knowledge-maintenance.ts` 核对 Wiki 文件 SHA、UTF-16 `body.slice(startOffset, endOffset)` 和块 SHA 后才构造上下文。`services/llm/knowledge-answers.ts` 同样以 JS 字符串 `slice` 核对引文坐标，持久快照仍走既有校验。
- `services/audit/lint.ts` 的 `WikiLint.inspect` 独立读正式 Markdown，保留 YAML 故障并生成巡检发现。现行 UI 入口分布在 `app/pages/HomePage.tsx` 的 `home-actions`/`action-badge`、`app/components/automation/RunDetailView.tsx` 的 `RunDetailDrawer`、`app/components/automation/WorkflowsTab.tsx` 的 `Badges`、`app/components/WikiQuestionPanel.tsx` 的 `answer-result`/`answer-status-bar` 和 `app/pages/WikiPage.tsx` 的 `WikiDetail`/`wiki-status`/`WikiLintPanel`。

## Step 1 规则

- `last_verified_at` 和 `source_published_at` 读入严格的 `YYYY-MM-DD`，支持 YAML 带引号和不带引号写法。非法日期、时间戳和相对求值日的未来核验日期无法确立人工核验。`source_published_at` 只供展示，`created`、`updated`、文件 mtime 及已有知识状态也不会确立人工核验。`review_cycle_days` 接受安全的正整数以及显式常青 `0` 或 `null`。
- 默认值由 `config/review-cycles.json` 管理。依次采用逐页覆盖、概念类型、分类、其余类型与兜底规则。AI 应用和公司业务分类默认 90 天。品类、渠道、销售、门店、经销商、供应链、商品、客户和未命中上述分类的来源、实体、综合页默认 180 天。其余按 365 天。常青页获得人工核验日期后没有硬到期，来源或推断事件仍可进入队列。
- 纯函数用调用方提供的自然日作基准，无隐式时钟。缺少有效核验日期为 `unverified`。已核验且周期有限时，到期日前 1–30 天为 `due_soon`，到期当天及以后为 `due`，更早为 `fresh`。已核验且有效周期常青为 `evergreen`。
- 基础优先级按 `due` 70、`unverified` 60、`due_soon` 30、`fresh` 和 `evergreen` 0。有效 `new_source` 和 `source_changed` 各加 50，`inference` 加 20。只计截至求值日已发生且未早于当前核验日的触发。同日继续提醒，因为日期无法表达先后。暂缓从操作日包含起计算 30 天，于第 30 天重新入队。队列排除零分及暂缓中的页面，按分数降序、到期日升序（空值最后）、页面 ID 升序取前五。调用方提供的页面 ID 范围在排序截取前生效。
- 保留 `js-yaml` 对其他字段的解析和序列化语义，显式手工编辑以当前记录为底保留未知字段值及字段顺序。读取和索引不修改已有 Markdown。保留原正文和 UTF-16 坐标。

## Step 2 派生状态

- `sqlite-store.ts` 把 schema 升为 2，`pages` 存储三项 freshness 元数据。`review_cycle_days` 的 SQL `NULL` 表示未设置，显式常青 `0` 或 `null` 统一投影为 `0`。`review_queue` 是正式页的候选输入视图，以指定自然日和独立状态求值。跨日时无需重写 SQLite。
- 匹配 chunking/tokenizer 版本的健康 v1 索引事务内新增列与视图，并从 Markdown 同步元数据。沿用现有按完整 embedding 输入复用机制，保留仍适用的本地向量。版本、解析或索引写入异常继续进入原有 dirty 标记与重建路径。增量变更和删除使用原 `pages`/FTS/chunks 事务，视图同步变化。
- `state/review-triggers.json` 由独立串行读改写及原子替换持久化。v2 对每页、每种提醒及暂缓各自保留不同的操作日，按自然日排序，同日合并。求值用截至指定日最近一次的记录，之后的同类事件与暂缓不会改变历史日结果。v1 单日期状态只读时保持原字节，实际写入时迁移到 v2。文件损坏明确报错并保留原字节，原 FTS/向量检索可继续运行。独立状态只参与当前正式页投影，删除 Wiki 后视图即时排除该 ID。删 SQLite 后同一自然日的队列由 Markdown 加该 JSON 重建。
- 本阶段交付规则、索引与内部状态操作。真实 Raw 触发、人工核验写入、API 与前端接入属于后续阶段。

## 验证

Node 24.18.0，ABI 137，锁定的 `better-sqlite3` 12.11.1。执行前在系统临时目录创建 `aipm-2a1-*` 并指定 `FMCG_DATA_DIR`、不存在的 `FMCG_LLM_CONFIG_FILE`，清除继承的 `FMCG_LLM_*` / `EMBEDDING_*`。新测试仅使用合成 Wiki 和本地 SQLite，原 embedding 回归使用已有回环 fake。

- `npm.cmd run typecheck` 通过。
- 首轮 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-freshness.test.ts tests/search-sqlite-index.test.ts tests/search-embeddings.test.ts tests/wiki.test.ts` 通过 36/36。覆盖日期/优先级临界点、手工保存未知 YAML、v1 升级内容和向量逐字节一致、旧页核验、作用域、暂缓与删库恢复、删页投影、损坏状态保护，以及既有 FTS/向量降级与来源权限。
- 独立验收重放了同类提醒和暂缓覆盖既往日期的问题。本轮返修 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-freshness.test.ts tests/search-sqlite-index.test.ts tests/wiki.test.ts` 通过 21/21。新增反例断言后续同类操作、同日重试、30 天暂缓临界、v1 文件读取及迁移前后、删库重建前后的一致性。重放采用当前 Wiki Markdown 中的核验事实。
- 最终冻结版 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` 通过 1,136/1,136，0 跳过。`npm.cmd run typecheck`、`npm.cmd run format:check`、`npm.cmd run lint`、`npm.cmd run guard`、`npm.cmd run build` 均退出 0。ESLint 0 错、761 个存量警告，生产构建 275 模块，Vite 有包体积警告。
- 初次 `npm.cmd run check` 的 guard 遇到宿主 Git 所有权检查。复试只对命令进程设置当前仓库 `safe.directory` 后通过 guard。默认并发复试遇到基线已有的 HTTP 启动超时，结束了卡住的测试子进程，随后沿用 1B 最终复核的六路并发通过全量。
- `git diff --check` 通过。

冻结的基线提交 `649184935cab69b444bdddde89b3d64f55afcd60`。下面是待独立验收源码和测试的工作区 SHA-256。

```text
e5a0ccf44df56bbf043b5ffa018c7575045d13579c52f13363a1eff25612255f config/review-cycles.json
46fa96591d25b80977109102f86c7a7bf51f10ba60b361d090eb696d988cdc0d services/wiki/freshness.ts
2308a45a69f54788823b6e9f247d320db89bc013532d7c274fba1f6fb85d5f1e services/wiki/review-triggers.ts
9d362af8ac9507695d1d43d1812133d5e37ce9aa160fa435d85085e9fc8665a9 services/wiki/store.ts
f87b58e371c381c514523b728ae132e4591a2d7b6aadeccebbd5895a8df0ec40 services/search/indexer.ts
1545925df3de3e3622627bf19d0ff56ce8d2bac0c3d286bc2dfea49ca7b554c5 services/search/sqlite-store.ts
f6013a2905a1b8a32dabda706a35a8ff7b437eaa26f6a86f64bb3443530d0138 tests/wiki-freshness.test.ts
3ad5a608c6dea808bef6b57cb2b83870eb451075e4ece3849a14dc5de855ae16 tests/search-sqlite-index.test.ts
```
