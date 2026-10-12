# B03 返修报告（2026-10-05）

状态：**返修完成，待独立复验**（本报告不签署 B03 PASS，不修改 `docs/status.md`、批次卡、验收标准或任何独立验收证据；本次未进入 B04）。

- 依据：[B03 最小返修卡](B03-fix-card.md)；独立验收结论：[B03-acceptance.md](B03-acceptance.md)（FAIL，4 项缺陷）；浏览器证据：[B03-browser-independent.md](B03-browser-independent.md)。
- 范围：只修复 F03-01（部分提交仍报成功）、F03-02（Node 最低版本声明）、F03-03（重导入合并标签）、F03-04（文件成功后关闭结果不刷新），并对受影响行为与关键回归复验。
- 角色：施工方（DeepSeek V4.1 Flash）。未调用 Codex 或其它开发协作 Agent；产品运行仍独立于开发 harness。

---

## 1. 逐项返修

### F03-01 部分提交不再报告导入成功，并可恢复/安全补偿

**根因**：`server/raw-import.ts` 在创建 Raw 之后单独写「原件 ↔ Raw」关联记录；该次写入失败被 `catch` 吞掉，只作为 `warnings` 返回，HTTP 仍是 `201`，界面固定渲染「导入成功」。重启后 asset 记录停在 `status=stored`，缺 `rawId/parser/extractionNote`，没有恢复机制。

**修复**（三层，缺一不可）：

1. **接口契约**：关联写入失败改为抛出 `InputError('IMPORT_LINK_PENDING', …, 500)`，`details` 带实际已提交的 `rawId`、`assetId`、`fileName`、`byteSize`、`sha256`、`format`、`committed=true`、`recoverable=true`、`cause`，以及已提交的完整 `raw` 记录。文案明确「正文已写入正式 Raw」「原件已保留」并提示「请不要重复导入同一文件」「下次启动会自动补齐该关联」，不再出现「未创建 Raw」。
2. **启动对账（关联恢复 / 安全补偿）**：新增 `AssetStore.reconcile(store.list())`，在 `server/index.ts` 每次启动时执行且不抛错：
   - `stored` 且存在 `assetId` 指向它的已提交 Raw → 补齐 `status=parsed` 与 `rawId/format/parser/extractionNote`（`parser`/`extractionNote` 来自 Raw frontmatter，新增 `extractionParser` 字段）；
   - `stored` 但没有对应 Raw（导入中断在 Raw 落盘之前）→ 安全补偿为 `parse_failed` + `IMPORT_INTERRUPTED`，原件保留，不创建 Raw；
   - `parsed` 但 `rawId` 已不存在（删除时标记失败）→ 置为 `detached`；
   - 单条记录读写失败只计入 `failed` 并继续其它记录；`AssetStore.list()` 也改为跳过被目录/损坏文件占位的记录，一条坏记录不再让整个原件列表 500。
3. **界面**：`IMPORT_LINK_PENDING` 渲染独立的「部分提交：正文已入库，原件关联待恢复」面板（展示 Raw ID、asset ID、原件信息、失败原因、恢复说明、`重启工作台自动对账`），不再显示任何成功文案；出现该错误时立即把已提交的 Raw 同步进列表与统计，并提供「查看已创建的 Raw」。

**复验**：

