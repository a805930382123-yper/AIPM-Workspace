# B04 第三次返修报告（2026-10-05）

对象：[B04 第三次返修卡](B04-recheck2-fix-card.md) 的**唯一残留 F04-11**（长文汇总证据完整性，P2）。第二次返修后 F04-04/F04-05 已由独立复验关闭，累计 10 项根因关闭，本报告只处理 F04-11 及其受影响回归。本报告由施工方 DeepSeek V4.1 Flash 编写，**不签署 B04 PASS**；未修改 `docs/status.md`、批次卡、`docs/acceptance.md` 或任何独立验收证据（`B04-recheck*`、`B04-independent*`、`b04-*.mjs` 原样保留），未进入 B05。

## 1. 根因：聚合与分块快照共享可变对象（引用生命周期）

复验报告与返修卡的定位是正确的，我复核后的完整链条是：

1. `wikiExtract` 先 `mergePages(chunkResults)`（`services/llm/service.ts`），它把 **首块 page 对象本身**（而非副本）放进聚合表：`if (!existing) { merged.set(key, page); continue; }`；之后所有聚合操作都写在这个对象上。
2. 同名后续块进入时，它**就地**把该块证据改名为 `e1-c2/e1-c3/…`（`evidence.id = candidate`），却只把改名后的 ID 写进**聚合页**的事实引用；**该块自身的 `source_facts[].evidenceIds` 仍是 `e1`**。
3. 我上一轮把汇总输入改成读 `entry.pages`（规范化快照）后，第 2–4 块的快照已经"证据 id 是 `e1-c2`、事实却引用 `e1`"→ 查不到 → 被降级成 `{id:"e1", resolved:false}`，quote/rawId/start/end 全丢（正是复验看到的实际汇总 payload）。
4. 首块的独立快照也被聚合追加/改名污染，不再是"该块自己的结果"。

## 2. 修复（保持既有语义，只改引用生命周期）

[services/llm/service.ts](../../services/llm/service.ts)：

1. **聚合基于独立深拷贝**：`mergePages` 每块先 `clonePage(source)`（深拷贝证据数组、事实数组、四类文本数组、provenance、mergedFrom/notes），聚合表与所有就地改名只作用于副本；`chunkResults[].pages` 的分块快照在整个流程中保持不变。
2. **引用一致性成对维护**：副本内改名后立即同步该副本自己的事实引用（`fact.evidenceIds = fact.evidenceIds.map(id => renamed.get(id) ?? id)`），不再"只改一个数组"。
3. **聚合结果先自检**：`assertReferencesResolve(page)` 保证聚合页不存在指向缺失证据的事实；发现即 `LLM_MERGE_FAILED`（含页标题与缺失 ID），不静默继续。
4. **汇总输入不再降级**：`callDocumentMerge` 构造 payload 时若某事实引用的证据在快照里找不到，直接抛 `LLM_MERGE_FAILED`（附块号、页标题、缺失 ID），**取消 `{resolved:false}` 兜底**；正常路径每条证据都带 `id + rawId + quote + 全局 UTF-16 start/end + chunkIndex`。
5. 单块、无重复标题、带 hint 的既有路径逻辑不变（拷贝即语义等价）。

## 3. 实测证据

新增 [tests/llm-repair3.test.ts](../../tests/llm-repair3.test.ts)（4 项）+ [tests/llm-http.test.ts](../../tests/llm-http.test.ts) 的公开 HTTP 版（`F04-11 残留 HTTP`）。fixture 完全按返修卡：四块、**标题相同**、每块证据 id 均为 `e1`、quote 分别为各块全篇唯一原文（四段各 7,600 字符、段首唯一标记）、四块摘要各不同（真实触发汇总），**有 hint 与合法省略 hint 两种输入都跑**。

| 用例 | 关键断言 | 结果 |
|---|---|---|
| `F04-11 残留（有位置hint）` / `（无位置hint）` | 真实汇总请求恰 1 次；payload 内零 `"resolved":false`；每条引用都有 rawId/quote/start/end，且 `body.slice(start,end)===quote`、位置等于草稿规范化位置；4 块摘要互不相同；聚合页 1 条建议、4 条独有事实、证据 ID 唯一且含重命名 `e1-c*`、引用全部可解析；尾部覆盖到原文末尾；并发 ≤2；Raw 正文不变 | **PASS**（两种输入都通过） |
| `F04-11 残留（对照）` | 无重复标题时汇总输入同样完整、四条建议保留；**单块短文不触发汇总**且草稿正常 | **PASS** |
| `F04-11 残留（回归）` | 聚合后的草稿可直接确认：正式页正文含四块证据引文、Log 2 行 | **PASS** |
| `F04-11 残留 HTTP`（公开 HTTP + 独立 fake Provider 进程） | 作业 `completed`、`callCount=5`；草稿 1 页/4 事实/证据 ID 唯一且引用全部可解析；**抓到的真实汇总请求**零 unresolved、每条证据 `body.slice(start,end)===quote`；并发 ≤2；Raw 文件 sha256 前后不变 | **PASS** |

**回退旧实现证明用例有效**：把 `const page = clonePage(source)` 换回 `const page = source` 并去掉副本事实同步（即复验看到的旧行为）后，两个 hint 变体都 **FAIL**，报 `分块汇总输入里「同标题指标」引用的证据 e1 无法解析（第 2 段），已停止汇总。`——旧代码在这一刻会送出 `{id:"e1",resolved:false}`；恢复修复后全部通过。

