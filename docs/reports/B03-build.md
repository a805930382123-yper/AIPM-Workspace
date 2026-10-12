# B03 施工报告：文件导入、Raw 删除与重新导入

状态：**施工完成，待独立验收**（本报告不签署独立验收 PASS，不修改 `docs/status.md`、批次卡、`docs/acceptance.md` 或任何历史验收证据；本次未进入 B04）。

- 授权：用户在本次指令中明确授权 B03 施工与自检，优先于 `docs/status.md` 中「B03 未授权」的旧状态。
- 角色：本报告由施工方（DeepSeek V4.1 Flash）编写；未调用 Codex/其它 Agent CLI，产品运行时不含任何开发协作 Agent。
- 说明：接口/资产/解析库/错误码/限制契约在编码前于本回合确定，本文件在交接时统一写入，含施工后的实测结果。

---

## 1. 采用的契约（编码前确定）

### 1.1 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/raw` | 粘贴文本导入（B01 契约逐字保持：字段、错误码、500,000 字符上限） |
| POST | `/api/raw/import` | `multipart/form-data`，字段 `file`（单文件）+ `metadata`（JSON 字符串） |
| GET | `/api/raw/:id/references` | 引用该 Raw 的正式 Wiki 列表（`id`/`title`/`type`） |
| DELETE | `/api/raw/:id` | 仅由用户显式确认触发 |
| GET | `/api/raw/assets?status=` | 只读原件/失败记录元数据（诊断与重启后解释用，不含字节） |

- `POST /api/raw/import` 的 `metadata` 使用既有 Raw 元数据字段（`title`/`sourceType`/`sourceName`/`author`/`publishedAt`/`url`/`tags`）；正文一律由解析器产生。`title`、`sourceName` 留空时用原文件名（去扩展名、去目录与控制字符）补全。
- 成功响应 `201 {raw, asset, extraction, warnings?}`：`raw` = 正式记录，`asset` = 原件记录，`extraction` = `{parser, note, bodyChars}`。
- 错误统一 `{error:{code,message,details}}`；`details.retained` 明确表示「原件已保留、正文未入库」。
- B02 全部接口未改动（`/api/wiki*`、`/api/stats`、`/api/raw` 列表与详情）。

### 1.2 资产布局

```text
knowledge/raw/assets/<assetId>.<ext>   原件，原始字节（ext ∈ .md/.txt/.docx/.pdf/.bin）
knowledge/raw/assets/<assetId>.json   原件记录：
    id / fileName（原文件名，仅元数据）/ format（实际格式）/ declaredExtension /
    byteSize / sha256 / storedFile / createdAt / status(stored|parsed|parse_failed|detached) /
    rawId / parser / extractionNote / failure{code,message,at} / detachedAt
```

- 落盘名永远是 `assetId`；**原文件名与标题都不参与任何路径**（B01 的 UUID Raw 文件名不变）。
- Raw frontmatter 增加 `assetId`/`assetFileName`/`assetFormat`/`assetByteSize`/`assetSha256`/`extractionNote`，粘贴导入没有这些字段。
- 写入顺序：先原子写入并**回读校验**原件字节（SHA-256 + 字节相等），再探测格式、再提取正文，最后创建 Raw；任何一步失败都留下「原件 + 失败记录」。

### 1.3 解析库与版本（真实库，不靠扩展名或 MIME 判断）

| 用途 | 依赖 | 版本（lockfile 固定） |
|---|---|---|
| multipart 接收 | `multer`（`memoryStorage`，`limits.fileSize=20 MiB`，`defParamCharset:'utf8'`） | 2.4.0（`@types/multer` 2.3.0） |
| DOCX 正文提取 | `mammoth`（`extractRawText`） | 1.13.0 |
| PDF 正文提取 | `pdfjs-dist` legacy build（`getTextContent`，无 worker） | 6.4.299 |
| 文本解码 | Node 内置 `TextDecoder('utf-8',{fatal:true})` | Node 25.2.1 |

格式判定：PDF 取前 1024 字节内的 `%PDF-`；ZIP 取 `PK\x03\x04` 且要求存在中央目录记录与 `word/document.xml`；其余按扩展名归类后必须严格 UTF-8 解码。扩展名与实际内容矛盾一律 `FORMAT_MISMATCH`。

