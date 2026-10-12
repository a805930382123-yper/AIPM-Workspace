# B07 返修施工报告（2026-10-07）

本报告由施工方撰写，对应 [B07 返修卡](B07-fix-card.md) 的六项 F07-01–06。**这是施工自测结论，不是独立验收**：六项在本报告中一律记为「已改 + 已自测」，CLOSED / PASS 只能由后一轮独立复验签出。本报告不覆盖 `B07-acceptance-*`、返修卡、冻结交接与旧验收报告，不改 Raw/Wiki 产品逻辑，不启动 B08。

- 冻结语义与范围沿用 [B07 冻结交接](../handoffs/B07-deepseek-prompt.md)。
- 独立失败报告：[B07-acceptance.md](B07-acceptance.md)。
- 本轮全部自测产物使用 `B07-repair-*` 前缀（见文末清单）。

## 1. 环境与执行

| 项 | 值 |
| --- | --- |
| 平台 | Windows 11，Node v25.2.1，`tsx` 运行时 |
| 构建 | `npm run build`（`tsc -b && vite build`） |
| 仓库测试 | `npm test`（`node --import tsx --import ./tests/support/css-stub.mjs --test tests/*.test.ts tests/*.test.tsx`） |
| HTTP 自测 | `tests/b07-prompt-http.mjs`（真实 Express + 真实文件系统 + 临时数据根） |
| 受控异步顺序 | `tests/prompt-ui.test.tsx` 内的 `harness.gate/release/waiting`：命中 gate 的请求挂起，`release` 后跑真实响应逻辑 |

变更文件与 SHA256（本轮结束时状态）：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| [app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx) | 40863 | `C220C23E507D16F8265CF9171FAD5C9514974A74895D7727ABD942C977BB66B1` |
| [services/prompt/store.ts](../../services/prompt/store.ts) | 23468 | `A19144499060F1EBCBF0CE1A0B0161CCD76663B37DD36F179E9E14E833A540A6` |
| [tests/prompt.test.ts](../../tests/prompt.test.ts) | 28889 | `A05334DF093039A57C4714CE30448937EEE2A67F072E7679B53F5ADD6F37D4CC` |
| [tests/prompt-ui.test.tsx](../../tests/prompt-ui.test.tsx) | 40032 | `6CEE8D71C3F4B0C85B2078EF1003BDC65E6504339637B8FC28EE4EA2F3520AA6` |
| [tests/b07-prompt-http.mjs](../../tests/b07-prompt-http.mjs) | 51654 | `E3AC3ED2C10EBEE5DC2187AAB338E629E5DE7BAF8271ADCC5102B5B13F2B8D89` |

未改动的产品模块（Raw / Wiki / 导出 / 服务器装配 / 错误契约实现）本轮零改动。

## 2. 六项逐项：变更、测试与证据

每项格式：**改动 → 针对性测试 → 自测结果 → 反空转证据（mutation）**。

### F07-01 / P2：损坏记录被计入有效数量

**改动**（[services/prompt/store.ts](../../services/prompt/store.ts)）