实际汇总 payload（真机抓取、纯测试数据、无任何 Key）记录在 [B04-repair3-merge-payload.json](B04-repair3-merge-payload.json)，两种输入的摘要与第 2 段样本：

```json
{ "chunkCount": 4, "callCount": 5, "pageCount": 1, "evidenceCount": 4,
  "unresolvedReferences": 0, "maxConcurrent": 1, "rawBodySha256Matches": true }
// payload[1]（第 2 段）
{ "chunk": 2, "chunkRange": { "start": 7600, "end": 15600 },
  "document": { "title": "资料4b5b27c2-第 2 段", "main_topic": "主题2", "summary": "第 2 段的摘要" },
  "pages": [{ "title": "同标题指标",
    "source_facts": [{ "text": "第 2 段的独有事实",
      "evidence": [{ "id": "e1", "rawId": "4b5b27c2-…", "quote": "返修三-乙", "start": 7621, "end": 7626, "chunkIndex": 1 }] }],
    "ai_organized": ["对「同标题指标」的整理"], "ai_inferences": [], "open_questions": [] }] }
```

（`start/end` 为 7621/7626：标记 `返修三-乙` 在完整 Raw 中的真实位置，`Raw.slice(7621,7626)==="返修三-乙"`。）

命令与结果（当前冻结版本）：

| 命令 | 结果 |
|---|---|
| `npm run build` | PASS（tsc 无错；vite 39 modules，`dist/assets/index-CC-_fZgv.js` 295.16 kB、CSS 30.00 kB） |
| `npm test` | **101/101 PASS**（新增 repair3 4 项 + HTTP 1 项；上一轮 96 项全部保持） |
| `node tests/acceptance/b01-http.mjs` | **7/7 PASS** |
| `node tests/acceptance/b02-http.mjs` | **12/12 PASS** |
| `node tests/acceptance/b03-http.mjs` | **23/23 PASS** |

F04-04（未知 ID 拒绝/幂等）与 F04-05（实际选集派生）的既有断言继续通过，本轮未改动这两个模块。运行 `npm test` 会重写 `B04-http-evidence.json`，运行前归档件：[B04-repair3-http-evidence-before.json](B04-repair3-http-evidence-before.json)。

## 4. 产品指纹（按当前实物重新计算）

| 文件 | 本轮 | SHA-256 |
|---|---|---|
| services/llm/service.ts | 修改（F04-11 根因） | `61e92017b99f4c8285e8301a160a60ed8f0a4bf52d1f5d0038519eb3cb8f05f8` |
| services/wiki/commits.ts | 未改（第二轮产物） | `17dc1bd10776c4bd7945a30d348145932a3f70cce2ad77f82fe38c31f8d4404e` |
| services/wiki/drafts.ts | 未改（第二轮产物） | `320edbef7fe7ab56cb4c7412da4fc10ea963ed3718bec235ae4110541bf94d11` |
| tests/support/fake-llm.ts | 修改（`factText`、并发计数） | `9a0d6de4e4f814632f7716e8c6d061e1d1a240f619042acd703e47de1ec999ab` |
| tests/llm-repair3.test.ts | 新增 | `65e874f587e8ab24a5eb6ed15b69cf2d87b1095d31180a70fd08c9d7b719b779` |
| tests/llm-http.test.ts | 修改（新增 F04-11 HTTP 用例） | `175de484663f148fe4a239ef5b4343631e956d5486f93e3c1fd5516f4bd2efbe` |
| README.md | 未改（第二轮产物） | `6c371e193056c0ad92118b6a6dc3a1d9ef28f2b04e89e3d37d2d16116d62a9c0` |
| package.json / package-lock.json | 未改 | `e5645495…` / `b40e9e8a…` |
| docs/reports/B04-repair3-merge-payload.json | 新增证据 | `f4976863160f4b662aa5837fffac8bb6ed04456b4da0ff466f93cfb533857f94` |
| docs/reports/B04-repair3-http-evidence-before.json | 归档证据 | `412a161253ea6866e13b71fa0ba4e0bb952b4c2b3daa11b8f5663d80239f2a3f` |

**DOC 差异更正（不冒充功能缺陷）**：第二次返修报告 [B04-repair2-build.md](B04-repair2-build.md) 的 README 行写的是 `814b4c5d…`，那是**先算指纹后又编辑 README** 导致的过期值；README 本轮实物为 `6c371e1930…`（内容与第二轮一致，仅第二轮末尾补了"重试校验/派生段落"两句说明）。本报告所有指纹均在全部编辑完成后一次性重算，未提交、未含任何 Key。

## 5. 未测边界

- 真实产品 Provider 仍**无配置 → BLOCKED**（零真实调用；fake 只替代协议与确定性路径，不代表真实 AI 成功或质量）。
- 真实浏览器本轮未由施工方运行（**NOT_RUN**）；界面相关结论沿用主 Agent 的独立浏览器报告。
- 10 分钟总期限、Provider 60 秒超时整套矩阵、legacy Raw > 500k、聚合 51 条上限等边界沿用前几轮证据，未在本轮重跑（本轮改动只影响聚合与汇总输入构造）。
- 未触碰 `docs/status.md`、批次卡、验收文档与历史独立证据；未进入 B05。