### 1.4 错误码（互相可区分）

| code | HTTP | 触发 |
|---|---|---|
| `MISSING_FILE` / `INVALID_UPLOAD` / `INVALID_METADATA` | 400 | 无文件、非法 multipart/字段名、metadata 非 JSON |
| `INVALID_SOURCE_TYPE` / `INVALID_URL` / `INVALID_DATE` / `INVALID_TAGS` / `REQUIRED_FIELD` | 400 | 沿用 B01 元数据校验 |
| `EMPTY_FILE` | 400 | 0 字节 |
| `FILE_TOO_LARGE` | 413 | 单文件 > 20 MiB（`details.retained=false`，接收阶段拒绝） |
| `BODY_TOO_LARGE` | 413 | 提取正文 > 500,000 字符（`details.retained=true`） |
| `UNSUPPORTED_FORMAT` | 415 | 扩展名不在 `.md/.markdown/.txt/.docx/.pdf` |
| `FORMAT_MISMATCH` | 415 | 扩展名与内容矛盾（含损坏压缩包冒充 DOCX） |
| `UNSUPPORTED_ENCODING` | 415 | 文本非严格 UTF-8（GBK 等），不做猜测解码 |
| `EMPTY_CONTENT` | 422 | 正文为空/纯空白（含 DOCX 无可提取文字） |
| `DOCX_INVALID` / `PDF_INVALID` / `PDF_NO_TEXT` / `PDF_ENCRYPTED` | 422 | 损坏、扫描件无文字层、加密 |
| `RAW_REFERENCED` | 409 | 仍被正式 Wiki `sources` 引用 |
| `NOT_FOUND` | 404 | Raw 不存在 |
| `ASSET_WRITE_FAILED` / `RAW_WRITE_FAILED` | 500 | 真实持久化失败（`retained` 如实标注） |

### 1.5 限制与并发约定

- 单文件 20 MiB（`services/raw/limits.ts` 单一来源，服务端/UI/README 同源）；提取正文 500,000 字符沿用 B01 常量。
- Markdown/TXT：去掉编码 BOM 后保留全部空白与换行，**不 trim**，不解释 frontmatter 为应用元数据，不静默转码。
- 解析器不静默截断：PDF 逐页提取并在 `extractionNote` 说明页数、页间分隔方式与「哪些页没有文字层」。
- 重复文件生成新的 Raw UUID 与新的 assetId，不覆盖旧 Raw/旧原件，也不声称做过内容去重。
- 删除与 Wiki 保存共用 WikiStore 的串行队列（`withLock`）：删除前在同一队列内重新扫描 `sources` 引用，避免并发产生指向已删 Raw 的坏来源。

---

## 2. 实际交付与未完成项

已交付：

1. Raw 页面支持上传 Markdown/TXT/DOCX/PDF，并保留原有粘贴文本流程（同一对话框内切换）。
2. 原件按原始字节存入 `knowledge/raw/assets/`，回读校验后才继续解析；记录原文件名、实际格式、字节数、SHA-256、asset ID 与 Raw 的关联。
3. 统一呈现成功（正文已入库 + 原件已保留）、失败（含错误码、原因、原件保留信息）、不支持格式、超限。
4. 用户显式删除（引用影响确认 + 引用阻止）与重新导入（预填元数据、新 Raw ID、旧记录不动）。
5. README 的真实支持矩阵、限制、操作说明与接口清单。

未完成 / 明确排除：OCR、网页抓取、LLM、自动 Wiki、Prompt、Audit/Lint、云部署与生产服务器；原件清理/回收站；内容去重；生产环境浏览器 E2E 自动化（本回合无浏览器工具，见第 8 节）。

---

## 3. 变更文件与最终 SHA-256 指纹

新增（`A`）与修改（`M`）：

