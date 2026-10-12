# B03 返修独立复验（2026-10-05）

最终结论：**B03 PASS，F03-01–04全部复验通过，当前批次无未关闭缺陷。** 后端/文件16/16、B02回归12/12、真实浏览器10/10及浏览器持久化核验5/5均通过；上一轮未执行的最终确认删除、前端超限交互已补齐。仅判当前B03授权范围，本报告不进入B04，不修改产品代码、status或旧FAIL报告。Node最低版本环境与B04 AI状态仍未实测，不扩展本轮PASS范围。

## 版本、环境与独立性

- 主证据：[B03-recheck-http-2026-10-05T10-44-46.439Z.json](B03-recheck-http-2026-10-05T10-44-46.439Z.json)，完整 `version` 记录25个产品文件SHA-256（app/server/services/rules、README、package与lockfile）。返修报告中10个修改产品文件的实际指纹逐项一致，运行前后FROZEN-VERSION=PASS。旧 [B03-acceptance.md](B03-acceptance.md) 保持历史FAIL，不覆盖。
- Node **v25.2.1 / Windows**，公开HTTP启动命令 `node --import tsx server/index.ts`，显式FMCG_DATA_DIR，随机隔离localhost端口、隐藏子进程；数据目录 `C:\Users\80593\AppData\Local\Temp\fmcg-b03-recheck-q4HKuy`，全部子服务在finally停止。
- 使用require_escalated运行隔离验收（前轮已有真实沙箱rename EPERM证据），自动批准后完成，不存在仍未解决的运行权限阻断。
- 验收实例 GPT-6.1 Sol High。脚本 [b03-recheck-http.mjs](../../tests/acceptance/b03-recheck-http.mjs) 复用原独立HTTP脚本的公共HTTP/文件基础设施与正常场景，在新的文件/证据命名空间中增加严格恢复和新对账分支断言。没有import产品模块、mock解析器或采用施工方重放结果作为独立结论。
- 主验收实际执行 **12.36秒**，逐场景耗时在JSON；子Agent token计量不可得。最低Node22.13、Node23及Node24未在本机执行，保持NOT_RUN，不把依赖声明当运行PASS。
- 浏览器由主Agent在IAB实际操作：UI5185/API4325，数据仅位于 `docs/reports/fixtures/B03-recheck-browser-20261005/`。验收Agent已读DOM/故障/持久化记录、查看关键截图，并独立只读核对实际7条Raw文件、5条asset记录及5份原件与fixture字节相等、已删除Raw不在磁盘、超限前后快照相同和25项产品冻结指纹。未重跑产品或修改该浏览器证据。

## 实测与缺陷关闭状态

独立HTTP/文件 **16/16 PASS**（15项业务场景+冻结检查），0 FAIL、0 BLOCKED。返修冻结版本中无新增后端缺陷。

| 场景 | 关键严格断言与实际结果 | 状态 |
|---|---|---|
| E03-01 四格式 | 真MD/TXT/DOCX/PDF，正文/元数据回读、原件字节相等与SHA、独立DOCX正文精确相等，正常parsed关联 | PASS |
| E03-02 文本/重复 | BOM去除、CRLF/LF/前后空白/emoji/frontmatter形似内容保留；文件名不参与路径；重复上传新Raw/asset ID、旧记录不变 | PASS |
| E03-03 失败矩阵 | 11真实/失败样本含独立加密PDF、扫描PDF、损坏/伪扩展名、GBK、空白/空文件/空DOCX/PNG；错误码正确、原件保留、Raw计数不增 | PASS |
| E03-04 大小边界 | 500k正文成功，500k+1返回413并保留原件；20MiB+1返回413、不存原件、不增Raw | PASS |
| E03-05 元数据/补救 | 元数据非法不写文件；随后粘贴补救正文原样保存 | PASS |
| E03-06 混合PDF | 提取文字且说明第2页无文字层 | PASS |
| E03-07/08 真实写入失败 | assets/reports目录分别被普通文件占位：ASSET_WRITE_FAILED/RAW_WRITE_FAILED，retained与实际一致、Raw计数不增 | PASS |
| E03-09 来源/删除/重导入 | 引用列表正确、409阻止有引用删除、旧Raw哈希不变；显式重导入新ID且Wiki引用不转移；无引用删除404、asset detached | PASS |
| E03-10 并发 | 12组Raw删除vsWiki创建/更新，不同先后次序；逐Wiki逐source核查，无坏来源 | PASS |
| E03-11 重启 | Raw/asset记录/统计/文件哈希完整相同，失败与删除状态保留 | PASS |
| E03-12 F03-01 | 真实JSON路径被目录阻断→500 IMPORT_LINK_PENDING→持续阻断重启不丢Raw→解除故障重启严格恢复全部关联→再次重启幂等；原件与Raw数量/字节不变 | PASS |
| E03-13 F03-02 | README最低22.13与package/lock根engines一致，安装pdfjs版本及engines与lock一致；本机真实PDF提取parser=pdfjs-dist 6.4.299 | PASS（DOC+本机RUN） |
| E03-14 新补偿分支 | stored但无Raw的显式崩溃状态fixture，启动转parse_failed/IMPORT_INTERRUPTED；不新增Raw、不改原件；二次重启不改状态/文件 | PASS |
| E03-15 新删除恢复分支 | API删除时真实阻断asset标记写入，删除成功但有warnings；原件仍parsed、Raw404；解除故障重启detached，保留rawId/parser/note/字节；二次重启幂等 | PASS |