- 新增统一记录校验：`isText`、`isTextList`（[store.ts:73](../../services/prompt/store.ts#L73)）、`isPromptShape(value, id)`（[:88](../../services/prompt/store.ts#L88)）、`isVersionShape(value, id)`（[:100](../../services/prompt/store.ts#L100)）、`isStoredInput`（[:109](../../services/prompt/store.ts#L109)）、`isRecord(value, id)`（[:122](../../services/prompt/store.ts#L122)）。规则同时校验字段结构与**身份一致性**（文件名 id、`file.id`、`current.id` 三者一致），不再只靠文件名或 `current.id` 是否存在。
- 统计与列表共用同一规则：`countActivePrompts`（[:157](../../services/prompt/store.ts#L157)）与 `existingRecords`（[:219](../../services/prompt/store.ts#L219)）都只计入 `isRecord` 通过的记录。
- `read(id)` 对不可读 JSON 或不通过 `isRecord` 的记录抛出受控错误 `CORRUPT_PROMPT`（HTTP 500，`details.id`），消息含「已保留原文件」（[:197](../../services/prompt/store.ts#L197)、[:200](../../services/prompt/store.ts#L200)）。**不修改、不删除、不迁移**损坏实物。

**测试**

- [tests/prompt.test.ts:355](../../tests/prompt.test.ts#L355) `返修 F07-01：结构损坏或身份不一致的记录不计为有效，直接读取给出受控错误且文件保持原样`。构造两个有效 Prompt，再写入缺字段记录（`{id,current:{id},versions:[],creation:{}}`，记录 SHA）与合法 UUID 文件名但内部 id 不一致的完整记录，断言：`countActivePrompts === 2`、`getStats().promptCount === 2`、列表与分类计数只含两条有效；`store.get/getVersions` 对损坏记录抛 `CORRUPT_PROMPT`（500，`details.id`，消息匹配 `/已保留原文件/`）；两个损坏文件 SHA 前后不变且仍在文件集合内；`store.create(损坏 id, …)` 同样被拒且 SHA 不变；有效模板仍可读且 `renderVariables` 正确替换；临时/回收/普通 JSON 仍不充数。
- [tests/b07-prompt-http.mjs:627](../../tests/b07-prompt-http.mjs#L627) `F07-01 损坏记录不计入有效数量且读取受控失败`（真实 HTTP）：首页统计/列表/分类数不受影响；`GET /api/prompts/<id>`、`/versions`、`/export` 均返回 500 `CORRUPT_PROMPT` 且带 `details.id`；SHA 在重启前后一致；复用该 id 创建被拒且 SHA 不变；有效记录仍被计入；收尾只删本轮自建夹具。

**自测结果**：仓库测试该用例通过；HTTP 场景 PASS（570ms）。原失败现象（计数 10→11、详情 500 `prompt.relatedWikiIds is not iterable`）不再出现。

**反空转证据**：把 `isRecord` 的整体结构与身份规则换回返修前的浅规则（`file.id !== id` + 无条件 `return true`），`tests/prompt.test.ts` → `fail 1`，被 F07-01 抓到；随后 `store.ts` 按字节还原（与备份一致）。

### F07-02 / P1：变量改动后还能复制旧结果

**改动**（[app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx)）

- 预览改为**值签名 + 版本 + 模板 id** 三者绑定：`signatureOf(names, values)`（[:38](../../app/pages/PromptLibraryPage.tsx#L38)）生成值签名；`previewCurrent`（[:164](../../app/pages/PromptLibraryPage.tsx#L164)）要求 `preview.promptId === prompt.id && preview.version === prompt.version && preview.signature === signatureOf(variables, values)`。
- 可复制正文由 `previewCurrent` 推导（`finalBody`，[:166](../../app/pages/PromptLibraryPage.tsx#L166)）：无变量时用模板正文，有变量时**只有当前签名匹配**才给出 `preview.body`，否则为 `undefined`，复制按钮 `disabled={busy || finalBody === undefined}`。
- `updateValues`（[:314](../../app/pages/PromptLibraryPage.tsx#L314)）在任何变量改动时立即 `renderRequest.current += 1`、清空 preview / previewMissing / copy / error。在途 render 在成功与失败分支都核对代次与所用值，旧结果不能成为新输入的可复制结果。填充与复制不改动模板文件与版本。

**测试**

- [tests/prompt-ui.test.tsx:376](../../tests/prompt-ui.test.tsx#L376) `返修 F07-02：变量改动后旧渲染结果不能再作为本次结果复制`：甲填客户「华东 $& $1 {{业务流程}}」、流程「铺货 回访」，生成并复制取得旧文本；改客户为「华南新客户」后不重新生成，断言旧正文消失、复制按钮禁用、剪贴板未被再次写入；再重新生成，断言粘贴内容为新值；并在 render 在途时改值，释放后断言旧可复制预览不恢复；全程断言模板文件与版本号未因填值/复制变化。

**自测结果**：通过。原现象（改值后仍复制到「华东」并提示成功）不再出现。

**反空转证据**：同时移除 `updateValues` 的清理与 `previewCurrent` 的签名条件 → `fail 1`，被 F07-02 抓到（`改值后旧的本次最终正文必须消失`）。单删签名条件不会失败，因为 `updateValues` 也已清预览——两条守卫互为冗余，属有意设计，报告中如实记录。

### F07-03 / P2：历史响应串到另一模板

**改动**（[app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx)）

- `openVersion`（[:348](../../app/pages/PromptLibraryPage.tsx#L348)）在发起时捕获 `token = historyRequest.current` 与 `selectionAtOpen = selectionVersion.current`，并定义 `stale()`（[:358](../../app/pages/PromptLibraryPage.tsx#L358)）：`historyRequest.current !== token || selectionVersion.current !== selectionAtOpen`。
- 成功与失败分支都先判 `stale()`，迟到响应不写 detail / versions / error，不串标题、元数据、正文或错误消息。
- `selectId` 与 `backToCurrent`（[:369](../../app/pages/PromptLibraryPage.tsx#L369)）递增 `selectionVersion` / `historyRequest`，使切页、同模板不同版本、返回当前、新建与导航都令旧请求失效。

**测试**

- [tests/prompt-ui.test.tsx:432](../../tests/prompt-ui.test.tsx#L432) `返修 F07-03：延迟的历史版本响应不串页，也不覆盖新选择`：gate 挂起乙第 1 版的真实 200 响应，点乙第 1 版后切甲（甲当前详情出现）再释放，断言右侧不变成乙历史、标题/正文保持甲；再做同模板连续点两个历史版本、请求在途时返回当前与开始新建三类受控时序，断言迟到成功与迟到失败都不覆盖新选择。

**自测结果**：通过。原现象（左侧甲、右侧乙历史的串页）不再出现。

**反空转证据**：删除 `if (stale()) return;` → `fail 1`，被 F07-03 抓到（`迟到的历史响应不得打开历史视图`）。

### F07-04 / P1：render 后切模板导致操作永久禁用

**改动**（[app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx)）

- 加载态改为**按令牌归属**：`busyToken` 引用 + `beginBusy()`（[:85](../../app/pages/PromptLibraryPage.tsx#L85)）返回令牌、`endBusy(token)`（[:86](../../app/pages/PromptLibraryPage.tsx#L86)）仅在令牌仍是最新时才解锁、`releaseBusy()`（[:88](../../app/pages/PromptLibraryPage.tsx#L88)）无条件解锁并递增令牌。
- 退出旧选择即释放旧操作：`selectId`（[:91](../../app/pages/PromptLibraryPage.tsx#L91)）与 `startCreate`（[:170](../../app/pages/PromptLibraryPage.tsx#L170)）都递增 `selectionVersion` / `historyRequest` / `renderRequest` 并 `releaseBusy()`。
- render、保存、删除等操作各自捕获 `token = beginBusy()`，`finally { endBusy(token); }`——旧请求的 `finally` 因令牌已过期不会误解锁新操作；也不再用「单一 busy + 旧代次条件」组合出永久禁用态。

**测试**

- [tests/prompt-ui.test.tsx:504](../../tests/prompt-ui.test.tsx#L504) `返修 F07-04：迟到的 render 既不锁死新记录，也不误解锁新记录自己的请求`：gate 挂起甲 `POST /render` 的真实 200，生成后切乙再释放，断言乙的收藏、编辑、删除可用（原先三项均 false）；补测 render 失败路径、切页/新建/查看历史后的释放；再构造「新记录自己另有在途请求时旧响应到达」，断言旧响应不会错误解锁新请求。

**自测结果**：通过。原现象（刷新才能恢复的永久禁用）不再出现。

**反空转证据**：删除 `releaseBusy(); setSelectedId(id);` 与 `finally { endBusy(token); }` → `fail 1`，被 F07-04 抓到（`切换后乙的收藏/编辑/删除必须可用`）。

### F07-05 / P1：迟到保存响应清空新表单

**改动**（[app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx)）

- 提交时冻结归属：`formAtSave` / `baseAtSave` / `targetId` / `selectionAtSave` / `requestIdAtSave`（[:208](../../app/pages/PromptLibraryPage.tsx#L208)–[:213](../../app/pages/PromptLibraryPage.tsx#L213)），创建路径把 `requestIdAtSave` 同时记入 `inflightRequestId`（[:216](../../app/pages/PromptLibraryPage.tsx#L216)）。
- 响应只能更新**它所属的**表单/选择：创建与更新在清表单前必须先过 `if (selectionVersion.current !== selectionAtSave) return;`（[:222](../../app/pages/PromptLibraryPage.tsx#L222)、[:230](../../app/pages/PromptLibraryPage.tsx#L230)），成功提示同样受该守卫保护（[:238](../../app/pages/PromptLibraryPage.tsx#L238)）；冲突（409）与失败分支同样先判归属。
- 列表统计仍会刷新（`await refreshList(); onChanged();`），页面不再无条件清除另一份 form / baseVersion / requestId，也不把消息串到新表单。新建重试的 idempotency 保持原约定：`creation.requestId` 与 `inflightRequestId` 的语义未变，仅增加「谁有权清空」的归属判断。

**测试**

- [tests/prompt-ui.test.tsx:543](../../tests/prompt-ui.test.tsx#L543) `返修 F07-05：迟到的保存响应不得清空之后新建的表单`：甲编辑提交 PUT（gate 持有真实 200），点「新建 Prompt」并输入新名称与正文，释放甲响应后断言新表单与新输入仍在、不显示甲的「已保存为第 N 版」。
- [tests/prompt-ui.test.tsx:582](../../tests/prompt-ui.test.tsx#L582) `返修 F07-05：迟到的冲突响应不得把错误串到新表单`：迟到的 409 不得把冲突消息串到新表单，新表单的身份与请求 id 保持正确。
- 新建成功/失败、更新成功/失败/409 各自延迟 + 切其他模板或开始新建的组合都在上面两条用例的受控时序里覆盖；原 409 保留输入链路沿用既有断言，未被删改。

**自测结果**：通过。原现象（人工输入丢失、串到甲第 4 版）不再出现。

**反空转证据**：删除 `if (selectionVersion.current !== selectionAtSave) return;` 与随后的 `setForm(null); setBaseVersion(null);` → `fail 1`，被 F07-05 抓到。

### F07-06 / P2：旧搜索覆盖当前筛选

**改动**（[app/pages/PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx)）

- 列表查询按**条件快照 + 代次**守卫：`conditionsRef`（[:76](../../app/pages/PromptLibraryPage.tsx#L76)、[:79](../../app/pages/PromptLibraryPage.tsx#L79)）在每次渲染同步最新条件；`refreshList`（[:109](../../app/pages/PromptLibraryPage.tsx#L109)）先 `listRequest.current += 1` 取 `token`，请求用快照条件，返回后 `if (listRequest.current !== token) return null;` 才写 `items` / `categoryCounts`，并由调用方决定是否更新选择。
- 保存、收藏、删除触发的刷新走同一函数，因此自动尊重最新条件；失败响应同样不写状态。
- 清空查询恢复、连续筛选不误清当前新建/编辑、分类数量仍是全库真实有效计数（`categoryCounts` 由服务端按有效记录计算，与筛选条件无关）。

**测试**

- [tests/prompt-ui.test.tsx:605](../../tests/prompt-ui.test.tsx#L605) `返修 F07-06：迟到的旧查询响应不覆盖当前筛选，也不误清新建表单`：gate 挂起 `q=B07模板乙`，随后输入「浏览器」（新查询立即返回并显示甲），释放旧查询后断言搜索框仍为「浏览器」、列表仍是甲、未变成乙；并覆盖旧查询失败响应、清空查询、连续筛选与「筛选期间正在新建/编辑」不误清；断言分类数量不随查询条件变化。

**自测结果**：通过。原现象（搜索框「浏览器」但列表变成乙）不再出现。

**反空转证据**：删除 `if (listRequest.current !== token) return null;` → `fail 1`，被 F07-06 抓到（`迟到的旧查询不得覆盖当前列表`）。

Mutation 完整记录见 [B07-repair-mutation-check.log](B07-repair-mutation-check.log)（基线 `pass 11, fail 0`；六项各自 `fail 1` 且被抓到的用例就是本项目对应的 F07-0X；每次变更后按字节还原，页面 SHA 仍为 `C220C23E…BB66B1`，`store.ts` 与备份一致）。

## 3. 全量回归结果

| 检查 | 结果 | 产物 |
| --- | --- | --- |
| `npm run build` | PASS（44 modules，921ms；`tsc -b` 含测试类型检查） | [B07-repair-build.log](B07-repair-build.log) |
| `npm test` | **142 / 142 pass，fail 0**（135 原有 + 7 新增） | [B07-repair-test.log](B07-repair-test.log) |
| `node --import tsx tests/b07-prompt-http.mjs` | **12 PASS / 0 FAIL / 1 NOT_RUN**（3145ms） | [B07-repair-http.log](B07-repair-http.log)、[B07-repair-http-evidence.json](B07-repair-http-evidence.json) |

HTTP 自测保持有效的能力组：E07-01 记录与校验、E07-02 列表与中文搜索、E07-03 版本历史、E07-04 并发冲突与创建重试、E07-05 变量提取与填充、E07-07 删除与回收、E07-08 与知识库松耦合、E07-09 Markdown 导出、E07-10 磁盘故障注入与恢复（EIO）、E07-11 首页数量与知识日志隔离、E07-12 无 LLM 可用与既有入口回归，另加本轮 **F07-01**。真实一次替换/粘贴、版本全量快照与原子提交、Wiki 松耦合、导出、删除/重启、知识隔离均仍通过。

存储层改动（`store.ts`）后的复查：有效读取（E07-01/E07-02/F07-01）、版本（E07-03）、创建幂等与并发 409（E07-04）、故障原子性（E07-10）全部通过；损坏记录路径新增受控错误而非 500 崩溃（F07-01）。

## 4. 真实未运行项（如实列出）

1. **E07-06 真实浏览器复制/粘贴**：本机没有可由脚本驱动的真实浏览器，本轮不执行剪贴板实测。UI 层分支（未填变量阻止复制、剪贴板失败提示、改值后不可复制）由 `tests/prompt-ui.test.tsx` 用**桩**验证，**不是真实剪贴板证据，不能替代**。留待 Codex 主 Agent 用真实浏览器独立复验。
2. **独立验收本身未在本轮运行**：本报告只写施工自测结论，不代签 CLOSED / PASS，六项状态仍为 OPEN，待独立复验关闭。
3. **B04–B06 真实 Provider 阻塞**：沿用现状，本轮未触碰、未解除。

## 5. 历史证据保护与隔离清理

**历史自测输出**：仓库测试会重写 [docs/reports/B04-http-evidence.json](B04-http-evidence.json) 与 [docs/reports/B04-repair3-merge-payload.json](B04-repair3-merge-payload.json)（[tests/llm-http.test.ts:19](../../tests/llm-http.test.ts#L19)、[tests/llm-repair3.test.ts:26](../../tests/llm-repair3.test.ts#L26)）。运行前已备份，运行后按字节还原，SHA 与冻结基线一致：

| 文件 | 运行后 SHA256 | 与 B06/B07 基线快照 |
| --- | --- | --- |
| `docs/reports/B04-http-evidence.json` | `2B28D35E2B73A5A7AED00CD048DE5032D2FC1C74758A372FEA617EB380B89BCD` | 一致 |
| `docs/reports/B04-repair3-merge-payload.json` | `F3A425DD5E9CB8A72CE28F4A257A938199E495950D1E4C1FD607A023CCFE36AF` | 一致 |

HTTP 自测脚本默认写 `B07-builder-http-evidence.json`，本轮先备份、运行后还原为该文件原 SHA `03F5EB78A82987FAEFCAB6A908338BE5BEC54F9CDA407DF4E269754CD8024F9E`，本轮输出另存为 [B07-repair-http-evidence.json](B07-repair-http-evidence.json)（SHA `5BA45DCA507B20463535C6AF0B19D2B2124F7ED53F189F12DC64352EB71E89FC`）。注意 [B07-repair-http.log](B07-repair-http.log) 末行按脚本原样打印默认证据路径，实际证据以 `B07-repair-http-evidence.json` 为准。

**未覆盖**：`B07-acceptance-*`、`B07-fix-card.md`、`B07-build.md`、`docs/handoffs/B07-deepseek-prompt.md`、`B06-acceptance-*`、`B05-baseline/`、`B06-baseline/`、`B07-acceptance-baseline/` 本轮零写入（时间戳仍为各自原始时间）。

**隔离与清理**：

- 本轮两个临时数据根 `fmcg-b07-builder-2LiluH`、`fmcg-b07-builder-WileUv` 及临时备份目录 `fmcg-b07-repair-b04-backup`（内容与仓库内 `B07-build-b04-*-backup.json` 逐字节相同，属冗余）均已删除。
- 临时脚本 `.tmp-b07-repair-*.ps1` 已删除，仓库内无残留（`Get-ChildItem -Filter '.tmp-b07*'` 为空）。
- 4317 / 5173 端口无监听；仓库内无本轮遗留进程。
- 临时目录中另有 `fmcg-b07-builder-*`（8 个）与 `fmcg-b07-independent-*`（2 个）为**此前轮次**（施工 `B07-build.md` 与独立验收）留下的数据根，不属于本轮，未擅自删除。
- 正式用户资料未触碰：`workspace/` 仍为原有 2 个文件且时间戳未变。

## 6. B08 接口兼容影响

- 冻结对外语义**未变**：HTTP 路由与响应字段、错误契约 `{error:{code,message,details?}}`、`baseVersion` 乐观锁与 409 `VERSION_CONFLICT`、版本全量不可变快照、`relatedWikiIds` 松耦合、单次字面量变量替换、`creation.requestId` 创建重试幂等，全部保持。
- 唯一新增的对外可见错误码是 `CORRUPT_PROMPT`（500，`details.id`）：这是 F07-01 要求的「直接读损坏记录给明确受控错误」，取代原先的 500 `INTERNAL_ERROR`。合规记录不受影响，客户端应将其视为记录级损坏提示。
- UI 侧改动均为页面内部状态管理（`PromptDetail` 的入参由 `preview` 更名并改为 `finalBody`），属同仓库内部组件，不构成对外接口。
- 服务端模块边界、存储文件格式与目录结构未变，B08 可在冻结接口上继续推进。

## 7. 自测结论

- 六项 F07-01–06 **均已实现并自测通过**，每项都有对应的针对性回归测试（含受控异步顺序），且经 mutation 验证非空转；`npm run build`、`npm test`、HTTP 十组能力全绿。
- 六项在本报告中**一律不标 CLOSED / PASS**，其状态仍为 OPEN；真正关闭取决于后一轮独立复验（含真实浏览器 E07-06）。
- 本轮**未启动 B08**，未改 Raw/Wiki 产品逻辑，未删旧断言、未改写独立证据。

自测产物清单（`B07-repair-*`）：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| [B07-repair-build.log](B07-repair-build.log) | 407 | `0F1A0269FF6ED45CE8B99AF1760BAB79585340280E17E11505D8526AB74E7FBA` |
| [B07-repair-test.log](B07-repair-test.log) | 14880 | `BE232CDD526C5AF9A030A84753F1B2C6C60ACAE13E6ECB522922A497B05F862A` |
| [B07-repair-http.log](B07-repair-http.log) | 1150 | `CACB0129F75ED9C4ABFAB55BB817269E3046B4049DA46816ECB11ACF7A3BF588` |
| [B07-repair-http-evidence.json](B07-repair-http-evidence.json) | 6371 | `5BA45DCA507B20463535C6AF0B19D2B2124F7ED53F189F12DC64352EB71E89FC` |
| [B07-repair-mutation-check.log](B07-repair-mutation-check.log) | 2360 | `867F5E1078786866BF48461E6FC75F0C924045908CE32F16CEA166C82D341BE9` |

施工到此停止产品代码修改，交 Codex 主 Agent 独立复验。