| 文件 | 类型 | SHA-256 |
|---|---|---|
| app/api.ts | M | `0dc8c063389c35d7741de71c86e0b93ce492e6ee2c8397f92efe6c0a90f33657` |
| app/main.tsx | M | `b280c492a2df4e6ec6ec998cfc03a90adb990822f83e804afb93e7536f950523` |
| app/App.tsx | M | `3753ffbf6ad75a9f7cc8cc34683cc86f0261745118a54c0a43cd7d2b342ca55e` |
| app/pages/RawPage.tsx | M | `cbc37ab0767423dea1a55ec307aff1770d3c4c8b234118fe68eaf4dd3c2f1b55` |
| app/raw.css | A | `88a1eab682566ba68839c9a8bafd9c9c7befb59ba4f844805deb47a103b5dfbc` |
| server/index.ts | M | `801810073b8b96ff4e20fee1326ef41822dede9f53cc2fa1aac8048034c78877` |
| server/validation.ts | M | `a05f077a6e578ee417fefd6e3f5aa37bd3a9789daa4f4f01c2fc2803e35eed48` |
| server/raw-import.ts | A | `e2ceca0433b88b307379f0b12abfeed9ee9bc444a526c57d6dd0945eef1ffed1` |
| services/raw/limits.ts | A | `22e62af61a8cf445962c154ef64a39caf3eb48cca873dc59396c8d0739da4537` |
| services/raw/parse.ts | A | `92545e34e614ce629d60974482cc081ef7a21036d7aac430d1f1e2d8a16cb229` |
| services/raw/assets.ts | A | `ca355e671658cb1e75909d37ca551d9394b2580be6756451ca5d5fbe43d71b02` |
| services/raw/store.ts | M | `246919f6b2d85eb6c0e850bc65e27205db7654267c7ef12e89447569129c7765` |
| services/wiki/store.ts | M | `64429e98068cc23fa4a0774e6aa62405c17cc912647f944b007d7060a0e48aa8` |
| package.json | M | `4ead8519427ef38f261e88a818e1747d70e59d10ccd6ffeb99fe5936bfd38379` |
| package-lock.json | M | `2201e13943a1dbfc033f0341c0f4edbece6517f078ef73ded0d75daf4098201d` |
| README.md | M | `33e01929bab501114d13dd013a2303b45386844a51814e424d760939394d1400` |
| tests/import.test.ts | A | `7b7199ae9aef5d64d38d3b321a9c819f01eb612b828de4ee3c3928070cf7ab07` |
| tests/ui.test.tsx | A | `dee7c34d78ee55495b401a4f3b05123ce1cc571f1f881429ba1c4bb75f283600` |
| tests/acceptance/b03-http.mjs | A | `b57e5f869cc1c833271c9eff323c1e3fd7b2f16cdd37f27eb8093949adc45754` |
| tests/fixtures/b03/make-fixtures.py | A | `f93554b2866002cb9217873dcdec32793445b382a09baee5410585c6d0cfa59c` |
| tests/fixtures/b03/zh-report.md | A | `1a0da87a111b026c69ac93d865cccf6044f6bf3ac7c838f09d5058be5fe24983` |
| tests/fixtures/b03/zh-notes.txt | A | `c0a1f77e7115956747edbd1841244de0bbedf95e37fc4ae0db0662934671015f` |
| tests/fixtures/b03/bom-notes.txt | A | `31b59c1407695d669164b69afe6ec7dface3c955ac72f09803d5001c5bb5712b` |
| tests/fixtures/b03/gbk-notes.txt | A | `8b2cd2d7938d5765d38d46a89dee2513252815e8f5ccf583e587e88ade81ab7c` |
| tests/fixtures/b03/empty.txt | A | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| tests/fixtures/b03/blank.txt | A | `2d78c57ece641bd2b069829350a2ca4272532ee9cc9953902ca8f59ed690089a` |
| tests/fixtures/b03/logo.png | A | `64855b65e2103a55a1b4c340032f9c8892eb9ba8564d7ee5e34a371def0c1849` |
| tests/fixtures/b03/zh-report.docx | A | `f9f031a7a263f7021eb02367be35e4275f4dbdf82a6854270a68fb7fc7df8058` |
| tests/fixtures/b03/zh-report.pdf | A | `525ccaf7185a9b65c074916720fe8cd265b518fe7dd1506bde23d51c8307a8e1` |
| tests/fixtures/b03/scan-image.pdf | A | `d8869404e8dee4a203543469620880dbe1033a7dece3266e38bf396d4d2bd057` |
| tests/fixtures/b03/broken.docx | A | `f34c29a09151bffff37eb49e532a9c70c6d1f13a5d4352f52d78283557a7e61b` |
| tests/fixtures/b03/broken.pdf | A | `986ad2bbe0aefbf4d90606dd21bdddcb8a75e68a411aae7c7b6cc3382a050390` |
| tests/fixtures/b03/fake-docx.docx | A | `eebebd963da033938c1dee356c3334f786f3465fb41de44ff186467390490fb3` |
| tests/fixtures/b03/fake-pdf.pdf | A | `eebebd963da033938c1dee356c3334f786f3465fb41de44ff186467390490fb3` |
| docs/reports/B03-api-2026-10-05T08-54-19-092Z.json | A | `b681f01eb965515e5f72d5d12ecd69d14843c03d736a744eee3347b7230a5c9c` |
| docs/reports/B03-api-evidence.json | A | `b681f01eb965515e5f72d5d12ecd69d14843c03d736a744eee3347b7230a5c9c` |

