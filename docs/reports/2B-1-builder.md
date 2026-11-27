# LLM-Wiki 2B-1 施工自查

2026-11-27。基线 `e9e4f125978f65818ed50b48d5effbd8fb02173c`，产品提交 `4263606`。范围见 [2B-1 任务卡](../handoffs/LLMWIKI-2B-1.md)。

## 交付

- SQLite schema 4 保存正式 Wiki 正文中每页去重的 `[[标题]]` 提及与唯一目标的有向边。标题两端去空白后逐字匹配。CommonMark 解析位置用于排除代码块、行内代码及 Markdown 链接等上下文，反斜杠转义的写法不建边。
- 正式页面增删改与启动对账在同一 SQLite 事务更新页面、检索块、提及和有向边。目标后建、同名由唯一变为歧义及歧义解除均重新求值。旧 schema 升级沿用现有对账与缓存复用路径。
- `GET /api/wiki/:id` 返回 `backlinks`，详情中的「反向链接」可打开引用页。返回前沿用正式 Wiki 来源权限检查。SQLite 不可用或标记为脏时按正式 Markdown 求值。详情保留既有正向链接和删除提醒语义。

## 施工验证

Windows NT 10.0.26200，Node `24.18.0`，npm `11.16.0`，SQLite `3.53.2`。测试使用系统临时数据根和不存在的配置文件，移除继承的模型和 Embedding 配置。HTTP 用例使用随机回环端口。

| 实际命令 | 结果 |
|---|---|
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/search-sqlite-index.test.ts tests/wiki-freshness.test.ts tests/wiki-review-http.test.ts tests/wiki-selection.test.tsx` | 29/29。覆盖正式 HTTP 增删改与反链、写入故障后从正式页读取、隐藏引用页、schema 1 与 3 升级、删除库后重建、CRLF 与 UTF-16 引文坐标。 |
| `npm run check` | 最终代码退出 0。类型及格式通过，Lint 0 错误与 761 条存量警告，体积门禁 0 违规，全量测试 1,145/1,145、0 跳过，Vite 构建 289 模块、3.44 秒，报告存量包尺寸提示。 |
| `node node_modules/prettier/bin/prettier.cjs --check app/pages/WikiPage.tsx services/wiki/link-titles.ts` | 通过。 |
| `node node_modules/eslint/bin/eslint.js -f json app/pages/WikiPage.tsx services/wiki/link-titles.ts` | 0 错误，`WikiPage.tsx` 19 条存量警告，链接解析文件 0 条。 |
| `git diff --check` | 退出 0。 |

冻结 25 问、千页性能和浏览器操作由独立验收记录。检索一跳扩展、向量重复提示与 Batch 2B 整体验收待后续阶段。

## 交接文件 SHA-256

以下摘要基于验收时工作树的文件字节。

| 文件 | SHA-256 |
|---|---|
| `app/api/wiki.ts` | `6b2c8d9c40d9aec7e8994df099b5d80d8974a369f911c34d87b64f803593fc6b` |
| `app/pages/WikiPage.tsx` | `fa4f8075ea3099c03ead8156c1a55a5ce9310639e989cde3ccd4597dc9e07ea3` |
| `package-lock.json` | `92415fc667c7c480fae0c94f37a443a68dc108e177158941c7371c8c18129e39` |
| `package.json` | `1ab455009576f4f79f7d2f820e472c1fd8925ca1fe3c525330c57f41f2ecee9e` |
| `server/index.ts` | `d5ea40d1cc68d23447052918d3a7acfd4555e30619157ae2c3bf808ec3e8705e` |
| `services/search/indexer.ts` | `8f5d61118dc7fb31114b8c4d765a642dccb55ed2a6df62619304c22032c34fb2` |
| `services/search/sqlite-store.ts` | `6a911c4ad86abd228af39b4c042ea7d377761ef6c028fff33b53132d073a91e9` |
| `services/wiki/link-titles.ts` | `3a89b30682002e536c3eb23372f2a00d40bdfdc87abcc6f94f022678e9b7f0bb` |
| `services/wiki/store.ts` | `a2e71b275a675b39b47560fcab370deea6b5f1e4649b3f45373e7ea7fd6f1595` |
| `tests/search-sqlite-index.test.ts` | `bd4aafdc8fd783e9945d9f4ab13e69248b81e1ef3852c5a4449ad6dea4f2cce2` |
| `tests/wiki-freshness.test.ts` | `8383c99249320b7a1bf2d959a08f29638ae6b15a156714782880d34db2e8c38c` |
| `tests/wiki-review-http.test.ts` | `1acfc57215d06e5a553a6cfc9b7813e2114b48fbbc6a12e524943d531ecb95e1` |
