# LLM-Wiki 1A-1 施工记录

1A-1 施工自查通过，待独立验收。范围为[任务卡](../handoffs/LLMWIKI-1A-1.md)中的仓库勘察与 SQLite 驱动冒烟。施工基线 `9afd0030362aa9c3e5d7153f31333935bb91603c`，后续由主 Agent 统一提交。

## 真实 Wiki 勘察

Windows 本机工作台采用 ESM，最低 Node `22.13.0`，TypeScript `strict`，测试入口为 Node test runner 加 `tsx`。`server/index.ts` 通过 `FMCG_DATA_DIR` 决定数据根，默认 `workspace/`。正式文件位于数据根 `knowledge/wiki/<id>.md`。只读盘点得到 95 个正式 Markdown 文件，另有自动重建的 `knowledge/wiki/index.md`。架构将未来 SQLite 定义为可重建索引，`state/` 位于数据根。[package.json](../../package.json) · [架构](../architecture.md) · [启动入口](../../server/index.ts) · [Wiki Store](../../services/wiki/store.ts)

| 真实样本类型 | 正文长度（UTF-16） | 结构观察 |
| --- | ---: | --- |
| 长来源页 | 15,297 | `## 来源信息`、`## 摘要`、`## Key Takeaways`、专题二级标题及 `### 待确认问题`，正文还有一个一级标题。 |
| PDF 派生概念页 | 3,628 | 只有 `### AI 整理`、`### 本主题依据`、`### AI 推断`、`### 待核问题` 四个三级标题。YAML 与生成的页标题共占正文前 37,092 个 UTF-16 单元。 |
| 指标页 | 545 | `## 来源事实`、`## 整理`、`## 推断`、`## 待确认问题`、`## 来源证据`。 |
| 业务流程页 | 4,111 | 正文含内部一级标题和专题二级标题，另有 `## 来源事实`、`## AI 整理`、`## AI 推断`、`## 待确认问题`、`## 来源证据`。 |
| 短来源页 | 1,903 | `## 来源信息`、`## 摘要`、`## Key Takeaways` 和专题二级标题。 |

采样只记录结构和长度。YAML 使用 `title`、`aliases`、`tags`、`type`、`category`、`source_level`，另有 `id`、`revision`、`sources`、`knowledge_status`、`confidence`、`review_status` 及可选派生数据。`WikiStore` 从 UTF-8 文件解析 YAML、剥掉紧随其后的生成一级标题，再返回原样正文。后续分块应识别二、三级的事实、整理、推断和待核标题，兼容带 `AI` 的变体。来源摘要与业务标题缺少显式事实标志时采用 `meta` 或 `mixed`，按原文顺序保留边界。[Wiki Store](../../services/wiki/store.ts) · [Markdown 渲染](../../services/wiki/render.ts)

## 调用与写入边界

`retrieveKnowledgeContext(wiki, rawStore, queries, options?)` 返回 `Promise<WikiRecord[]>`。查询字段为 `title`、`content`、`tags`，默认过滤 `source` 类型，合并去重、子串和三字片段命中，并扩展领先页的 Wiki 链接。在最多 8 页、48,000 字符内按完整记录的 JSON 长度纳入页面，以来源链校验排除受限或缺失底源。生产调用包含问答读取（开启 `includeSources`）、问答沉淀目标选择、提取维护检查点、巡检相关页扩展、PDF 整理草稿选目标。维护及 PDF 流程会依赖旧页完整内容；保留数组接口，新增的详细检索接口承载块级数据及引擎状态。[检索入口](../../services/llm/knowledge-maintenance.ts) · [问答](../../services/llm/knowledge-answers.ts) · [提取任务](../../services/llm/jobs.ts) · [巡检](../../services/llm/knowledge-inspections.ts) · [PDF 整理](../../services/raw/pdf-cleanup.ts)

问答仅接纳本次实际发送给模型的记录来源。Wiki 引文以 `WikiRecord.body` 为原点，校验 `body.slice(start, end) === quote`，坐标按 UTF-16、左闭右开。Raw 补读用原文片段的起始位置换算，图片引文走图片解析文字专用坐标。保存问答草稿前重新读盘校验 Wiki 版本和正文哈希，同时校验底层 Raw 哈希与逐字引文。后续块偏移沿用正文坐标，整份文件哈希仍可检测 YAML 变化。[问答引文校验](../../services/llm/knowledge-answers.ts) · [来源链校验](../../services/wiki/source-lineage.ts)

Prompt 走独立的 `PromptAiService.context`。它按用户选择的页面 ID 逐一读盘和校验来源，当前按正文段落计分，最多 6 页、每页 3,000 字符，总计 12,000 字符。后续检索范围限定在用户选择的页面 ID。[Prompt AI](../../services/prompt-ai/service.ts)