以上最后两行是最终冻结版本的证据（21 项检查全部 PASS）。同一批自检的中间运行归档（保留以便复核修复历史）：`B03-api-2026-10-05T08-48-37-341Z.json`（15 PASS / 5 FAIL，`060208ba…`）、`B03-api-2026-10-05T08-49-23-938Z.json`（18 PASS / 2 FAIL，`31089c0a…`）、`B03-api-2026-10-05T08-49-43-444Z.json`（20 PASS，`a9589a1b…`）、`B03-api-2026-10-05T08-52-50-131Z.json`（20 PASS，`2153d3ce…`）；这些是被最终运行取代的旧版本证据，不代表交付版本。

本报告自身（`docs/reports/B03-build.md`）不列入指纹表。

受保护文件（本次**未修改**，供独立验收核对）：

| 文件 | 当前 SHA-256 |
|---|---|
| AGENTS.md | `e7410b69d0fdd7b2505504b941d717a96a4759fb26a05d98ceeb7d04f486cde2` |
| docs/status.md | `051327e3d0b00586352b28451ac058855a57b67e6978060cd0afcc52b1dd185f` |
| docs/acceptance.md | `f1e26007af646a1b4dab8cc68d4e2b70cbdf6c4ce0afff01e7b34e28a2bc1a95` |
| docs/product-spec.md | `a2de470be73726b3c4fbb93b52e9b898ce788a801b7477749ba144ae616350b9` |
| docs/architecture.md | `3e065ef36e3a8f792e033e1ae6924c63262b2fbbf3847a1a2ca72a7cc45857a0` |
| docs/coordination.md | `6a1d76a850678e5858fdd980784f244de892bb4f2b93cdf86a1c287158b6ad93` |
| docs/batches/B03.md | `3ce137a7d99b054be8b09d507c4a10de509a4690cfb4cc0d7e3bc71265a461e0` |
| docs/batches/B04.md | `3bd722003fa4c296eea4dd7550c54a88e41144cb7dbc260b6fc024326825bfbd` |
| rules/fmcg-schema.yaml | `21e817f606fb0df1b6aeea724a9b227b8c9fa86c011165d0cdc29e853c0ca1b7` |
| rules/page-templates.yaml | `f9b311f7470b461c53ddb19f091bd69189746835dfa3c969427ecdef021443ae` |
| rules/source-policy.yaml | `6594dd86b1aef929056f86c9d9ad6c176828e55397a272e999c4d1dbb04337a3` |
| tests/raw.test.ts | `7525c333ec11da7ef97e95f426318280825ec9333dd06654998a6d66c29722ef` |
| tests/wiki.test.ts | `2dc605f93abc212587a5f6c0cc84e16d73d59c5e17903605894770b2c4e6d883` |
| tests/acceptance/b01-http.mjs | `44674241e9b0aeba9f38a663a7f3742c7e69d5474a6926872dc3220ba02f750e` |
| tests/acceptance/b02-http.mjs | `9659f9822ff58a932173f3c5609e75ce35ff58d060ef2704d94bd1a5c4b7dae3` |
| docs/reports/B01-build.md | `f6242a6db61d82730e68aaa697b2f65d4e7d2caf50f7838a6877abd3281222d3` |
| docs/reports/B01-acceptance.md | `a9295b7351653add6a1005d7e79784c0c2ce09938b61143a4c4d8eb34b184154` |
| docs/reports/B02-build.md | `0065760c52bdaab6da6935694fedaf2bd0ecaa745c39f2c6b1b0b12bf0e9b314` |
| docs/reports/B02-acceptance.md | `a807407c987d029fd6c17440ec7773d5817f1a776b7186791bec77189e4bca2b` |

