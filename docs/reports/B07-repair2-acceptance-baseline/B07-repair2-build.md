# B07 第二次返修施工报告（2026-10-07）

本报告由施工方撰写，对应 [第二次返修卡](../B07-repair1-fix-card.md) 仅剩的两项 **F07-04 残留 / F07-05 残留**。**这是施工自测结论，不是独立验收**：两项在本报告中一律记为「已改 + 已自测」，CLOSED / PASS 只能由后一轮独立复验签出。本轮不覆盖 `B07-acceptance-*`、`B07-repair1-*`、两张返修卡、冻结交接与旧报告，不改 Raw/Wiki 产品逻辑，不启动 B08。

- 冻结范围：[B07 交接](../../handoffs/B07-deepseek-prompt.md)。
- 首次返修独立 FAIL 报告：[B07-repair1-acceptance.md](../B07-repair1-acceptance.md)（F07-01/02/03/06 已 CLOSED）。
- 本轮全部自测产物使用 `B07-repair2-*` 前缀。

## 1. 环境与执行

| 项 | 值 |
| --- | --- |
| 平台 | Windows 11，Node v25.2.1，`tsx` 运行时 |
| 构建 | `npm run build`（`tsc -b && vite build`） |
| 仓库测试 | `npm test` |
| 受控异步顺序 | `tests/prompt-ui.test.tsx` 的 `harness.gate/release/waiting`：命中 gate 的请求挂起，`release` 后仍跑真实桩逻辑（同一响应体、同一状态码） |

| 检查 | 结果 | 产物 |
| --- | --- | --- |
| `npm run build` | PASS（44 modules，965ms） | [B07-repair2-build.log](../B07-repair2-build.log) |
| `npm test` | **144 / 144 pass，fail 0**（142 原有 + 2 新增） | [B07-repair2-test.log](../B07-repair2-test.log) |

## 2. 本轮改动文件与 SHA

本轮**只改 UI 与 UI 自测**，存储/后端零改动。

| 文件 | 字节 | SHA256 | 本轮 |
| --- | --- | --- | --- |
| [app/pages/PromptLibraryPage.tsx](../../../app/pages/PromptLibraryPage.tsx) | 42032 | `43A0EBA2EC94FD2036ACEFB16E89F4F4661F3FA37A82AE672A29DAB69E4ED3F3` | 修改 |
| [tests/prompt-ui.test.tsx](../../../tests/prompt-ui.test.tsx) | 49094 | `1A77FFFFAA34C20A9A553B7839AB05799D187FDE7603059DAD38FFF35F40527D` | 修改（新增 2 个用例 + 修正 1 处桩分支） |
| [services/prompt/store.ts](../../../services/prompt/store.ts) | 23468 | `A19144499060F1EBCBF0CE1A0B0161CCD76663B37DD36F179E9E14E833A540A6` | **未改**（与首轮返修一致） |
| [tests/prompt.test.ts](../../../tests/prompt.test.ts) | 28889 | `A05334DF093039A57C4714CE30448937EEE2A67F072E7679B53F5ADD6F37D4CC` | **未改** |
| [tests/b07-prompt-http.mjs](../../../tests/b07-prompt-http.mjs) | 51654 | `E3AC3ED2C10EBEE5DC2187AAB338E629E5DE7BAF8271ADCC5102B5B13F2B8D89` | **未改** |

`store.ts` 与 HTTP 脚本 SHA 与首轮返修完全一致，符合返修卡「产品仅 UI 改动且存储/backend SHA 保持本轮一致时，后续复验可复用本轮独立 HTTP 与损坏记录证据」的条件；**本轮没有重新运行 HTTP 与真实浏览器检查，也不声称那些检查在本轮重新跑过**。

## 3. F07-04 残留 / P2：查看历史时作废旧变量生成请求

**根因（与独立报告一致）**：`openVersion` 只递增 `historyRequest` 并释放 busy，不递增 `renderRequest`；同模板下 `selectionVersion` 也不变。`doRender` 的成功/失败分支只检查 `selectionVersion` 与 `renderRequest`，因此一个仍在途的 render 的 422（或 200）会写进历史只读视图，`previewMissing` 也会保留到返回当前之后。

**改动**（[PromptLibraryPage.tsx](../../../app/pages/PromptLibraryPage.tsx)）

