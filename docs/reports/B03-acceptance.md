# B03 独立验收（2026-10-05）

结论：**FAIL，不能将 B03 标为 PASS，不进入 B04。** 本次用户授权优先于 status.md 中旧记录；本报告只验收 B03，不改产品代码和历史证据。共四项缺陷：跨文件失败仍返回成功、Node最低版本说明不符、重新导入合并标签、上传成功关闭结果后列表/统计不刷新。正常HTTP/文件链路与部分真实浏览器链路通过；最终浏览器确认删除、前端超限拦截留待返修补验，仍为NOT_RUN。

## 冻结版本与环境

- 版本以 [独立 HTTP 全量证据](B03-independent-http-2026-10-05T09-01-35.890Z.json) 的 `version` 完整 SHA-256 映射为准，包括 app/server/services/rules、README 与依赖锁；运行前后 FROZEN-VERSION=PASS，未发现修改。无 Git 元数据可用，以文件指纹冻结。
- Node v25.2.1；Windows/PowerShell；启动 `node --import tsx server/index.ts`，显式 FMCG_DATA_DIR 与动态隔离 localhost 端口，`windowsHide:true`。主样本目录 `C:\Users\80593\AppData\Local\Temp\fmcg-b03-independent-YRgPzn`，跨文件复验目录 `C:\Users\80593\AppData\Local\Temp\fmcg-b03-independent-ZltgVq`。未访问或修改 workspace 用户数据。
- 独立验收脚本：[b03-independent-http.mjs](../../tests/acceptance/b03-independent-http.mjs)。仅使用公开 HTTP 与文件系统，不 import 产品模块、不复用施工方 21/21 结果、不 mock 解析器。
- 默认沙箱启动曾因 Wiki index rename EPERM 受阻，证据 [原始环境记录](B03-independent-http-2026-10-05T09-01-19.042Z.json)。获自动审批后使用 require_escalated 执行真实隔离服务，完整检查成功运行。此环境阻断已解除，不算产品失败。
- 本机实测 PDF 使用 pdfjs-dist 6.4.299，DOCX 使用 mammoth 1.13.0。Node20 实际运行 NOT_RUN；本报告未声称测试过该环境。
- 主 Agent 真实浏览器环境：IAB、隔离API4323/Vite5183，数据目录 `docs/reports/fixtures/B03-browser-independent-20261005`。浏览器结束后主Agent比对产品指纹0差异。验收Agent已独立核对浏览器报告、关键截图、公开HTTP快照和对应Raw落盘文件。

## 检查与证据

独立 HTTP 全量为 **12 PASS / 2 FAIL / 0 BLOCKED**，其中 12 PASS 包含冻结检查，业务正常场景 11 项。追加失败重启复验为 **1 PASS / 2 FAIL**（PASS 为冻结检查）。

主Agent提供的 [真实浏览器报告](B03-browser-independent.md) 为 **6 PASS / 2 FAIL**（含删除确认面板子行为PASS，不含最终确认删除）；[持久化快照](B03-browser-persisted-evidence.json) 与实际文件核对一致。首次filechooser/CDP超时后创建新标签恢复并真实选择文件，不以工具问题判产品FAIL。