人工新建、编辑、删除从 Wiki HTTP 路由进入 `WikiStore.create/update/delete`。`commitChange` 包含登记待恢复状态、原子写文件或移入 `knowledge/recycle/wiki`、补日志和重建 Markdown 索引；审核状态更新和样例创建也经过该路径。AI 草稿确认及恢复经 `writePageLocked` 原子写入正式页，由外层管理事务、版本、日志及索引。以后加派生索引同步时需要覆盖 `commitChange` 和 `writePageLocked` 的成功落盘路径，保留原先的写入门禁和恢复语义。[Wiki 路由](../../server/index.ts) · [Wiki Store](../../services/wiki/store.ts) · [草稿确认](../../services/wiki/commits.ts) · [确认工作流](../../services/wiki/knowledge-workflows.ts)

## 驱动选型、冒烟与自查

Node `22.13.0` 是项目当前最低支持版本。最初以原生 `node:sqlite` 运行 `node --import tsx scripts/smoke-sqlite.ts`，SQLite `3.47.2` 的 `sqlite_compileoption_used('ENABLE_FTS5')` 为 `0`，创建 `USING fts5` 表返回 `ERR_SQLITE_ERROR: no such module: fts5`。同一份初版脚本在 Node `24.18.0` 原生 SQLite `3.53.1` 上通过，写入 353.38 ms，查询均值 1.33 ms，P95 1.69 ms。

首个备选 `better-sqlite3@13.2.0` 的 Windows 预编译库在最低版本运行 `new Database(':memory:')` 即触发访问冲突（进程退出码 `-1073741819`）。最终锁定 `better-sqlite3@12.11.1` 和开发类型 `@types/better-sqlite3@9.6.0`，使用 Windows x64 对应 Node 22（ABI 127）和 Node 24（ABI 137）的上游二进制并验证了两份发行资产的 SHA-256。[package.json](../../package.json) · [锁文件](../../package-lock.json) · [上游发行资产](https://github.com/WiseLibs/better-sqlite3/releases/expanded_assets/v12.11.1)

- [scripts/smoke-sqlite.ts](../../scripts/smoke-sqlite.ts) 在系统临时目录生成独立库，断言三项 PRAGMA 读回值和外键实际拒绝，关闭连接后删除临时库。写入计时从 `BEGIN` 前到 `COMMIT` 后，覆盖 1,000 页、6,000 块及 6,000 行 FTS 记录。25 个合成主题随机抽取 20 个，各有 240 块候选，每次按加权 BM25 排序并联表返回 Top 30。独立匹配词验证标题命中优于正文命中，分数为负值且按升序取最相关。P95 采用最近秩。
- [services/search/sqlite-store.ts](../../services/search/sqlite-store.ts) 集中导入驱动并暴露类型化打开函数。[tsconfig.json](../../tsconfig.json) 将该脚本显式纳入 `strict` 检查并覆盖其驱动依赖。
- Node `22.13.0` 执行 `node node_modules/typescript/bin/tsc --noEmit` 退出码 `0`，`--listFilesOnly` 确认两份新代码都纳入检查。对本轮代码和配置调用 `prettier --check package.json scripts/smoke-sqlite.ts services/search/sqlite-store.ts tsconfig.json` 通过，新代码 `eslint scripts/smoke-sqlite.ts services/search/sqlite-store.ts --max-warnings=0` 通过。新增代码没有 `any` 或类型断言。
- 在隔离数据根、隔离模型配置并清除继承的 `FMCG_LLM_*` 变量后，Node `22.13.0` 和 `24.18.0` 定向执行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lw01-recovery.test.ts tests/lw01-maintenance.test.ts tests/lw02-main.test.ts tests/lw02-boundaries.test.ts tests/lw03-core.test.ts tests/prompt-ai.test.ts`，各 47/47 通过，真实 Provider 调用为 0。

| 实测 Node / SQLite | 单事务写入（< 1,500 ms） | 20 次查询均值（< 50 ms） | 查询 P95 |
| --- | ---: | ---: | ---: |
| `22.13.0` / `3.53.2` | 359.91 ms | 1.21 ms | 1.90 ms |
| `24.18.0` / `3.53.2` | 348.04 ms | 1.16 ms | 1.68 ms |

本机 `npm install` 的预编译下载首次超时，随后 `npm install --ignore-scripts --no-audit --no-fund --prefer-offline --fetch-retries=0` 成功生成锁文件。在 `node_modules/better-sqlite3` 下设置会话级 `npm_config_better_sqlite3_local_prebuilds` 指向两份已校验的上游发布压缩包，并用各自 Node 版本执行 `node ../prebuild-install/bin.js --verbose` 安装对应二进制。两个版本随后运行 `node --import tsx scripts/smoke-sqlite.ts` 均退出码 `0`，并通过 WAL、NORMAL、外键、加权 BM25 和 1,000 / 6,000 / 6,000 记录数的断言。切换 Node 大版本时需为该 ABI 重新安装对应预编译库。当前工作区依赖已恢复为默认 Node 24 对应的预编译库。

真实库只读勘察。表内性能来自预分词的合成记录。千页 Markdown 端到端、25 问 A–E 对照、B 类漏题及回滚验证属于后续阶段，当前没有实测结果。
