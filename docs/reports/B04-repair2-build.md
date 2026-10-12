# B04 第二次返修报告（2026-10-05）

对象：[B04 第二次返修卡](B04-recheck-fix-card.md) 的三项残留 **F04-04 / F04-05 / F04-11**（复验结论 8 项已关闭、这 3 项部分修复）。本报告由施工方 DeepSeek V4.1 Flash 编写，**不签署 B04 PASS**；未修改 `docs/status.md`、批次卡、`docs/acceptance.md`、`B04-acceptance.md`、`B04-recheck-acceptance.md`、`B04-recheck-*.json`/`.jpg` 等独立验收证据，未进入 B05。

- 每项都先按复验报告"三项残留最小复现"写出失败用例，**并临时回退到旧实现确认该用例真的失败**，再装上修复（见第 2 节）。
- 按返修卡要求，运行 `npm test` 前已归档上一份施工证据：[B04-repair2-http-evidence-before.json](B04-repair2-http-evidence-before.json)（原 [B04-http-evidence.json](B04-http-evidence.json) 已被本次运行重写）。
- 真实产品 Provider 仍无配置 → **BLOCKED**；真实浏览器本轮未由施工方运行（**NOT_RUN**），界面相关结论沿用主 Agent 的真实浏览器报告。

## 1. 三项残留的修复

### 残留一 F04-04：重试静默忽略未知选择 ID（P2）

- 复现：先确认 `[p1]` 成功，同草稿同 key 重试 `[p1, 未知UUID]`，实际 201 `reused=true`（未知 ID 在比较 payload 前被 `.filter(id => knownIds.has(id))` 丢掉）。
- 修复：[services/wiki/commits.ts](../../services/wiki/commits.ts) 的 `confirm` 把 **ID 存在性校验提到最前**，对首次确认与重试一律生效：去重后为空 → 400 `NO_SELECTION`；任一 ID 不在草稿里 → 400 `UNKNOWN_PAGE`（details 给出 `unknownPageId` 与已知 ID 列表）。之后才进入"按冻结 payload 判定"的重试分支，未知 ID 再也不会被静默缩减成成功。
- 保留：同 payload 在任意 key 下复用同一 `operationId`/页面 IDs；不同有效选集同 key/异 key 都 409，正式文件与 Log 不增长。

### 残留二 F04-05：正式 Source 派生段落与本次确认选集矛盾（P2）

- 复现：草稿全部 `selected=false`，PATCH 只改 p1 标题（不动标记），公开 confirm 传 `[p1]` → 正式 Source 链接 p1，但同正文把 p1 列进"本次未创建的建议"，Key Takeaways 还是"暂无"。
- 修复：
  - [services/wiki/commits.ts](../../services/wiki/commits.ts) `sourceBodyFor` 的 skipped 集合改为 **`draft.pages` 减去本次确认的 ID 集合**（不再看 `page.selected` 标记），使 selected 与 skipped 互斥且覆盖全部建议；
  - [services/wiki/drafts.ts](../../services/wiki/drafts.ts) `derivedTakeaways` 不再内部按标记过滤，改为由调用方传入**生效选集**（草稿保存时用标记，提交时用确认 ID）→ Key Takeaways 一定包含被确认页的定义；
  - 链接集合本来就按确认选集渲染，因此链接/Key Takeaways/未创建列表三段现在统一。
- 保留：普通 UI 先保存（标记与选集一致）、改名、Source 复用（链接既有真实标题）、用户主动编辑 Source 正文时整段正文按其原文冻结等既有语义。

### 残留三 F04-11：汇总丢失已规范化的证据全局位置（P2）

- 复现：27,200 字符四块、每块 quote 唯一、摘要不同；Provider 合法省略可选 `start/end`（只回 `id/rawId/quote`）。产品草稿定位正确，但汇总请求里每条事实的 evidence 只有 `{id,quote}`，缺 `start/end`。
- 修复：[services/llm/service.ts](../../services/llm/service.ts) `callDocumentMerge` 的 payload 改用**已校验/规范化的每块结果 `entry.pages`**（而不是 `entry.result.suggested_pages` 原始对象），因此每条事实的证据都带 `rawId + quote + 全局 UTF-16 start/end + chunkIndex`；两者语义不同时（例如某 ID 未解析）退回 `{id, resolved:false}` 而不是给出伪造位置。
- 保留：真实触发额外汇总（多块且摘要不同）、尾部覆盖、并发 ≤ 2、Raw 不变、每块字段完整性（标题/类型/分类/一句话说明/事实/整理/推断/问题/关联）。

## 2. 复现与回归证据

新增 [tests/llm-repair2.test.ts](../../tests/llm-repair2.test.ts)（3 项，逐条对应上面三项残留），并在 [tests/llm-http.test.ts](../../tests/llm-http.test.ts) 增加一项**公开 HTTP** 版残留用例（名称：`F04-04/05 HTTP 残留：未知 ID 的重试 400；Source 派生段落按本次确认选集`）。

