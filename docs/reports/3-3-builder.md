# LLM-Wiki 3-3 · 索引列表与首页统计施工

施工基于 `a15470a789e9bea17a3ca04af8ff90efff928af8`。冻结范围见[任务卡](../handoffs/LLMWIKI-3-3.md)。

## 实现

- SQLite schema 5 新增可重建的 Wiki 列表快照，保存完整页面对象、文件变化指纹和统计使用的创建时间文本。快照与页、全文及关系索引随同一次事务增删改，schema 4 可原地迁移并复用兼容向量。启动重查 Markdown 哈希，对字节相同的文件只刷新变化指纹。
- GET /api/wiki 在索引就绪时核对正式文件目录与文件的大小、时间和身份，用 SQLite 读取页面内容。文件变化、索引关闭或异常时扫描 Markdown。列表继续使用原有多词匹配、中文排序、全库可见分类计数和时效逻辑。来源检查继续读取当前 Raw，并检查当前派生 Wiki 页面。正常路径使用同批已核对的来源 Wiki 快照。
- 首页 Wiki 数、本周新增里的 Wiki 数和近期变化来自同一套可见记录。近期变化的时间、动作和版本取历史日志，标题、类型和演示状态取当前页面。无当前可见页面的事件移出首页近期变化。Raw、Prompt、待确认草稿、审计和上海周界沿用原规则。旧四参数 getStats 调用保留其历史 Markdown 目录及日志口径。

实现见[索引器](../../services/search/indexer.ts)、[SQLite](../../services/search/sqlite-store.ts)、[Wiki Store](../../services/wiki/store.ts)、[统计](../../services/stats/index.ts)及[HTTP 路由](../../server/index.ts)。

## 验证

Windows，Node 24.22.1，原生 SQLite 测试运行。使用新的系统临时数据目录、不存在的模型配置和随机本机端口。先清除继承的模型、向量和搜索配置。定向套件使用现有回环替身，外部 Provider 调用 0 次。

| 命令 | 实测 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=3 tests/wiki-review-http.test.ts tests/search-sqlite-index.test.ts tests/wiki-freshness.test.ts tests/wiki.test.ts tests/raw.test.ts tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/llm-http.test.ts tests/import.test.ts tests/prompt.test.ts tests/lifeos-l5-feedback.test.ts` | 冻结版本 121/121，无跳过。覆盖旧 schema 1、3、4 的迁移、向量和引用坐标、索引回退与重建、权限和 Raw/Prompt/LLM 回归。 |
| `node node_modules/prettier/bin/prettier.cjs --check <本包十份代码和测试文件>`、`git diff --check` | 都退出 0。 |

定向 HTTP 使用真实服务进程，测试探针只累计正式 Wiki Markdown 读取次数。正常列表、关键词和分类筛选、首页统计以及 Raw 缺失后的重新鉴权均记录零次 Wiki 正文读盘。详情和外部变更回退记录实际读盘。破坏 SQLite 投影表导致索引标记为 dirty，列表和统计以 Markdown 结果继续响应。见[HTTP 回归](../../tests/wiki-review-http.test.ts)。

## 千页 HTTP 基准

`node --import tsx scripts/bench-wiki-catalog-1000.ts` 启动真实本地服务。两种模式均使用同一千页合成夹具，每路预热 3 次后实测 15 次，耗时包括回环 HTTP 及 JSON 解析。结果逐次验证整个响应一致，999 个可见页面，筛选命中 19 页，两个分类分别计数 499 和 500。见[基准脚本](../../scripts/bench-wiki-catalog-1000.ts)。

冻结版本实测与全仓类型及静态检查并发。

| 生产 HTTP 路径 | SQLite 平均 / P95 | Legacy 平均 / P95 |
| --- | ---: | ---: |
| Wiki 全列表 | 74.06 / 103.18 ms | 213.62 / 245.34 ms |
| Wiki 关键词与分类 | 66.89 / 81.39 ms | 207.43 / 231.33 ms |
| 首页统计 | 66.55 / 75.79 ms | 228.22 / 259.86 ms |

在加入近期变化的当前标题、类型和演示状态投影前，较少并发的首轮 SQLite P95 为 87.12、72.40、60.23 ms，Legacy P95 为 198.66、184.28、175.22 ms，顺序同上。两轮正确性断言均通过。

正常读取仍检查全库的文件名和文件状态。这个表记录列表与统计的应用侧耗时，检索查询耗时与引用证据见单独的评测报告。

## 交接

本文记录施工自查。批次结论及浏览器、25+5 问检索和同版全仓门禁由独立验收签发。

| 交付文件 | SHA-256 |
| --- | --- |
| `server/index.ts` | `e1aeaa2a009f7408773a39c8fa591121166bf86f8d83b7d7a1fba2554d6f605b` |
| `services/search/indexer.ts` | `5bdb23c609bac5a4634da577959de23715c2e3844ef415b21cc8731767309cb1` |
| `services/search/sqlite-store.ts` | `f24ae77e767ebeeb07e8d085bdad68c40e4f73a8d624a1ea51d54ee7d2a5ebf7` |
| `services/stats/index.ts` | `07306fd3ddf087d4144783bd0311f645d02b6ad94844d2a92db84e025a71f456` |
| `services/wiki/creation.ts` | `35003a0d23f57fe5706edd1a0c62cb528a3eeb28df6a6a8528994828c2b03ada` |
| `services/wiki/store.ts` | `072c0bbcff89a7f9c8988630bd9888ca7c5f494d867174c3a4fde3b19a049d6e` |
| `tests/search-sqlite-index.test.ts` | `016b466b41ab29e0dacc60adb4bd5c58f5b002f5cad2cc07137904c1ecf7d774` |
| `tests/wiki-freshness.test.ts` | `ddb6a4d49a65186ec2049a82d29cbce28dfd5e20f47ff3e7b017f97515123c08` |
| `tests/wiki-review-http.test.ts` | `888a4f63a3447f4dabb1792a591d245ca8df9b80d0d60b0e6d2a4ac084c5b646` |
| `scripts/bench-wiki-catalog-1000.ts` | `4ecf739317311730b43415f60052ecbc9aa946a5f6f54d5c32bbd763fb0c6496` |
