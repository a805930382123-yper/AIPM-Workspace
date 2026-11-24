# LLM-Wiki 1A-2 施工记录

1A-2 的派生索引、正式 Markdown 对账及结构切块已实现。独立验收提出的路径图归属和四级标题作用域两项已返修，定向自查通过，待独立复验。初次施工基线为 `9c7c7add823517dab87a99aa4306b9a5fc3c6e1b`，返修基线为 `d12f20ce1bb8efeb6200038050b601e641b29bea`。本轮施工交由主 Agent 统一提交。

## 驱动与实现

- 继续使用 1A-1 锁定的 `better-sqlite3@12.11.1`。此前 Node 22.13.0 原生 `node:sqlite` 的 SQLite 3.47.2 未编译 FTS5。本轮 Windows 实测使用 Node 24.18.0 与 SQLite 3.53.2。[1A-1 施工记录](1A-1-builder.md)
- `services/search/sqlite-store.ts` 负责四表、版本标记、WAL/NORMAL/外键及单批事务。删除时显式清理 FTS 行，由外键级联删除块。向量字段预留为 `NULL`。[SQLite 存储](../../services/search/sqlite-store.ts)
- `services/search/indexer.ts` 对完整文件字节计算 SHA-256，按哈希检测正文和 YAML 变更。单页同步或删除失败时返回 `false`，记结构化日志并标脏。重建按批读取并写入临时库，查询继续使用旧连接。切换阶段在同一进程内同步关闭旧库、原子替换并重开，并由 SQLite 完成正常 WAL 归并及侧文件清理。损坏或缺失的派生库可从原文件重建。[索引维护](../../services/search/indexer.ts)
- `services/search/chunking.ts` 识别真实的 `来源事实`、`AI 推断`、`待确认问题`、PDF 三级标题，以及结构化笔记的 `【原文支持】`、`【待核实】` 等标记。短块同父同类时可合并，保留首段标题路径和原始换行。长块按自然段、句末或 UTF-16 边界切分，含重叠最多 1,200 个 UTF-16 单元，同分区长块重叠约 100 个单元。正式 Wiki 与索引复用同一 Markdown 解析器，每块在返回前校验正文的原样切片。[切块](../../services/search/chunking.ts) · [正式 Wiki 解析](../../services/wiki/store.ts)
- `scripts/rebuild-search-index.ts` 提供离线入口 `node --import tsx scripts/rebuild-search-index.ts [data-root]`，也读取 `FMCG_DATA_DIR`。命令取得现有工作台的实例锁，运行中的同数据根工作台持锁时会拒绝。进程内维护使用 `WikiSearchIndexer.rebuildAll()`。两者返回页数、块数及毫秒数。`.gitignore` 忽略仓库根 `/state/`，入口纳入严格类型检查。[重建命令](../../scripts/rebuild-search-index.ts)

## 定向自查与实测

| 实际检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，0 错误 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/search-chunking.test.ts tests/search-sqlite-index.test.ts` | 返修后 14/14 通过 |
| 新增与修改代码的 Prettier 检查、新增搜索模块和测试的 ESLint `--max-warnings=0` | 通过 |
| `git diff --check` | 通过 |

其中索引测试覆盖带 CRLF 和补充 Unicode 字符的原文坐标、保留修改时间的 YAML 变更、三项版本分别漂移、单篇替换中途异常时三表回滚、删库重建后的内容/哈希/命中结果一致、损坏库恢复、Windows 上重建期间多次查询旧库、SQLite 读锁阻止替换后保留旧库并可重试，以及 CLI 数据根锁。[切块测试](../../tests/search-chunking.test.ts) · [索引测试](../../tests/search-sqlite-index.test.ts)

返修测试直接调用正式 `renderStructuredNote(note, true)`。节点和边的后置归属分别产生 `fact` 或 `mixed` 块，普通段落提及标签时仍继承章节角色。四级同级标题结束上一标题的作用域，回到父级角色，并保留完整标题路径。两项都逐块验证原文偏移、哈希及覆盖范围。[第一轮独立验收](1A-2-review.md)

首次共享工作树 `npm test` 已观察到 `tests/llm-repair2.test.ts` 和 `tests/llm-http.test.ts` 中三项现有 HTTP 用例失败，涉及确认重试、四块长文汇总及部分提交重启恢复。该运行未形成全量通过结论，故障归因待独立隔离复跑。返修后定向执行取上表结果。

在系统临时目录生成 1,000 篇含 YAML、生成页标题和 6 类正文区块的合成 FMCG Wiki，用 `node --import tsx --input-type=module` 运行实际 `WikiSearchIndexer.rebuildAll()`。建索引计时从创建状态目录前到原子替换并重开连接后，包含读取正式 Markdown、字节哈希、解析切块及 SQLite 写入。对 25 个合成词分布执行 100 次带加权 BM25、三表联接的 Top-30 FTS5 查询，每次均返回 30 条，P95 取最近秩。

| 页数 | 块数 | 全量建索引 | 查询均值 | 查询 P95 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 6,000 | 3,127.17 ms | 7.71 ms | 10.01 ms |

返修前只读实际扫描 95 篇正式 Wiki，核对文件 ID、正文覆盖和切片坐标，最长正文 15,297 个 UTF-16 单元。SQLite 验证和压测均使用临时数据目录，真实 Provider 调用为 0。

## 阶段边界

1A-2 的 FTS5 列采用 Unicode61 原文输入。1A-3 接入 `Intl.Segmenter` 时须触发一次全量重建，并实现正式业务接入、引用复核和异常降级。上表是阶段索引实测，1A-4 将按最终双引擎链路复测千页并核对回滚。

25 问 A（精确术语）、B（换说法）、C（长页）、D（紧预算）、E（负样本）分类结果和 B 类具体漏题均待 1A-4 实测。Batch 1A 整体验收待后续阶段。