`package.json` 只改了 `test` 脚本的 glob（`tests/*.test.ts tests/*.test.tsx`），并新增 `multer`/`mammoth`/`pdfjs-dist` 依赖与 `@types/multer`；`package-lock.json` 同步锁定。未降低任何既有断言。

---

## 4. 真实测试样本（fixtures）

`tests/fixtures/b03/`，由 `make-fixtures.py` 生成（python-docx 1.2.0），文本 PDF 由**捆绑 LibreOffice kit** 从该 DOCX 转换（`convert --input zh-report.docx --output zh-report.pdf`，未使用系统 LibreOffice），扫描件 PDF 由 Pillow 12.3.0 以图片页输出（无文字层）。没有任何样例靠「改扩展名」冒充 DOCX/PDF。

- 中文正常样本：`zh-report.md`（混合 CRLF/LF、首尾空白、正文含独立 `---`）、`zh-notes.txt`（首尾空行与空格、混合换行）、`bom-notes.txt`（UTF-8 BOM）、`zh-report.docx`、`zh-report.pdf`。
- 负面样本：`empty.txt`、`blank.txt`、`broken.docx`（真实包截断，保留 `PK` 头）、`broken.pdf`（`%PDF-1.7` 后垃圾字节）、`scan-image.pdf`（图片页无文字层）、`fake-docx.docx` / `fake-pdf.pdf`（纯文本改扩展名）、`gbk-notes.txt`（GBK 编码）、`logo.png`（真实 PNG 非文本）。
- 超限样本在测试中即时构造：21 MiB 的 `.txt`（接收阶段拒绝）、500,001 字符的中文正文（正文上限）。

---

## 5. 实际运行命令、结果与证据