| 检查 | 预期与实测 | 结论 |
|---|---|---|
| E03-01 四格式 | 真实 Markdown/TXT/DOCX/PDF 上传；全部元数据回读；正文/原件 SHA-256、字节数与落盘字节一致；独立新 DOCX 正文精确相等；文件名默认标题/来源正确 | PASS |
| E03-02 文本与重复 | BOM 去除，混合 CRLF/LF、前后空白、emoji、frontmatter 形似内容不改写；路径文件名不参与落盘；相同文件产生不同 Raw/asset ID，旧正文不变 | PASS |
| E03-03 失败格式 | 0字节、空白、GBK、伪 DOCX/PDF、损坏 DOCX/PDF、扫描 PDF、独立真实加密 PDF、空 DOCX、PNG；各错误码/HTTP 正确；原件字节与失败记录保留，Raw计数不增 | PASS |
| E03-04 边界 | 500,000中文字符成功；500,001返回413 BODY_TOO_LARGE且保留原件；20MiB+1返回413 FILE_TOO_LARGE、不保存原件、不增Raw | PASS |
| E03-05 元数据/补救 | 无效来源类型、链接、日期、标签与JSON返回400，不写assets；随后粘贴中文补救成功 | PASS |
| E03-06 混合 PDF | 真实PDF文字页+空白页，文字提取成功，extractionNote明确第二页没有文字层 | PASS |
| E03-07 原件失败 | 真实 assets 目录被普通文件占位；500 ASSET_WRITE_FAILED、retained=false、不增Raw | PASS |
| E03-08 Raw失败 | reports目录被普通文件占位；500 RAW_WRITE_FAILED、retained=true、parse_failed原件记录、不增Raw | PASS |
| E03-09 引用/删除/重导入 | 正式Wiki引用可列出且409阻止删除；Raw哈希不变；重新上传生成新ID、不转移Wiki来源；无引用Raw删除后404，asset detached | PASS |
| E03-10 并发 | 12组Raw删除 vs Wiki新建/更新，不同发起顺序；逐页逐来源核对，不存在指向缺失Raw的Wiki | PASS |
| E03-11 重启 | 同一数据目录停止/重启；Raw、原件记录、统计、文件哈希全部一致，失败/删除状态保留 | PASS |
| E03-12 跨文件失败 | Raw创建后原件关联记录写入被真实目录占位阻断；实际返回201成功；重启后status=stored缺关联字段，未自动恢复 | **FAIL F03-01** |
| E03-13 最低版本 | README Node20+，依赖pdfjs engines >=22.13.0 \|\| >=24 | **FAIL F03-02（DOC）** |
| UI03-01/03/04 | 粘贴16字符/两标签保存；真实DOCX上传103字符并查看正文/原件；伪PDF显示FORMAT_MISMATCH且原件保留，粘贴补救成功 | PASS |
| UI03-02 重导入 | 两个标签未编辑，重新导入却合并成一项；旧Raw保持不变 | **FAIL F03-03** |
| UI03-05/06 删除检查 | 无引用显示检查结果/不可恢复说明并可取消；有正式Wiki引用时列出页面，确认删除按钮禁用，Raw保留 | PASS（确认面板/引用门禁） |
| UI03-07 PDF上传后关闭 | 真实PDF成功96字符；关闭结果后列表/首页仍4，HTTP与磁盘已有5 | **FAIL F03-04** |
| UI03-08 刷新 | reload后Raw=5，PDF正文/原件关联与旧资料均正确 | PASS |
| 未执行浏览器项 | 无引用最终确认删除、前端超限文件拦截 | NOT_RUN；当前FAIL，留待返修补验，未以API通过冒充UI通过 |

失败矩阵与边界响应、每个Raw/asset ID、原件/正文摘要、启动日志、耗时保存在 JSON 中。独立加密/混合 PDF 与 DOCX 位于 `docs/reports/fixtures/B03-independent/`，由 [独立 fixtures 脚本](../../tests/acceptance/b03-independent-fixtures.py) 生成，未修改施工 fixtures。

## 缺陷最短复现与修复边界

### F03-01：关联持久化部分失败仍报告导入成功

关联：R10、README“只有原件持久化与Raw创建都成功才显示导入成功”与UI“全部成功才显示导入成功”；[追加失败重启证据](B03-independent-http-2026-10-05T09-03-02.738Z.json) 中 E03-12。

1. 启动新隔离 API（确保 PDF parser 尚未加载），POST真实 `zh-report.pdf` 至 `/api/raw/import`。
2. 观察 `knowledge/raw/assets/<assetId>.json` 首次出现，在解析期间将该文件移动为备份，同名建目录，真实阻断后续关联记录写入。
3. 检查响应、Raw列表；恢复原件JSON后停止/重启同一目录，再查Raw与assets。

预期：返回明确的持久化失败状态，提供实际已提交Raw ID/asset ID及恢复或“勿重复创建”说明；如已提交Raw，不能声称“未创建Raw”。应保证重启后可解释/恢复关联，界面不显示完整导入成功。

实际：HTTP **201**，有正式Raw且asset `status=stored`；只附warnings。`RawPage.tsx:165` 固定渲染“导入成功：正文已入库，原件已保留”，warnings在其后。恢复文件重启后仍 `stored`，无 `rawId/parser/extractionNote`。根因位于 `server/raw-import.ts:92` 起：吞掉markParsed错误、返回成功结果；server按201返回。

最小修复：明确部分提交错误契约及UI显示，保留已提交ID，避免诱导重复入库；记录/恢复关联或采用安全补偿。只允许施工Agent处理；验收Agent不改产品代码。复验跨文件故障、重启状态及正常上传/删除关键回归。

### F03-02：README Node20最低环境声明不受依赖支持

证据：E03-13；README第7行；安装的 `node_modules/pdfjs-dist/package.json` version=6.4.299、engines.node=`>=22.13.0 || >=24`，lockfile固定同版本。正常解析仅实测Node25.2.1。Node20完整运行未执行，不能推断为兼容PASS。

预期：README最低运行环境与锁定依赖一致，并准确记录实际验证环境。实际：声明Node20+，覆盖依赖不支持的Node版本。

最小修复：调整最低版本声明与package engines，或换用真正支持所声明版本的解析库并实测该最低版本。不需扩大产品范围。

### F03-03：重新导入把两个标签合为一项