- HTTP（真实跨文件故障，逐字复刻验收步骤）：观察 `<assetId>.json` 首次写入后把它改名为备份、用同名目录占位 → 导入响应 `500 IMPORT_LINK_PENDING`（`details.committed=true`、`recoverable=true`、含真实 `rawId`/`assetId`，消息含「正文已写入正式 Raw」「不要重复导入」「自动补齐」且不含「未创建 Raw」）；已提交 Raw 可 `GET`，其 `assetId` 与故障 asset 一致；故障 asset 此时为 `stored`。**解除故障并重启同一数据目录**后：asset 变为 `parsed`，`rawId` 正确，`parser=pdfjs-dist 6.4.299`，`extractionNote` 与 Raw frontmatter 完全一致，`format` 一致；Raw 计数不变（对账不新增/不删除 Raw），原件字节仍与源文件逐字节相等；随后重新导入同一文件仍生成新的 Raw ID，不覆盖已提交记录。证据见 `B03-api-evidence.json` 的 `B03-23`（`beforeRestart: stored` → `afterRestart: parsed`）。
- 单元（`tests/import.test.ts`）：`markParsed` 失败时返回 `500 IMPORT_LINK_PENDING` 且 Raw 确实已提交、原件哈希一致、消息不称「未创建 Raw」；对账三分支（补齐/补偿/分离）与「一条记录被目录阻断不影响其余」；对账幂等（第二次运行为 0/0/0）。
- DOM 交互（`tests/ui-interaction.test.tsx`）：部分提交时界面不含「导入成功」，含「部分提交…待恢复」「IMPORT_LINK_PENDING」「请不要重复导入同一文件」「重启工作台自动对账」、Raw ID 与 asset ID，且新 Raw 已在列表中；关联正常写入时不出现待恢复面板。
- 关键回归：四格式真实导入（E03-01 等价）、九类解析失败、超限、重复导入、删除与引用、重启一致性、B02 搜索/导出均继续通过（第 5 节）。

### F03-02 Node 最低版本声明与依赖一致

**根因**：README 声明「Node.js 20 或更高」，但锁定的 `pdfjs-dist 6.4.299` 的 `engines.node` 为 `>=22.13.0 || >=24`；`package.json` 没有 `engines`；本机只实测过 Node v25.2.1。

**修复**：`package.json` 增加 `"engines": { "node": ">=22.13.0" }`（所有运行依赖要求的交集，`pdfjs-dist` 是约束来源：vite `^18||^20||>=22`、multer `>=10.16`、mammoth `>=12`、express `>=18`、tsx `>=18` 都更宽）；README 改为「需要 Node.js 22.13 或更高版本（**下限由锁定的 `pdfjs-dist 6.4.299` 的 `engines.node` 决定**）」，写明下限来源、**实际验证环境为 Node v25.2.1 / Windows**、Node 22.13–24 未实测不声称通过，并注明仅开发测试用的 `jsdom` 声明 22.13.x 或 ≥24（Node 23.x 只会打印 engines 警告，不影响运行）。

**复验**：`B03-22-node-minimum-consistent-with-locked-dependencies` 断言 `package.json.engines.node === '>=22.13.0'`、README 不再出现「Node.js 20 或更高」、README 同时包含「Node.js 22.13 或更高」与锁定版本 `6.4.299`、声明下限不低于依赖要求、README 含有 `Node vX.Y.Z` 形式的实测版本（本轮 `v25.2.1`，与运行本次检查的进程一致），并在该 Node 上真实上传 PDF 得到 `parser=pdfjs-dist 6.4.299` 与正确正文。

### F03-03 重新导入不再合并标签

**根因**：`RawPage.tsx` 预填用 `prefill.tags.join('、')`，而 `parseTags` 只按中英文逗号切分，顿号既用于展示又不被解析，导致未编辑的两个标签在保存时变成一项；输入示例同样使用顿号。

**修复**：
- 分隔符规则统一为 `/[，,、;；]+/`，展示（`tagsText`）、输入提示、解析共用同一规则；
- 保留原始标签数组：表单持有 `tagsTouched` 标记，**未经编辑**时提交原数组，编辑后按统一规则解析；
- 提示改为「分隔符：中文/英文逗号、顿号、分号 · 当前 N 项（未修改，按原标签保存）」，实时显示识别到的数量，示例也用合法的顿号写法。