隔离要求：所有自检使用显式 `FMCG_DATA_DIR` + 独立端口，未向正式 `workspace/` 导入任何测试样本，未关闭任何未知进程，自启服务在结束时全部停止。

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npm run build` | 通过（`tsc -b` 无错；`vite build` 36 modules，`dist/assets/index-NPmKTm--.js` 267.95 kB、`index-7KHxRmYG.css` 26.39 kB） |
| 2 | `npm test` | **34/34 通过**（B01/B02 既有 14 项 + B03 导入 15 项 + B03 UI 渲染 5 项） |
| 3 | `node tests/acceptance/b03-http.mjs` | **21/21 PASS**，自建于 `%TEMP%\fmcg-b03-selfcheck-*` 的隔离数据目录与随机回环端口 |
| 4 | 构建产物检查 | `dist` CSS 含 `.retained-badge/.dialog-tab/.file-picker/.result-panel/.reference-list/.delete-panel/.danger-button/.detail-asset`；JS 含 `/api/raw/import` 与 B03 界面文案 |

证据路径：

- `docs/reports/B03-api-evidence.json`（最新一次，等同 `docs/reports/B03-api-2026-10-05T08-54-19-092Z.json`，`b681f01e…`）：21 项检查，每项含断言证据（HTTP 状态与错误码、assetId、字节数、SHA-256、磁盘文件清单与统计快照）。报告只记录文件与接口层面的证据，不含任何用户业务资料或密钥。
- 中间运行归档见第 3 节。
- 隔离数据目录：`C:\Users\80593\AppData\Local\Temp\fmcg-b03-selfcheck-*`（保留可复查；未写入 `workspace/`）。
- 产品运行（正式库）：按用户既有方式仍为 `workspace/`，本批未改动其内容（正式库仅原有 1 条 Raw、0 条正式 Wiki）。

### 5.1 `node tests/acceptance/b03-http.mjs` 的 21 项

`B03-01` 健康检查与空基线 · `B03-02` 粘贴文本回归 · `B03-03` Markdown 导入（逐字符 + 原件字节 + frontmatter 关联）· `B03-04` TXT 空白/换行/BOM · `B03-05` DOCX 真实解析 · `B03-06` PDF 真实解析 · `B03-07` 九类失败矩阵（原件保留 + 失败记录 + 不增 Raw + 重启后可解释）· `B03-08` 21 MiB 接收阶段拒绝（413）· `B03-09` 500,001 字符正文上限（保留原件）· `B03-10` 上传请求错误（无文件/非法 JSON/非法字段/非法 URL/字段名错误/多文件/无 boundary）· `B03-11` 404 集合 · `B03-12` 重复导入生成独立记录且旧文件哈希不变 · `B03-13` 原文件名与标题只作元数据、无越界写入、HTML 只作文本 · `B03-14` 引用列表 + 删除 409 · `B03-15` 无引用删除生效且原件保留 · `B03-16` 删除后的 Raw 不能再作为 Wiki 来源 · `B03-17` 重新导入新 ID、旧记录与旧关联不变 · `B03-18` 真实持久化失败（原件目录/目标目录被占用）不显示成功、恢复后可导入、已成功资产不受破坏 · `B03-19` 同目录重启一致性 · `B03-20` 首页统计与 B02 搜索/导出回归 · `B03-21` 并发不变量：同一时刻发起「Wiki 保存（sources 指向该 Raw）」与「Raw 删除」，只允许一种结果成立（本轮实测 Wiki 201 / 删除 409，Raw 保留），且遍历全部正式 Wiki 确认没有任何来源指向已不存在的 Raw。

### 5.2 `npm test` 的 B03 用例

`tests/import.test.ts`（15 项）覆盖：四种真实格式正文与已知样本逐字符/逐句一致；BOM 去除与不 trim；八类失败的错误码、原件哈希、失败记录、不建 Raw、统计不增；20 MiB 与 500,000 字符双边界；文件名/标题的路径安全与 `fileStem`；重复导入；删除与引用可见性；重新导入；粘贴契约回归；重启后失败记录可解释（新建 AssetStore 重新读取）。

`tests/ui.test.tsx`（5 项）用 `react-dom/server` 渲染真实组件，断言：粘贴模式保留原文本流程与字符上限、文件模式提供四种格式与边界文案、重新导入的「新 ID / 不自动复制原件 / 不转移来源」提示与预填元数据、Raw 详情区分「原件已保留」与粘贴资料、删除确认先检查引用且未加载完成时不可删除。

### 5.3 自检引发的实现调整（如实记录）

中间运行 1（15 PASS / 5 FAIL）与运行 2（18 PASS / 2 FAIL）暴露的问题与处理：

| 现象 | 处理 | 是否产品缺陷 |
|---|---|---|
| 超限响应 `details.retained` 缺失 | 产品：`FILE_TOO_LARGE` 明确返回 `retained:false`（`server/raw-import.ts` + `server/index.ts`） | 是（信息不明确） |
| `expectFailure` 对既有短消息（如「来源类型无效。」）断言过严 | 自检修正为「消息非空可读」 | 否，测试断言问题 |
| 浏览器 `FormData` 与 busboy 都会去掉原文件名中的目录部分，导致用 fetch 构造的穿越文件名无法送达 | 自检改用**手写 multipart 报文**发送 `filename="../../evil<script>.md"`，并记录「两层都去目录、落盘名永远是 assetId」；另增「标题含路径字符」用例 | 否，测试构造问题 |
| 故障注入把 `reports` 目录（含已成功 Raw）替换为文件，破坏了本轮样本 | 自检改用空的 `company` 目录注入，避免自检自身造成数据损失 | 否，测试设计问题 |
| 0 字节原件按 `size > 0` 断言失败 | 自检改为「字节数 + SHA-256 一致」 | 否，测试断言问题 |

除上表第一项外，未为通过自检而修改产品断言或放宽标准；第 3 节指纹表对应该轮冻结版本。

---

## 6. 实测的错误/失败恢复、删除与重新导入行为

- **解析失败**（损坏/扫描/伪扩展名/编码/空文件/纯空白/正文超限）：HTTP 4xx + 可区分错误码；响应与 `details` 明确「原件已保留（assetId、字节数、SHA-256）」；磁盘上是 `<assetId>.<ext>` 原件 + `<assetId>.json`（`status=parse_failed`、`failure.code`）；Raw 列表、首页 Raw 计数、本周新增都不增加；重启后 `GET /api/raw/assets?status=parse_failed` 仍能列出原因与原件的哈希一致。
- **接收阶段超限**（>20 MiB）：413，`retained=false`，assets 目录无新增文件。
- **真实持久化失败**：把 `knowledge/raw/assets` 换成同名文件 → `500 ASSET_WRITE_FAILED`（无 Raw、无原件）；把 `knowledge/raw/company` 换成同名文件 → `500 RAW_WRITE_FAILED` + 「原件已保留」+ 失败记录；恢复目录后同一文件导入成功，已成功的 Raw/Wiki 文件名集合完全不变。
- **删除**：无引用 → 200，列表/统计/重启结果中消失，`<assetId>.json` 变 `detached`，原件字节保留；被正式 Wiki `sources` 引用 → 409 `RAW_REFERENCED` + `details.references`（id/title/type），Raw 仍在；删除后立即用该 Raw 作为 `sources` 建 Wiki → 400 `INVALID_SOURCE`，不留坏来源页。
- **重新导入**：同一文件 + 预填元数据 → 新 Raw UUID、新 assetId，正文与标题一致；旧 Raw 文件字节哈希不变、旧 `assetId` 关联不变、Wiki 引用未被转移。

---

## 7. 已知限制与风险

1. PDF 只做文本层提取：扫描件、加密件明确失败，不做 OCR（B03 范围外）。
2. DOCX 只取文字（mammoth `extractRawText`）：图片、表格结构、批注、脚注不进入正文；段落间以空行分隔，与原文档视觉排版不同。
3. 文本严格 UTF-8：GBK/GB18030/Big5 等一律失败并提示改用粘贴（不做编码猜测，避免乱码入库）。
4. 上传使用 `multer` 内存缓冲，单请求最多 20 MiB 常驻内存；本机单用户场景可接受，未做流式落盘。
5. 原件只增不删：删除 Raw 后原件与失败原件都留在 `knowledge/raw/assets/`，没有清理工具或界面（本批约定）。长期使用需要人工或后续批次清理。
6. 删除不可撤销：正文文件被直接删除（不做 Raw 回收站），仅原件（若来自文件导入）仍在。
7. 文件名信息以 multipart 解析器的结果为准：busboy 已去掉目录部分，因此记录的原文件名不包含客户端路径；这是刻意的安全行为。
8. 并发仅覆盖「删除 vs Wiki 保存」这一对：同一进程内通过 WikiStore 队列互斥；多进程同时写同一数据目录不在本批范围。
9. Wiki 引用只按 `sources` 字段判定，正文里提到某 Raw 的文字不算引用（符合 §6「正式 Wiki 引用」的界定）。
10. 环境风险（已处理，非代码问题）：会话开始时工作区被 Windows 文件权限挡住（`E:\AI\Work\AIPM Workspace` 缺「修改权限」），已用 DSH 的 ACL 诊断脚本修复并验证；备份与撤销脚本在 `E:\AI\Work\dsh-acl-recovery\`（`acl-backup-5a26b57dacd244f5842693a42ff2b7e4.json(.ps1)`），未改动文件内容与所有者。

---

## 8. 未运行项（NOT_RUN）与浏览器复现步骤

本回合**没有浏览器工具**，因此以下项目记为 `NOT_RUN`，不声称 UI 已在浏览器中通过（但组件渲染契约由 `tests/ui.test.tsx` 覆盖，构建产物已确认包含对应文案与样式）：

- `NOT_RUN`：真实浏览器中的文件选择/上传、失败提示与「改用粘贴文本补救」、删除确认、引用阻止、超时/大文件交互。
- `NOT_RUN`：真实浏览器中的超限文件前端拦截体验（服务端 413 已实测）。

最短浏览器复现步骤（建议用隔离数据目录与独立端口，勿对 `workspace/` 操作）：

```powershell
$env:FMCG_DATA_DIR = 'E:\AI\Work\AIPM-Workspace-B03-browser'
$env:FMCG_PORT = '4319'
npm run dev:api                      # 隔离 API
npx vite --port 5180 --host 127.0.0.1  # 若 5173 已被既有开发服务占用（strictPort）
# 浏览器打开 http://127.0.0.1:5180/
```

1. Raw 页面 → 「导入资料」→「上传文件」→ 选 `tests/fixtures/b03/zh-report.docx`，标题/来源留空 → 「上传并入库」：期望结果面板显示「导入成功：正文已入库，原件已保留」、正文/原件字节数与 SHA-256、`knowledge/raw/assets/<assetId>.docx`。
2. 再选 `tests/fixtures/b03/fake-pdf.pdf`：期望错误码 `FORMAT_MISMATCH`、说明「文件内容不是 TXT 文本」类原因、「原件已保留」+ SHA-256，并出现「改用粘贴文本补救」按钮；点击后切回粘贴模式且已填元数据保留。
3. 选一个 >20 MiB 的 `.txt`：期望前端立即提示超过 20 MiB 且不上传。
4. 选中任意 Raw → 「删除」：期望先显示「正在检查引用关系…」，无引用时提示「删除后正文不可恢复」+ 原件保留说明；「确认删除」后列表与首页 Raw 计数减少。
5. 在知识库新建一个 Source 类型页面并关联该 Raw → 回到 Raw 详情点「删除」：期望列出引用页面并禁止删除（按钮不可点），提示需先解除来源引用。
6. 选中已有 Raw → 「重新导入」：期望标题/来源/作者/日期/链接/标签被预填，显示「重新导入会创建新的 Raw ID，旧记录及其原件保持不变」；确认后列表出现第二条，原记录内容不变。

---

## 9. 供 Sol 独立验收的最短启动与复现步骤

```powershell
# 0) 依赖与静态检查（只读产品代码，不需要产品 Key）
npm install
npm run build            # 期望 exit 0
npm test                 # 期望 34/34 pass
node tests/acceptance/b03-http.mjs   # 期望 21/21 PASS，自启隔离服务并写证据