### F03-01严格复现细节

新隔离服务上传真实 `zh-report.pdf`，观察asset JSON首次保存，将JSON移动为备份、同名建目录，阻断关联写入。响应 **500 IMPORT_LINK_PENDING**，`details.committed=true`、`recoverable=true`、真实rawId/assetId、完整已提交Raw和非空cause；文案包含“不要重复导入”，不含“未创建 Raw”。正式Raw恰好1条，原件40990字节与源文件完全相等；备份JSON为stored且无rawId。故障持续时asset列表200且服务可重启，Raw与数量仍相同。

解除目录占位并恢复JSON后，用同一目录重启：asset **parsed**，rawId准确，parser=`pdfjs-dist 6.4.299`且与Raw.extractionParser相等，extractionNote/format均与Raw元数据精确相等，SHA/字节与源文件相等。Raw列表及Raw文件哈希不变、数量仍1。再次重启，全部Raw/asset文件哈希和记录完全不变。最后显式再次上传同文件：生成新Raw/asset ID，原已提交Raw逐字段不变，计数变2；恢复流程自身没有新增资料。

### 新对账分支的证据性质

E03-14采用明确标注的磁盘状态fixture：先真实HTTP上传原件、通过HTTP删除Raw，再将原件JSON置stored且清除链接字段以代表“创建Raw前中断”。仅该过渡状态由验收脚本构造；原件是真实上传字节，补偿与重启由实际产品完成，不冒充真实进程被杀中的时序测试。

E03-15完全通过真实故障形成过渡状态：阻断assetJSON路径后调用公开DELETE，Raw已删、返回warnings；恢复的旧JSON仍parsed。产品启动实际转为detached；没有人工修改该状态结果。

## B02关键回归

因返修改动Raw frontmatter增加extractionParser、API启动加入对账、原件列表容错，会影响Raw读取与Wiki启动恢复，本轮重新运行B02完整独立HTTP回归的隔离副本，结果 **12/12 PASS**，没有覆盖旧证据。

- 脚本：[b03-recheck-b02-regression.mjs](../../tests/acceptance/b03-recheck-b02-regression.mjs)。
- 证据：[B03-recheck-b02-regression-2026-10-05T10-45-10-907Z.json](B03-recheck-b02-regression-2026-10-05T10-45-10-907Z.json)。
- 数据：`C:\Users\80593\AppData\Local\Temp\fmcg-b03-recheck-b02-4OkHei`。
- 覆盖六类Wiki/frontmatter、来源/状态非法不写、过期与并发版本、别名歧义/引用、五字段中文搜索、真实Markdown导出、删除回收/断链、Index/Log/统计、实际主文件与派生文件写入失败、重启与Raw哈希、上海周界；产品冻结指纹不变。

## 真实浏览器证据与缺陷关闭

主Agent [浏览器报告](B03-recheck-browser.md) **10/10 PASS**；[DOM实录](B03-recheck-browser-dom.json)、[持久化证据](B03-recheck-browser-persistence.json) **5/5 PASS**，与验收Agent独立读盘核查一致。