关联：R08元数据、R09用户重新导入、R10文本入口标签；主Agent真实浏览器UI03-02，验收Agent核对 [标签截图](B03-browser-reimport-tags.jpg)、HTTP快照及两条Raw文件。

最短复现：粘贴Raw，标签输入 `渠道,库存`，保存后点击重新导入；不编辑预填标签，只填写新正文再保存。

预期：旧Raw与新Raw均保持两个标签。实际：旧ID `5df045b1-ebc8-49bc-959e-e273a03051a3` 的tags为 `["渠道","库存"]`，新ID `2e4f8030-8575-4272-a344-7150a562a10c` 的tags为 `["渠道、库存"]`；磁盘frontmatter与公开HTTP均确认。旧正文/标签仍保留，新资料元数据却改变。根因：`RawPage.tsx` 第71行预填 `join('、')`，第8行parseTags只接受中英文逗号；输入示例也使用顿号。

最小修复：统一预填、示例与分隔符规则，复验两标签重导入及用户输入支持的分隔符，确保旧资料不变。

### F03-04：文件成功后关闭结果不刷新列表与统计

关联：R10统一导入结果、R08刷新正确、B01首页真实统计回归；主Agent真实浏览器UI03-07/08。证据：[旧列表](B03-browser-stale-list.jpg)、[旧统计](B03-browser-stale-stats.jpg)、[刷新后PDF](B03-browser-pdf-after-reload.jpg) 与公开HTTP/磁盘快照。

最短复现：上传真实 `zh-report.pdf`，等成功面板显示96字符，点击“关闭”；查看Raw列表与首页，再reload。

预期：提交成功后列表/统计及时同步，不依赖用户点击查看。实际：PDF Raw `35021656-f283-4d5b-9368-39e1ce907e7d` 与原件已落盘、API rawCount=5；关闭后UI列表4条且新标题不存在，首页Raw=4，reload后才显示5并可读PDF。独立核对的PDF原件SHA为 `525ccaf7185a9b65c074916720fe8cd265b518fe7dd1506bde23d51c8307a8e1`，正文SHA为 `f6db214ad1ec1aab5e5cfdc4c9c4a81e0c275a6d5453e1949562a4fe9d053e23`。

根因：文件submit分支仅setResult，ResultPanel只有“查看这条资料”调用onCreated；关闭仅onClose，继续导入仅清对话框状态。最小修复：成功提交后的数据同步与展示/导航分离，并防止重复添加。复验结果关闭、右上角关闭、查看、继续导入、重导入及首页计数。未实测的退出方式不能冒称已复现，但应覆盖同根因路径。

## B02 回归与A/R映射

[B02回归证据](B03-independent-b02-regression-2026-10-05T09-02-15-249Z.json)：**12/12 PASS**。隔离目录 `C:\Users\80593\AppData\Local\Temp\fmcg-b03-b02-regression-Qm5TbW`。重新执行原B02独立脚本的隔离副本，证据写入新B03文件，未覆盖任何B02历史报告。覆盖六类Wiki/完整frontmatter、来源校验与不写失败、编辑/过期版本/并发冲突、别名歧义/断链、五字段中文搜索、真实Markdown导出、删除回收、Index/Log/统计、实际主文件/派生文件失败、重启与Raw哈希不变、上海周界。冻结版本检查未变。

| 功能ID | DOC | RUN与范围 |
|---|---|---|
| A04 | PASS（文本解析/存储设计） | HTTP真实MD/TXT正文/中文/空白PASS；通用文件结果同步FAIL F03-04，完整闭环未签PASS |
| A05 | FAIL（最低环境说明） | Node25四格式与失败边界PASS；浏览器DOCX/PDF真实提取/失败补救PASS，但PDF完成后同步FAIL F03-04；Node20NOT_RUN |
| R08 | FAIL（重导入标签/刷新） | 文件导入元数据/状态/正文/原件PASS；UI F03-03/F03-04 FAIL；复用B01来源映射证据，不声称新测八来源全量 |
| R09 | FAIL（重导入元数据） | HTTP删除引用门禁/重导入/并发/重启PASS；UI引用影响/阻止删除PASS，重导入F03-03 FAIL；最终确认删除NOT_RUN；B04 AI状态未验 |
| R10 | FAIL F03-01–04 | 正常与解析失败链路、真实DOCX/PDF/失败粘贴补救PASS；跨文件部分失败/说明/标签/列表同步FAIL；前端超限拦截NOT_RUN |

主Agent已告知独立 `npm test` 34/34 PASS、`npm run build` 在沙箱realpath EPERM后获审批复跑PASS（36模块）。这些是主Agent检查结果，不冒称本验收实例亲自执行。子Agent token计量不可得；实际每场景毫秒及始末时间见证据。所有本次隔离API在脚本finally关闭。
