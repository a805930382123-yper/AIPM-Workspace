# B07 第三次返修施工报告（2026-10-07）

本报告由施工方撰写，对应 [第三次返修卡](B07-repair2-fix-card.md) 唯一一项 **F07-07 / P2**。**这是施工自测结论，不是独立验收**：F07-07 在本报告中一律记为「已改 + 已自测」，CLOSED / PASS 只能由后一轮独立复验签出。原 F07-01–06 维持第二次返修独立验收的 CLOSED 结论，本轮不予改动、也不由本报告重新签署。本轮不覆盖 `B07-acceptance-*`、`B07-repair1-*`、`B07-repair2-*` 证据与两张旧返修卡，不启动 B08。

- 冻结范围：[B07 交接](../handoffs/B07-deepseek-prompt.md)。
- 第二次返修独立 FAIL 报告：[B07-repair2-acceptance.md](B07-repair2-acceptance.md)（本轮只处理其中的 F07-07）。
- 本轮全部自测产物使用 `B07-repair3-*` 前缀。

## 1. 环境与执行

| 项 | 值 |
| --- | --- |
| 平台 | Windows 11，Node v25.2.1，`tsx` 运行时，PowerShell 5.1 |
| 构建 | `npm run build`（`tsc -b && vite build`） |
| 仓库测试 | `npm test`（146 个用例全部执行） |
| 受控异步顺序 | [tests/prompt-ui.test.tsx](../../tests/prompt-ui.test.tsx) 的 `harness.gate/release/waiting`：命中 gate 的请求挂起，`release` 后仍跑真实桩逻辑（同一响应体、同一状态码） |

| 检查 | 结果 | 产物 |
| --- | --- | --- |
| `npm run build` | PASS（44 modules，1.06s，exit 0） | [B07-repair3-build.log](B07-repair3-build.log) |
| `npm test` | **146 / 146 pass，fail 0**（原 144 保留 + 新增 2，17.96s） | [B07-repair3-test.log](B07-repair3-test.log) |
| 守卫删除 mutation | 4 项全部按预期被检出（见 §4） | [B07-repair3-mutation-check.log](B07-repair3-mutation-check.log) |

## 2. 本轮改动文件与 SHA

本轮**只改 UI 与 UI 自测**，存储/后端/HTTP 脚本零改动。

| 文件 | 字节 | SHA256 | 本轮 |
| --- | --- | --- | --- |
| [app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx) | 42779 | `90431F9F55A1BC54ED1CEE62E8C9E269C72B848129A3CB6B8E70796450EEF6BF` | 修改（+1 行触发、+注释） |
| [tests/prompt-ui.test.tsx](../../tests/prompt-ui.test.tsx) | 57723 | `4983BD5EA09F1C4AA7142FC130A61E3A760CBD9A6EF19EE85ABBDC53303D0665` | 修改（新增 2 个用例） |
| [services/prompt/store.ts](../../services/prompt/store.ts) | 23468 | `A19144499060F1EBCBF0CE1A0B0161CCD76663B37DD36F179E9E14E833A540A6` | **未改**（与首轮返修一致） |
| [tests/prompt.test.ts](../../tests/prompt.test.ts) | 28889 | `A05334DF093039A57C4714CE30448937EEE2A67F072E7679B53F5ADD6F37D4CC` | **未改** |
| [tests/b07-prompt-http.mjs](../../tests/b07-prompt-http.mjs) | 51654 | `E3AC3ED2C10EBEE5DC2187AAB338E629E5DE7BAF8271ADCC5102B5B13F2B8D89` | **未改** |

`store.ts`、HTTP 脚本、后端契约 SHA 与首轮返修完全一致，符合返修卡「产品保持仅 UI 改动时，可复用上一轮后端 11/11 HTTP 与四类损坏记录证据」的条件；**本轮没有重新运行独立 HTTP 与真实浏览器检查，也不声称那些检查在本轮跑过**（见 §5）。

## 3. F07-07 / P2：重复选择当前模板使历史列表永久为空