| 场景 | 实测结果与证据 | 结论 |
|---|---|---|
| U01/U02 F03-03 | 未编辑的两个标签仍为两项，新ID且旧正文/标签不变；编辑 `渠道,库存、动销；SKU` 精确保存4项 | PASS |
| U03 F03-04 关闭 | 真实PDF成功面板出现时列表已从3变4；结果关闭后首页4，无reload | PASS |
| U04 F03-04 继续导入 | 真实MD提交后列表5；继续导入回表单，已提交MD仍在，随后能上传TXT | PASS |
| U05 F03-04 右上关闭 | 真实TXT提交后右上关闭，列表/首页6、周新增6，无reload | PASS |
| U06 F03-04 查看 | 真实DOCX查看后列表7、选中正确记录、中文正文与原件信息正确 | PASS |
| U07 最终删除 | 无引用TXT显式确认删除，列表/首页7→6、HTTP404；asset detached，原件与fixture相等；刷新/恢复未出现已删Raw | PASS |
| U08 前端超限 | 真实20MiB+1文件选择即报FILE_TOO_LARGE，提交仍报超限、无成功面板；全部Raw/assets/stats前后相同 | PASS |
| U09 F03-01部分提交 | 真实watcher捕获stored原件JSON并目录占位；界面明确部分提交/IMPORT_LINK_PENDING、真实两个ID、原因、勿重复、重启恢复，不显示成功；列表/首页7且可查看已提交Raw | PASS |
| U10 F03-01恢复 | 解除故障同目录重启，浏览器刷新后仍同一7条Raw；原件parsed且全部关联字段正确，Raw/统计/原件字节不变 | PASS |

关键截图：[标签](B03-recheck-tags.jpg)、[即时统计](B03-recheck-immediate-stats.jpg)、[超限](B03-recheck-oversize.jpg)、[真实部分提交](B03-recheck-partial-submit.jpg)、[恢复](B03-recheck-restored.jpg)。真实故障的 [初始记录](B03-recheck-browser-fault.json) 确认为stored。

F03-01：严格HTTP错误/恢复/幂等与真实部分提交UI均PASS；F03-02：README/package/lock一致，实际Node25PDF解析PASS；F03-03：未编辑/编辑标签、旧资料不变PASS；F03-04：四格式与关闭/继续/右上关闭/查看即时同步PASS。旧FAIL证据保留为修复前历史，返修版本无需保留缺陷为待办。

证据边界：超限UI依据界面提示及持久化前后完全相同，未采集逐请求Network日志，不声称由网络日志证明“零请求”。浏览器部分提交的500状态由独立HTTP E03-12证明，UI证明错误面板真实呈现，不能互相冒充。浏览器持久化核验中的ISO `.380Z/.38Z`仅作等价时间表示归一，Raw其它字段严格比较；本实例独立HTTP重启另外以文件SHA证明Raw字节不变。解析失败/粘贴补救与被引用删除UI的前轮真实通过证据继续保留在 [原浏览器报告](B03-browser-independent.md)，当前HTTP错误矩阵/来源阻止删除已复验通过。

主Agent独立 `npm test` **46/46 PASS**、`npm run build` **PASS（36模块）**，记录见 [主Agent检查](B03-recheck-main-checks.json)；默认沙箱realpath权限限制后获审批复跑成功。这是主Agent运行并交接的检查结果，不冒称验收实例亲自执行。产品冻结25项经本实例读盘核查仍全部一致。隔离Node服务按PID/命令核对后关闭，临时浏览器已关闭，[清理记录](runtime/B03-recheck-browser-cleanup.json) 保留；未关闭用户正式服务。

## 最终A/R门禁

| ID | DOC | RUN与当前边界 |
|---|---|---|
| A04 | PASS | 真实MD/TXT HTTP/文件正文逐字符/中文/空白PASS，真实浏览器上传/读取/结果同步PASS |
| A05 | PASS（支持矩阵/最低环境如实） | Node25真实DOCX/PDF正常与失败边界、浏览器上传/读取/故障提示PASS；Node22.13/23/24运行NOT_RUN，未宣称兼容实测 |
| R08 | PASS（B03元数据/存储子能力） | 正常导入/恢复字段、未编辑/编辑标签、刷新持久化PASS；B01来源映射证据继续复用，不扩展到未实现AI能力 |
| R09 | PASS（B03删除/重导入子能力）；跨批整项NOT_RUN | 删除/来源/重导入API/并发/重启、浏览器显式确认删除及重导入PASS；B04 AI处理状态/真实AI不可变回归仍未验 |
| R10 | PASS（B01/B03已实现范围） | 文件/原件/统一错误/真实部分失败恢复、部分提交面板、结果同步、前端超限、补救入口PASS；链接仅元数据，不推断网页抓取能力 |

独立裁定：当前B03卡的全部必选项与四项返修缺陷已由真实运行证据满足，允许主Agent将B03标PASS并交付。所有已授权验收工作到此完成；B04仍未授权，不推进下一批。主Agent管理status，本实例未修改状态、旧FAIL报告或正式workspace。