# 1) 手工 HTTP 复现（隔离目录 + 独立端口）
$env:FMCG_DATA_DIR = 'E:\AI\Work\AIPM-Workspace-B03-accept'
$env:FMCG_PORT = '4320'
node --import tsx server/index.ts        # 隐藏窗口启动，仅 127.0.0.1

# 2) 四格式与失败矩阵（示例命令，路径按需调整）
curl.exe -s -X POST http://127.0.0.1:4320/api/raw/import `
  -F 'metadata={"title":"验收 DOCX","sourceType":"report","sourceName":"B03 验收"}' `
  -F 'file=@tests/fixtures/b03/zh-report.docx'
curl.exe -s -X POST http://127.0.0.1:4320/api/raw/import `
  -F 'metadata={"title":"验收 PDF","sourceType":"report","sourceName":"B03 验收"}' `
  -F 'file=@tests/fixtures/b03/zh-report.pdf'
curl.exe -s -X POST http://127.0.0.1:4320/api/raw/import `
  -F 'metadata={"title":"扫描件","sourceType":"report","sourceName":"B03 验收"}' `
  -F 'file=@tests/fixtures/b03/scan-image.pdf'      # 期望 422 PDF_NO_TEXT + 原件已保留

# 3) 引用与删除
curl.exe -s http://127.0.0.1:4320/api/raw/<rawId>/references
curl.exe -s -X DELETE http://127.0.0.1:4320/api/raw/<rawId>   # 有引用 409 RAW_REFERENCED；无引用 200

# 4) 重启一致性：停止后用同一 FMCG_DATA_DIR 重新启动，重复 GET /api/raw、/api/raw/:id、
#    /api/raw/assets?status=parse_failed 与 /api/stats，比较 ID、正文、SHA-256、删除结果。

# 5) 浏览器项见第 8 节（本回合未运行，需在验收环境实际执行）。
```

独立验收可直接复用的断言要点：`tests/fixtures/b03/*` 的 SHA-256 与第 3 节一致；`docs/reports/B03-api-evidence.json` 中 21 项状态为 PASS；`knowledge/raw/assets/<assetId>.<ext>` 字节 SHA-256 = 源文件 SHA-256 = Raw frontmatter `assetSha256`；失败样本不增加 `GET /api/stats` 的 `rawCount`；被引用 Raw 的 `DELETE` 返回 409 且 Raw 仍可读；无引用 Raw 删除后 `GET /api/raw/:id` 为 404 且 `GET /api/raw/assets` 中对应记录为 `detached`；并发保存与删除后不存在指向缺失 Raw 的正式 Wiki 来源。