- `openVersion`（[:362](../../../app/pages/PromptLibraryPage.tsx#L362)）在递增 `historyRequest` 的同时递增 `renderRequest`（[:367](../../../app/pages/PromptLibraryPage.tsx#L367)）——打开历史即退出生成上下文，在途 render 的成功、错误、缺值与复制结果一并失效（`setPreview/setPreviewMissing/setCopy/setError` 的清空原本已在）。
- `backToCurrent`（[:385](../../../app/pages/PromptLibraryPage.tsx#L385)）与 `startEdit`（[:190](../../../app/pages/PromptLibraryPage.tsx#L190)）各补一次 `renderRequest` 递增，把「视图切换 = 明确的有效操作身份」补全；busy 令牌所有权未动，旧 `finally` 仍不能解锁新请求，也没有用「只隐藏错误提示」的方式掩盖。

**测试**（[tests/prompt-ui.test.tsx](../../../tests/prompt-ui.test.tsx)）

`返修 F07-04 残留：同模板打开历史/返回当前都作废在途 render，错误与缺值不得回灌`

1. 甲当前版缺变量 → 点击「生成最终正文」，真实 422 被扣住 → 打开甲第 1 版（同模板，`selectionVersion` 不变）→ 释放：断言历史页不出现错误条、不出现任何缺变量提示，历史视图不被替换。
2. 返回当前后：断言旧错误与旧 `role="alert"` 的服务端缺值状态都没有回灌，而 `role="status"` 的实时缺变量提示仍按当前填写状态显示。
3. 在途 render 期间「打开历史 → 返回当前 → 释放」：断言错误与缺值状态同样不出现，随后填值重新生成能拿到 `请总结 华东。`（新上下文操作正常）。
4. 在途 render 期间进入新建：释放后新表单的人工输入不被清掉，旧 render 的错误不串到新表单。

**自测结果**：用例通过（`npm test` 计入 144/144）。

**反空转证据**（[B07-repair2-mutation-check.log](../B07-repair2-mutation-check.log)）：删掉 `openVersion` 里的 `renderRequest.current += 1;` → 该用例 `fail 1`，报 `迟到的生成错误不得盖到历史只读页上`，即独立验收报告的原症状；随后按字节还原。
另有两处如实记录：`backToCurrent` 与 `startEdit` 的递增在本轮用例下**未被检出**（A2/A3 仍 `fail 0`）。它们是纵深防御——`backToCurrent` 只可能从历史视图进入，而进入历史时 `openVersion` 已经作废了旧 render；`startEdit` 在 busy 期间按钮本就是 disabled。不作为本轮的可检出守卫声明。

## 4. F07-05 残留 / P1：并发新建的 requestId 与清理身份隔离

**根因（与独立报告一致）**：`inflightRequestId` 是**单一共享槽位**，`save` 的 `finally` 对任意旧 create 无条件把它清空。丁完成时清掉了戊占用的标记，`startCreate` 于是认不出当前 `requestId` 已被戊占用，己复用了戊的 id → 服务端按 `creation.requestId` 判重，返回真实 409 `REQUEST_ID_CONFLICT`（指向已落盘的戊 UUID），己的新建被阻断。后端拒绝冲突本身正确。

**改动**（[PromptLibraryPage.tsx](../../../app/pages/PromptLibraryPage.tsx)）

- 共享槽位改为**按 id 归属的占用集合**：`inflightRequestIds = useRef(new Set<string>())`（[:78](../../../app/pages/PromptLibraryPage.tsx#L78)）。
- 提交创建时只**添加自己的** id（[:223](../../../app/pages/PromptLibraryPage.tsx#L223)）；`finally` 只**删除自己的** id（[:249](../../../app/pages/PromptLibraryPage.tsx#L249)），旧请求再也无法清掉后一张表单的占用。
- `startCreate` 判定改为 `inflightRequestIds.current.has(requestId.current)`（[:186](../../../app/pages/PromptLibraryPage.tsx#L186)）：**只**在「当前 id 已被另一张在途表单认领」时换新 UUID；同一表单失败重试的 id 不在集合里，因此仍保持稳定，原 `creation.requestId` 幂等契约不变（`requestId.current = null` 仍在成功且归属校验通过之后才执行）。
- 已保存但被 UI 忽略的记录仍照常出现在列表（`refreshList` 在归属守卫之前调用，未改动）；已提交的旧操作不重复提交；没有清掉新表单输入。

**测试**（[tests/prompt-ui.test.tsx](../../../tests/prompt-ui.test.tsx)）

`返修 F07-05 残留：重叠新建各有独立 requestId，旧 finally 不得清掉后一张表单的占用`

按独立报告的实际时序：新建丁提交（真实 201 被扣）→ 新建戊提交（另一个真实 201 被扣）→ **只释放丁** → 新建己并保存。断言：丁/戊/己三次创建各用不同 requestId；己收到的是成功而不是 409（无错误条、表单正常关闭）；释放戊后不报错、不重复提交，且丁/戊/己三条记录都出现在列表里。为复现需要，桩里的创建分支按真实服务端语义实现（requestId 即记录 id；同 payload → `reused`；不同 payload → 409 `REQUEST_ID_CONFLICT`），并让创建成功的记录进入列表数据。

**自测结果**：用例通过。

**反空转证据**：把 `finally` 的 `delete(自己的 id)` 换回返修前的「清掉共享槽位」等价形式 `clear()` → 该用例 `fail 1`，报 `己不得复用戊仍在途的 requestId`（正是原缺陷）；再把 `startCreate` 的 `has(...)` 判定去掉 → `fail 1`，报 `两张新表单必须各自分配 requestId`。两次均按字节还原。

**顺带修正的自测缺陷（如实报告）**：UI 桩的列表分支此前是 `url.startsWith('/api/prompts?') || url === '/api/prompts'`，**没有判断方法**，于是 `POST /api/prompts` 一直被列表分支吞掉、返回列表体，创建分支实际是不可达的死代码——即旧 UI 用例从未真正走过「创建响应」这条路径。本轮加了 `method === 'GET'` 守卫后才真正生效。这不是产品缺陷（真实服务端行为正确，HTTP 脚本一直覆盖创建），但它意味着**依赖创建响应的 UI 断言此前是空转的**，后续复验应注意这一点。

## 5. 真实未运行项（如实列出）

1. **本轮未运行 HTTP 自测与真实浏览器检查**：两项残留都是 UI 并发身份缺陷，`store.ts`、HTTP 脚本、后端契约零改动。可复用首轮返修的独立 HTTP（11/11）、损坏记录（4/4）与本轮之前的真实浏览器证据；但**最终裁决必须由独立复验在真实浏览器里按返修卡的两个最小复现重新验证**（尤其丁/戊/己三表单重叠的时序）。
2. **独立验收本身未在本轮运行**：F07-04 / F07-05 两项在本报告中不标 CLOSED / PASS，状态仍为 OPEN。
3. **B04–B06 真实 Provider 阻塞**：沿用现状，未触碰、未解除。

## 6. 历史证据保护与隔离清理

`npm test` 会重写 [B04-http-evidence.json](B04-http-evidence.json) 与 [B04-repair3-merge-payload.json](B04-repair3-merge-payload.json)（[tests/llm-http.test.ts:19](../../../tests/llm-http.test.ts#L19)、[tests/llm-repair3.test.ts:26](../../../tests/llm-repair3.test.ts#L26)）。运行前已备份到隔离目录，运行后按字节还原：

| 文件 | 运行后 SHA256 |
| --- | --- |
| `docs/reports/B04-http-evidence.json` | `2B28D35E2B73A5A7AED00CD048DE5032D2FC1C74758A372FEA617EB380B89BCD` |
| `docs/reports/B04-repair3-merge-payload.json` | `F3A425DD5E9CB8A72CE28F4A257A938199E495950D1E4C1FD607A023CCFE36AF` |

两份 SHA 与 B06/B07 基线快照一致。**未覆盖**：`B07-acceptance-*`、`B07-repair1-*`、`B07-fix-card.md`、`B07-repair-build.md`、`docs/handoffs/B07-deepseek-prompt.md`、`B06-acceptance-*` 及 `B05-baseline/`、`B06-baseline/`、`B07-acceptance-baseline/`、`B07-repair1-acceptance-baseline/` 本轮零写入。

**隔离与清理**：临时脚本 `.tmp-b07-repair2-mutation.ps1`、模式文件 `.tmp-b07-repair2-patterns.txt`、页面备份与 B04 备份目录全部删除，仓库内 `.tmp-b07*` 已为空；4317 / 5173 无监听；本轮的临时数据目录已清空；`workspace/` 仍是原有 2 个文件、时间戳未变（2026/10/3、2026/10/4）。临时目录中此前的 `fmcg-b07-builder-*`、`fmcg-b07-independent-*` 属早前轮次，未擅自删除。

## 7. B08 接口兼容影响

- 冻结对外语义未变：路由与字段、错误契约、`baseVersion` 乐观锁与 409、版本全量快照、`relatedWikiIds` 松耦合、单次字面量替换、`creation.requestId` 创建重试幂等，全部保持。本轮唯一的错误码仍只有首轮新增的 `CORRUPT_PROMPT`。
- 改动全在页面内部状态（视图切换时的 render 代次、创建身份的归属集合），无对外接口变化。
- 服务端模块边界、存储格式与目录结构未变，`store.ts` SHA 不变，B08 可在冻结接口上继续推进。

## 8. 自测结论

- F07-04 残留、F07-05 残留**均已实现并自测通过**，各有能复现独立报告所述原因的受控时序用例；F07-05 的两条守卫与 F07-04 的主守卫经 mutation 验证非空转（`backToCurrent` / `startEdit` 两处如实记录为未被检出的纵深防御）。
- `npm run build`、`npm test`（144/144）通过；原有 142 项断言全部保留、未删改。
- 两项在本报告中**不标 CLOSED / PASS**，待独立复验在真实浏览器按两个最小复现关闭并裁决 B07 门禁。
- 本轮**未启动 B08**，未改 Raw/Wiki 产品逻辑，未改独立验收脚本与历史证据。

自测产物（`B07-repair2-*`）：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| [B07-repair2-build.log](../B07-repair2-build.log) | 407 | `5D371BAEB81AAF25EED4BB0359EFC62FA7F579C664280097BBF289E52FEEA5B9` |
| [B07-repair2-test.log](../B07-repair2-test.log) | 15136 | `AD425B829E932CA38441388AEDD434542382CF0D3C49C33D01FE70FFC326012F` |
| [B07-repair2-mutation-check.log](../B07-repair2-mutation-check.log) | 1306 | `294C08848DF9CD716115E815128EA8E54E684865F95ADC112902CEFC62348314` |

施工到此停止产品代码修改，交 Codex 主 Agent 独立复验。