**根因（与独立报告一致）**：[PromptLibraryPage.tsx:106–118](../../app/pages/PromptLibraryPage.tsx#L106-L118) 的 `selectId` 无条件递增 `selectionVersion`、清空 `versions` 等状态，却只 `setSelectedId(id)`；而读取详情/历史的 effect（[:161–172](../../app/pages/PromptLibraryPage.tsx#L161-L172)）只依赖 `[selectedId, reloadToken]`。**同一个 id 时 `selectedId` 不变、`reloadToken` 也不变**，被清空的 `versions` 于是没有任何读取能再填回来；同时该次调用已把在途读取的选择代次作废，所以旧响应也会被丢弃，界面永久停在「版本历史 · 0／正在读取版本…」。数据没有丢，只有这个 UI 读取不再触发。

**改动**（[PromptLibraryPage.tsx:117](../../app/pages/PromptLibraryPage.tsx#L117)，一行）

```ts
requestId.current = null;
setReloadToken(current => current + 1);   // B07 repair (F07-07)
```

- 为什么这样修：`reloadToken` 是页面里既有的「把这条记录重新读一遍」信号（保存成功、收藏、409 刷新都在用同一个 idiom）。把它加进 `selectId`，就使**清理与读取触发对同一次选择同时发生**：`selectedId` 变不变都会导致 effect 重跑一次，并且由于 `selectionVersion` 同时递增，这次新读取拿到的是当前代次，任何更早的在途响应仍被丢弃。
- **不是掩盖**：没有隐藏「正在读取版本」文字，也没有把清空前的旧数组塞回去。旧的 `setVersions([])` 保持原样，变得只是「清空之后一定跟着一次真实读取」。
- **已关闭的守卫未动**：`selectionVersion`、`historyRequest`、`renderRequest`、`busyToken/beginBusy/endBusy/releaseBusy`、`inflightRequestIds`、`requestId` 的语义与递增次序全部不变，本行是唯一的改动。
- **语义保留**：同一行点击仍然是一次选择——它同时退出历史只读视图（`setViewVersion(null)`）、退出编辑上下文（`setForm(null)`）、清掉填写内容与生成结果/复制状态，现在再额外重新读取该模板的详情与历史。从历史页、编辑页、生成上下文点当前模板，行为一致。

**测试**（[tests/prompt-ui.test.tsx:829](../../tests/prompt-ui.test.tsx#L829)、[:934](../../tests/prompt-ui.test.tsx#L934)），覆盖返修卡要求的两个顺序：

1. `返修 F07-07：重复点击当前模板仍能看到完整历史，重复选择不得清空版本列表`
   - 独立验收的最小复现：乙→甲，再点已经选中的甲 → 断言详情仍是甲、`.prompt-version-row` 仍有 1 行、标题计数「版本历史 · 1」一致、且**不存在**「正在读取版本…」。
   - 已有 2 版的模板（乙）：重复点两次后仍为 2 行、计数为 2、无假加载、正文不串到甲。
   - 生成上下文里的同 id 点击：生成出 `请总结 华东。` 后点当前行 → 填写内容被清空、旧结果不再显示、复制重新禁用，**同时**历史重新读出 1 行（清理与读取一致）。
   - 历史页点该模板返回当前：横幅消失、详情回到乙、历史仍 2 行，且整段「查看版本 + 返回当前」期间没有新增 `/render` 请求（版本查看只读）。
   - 编辑页选择同一模板：退出编辑、详情与历史照常。
   - 甲乙往返各一次：每次历史都完整；全程无错误条。
   - 刷新：卸载后重新挂载，乙的历史仍完整，重复点击仍然有效。
2. `返修 F07-07：初次历史仍在途中时重复点当前行，必须重新读取并最终加载完整历史`
   - 扣住乙的 `/versions` 整体：第一次读取在途时重复点同一行 → 断言等待中的读取变成 **2**（真的重新触发，而不是只清空）。
   - 先释放被作废的第一次：不得写入任何版本行（代次失效仍有效）。
   - 再释放第二次：历史最终加载出 2 行、无假加载、可点开第 2 版并看到它自己的旧正文「乙的旧版正文。」→ 历史是真的可用，不只是计数正确。

**自测结果**：两个用例通过（`npm test` 计入 146/146；原 144 项未删改）。

**反空转证据**（[B07-repair3-mutation-check.log](B07-repair3-mutation-check.log)）：删掉本轮的 `setReloadToken` 那一行 → 两个用例 `pass 0, fail 2`，报 `重复点击当前行后，甲的历史必须仍然完整（此前会清成 0 并卡在“正在读取版本…”）`（actual 0 vs expected 1）与 `重复点击同一模板必须重新触发读取，而不是只清空`（actual 1 vs expected 2），随后按字节还原。

## 4. 已关闭守卫的回归（本轮改动不得让它们变空转）

本轮改的是选择路径本身，因此额外重测了上一轮已 CLOSED 的守卫是否仍可被检出（同一份页面，逐个改坏后运行对应用例，再按字节还原）：

| 改动 | 结果 | 报出的断言 |
| --- | --- | --- |
| A 本轮修复：`selectId` 不再 `setReloadToken` | tests 2，pass 0，fail 2 | 两个 F07-07 用例的上述断言 |
| B F07-04 残留：`openVersion` 的 `renderRequest` 递增去掉 | tests 2，pass 1，fail 1 | `迟到的生成错误不得盖到历史只读页上` |
| C F07-05：创建 `finally` 改回清掉全部占用 | tests 3，pass 2，fail 1 | `己不得复用戊仍在途的 requestId` |
| D F07-05：`startCreate` 不再让出被在途表单占用的 id | tests 3，pass 2，fail 1 | `两张新表单必须各自分配 requestId` |

基线（还原后）：F07-04 tests 2 / pass 2，F07-05 tests 3 / pass 3，F07-07 tests 2 / pass 2，整仓 146/146。四步均在改动前用 `Copy-Item` 备份、改动后按字节还原，还原 SHA 每次核验为 `90431F9F…`。

## 5. 真实未运行项（如实列出）

1. **本轮未运行 HTTP 自测与真实浏览器检查**：改动仅一个页面内部状态与两个 UI 用例，`store.ts`、`server/**`、HTTP 脚本、后端契约零改动，可直接复用上一轮独立 HTTP（11/11）与四类损坏记录证据。**但按返修卡，F07-07 的最终关闭必须由独立复验在真实浏览器里重复「乙→甲→再点甲」的最小复现，并重点回归 F07-04/05，不能靠本报告的 self-test 签 CLOSED。**
2. **独立验收本身未在本轮运行**：F07-07 在本报告中不标 CLOSED / PASS，状态仍为 OPEN；F07-01–06 的 CLOSED 仍属上一轮独立结论，本报告未重新签署。
3. **B04–B06 真实 Provider 阻塞**：沿用现状，未触碰、未解除。
4. **真实多窗口并发、真实 EIO/rename 故障、真实剪贴板（E07-06）**：本轮未复测，沿用上一轮证据。

## 6. 历史证据保护、正式数据不变量与隔离清理

**B04 两份会被 `npm test` 重写的原件**（[tests/llm-http.test.ts:19](../../tests/llm-http.test.ts#L19)、[tests/llm-repair3.test.ts:26](../../tests/llm-repair3.test.ts#L26)）运行前备份到隔离目录，运行后按字节还原；本轮产物另存，未覆盖任何历史文件：

| 文件 | 本轮状态 | SHA256 |
| --- | --- | --- |
| `docs/reports/B04-http-evidence.json` | 原件（已还原） | `2B28D35E2B73A5A7AED00CD048DE5032D2FC1C74758A372FEA617EB380B89BCD` |
| `docs/reports/B04-repair3-merge-payload.json` | 原件（已还原） | `F3A425DD5E9CB8A72CE28F4A257A938199E495950D1E4C1FD607A023CCFE36AF` |
| `docs/reports/B07-repair3-generated-B04-http-evidence.json` | 本轮 `npm test` 产物另存（1786 B） | `AA6E4A8D697A2C1D35F78D64CC784A6E8AC3F1420293E50CBC3003134B739AB5` |
| `docs/reports/B07-repair3-generated-B04-repair3-merge-payload.json` | 本轮 `npm test` 产物另存（10003 B） | `D3AAFF2E626389528906E80454A2D03782E29101732DE7602AE5E29F47666FDE` |

两份件的 SHA 与 B06/B07 基线一致。本轮再次运行的 B04 用例 13/13 pass；另存产物与历史原件只差运行时间与本次生成的 UUID：字段集合完全相同（两侧各 26 个键，`Compare-Object` 无差异），两次 `scenarios.happyPath.rawSha256` 同为 `6e9e4020…`（Raw 正文内容哈希不变），仅 `rawFileSha256`（含本次生成 frontmatter id 的文件级哈希）与 `startedAt` 随运行变化。**Raw 正文本轮零改写**。

**正式数据不变量**：本轮未启动任何产品服务、代理或浏览器，未写入任何数据目录。`workspace/` 仍为原有 2 个文件，SHA 与上一轮独立验收基线快照 [B07-repair2-acceptance-baseline/workspace.json](B07-repair2-acceptance-baseline/workspace.json) 逐字节一致：Raw `daf6fde4-…md` = `91ce67d2…`、`knowledge/wiki/index.md` = `6ec47044…`；`workspace/prompts` 仍为空（0 文件，mtime 2026/10/3 未变）。本轮改动不影响、也未读取任何正式 Prompt/knowledge 数据。

**产品文件集合**：本轮回合内（23:30 之后）被写入的非 `docs/` 文件只有 `app/pages/PromptLibraryPage.tsx`、`tests/prompt-ui.test.tsx`，以及构建产物 `tsconfig.tsbuildinfo`、`dist/**`；其余产品文件一个都没被写过（按 mtime 全量核对）。后两个是被保护的 B04 原件路径之所以要还原的原因——它们不在产品集合内，但属历史证据。

**未覆盖**：`B07-acceptance-*`、`B07-repair1-*`、`B07-repair2-*`（含 [B07-repair2-fix-card.md](B07-repair2-fix-card.md)、[B07-repair2-build.md](B07-repair2-build.md)、[B07-repair-build.md](B07-repair-build.md)）、`docs/handoffs/B07-deepseek-prompt.md`、`B06-acceptance-*` 与 `B05-baseline/`、`B06-baseline/`、`B07-acceptance-baseline/`、`B07-repair1-acceptance-baseline/`、`B07-repair2-acceptance-baseline/`、`tests/acceptance/**` 本轮零写入。

**隔离与清理**：页面备份与 B04 备份目录（`docs/reports/.tmp-b07r3/`、`%TEMP%\b07r3-*`）在本报告写完后删除；仓库内 `.tmp-b07*` 为空；4317 / 5173 无监听；本轮未新增仓库根目录临时目录（现存 9 个 `.test-b04-http-*` 为 14:24–14:25 早前轮次残留，未擅自删除）；`Get-Process node` 的 11 个进程全部属于 Codex 运行时（21:41 / 22:18 启动），本轮测试进程均已退出。

## 7. B08 接口兼容影响

- 冻结对外语义未变：路由与字段、错误契约、`baseVersion` 乐观锁与 409、版本全量快照、`relatedWikiIds` 松耦合、单次字面量替换、`creation.requestId` 创建重试幂等，全部保持；本轮未新增错误码。
- 改动只在页面内部状态（选择时同时发布一次重新读取信号），无对外接口变化；`store.ts` 与 HTTP 脚本 SHA 不变。
- 服务端模块边界、存储格式与目录结构未变，B08 可在冻结接口上继续推进。

## 8. 自测结论

- F07-07 已实现并自测通过：同 id 重复选择时清理与读取触发重新一致，两个顺序（已有历史／在途读取）各有能复现独立报告所述原因的受控时序用例，且修复删除后两个用例都会失败（非空转）。
- 已关闭的 F07-04 / F07-05 守卫在本轮改动后仍可被检出（B/C/D 三项 mutation），没有因为这次改动变成空转。
- `npm run build`、`npm test`（146/146，原 144 项全部保留）通过；历史报告、返修卡、冻结交接、独立验收脚本与正式数据本轮零改动。
- F07-07 在本报告中**不标 CLOSED / PASS**，待独立复验在真实浏览器按最小复现关闭并裁决 B07 门禁；本轮**未启动 B08**。

自测产物（`B07-repair3-*`）：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| [B07-repair3-build.log](B07-repair3-build.log) | 391 | `7AD922D0C9B927D65ACE9974853FEB7AE67BB17AF998326FEB5A9BF87462E5DC` |
| [B07-repair3-test.log](B07-repair3-test.log) | 15226 | `17BA3D630335E49AB6D09F7B5AF1F9DA3851AFB8E1F41E5765B5549A26C02558` |
| [B07-repair3-mutation-check.log](B07-repair3-mutation-check.log) | 2591 | `1A4E507995FD599ABB9BC9C2D634EBCD37372836D83D99E30B2248DDBDADD51A` |
| [B07-repair3-generated-B04-http-evidence.json](B07-repair3-generated-B04-http-evidence.json) | 1786 | `AA6E4A8D697A2C1D35F78D64CC784A6E8AC3F1420293E50CBC3003134B739AB5` |
| [B07-repair3-generated-B04-repair3-merge-payload.json](B07-repair3-generated-B04-repair3-merge-payload.json) | 10003 | `D3AAFF2E626389528906E80454A2D03782E29101732DE7602AE5E29F47666FDE` |

施工到此停止产品代码修改，交 Codex 主 Agent 独立复验。