**复验**：DOM 交互测试——重导入不编辑标签、只填新正文，提交到 `POST /api/raw` 的 `tags` 仍为 `["渠道","库存"]`；编辑为 `渠道,库存、动销；SKU` 时识别为 4 项并提交 `["渠道","库存","动销","SKU"]`；静态渲染断言提示文案与「未修改，按原标签保存」。旧资料不变由既有 `tests/import.test.ts`「重新导入：创建新 ID 的 Raw，旧记录与旧原件保持不变」覆盖（旧 Raw 文件哈希前后相等，即旧正文与旧标签均未被改写）。

### F03-04 文件导入成功后列表与统计立即同步

**根因**：`ImportDialog` 文件分支只 `setResult`，仅「查看这条资料」调用父组件回调；关闭/右上角关闭/继续导入都只改对话框本地状态，父组件列表与首页统计保持旧值，需刷新页面才正确。

**修复**：把「数据同步」与「结果展示/导航」分离。文件上传成功后立即 `await onCommitted(raw)`（父组件去重后加入列表并 `refresh()` 重新拉取列表与统计），随后才渲染结果面板；关闭、右上角关闭、继续导入、查看、重新导入都建立在已同步的数据之上。`onCommitted` 以 ID 去重，重复调用不会重复添加；粘贴分支同样只同步一次并打开新资料。

**复验**（DOM 交互测试，真实 React 组件 + jsdom，仅 stub `fetch`）：
- 成功面板出现时列表已包含新资料；点「关闭」后对话框消失、列表仍有新资料、未再次上传、服务端状态只有一条；
- 点「继续导入下一条」回到表单且列表仍包含新资料、上传请求仍只有一次；
- 点右上角「×」同样保持同步；
- 点「查看这条资料」关闭对话框并打开新资料，切到首页后统计卡数值包含新 Raw（`2`）。

---

## 2. 前次验收未覆盖项的补验

| 项目（原 NOT_RUN） | 本轮处理 | 结论 |
|---|---|---|
| 无引用最终确认删除（浏览器） | DOM 交互测试：真实点击「删除」→ 检查引用 → 点「确认删除」→ 对话框关闭、调用 `DELETE /api/raw/:id`、列表同步为空；被正式 Wiki 引用时显示引用页并禁用确认按钮，Raw 不被删除。HTTP 层另由 `B03-15`/`B03-14` 覆盖。 | DOM 层 PASS；**真实浏览器仍 NOT_RUN** |
| 前端超限文件拦截（浏览器） | DOM 交互测试：选择 20 MiB+1 的文件后立即显示 `FILE_TOO_LARGE` 与「工作台不会上传它」，提交时**零**上传请求。 | DOM 层 PASS；**真实浏览器仍 NOT_RUN** |
| F03-03/F03-04 的浏览器复现 | 同根因路径已用 DOM 交互测试覆盖（标签、关闭、继续导入、右上角关闭、查看、首页计数）。 | DOM 层 PASS；**真实浏览器仍 NOT_RUN** |

本回合**没有浏览器工具**，因此不声称上述 UI 已在真实浏览器中通过；DOM 交互测试使用真实的 React 组件与真实事件流，只把 `fetch` 替换为内存 stub（同一端点的真实 HTTP 行为由第 5 节的隔离服务实测覆盖）。

### 2.1 施工方复现独立验收脚本的断言（不代替独立复验）