| 残留 | 新用例 | 回退旧实现的实测（证明用例有效） | 装有修复的实测 |
|---|---|---|---|
| F04-04 | `F04-04 残留：带未知选择 ID 的重试不会被静默缩减成成功` | **FAIL**：`带未知 ID 的重试必须失败，实际 {"value":{…"status":"completed"…"reused":true…}}`（201 reused，与复验报告一致） | **PASS**：400 `UNKNOWN_PAGE`，文件/Log 不变；同 payload 任意 key 仍复用；空选集 400 `NO_SELECTION` |
| F04-05 | `F04-05 残留：正式 Source 的所有派生段落以本次确认选集为准` | **FAIL**：`被确认的页不得被标为未创建：`（旧代码把 p1 列进未创建集合） | **PASS**：Source 只链接 p1、未创建列表只含 p2、Key Takeaways 含 p1 定义且非"暂无"、links 唯一解析、只落盘 2 个文件 |
| F04-11 | `F04-11 残留：Provider 省略可选位置时，汇总输入仍带规范化后的全局 start/end` | **FAIL**：`汇总输入的证据缺全局 start（第 1 段）：{"id":"e1","rawId":"…","quote":"独有标记甲"}`（与复验报告一致） | **PASS**：捕获 1 次真实汇总请求，每条事实证据都带 rawId 与 start/end，且 `完整Raw.slice(start,end) === quote`，并与草稿规范化位置逐字段相等 |

四块 fixture 说明（F04-11）：四段各 7,600 字符、段首放全篇唯一标记，标记落在各自分块内且全篇只出现一次，因此 Provider 只回 `quote` 时产品仍能唯一定位（也顺带验证了 `LLM_EVIDENCE_AMBIGUOUS` 之外的正路）。

命令与结果（当前冻结版本）：

| 命令 | 结果 |
|---|---|
| `npm run build` | PASS（tsc 无错；vite 39 modules，`dist/assets/index-CC-_fZgv.js` 295.16 kB、CSS 30.00 kB） |
| `npm test` | **96/96 PASS**（B01/B02 14 + B03 32 + B04 原 34 + 上一轮返修 12 + 本轮 4） |
| `node tests/acceptance/b01-http.mjs` | **7/7 PASS** |
| `node tests/acceptance/b02-http.mjs` | **12/12 PASS** |
| `node tests/acceptance/b03-http.mjs` | **23/23 PASS** |
| 上一轮 11 项返修的断言 | 全部保持通过（幂等/Source 元数据/合并/竞态/部分提交/Key 保护/默认未选/UI 保存与确认） |

进程级 HTTP 证据（本次运行重写 [B04-http-evidence.json](B04-http-evidence.json)，`node v25.2.1`）：成功链路 Raw `d0dfc073-…` → 草稿 `607bee08-…`（revision 2，只选 1 条）→ `operationId e39af00c-02c9-4891-98d2-efe55669835e` → Source `b7d3724b-…` + 页 `4a35d46d-…`，未选中标题未落盘、响应无 Key 命中；部分提交与恢复 Raw `793015b8-…`、`operationId 45a42432-9043-42e0-bc9f-88e24574b8dc`，失败阶段 `source:done/pages:done/index:failed/log:pending/state:pending`、已写 3，恢复后仍 3、Wiki 3、日志 3 行且目标唯一。运行 `npm test` 会重写该文件，本轮归档件为 [B04-repair2-http-evidence-before.json](B04-repair2-http-evidence-before.json)。

## 3. 变更文件指纹（SHA-256）

| 文件 | 变更 | SHA-256 |
|---|---|---|
| services/wiki/commits.ts | F04-04 前置校验；F04-05 skipped/派生按确认选集 | `17dc1bd10776c4bd7945a30d348145932a3f70cce2ad77f82fe38c31f8d4404e` |
| services/wiki/drafts.ts | F04-05 `derivedTakeaways` 由调用方传入生效选集 | `320edbef7fe7ab56cb4c7412da4fc10ea963ed3718bec235ae4110541bf94d11` |
| services/llm/service.ts | F04-11 汇总输入改用规范化 `entry.pages` | `f31bc73bf88c183f7aafce1577225a79dd5176da9d77487bdcd2bb4bb3122fb5` |
| tests/support/fake-llm.ts | 支持 `quoteText` / 合法省略可选位置 | `38e507e3d24ef6e05721c4f0b192471b44ebacc423f18818f7999140146b9265` |
| tests/llm-repair2.test.ts | 新增三项残留复刻用例 | `7127945390ed11cb53a1207ceb718df8c5d4ee82eb357c1ad6cb9ddc8168cd79` |
| tests/llm-http.test.ts | 新增公开 HTTP 残留用例 | `4857ad27d7a84c06acee42a75bcc7fd70e33133d75dba2a6df9632610be7aaab` |
| README.md | 重试校验与 Source 派生段落的说明 | `814b4c5d1317e3f73db70e4c358486ada4b5bcc30e2f473c54a4fb19128042cd` |
| docs/reports/B04-repair2-http-evidence-before.json | 运行前归档的上一份证据 | 见文件 |

`package.json`（`e5645495…`）与 `package-lock.json`（`b40e9e8a…`）**未改动**：本轮未引入依赖，也未新增错误码（`UNKNOWN_PAGE`/`NO_SELECTION` 均为首批已声明的代码）。

## 4. 兼容性与未测边界

- 接口形状、状态机、预算与路径均未变；`confirm` 的错误语义只是**更严格**（未知 ID 从"被忽略"变为明确 400），符合冻结契约"同 key 不同 payload 明确 409 / 未知建议明确拒绝"。
- F04-05 的改动只影响**提交时**的派生文本；草稿预览仍以草稿标记为准（普通 UI 会先保存标记，与确认选集一致）。
- 未测边界：真实浏览器（本轮未由施工方运行）；真实 Provider 成功与质量（BLOCKED）；F04-11 的 10 分钟总期限与 Provider 超时矩阵沿用上一轮证据，未在本轮重跑。
- 未触碰 `docs/status.md`、批次卡、验收文档与历史独立证据；未进入 B05。
