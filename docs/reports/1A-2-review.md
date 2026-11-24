# 1A-2 独立验收 · 第一轮

阶段结论为 **需返修**。Step 1 的 Windows 实库与事务检查通过。Step 2 在正式结构化笔记路径图中会将实测事实和待核内容一并作为推断返回。Batch 1A 整体待验收，后续检索接入、25 问 A–E 分组和 B 类漏题留待对应阶段。

## 本轮缺陷

1. **正式路径图节点和边丢失角色**。正式写入链路调用 `renderStructuredNote(note, true)`。节点、边把角色写在句末；`sectionsOf` 只识别行首、列表项起始或表格角色。独立调用实际渲染函数，将“推断”章节中的节点 A 标为原文支持、B 标为待核实，然后将结果传给 `chunkWikiPage`。输出只有 mixed 前言和一个 inference 块，该推断块含 A、B 两行。应按生成格式识别节点、边的归属，验证普通正文中提及标记时保持原分类。
2. **同层标题未结束前一个四级分区**。`## 来源事实\n### 价格\n#### AI 推断\n假设\n#### 门店数\n实测` 经实际切块返回 fact 和 inference 两块，后者同时包含“假设”“门店数”和“实测”。既然识别有角色的四级标题，遇到无角色的同级标题时，应恢复父级角色。新增针对该示例的回归用例并核对正文坐标。

## 实测与版本

工作树核验基线提交为 `17ab0bcd8ac0099253ac7d5866f9c6c4f79d4cb6`。待提交源码的 SHA-256 分别为 chunking.ts `23cd5d58daddd7b6ce11fa971fa085585e66dc155dbfbd51da399d92e0ac0de5`、indexer.ts `39d4bb20e762ceeb601a53db80f7119d24f8965a1d09189599b5949f7af3f9c9`、sqlite-store.ts `bbc77c6736928dad965bbd7135feb5e3238b6563cb20d009d3fb3600b07abe33`。

| 实际执行 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/search-chunking.test.ts tests/search-sqlite-index.test.ts` | 12/12 通过。Windows、Node 24.18，临时磁盘 SQLite。覆盖删除重建、版本漂移、哈希对账、替换期间旧库可读、错误回滚、外部连接锁住时失败及重试、CLI 实例锁。切块测试覆盖 CRLF、代理对、UTF-16 坐标与哈希。 |
| `node --import tsx --input-type=module`，独立调用正式渲染函数及切块器，并以四级同层标题样例调用切块器 | 两个错误输出如上。 |
| `node --import tsx --input-type=module`，系统临时目录生成 1,000 篇带 YAML 及六个 H2 的短页，实际调用 rebuildAll；25 个均匀分布的 ASCII 搜索词循环查询 100 次，FTS5 加权 BM25 联接 pages/chunks 取 Top-30 | 1,000 页、6,000 块，全量 466.66 ms；每次 30 条，平均 0.45 ms、P95 0.56 ms。短样本成绩只代表本轮存储层。 |

证据仅涉及 1A-2，未调用真实 Provider 或改写正式 Wiki。施工报告中原列 11/11，独立实跑包含后来加入的角色标记用例，共 12 项。

## 返修后独立复验 · 最终裁决

**两项缺陷均已关闭，1A-2 阶段 PASS。Batch 1A 整体待验收。** 后续阶段负责生产接入、最终分词、双引擎评测与回滚。本轮 25 问分组及 B 类漏题尚无实测结论。

- 独立复跑 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/search-chunking.test.ts tests/search-sqlite-index.test.ts`，Windows 实库及切块共 14/14 通过，0 跳过。
- 另以 `node --import tsx --input-type=module` 联调实际渲染器和切块器。正式路径图包含双事实引用、补充说明、节点与边，CRLF 正文包含补充 Unicode 字符；事实节点、补充节点、事实边分别返回 fact、mixed、fact。另测 H4 推断下的 H5 继承推断，切换至普通 H4 后恢复父级 fact。六项角色断言及全部原文偏移断言通过。
- 本轮 `git rev-parse HEAD` 为 `d12f20ce1bb8efeb6200038050b601e641b29bea`。以冻结工作树 SHA-256 定位实际验收代码：chunking.ts 为 `86d823d161d68dc996c0d82fd1635fd4442459cca7e3ecf5cfce7ab905e3c906`，tests/search-chunking.test.ts 为 `8c581350a722731a47eb95b80671c4d4f10dfdea2b196b9b1b2968df321a088d`。indexer.ts、sqlite-store.ts 经 Get-FileHash 复核与第一轮相同。首轮独立千页性能数据对应当时的切块器。