为确认返修满足独立验收脚本的**原有断言**（不改脚本、不改断言、不降低标准），施工方在临时副本上重放了 `tests/acceptance/b03-independent-http.mjs`：副本与原件逐字节相同，**只把证据输出路径重定向到临时目录**（`%TEMP%\b03-independent-check\`），避免占用独立验收的证据命名空间；运行目录仍为项目根目录。

结果：**14 PASS / 0 FAIL / 0 BLOCKED**（返修前的两次运行为 12 PASS / 2 FAIL、1 PASS / 2 FAIL）。其中：

- `E03-12-cross-file-association-write-failure-no-success` → PASS：真实跨文件故障下返回 `500 IMPORT_LINK_PENDING`，`details.committed=true`、`details.recoverable=true`，并带真实 `rawId`/`assetId`（`server/raw-import.ts` 文案含「正文已写入正式 Raw」「原件已保留」与恢复提示，不含「未创建 Raw」）。
- `E03-13-readme-node-minimum-vs-installed-pdfjs` → PASS：README 不再包含「Node.js 20 或更高」，`package.json.engines.node = ">=22.13.0"`。
- `FROZEN-VERSION` → PASS（运行前后 25 个产品文件指纹一致）。
- 其余 11 项业务检查（四格式、BOM/空白、失败矩阵、边界、元数据、混合 PDF、两类持久化失败、引用/删除/重导入、并发、重启）继续 PASS。

证据：`docs/reports/B03-fix-independent-replay.json`（`4bc42e7e…`）。该文件是**施工自检证据**：它证明原脚本的断言在返修版上成立，但**不是**独立验收结论——独立复验仍需由验收方在自己的环境中运行原脚本（第 8 节）。

顺带修正：本轮发现 README 的 Node 声明曾写成 `需要 **Node.js 22.13 或更高版本**`，会让独立脚本用于记录声明的正则 `/需要 Node\.js[^\n]+/` 取不到匹配而抛错；已改为纯文本 `需要 Node.js 22.13 或更高版本`（加粗移到从句），使文档措辞与既有断言兼容。

---

## 3. 本轮变更文件与最终 SHA-256

新增（A）/ 修改（M）：

| 文件 | 类型 | SHA-256 |
|---|---|---|
| app/api.ts | M | `37ea609182b6c4b4674961a41ec24aa17ba0ea4127c09cfbb4035cdce9d9625a` |
| app/App.tsx | M | `acb0bc4f1ee5b4f99bea65b53d73829ef260b5e3d52abaf4df1ec1180d725fea` |
| app/pages/RawPage.tsx | M | `fd1e5b2d29be992f64b41253298044cd8ffae5a5a8831cdf353464ead80343f1` |
| server/index.ts | M | `90350c0cd44b19ed2551f80bffe19f765f4de134f193eb23476d9a572e59dd9c` |
| server/raw-import.ts | M | `425ce9e785b67fd07b9604402ffea8fbb96a765513682d5fae0a8b0a2365234d` |
| services/raw/assets.ts | M | `79459e525b1fdf92ac460ed8a8b0212b2c14d0ff78354b734a5b466370dd3861` |
| services/raw/store.ts | M | `a6d10185f7a9a61dc765c31740b57c2115afb51275be3784f81791d7c2719937` |
| README.md | M | `957b20047ceb27dc88cc7280541aa67d7ffbaece1a21b855a3fcc46237a6cdd8` |
| package.json | M | `e5645495a8ee4795492494cafbd44f35e144049637424830edec32af1f4e3380` |
| package-lock.json | M | `b40e9e8ab792a7d84ce0448bc6f6942e7c1b3c1bb9822feb1f4c87ebc9277d43` |
| tests/import.test.ts | M | `fec223789ef003f2b7c8597a747d1caf1760e25db4ef5e6915ff9e027932b19e` |
| tests/ui.test.tsx | M | `a67f5d85ed08c3928ee8389c8178570fa44dd3129bc8e035886a57d80f2ab9c0` |
| tests/ui-interaction.test.tsx | A | `fce08891f235831e0c7ee7ba27dadc71d7f27b1c4d73261934317357d91c5df4` |
| tests/support/css-stub.mjs | A | `4181e61cd726993d0339245be5f537989d9b95230e1d8f258fcfd4f9cb48ac50` |
| tests/support/css-stub-hooks.mjs | A | `30e448e7efe8e7efaae5af342be68f97a1ead3f86985a4b000ce2d7a7254a3a4` |
| tests/acceptance/b03-http.mjs | M | `bc35f26b7c46f0afb3139fd3dc8345aebaff860f5b048c250e22e902d8344405` |
| docs/reports/B03-api-2026-10-05T10-36-46-840Z.json | A | `30e57d93f36798772ef111bdf9788016b90ad31c9012c13a919586e2c4e3df06` |
| docs/reports/B03-api-evidence.json | A | `30e57d93f36798772ef111bdf9788016b90ad31c9012c13a919586e2c4e3df06` |
| docs/reports/B03-fix-independent-replay.json | A | `4bc42e7e81ea7044960e67aa64f31cb46084883179ccbd82c1e65dd57af0e023` |

说明：

- 最后两行是**最终冻结版本**的证据：`B03-api-evidence.json`（施工自检 23/23 PASS，等同 `B03-api-2026-10-05T10-36-46-840Z.json`）与 `B03-fix-independent-replay.json`（施工方对独立验收脚本断言的复现，14/14 PASS，见第 2 节）。本轮中间运行归档（保留以便复核）：`B03-api-2026-10-05T10-30-55-340Z.json`（22 PASS / 1 FAIL，`43b61548…`，自检对提取说明的断言过严，已改为与 Raw frontmatter 精确比对）、`B03-api-2026-10-05T10-31-10-747Z.json`（23 PASS，`5c5bc07f…`）、`B03-api-2026-10-05T10-33-02-057Z.json`（23 PASS，`f58c975c…`，UI 用例扩展前）、`B03-api-2026-10-05T10-33-56-298Z.json`（23 PASS，`7385c846…`）、`B03-api-2026-10-05T10-34-51-563Z.json`（23 PASS，`bfbf8442…`，README 措辞调整前）。
- `package.json` 本轮改动：新增 `engines.node`、`test` 脚本增加 CSS stub loader、新增 devDependencies `jsdom` 与 `@types/jsdom`；`package-lock.json` 同步。
- `docs/reports/B03-build.md` 是首次施工报告，其指纹表描述**返修前**版本，未修改（保持历史证据原样）。
- 本报告自身不列入指纹表。

## 4. 本轮未改动文件（供独立复验核对）

| 文件 | SHA-256 |
|---|---|
| docs/status.md | `9dede3ae356f8617054fbd786b70ab567f22cdc72d7ce3386960d62c8026e7e0` |
| docs/acceptance.md | `f1e26007af646a1b4dabcc68d4e2b70cbdf6c4ce0afff01e7b34e28a2bc1a95` |
| docs/batches/B03.md | `3ce137a7d99b054be8b09d507c4a10de509a4690cfb4cc0d7e3bc71265a461e0` |
| docs/reports/B03-acceptance.md | `01c77d5aa786b1099829ac1a943401c056929254d6c7fa465ebd779587f139d1` |
| docs/reports/B03-fix-card.md | `4efda1a9c447a6278eff6fcba9eb6e6f929d5b474d818dfb94cf3bdc9c2c0a48` |
| docs/reports/B03-browser-independent.md | `20af181541200705c456ea19a68a402ef79c80641c250ea8f502fd1dc9042c16` |
| tests/acceptance/b03-independent-http.mjs | `892f7bfc83f68c82b9c14cb278f1d467082e185c9d6274fdcfb0df8dc423512f` |
| app/raw.css | `88a1eab682566ba68839c9a8bafd9c9c7befb59ba4f844805deb47a103b5dfbc` |
| server/validation.ts | `a05f077a6e578ee417fefd6e3f5aa37bd3a9789daa4f4f01c2fc2803e35eed48` |
| services/raw/limits.ts | `22e62af61a8cf445962c154ef64a39caf3eb48cca873dc59396c8d0739da4537` |
| services/raw/parse.ts | `92545e34e614ce629d60974482cc081ef7a21036d7aac430d1f1e2d8a16cb229` |
| services/wiki/store.ts | `64429e98068cc23fa4a0774e6aa62405c17cc912647f944b007d7060a0e48aa8` |
| tests/raw.test.ts | `7525c333ec11da7ef97e95f426318280825ec9333dd06654998a6d66c29722ef` |
| tests/wiki.test.ts | `2dc605f93abc212587a5f6c0cc84e16d73d59c5e17903605894770b2c4e6d883` |

未修改任何独立验收报告/脚本/证据、验收标准、规划与状态文件、B01/B02 历史证据；未降低任何既有断言（既有 14 项 B01/B02 单测与全部 HTTP 断言保持不变，只新增更严格的断言）。正式 `workspace/` 用户数据未被读写。

## 5. 实际执行的命令与结果

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npm run build` | 通过（`tsc -b` 无错；vite 36 modules，`dist/assets/index-CQkk3eQh.js` 270.48 kB、`index-7KHxRmYG.css` 26.39 kB） |
| 2 | `npm test` | **46/46 PASS**（既有 14 + B03 导入 18 + UI 渲染 5 + DOM 交互 9） |
| 3 | `node tests/acceptance/b03-http.mjs` | **23/23 PASS**，自建于 `%TEMP%\fmcg-b03-selfcheck-*` 的隔离数据目录与随机回环端口；运行前后产品指纹一致（无 FROZEN-VERSION 告警） |
| 4 | 新增/变化的复验 | `B03-22`（Node 版本一致性）、`B03-23`（跨文件关联失败→重启恢复）；`B03-01`–`B03-21` 全部继续 PASS |
| 5 | 重放独立验收脚本的断言（临时副本，仅重定向证据输出路径） | **14/14 PASS**（返修前 12 PASS / 2 FAIL），含 E03-12、E03-13 与 FROZEN-VERSION；证据 `docs/reports/B03-fix-independent-replay.json` |

`npm test` 现由 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/*.test.ts tests/*.test.tsx` 执行：`css-stub` 只是一个测试用 loader，把组件的 CSS 导入解析为空模块，让 DOM 交互测试可以导入真实组件树；产品构建路径不经过它。

## 6. 证据路径

- 施工侧 HTTP/文件证据：`docs/reports/B03-api-evidence.json`（= `docs/reports/B03-api-2026-10-05T10-36-46-840Z.json`），含每个检查的断言细节与 39 个产品文件的冻结指纹。
- 独立验收脚本断言的施工侧重放：`docs/reports/B03-fix-independent-replay.json`（14/14 PASS）。
- 施工单元/DOM 证据：`tests/import.test.ts`（F03-01 契约与对账）、`tests/ui-interaction.test.tsx`（F03-03/F03-04/F03-01-UI/删除确认/超限拦截）、`tests/ui.test.tsx`（渲染契约与提示文案）。
- 隔离数据目录（保留可复查）：`%TEMP%\fmcg-b03-selfcheck-*`。

## 7. 已知限制与剩余风险

1. 无浏览器工具：真实浏览器中的重导入、结果关闭/继续导入、确认删除与超限拦截仍未运行（NOT_RUN），交独立复验在浏览器中补齐；DOM 交互测试不能替代真实浏览器。
2. Node 22.13–24 未实测：声明下限来自依赖 `engines` 的交集，不是实测结论；Node 23.x 上 `jsdom`（仅开发依赖）会打印 engines 警告。
3. 启动对账只处理三类可判定状态（`stored` 有/无对应 Raw、`parsed` 但 Raw 已删）；若 asset JSON 本身被目录长期占位，该条记录在列表中不可见（已确保不使整体列表失败），原件字节仍在磁盘，解除占位后对账即可修复。
4. `IMPORT_LINK_PENDING` 使用 500（与 Wiki 派生文件失败的既有约定一致）：语义是「已提交但未完成」而非「未发生」，界面据此区分；调用方不应把 500 一律当作「没有写入任何东西」。
5. 删除仍为不可撤销（本批约定），原件只增不删；`knowledge/raw/assets/` 需要人工或后续批次清理。
6. 本报告不判定 B03 PASS；`docs/status.md` 的 B03 状态仍为 FAIL，等待独立复验结论。
7. 第 2.1 节的独立脚本重放由施工方执行，只用于自检；`E03-12` 在脚本中只断言「非 201」，重启后的关联补齐由脚本记录、由施工方的 `B03-23` 断言（`stored` → `parsed` + `rawId/parser/extractionNote` + Raw 计数不变 + 原件字节不变）。

## 8. 供 Sol 独立复验的最短步骤

```powershell
# 0) 依赖、构建、单测（冻结版本，勿在运行中改文件）
npm install
npm run build                             # 期望 exit 0
npm test                                  # 期望 46/46 PASS

# 1) 施工方 HTTP 自检（隔离服务/端口/数据目录，自带证据）
node tests/acceptance/b03-http.mjs         # 期望 23/23 PASS

# 2) 以独立脚本复验同一缺陷（脚本与既有证据未改动）
node tests/acceptance/b03-independent-http.mjs
#    期望 14 PASS / 0 FAIL（返修前为 12 PASS / 2 FAIL），含冻结指纹检查。
#    关注 E03-12：现返回 500 IMPORT_LINK_PENDING（details.committed/recoverable/rawId/assetId），
#    恢复目录重启同一数据目录后 asset 应为 parsed 且带 rawId/parser/extractionNote；
#    E03-13：README 不应再出现「Node.js 20 或更高」，package.json engines 应为 >=22.13.0。
#    该脚本会在 docs/reports/ 下新增一个带时间戳的 B03-independent-http-*.json，不覆盖历史文件。
#    施工方已在临时副本上重放同一脚本的断言（14/14 PASS，仅重定向证据输出路径），
#    证据见 docs/reports/B03-fix-independent-replay.json；独立复验请运行原脚本并在自己的报告中记录。

# 3) 浏览器复验（本轮 NOT_RUN，需在浏览器中实做）
$env:FMCG_DATA_DIR = 'E:\AI\Work\AIPM-Workspace-B03-recheck'
$env:FMCG_PORT = '4321'
npm run dev:api
npx vite --port 5184 --host 127.0.0.1
```

浏览器复验要点：

1. **F03-03**：Raw 页面 → 选中标签为两项的资料 → 「重新导入」→ 不改标签、只填新正文 → 保存 → 新记录仍为两个标签，旧记录标签/正文/原件哈希不变；再把标签改成 `渠道,库存、动销` 应识别为 3 项。
2. **F03-04**：上传真实 `tests/fixtures/b03/zh-report.pdf` → 成功面板出现时左侧列表已含新资料 → 点「关闭」/右上角「×」/「继续导入下一条」→ 列表与首页 Raw 计数都保持 5（不需要刷新）；点「查看这条资料」应打开该 Raw。
3. **删除确认**：选中无引用的 Raw → 「删除」→ 显示「删除后正文不可恢复」→「确认删除」→ 列表与首页计数减少；用公开 API 建一个 `sources` 指向某 Raw 的 Source 页后，删除该 Raw 应列出引用页并禁用确认按钮。
4. **超限拦截**：选择一个 >20 MiB 的 `.txt` → 界面立即提示 `FILE_TOO_LARGE` 且不发起上传（Network 中无 `/api/raw/import` 请求）。
5. **F03-01**：按 `B03-fix-card.md` 的 E03-12 步骤制造关联写入失败 → 界面应显示「部分提交…待恢复」而非成功，并列出已提交 Raw ID/asset ID；恢复目录并重启同一数据目录后，`GET /api/raw/assets` 中该记录应为 `parsed` 且带 `rawId/parser/extractionNote`。
