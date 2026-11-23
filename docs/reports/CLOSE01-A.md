# CLOSE01：A01–A63 交付证据对账

2026-11-23；审查基线 `aff5b325ad1b40c0f47e98171bccd46eae02f15c`。本实例负责证据归并和下述离线补验，未修改产品、正式资料、历史结论或主矩阵，未提交；未调用真实 Provider。

**A01–A63 当前可交付结论：63 PASS、0 FAIL、0 BLOCKED、0 NOT_RUN。** 这是逐项历史实测、后续受影响范围独验及本轮补验的组合结论，不是本轮重新执行 63 项或重新付费跑四链。此结论仅覆盖 A 系列；不能据此签全项目结项。全项目工程门禁、R 系列、会议及未关闭问题由 CLOSE01 主报告分别裁决。

## 判据及版本适用性

采用 [acceptance.md](../acceptance.md) 的稳定 A01–A63 与 DOC/RUN 定义：mock/固定响应不证明当前真实模型质量，历史失败保留，后续具名补证可以关闭相应缺口。A09 的旧 `document/suggested_pages` 命名按已批准的 facts/planning 现行契约解释，沿用 B09 集成冻结裁决，未由本轮放宽标准。A06 的“不改 Raw”指 AI 不得改写；[RAWEDIT02](RAWEDIT02-20261114-review.md) 已授权的人工作文修订不违背此边界，且必须保历史、使旧派生失效。

旧 [delivery-matrix.md](../delivery-matrix.md) 是 2026-10-14 FULL3 快照；本轮按 A 行解析确认为 50 PASS / 1 FAIL / 12 BLOCKED。后续 [B09 逐行独立矩阵](B09-INTEGRATION-AUDIT-20261029-matrix.md) 已明确 A01–A63 全部 PASS，109 项整体仍因 R13 FAIL 未通过。不能把旧 FULL3 状态当作最终现状，也不能抹掉当时失败。后续 [R13 独验](R13-MERGE-AUDIT-20261029.md) 是否满足 R13 由 R 系列审查引用，本报告不代签。

本轮实际执行了以下适用性检查：

- `git rev-parse HEAD` 为上述基线；开工 `git status --short` 为空。`git log c6474fe..HEAD -- services/prompt-ai/service.ts services/prompt-ai/contract.ts` 仅有 `02ab4ca` 纯格式化。
- 使用 `git show c6474fe:<文件>` 与当前文件，通过 `esbuild.transform({loader:'ts',format:'esm',target:'esnext',minify:true,legalComments:'none'})` 独立比较，`service.ts` 和 `contract.ts` 的结果均完全相同。`git diff --name-only c6474fe HEAD -- rules/prompt` 为空。因此 PA01/B09 真实 Brief、生成、九维检查和重写的业务代码及契约仍适用；不是仅按文件名认定版本相同。
- Raw、Wiki、Audit、Library、标准整理、UI 在 B09 后确有变更，未宣称它们字节未变。下表分别组合 UI04、LW01/LW-REAL、COMPAT01、RAWEDIT01/02、LINT01、EVAL01、RAWOCR01–04 的受影响实测；ENG04 格式化的独立等价性另见 [ENG04](ENG04-20261122-review.md)。默认全量由主会话统一执行，本实例不重复计数。
- 本轮标准链真实录制回放严格核对请求与规则指纹，8/8 通过；证明冻结真实响应在现行产品代码上的契约、证据和分区仍成立。它不证明今天再次发给 Provider 会得到相同响应，也不扩大为所有输入的语义质量保证。

## 证据索引

| 简称 | 实际证据与适用边界 |
|---|---|
| B | [B09 最终逐行矩阵](B09-INTEGRATION-AUDIT-20261029-matrix.md)、[阶段独验](B09-INTEGRATION-AUDIT-20261029-stages.md)、[准备独验](B09-INTEGRATION-AUDIT-20261029-prepare.md)；交付 `c6474fe`，含当前当时真实四链、手动路径、23 文件重启/恢复、导出与逐行版本归并。下表 B 不是仅复用旧表状态，而是引用其相应行及 P/S 原始核查。 |
| P | [PA01 最终独验](PA01-CONTINUE-20261016-acceptance.md)；真实 15/24：7 Brief、2 generate、3 check、3 rewrite，六模板/custom、弱/完整 Prompt；原断言脚本误判另作只读校准，未覆盖历史 FAIL。其后 B 的 16/18/19/20 补真实完整 UI 集成。 |
| U | [UI04 独验](UI04-20261101-review.md)；实际完整 App Raw→审核→Wiki、Prompt 变量/编辑生成保存 v1→检查重写保存 v2、Workflow 门禁；fake 明确不能证明语义。 |
| L | [LW01 独验](LW01-20261101-review.md) 与 [LW 真实独验](LW-REAL-20261105-review.md)；工程审批/事务/恢复及真实 standard 跨年双来源更新、人工说明和原文保全，真实样本 8 次请求；不覆盖全部 deep/长文质量。 |
| C | [COMPAT01 独验](COMPAT01-20261105-review.md)；修复后 738/738、完整类型/构建和新 TEMP 真实 Chrome 维护/失败保留闭环；真实语义未测。 |
| E | [EVAL01 独验](EVAL01-20261115-review.md)；8 个合成用例真实录制、16 次历史真实请求；结构/证据 8/8、事实 21/21、待确认 3/3。本轮回放另见下节。 |
| H | [RAWEDIT01](RAWEDIT01-20261114-review.md)、[RAWEDIT02](RAWEDIT02-20261114-review.md)；真实 HTTP/Chrome 编辑、选择重审、失败与冲突保输入、显式确认、Raw/原件不变或人工历史保存；都是零真实 Provider 的受影响界面/存储补证。 |
| O | [RAWOCR02 最终复验](RAWOCR02-review.md#第二次返修独立复验)、[RAWOCR03](RAWOCR03-review.md)、[RAWOCR04](RAWOCR04-review.md)；已关闭旧 OCR 混入和孤立图引用，隔离 Tesseract/HTTP/Edge、失效引用/编辑/普通阅读验证，原文原图保真；既定正式库图片迁移已完成。 |
| T | 本轮离线补验，见下节；120,005 字符 Raw 逐字/重启/重复初始化及真实 MD/TXT/DOCX/PDF 正常与失败样本解析。 |

## 本轮实际补验

环境为当前 Windows、实际 `node --version` 为 `v25.2.1`；全部合成材料，数据放在 `os.tmpdir()` 的新 `aipm-close01-a-*` 目录，无正式配置/数据/用户端口使用。未运行 live 模式。补验未修改测试或降低断言；不把本实例运行环境冒称主线 Node 22 或历史 CI 的 Node 22/24。

| 命令/操作 | 实际结果 |
|---|---|
| `node --import tsx --input-type=module -`，stdin 设置 `globalThis.fetch` 为立即抛错，再设置 argv 为 `scripts/eval/run.mjs --chain standard-extract --recording live-20261115-baseline` 并 import 该模块 | 退出 0，mode=replay，8/8、事实 21/21；结构/证据/召回率均 1，禁止断言/分区违规/重复/空主题均 0。先清 `FMCG_LLM_*`，数据根为新 TEMP，配置路径为不存在文件。显示的 expected provider calls=16 是录制预期，真实外发为 0。 |
| `git log`、`git diff --name-only` 及 `node --input-type=module -` 中 `esbuild.transform` 比较 | 两份 Prompt AI 文件编译结果相等，prompt 规则差异为空。 |
| `node --import tsx --input-type=module -`，使用产品 `RawStore` 创建长文，新 Store 初始化两次，再 get、比较 Markdown Buffer | 120,005 字符逐字相等，ID 保持、初始化未覆盖。正文 SHA-256 `4e905d0907b2e8e900b596a5794b8855a9f231f99f828a25f549f42a4b3c5a5f`，磁盘 SHA-256 `de072326a527d904a72ff9000f637f91c327b8f0faa3680c29753e33d8ce4e56` 前后一致。 |
| 同一 stdin 通过产品 `parseFile` 读取 `tests/fixtures/b03/zh-report.md`、`zh-notes.txt`、`zh-report.docx`、`zh-report.pdf` | 4/4 非空，长度分别 151、78、103、96；UTF-8、mammoth 1.13.0、pdfjs-dist 6.4.299 实际运行。 |
| 同一 `parseFile` 读取 `broken.docx`、`broken.pdf`、`scan-image.pdf` | 3/3 明确拒绝：`DOCX_INVALID`、`PDF_INVALID`、`PDF_NO_TEXT`。PDF 文字层解析不会冒称普通扫描 PDF 已 OCR。 |

回放结果为忽略目录 `evals/results/2026-11-23T14-22-54-194Z-43128ffa-standard-extract.json`，SHA-256 `d42c75c858998024a179814e452d51b9c3133aa9d5e89bd0da1171cfa7cf73cf`；runId、HEAD 与统计均已读取核对。该产物可由上述命令再生，不作为仓内大附件。长文构造为 `' \r\n' + ('中文长文：渠道库存\r\n---\n引号“原文”与emoji😀\n').repeat(4000) + ' \n'`，不是仅做长度校验。重启为新 Store 实例，不冒称本轮另启 HTTP 进程；完整进程重启与 UI 刷新复用 B/O 的独立证据。临时数据已清理。

## 逐项当前结论与可交付边界

各行当前 DOC/RUN 均为 **PASS/PASS**。每行的“边界”是已经证实的交付范围；缺少本轮再测不伪称新实测。

| ID | 依据 | 可交付边界及后续变化适用性 |
|---|---|---|
| A01 | B、T、O | 空根初始化、重复初始化保已有资产；本轮长文文件重复初始化不变，迁移空库/损坏目录已有独验。 |
| A02 | B、U、H、O | UI 保存元数据/正文及稳定 ID；后续人工编辑与网页图导入各有真实 HTTP/UI 读回。 |
| A03 | B、T、H | 十万字、空白/换行/分隔线保全；本轮 120,005 字符逐字落盘/新 Store 读回。不是本轮同等长文 UI 重测。 |
| A04 | B、T | MD/TXT 实际解析与历史当前上传入口读回；本轮两真实文件通过，不扩大为未知编码皆支持。 |
| A05 | B、T、H | 实际 DOCX/PDF 正常/损坏/扫描边界通过；普通 PDF 解析为文字层，按页 AI/OCR 是另行显式流程。 |
| A06 | B、L、H、O | 成功提取/更新/Audit、失败与放弃不改 Raw；人改有历史，AI 媒体派生不覆盖原文原图。 |
| A07 | B、T、O | ID/正文刷新与重启可找回；本轮新 Store 逐字/摘要相同，完整进程/浏览器复用独验。 |
| A08 | B、L、E、O | 真实发起、状态/失败可见有历史 Provider 证据；新图片/整理入口有 HTTP/Edge 补验。 |
| A09 | B、E、O | 现行结构/证据严格校验及非法拒绝；本轮原真实录制在当前代码回放 8/8，不把回放当新增付费成功。 |
| A10 | B、L、E、H、O | 事实、整理、推断、人改与待确认分开；原引文可核，明确人工审核；不承诺所有输入自动无误。 |
| A11 | B、U、L、H、O | 模型仅草稿，编辑失审/零选择/未明确确认不能正式写入；当前标准/deep/PDF 编辑均补证。 |
| A12 | B、U、H、O | 原文、主题、摘要/证据/问题/关联与返回/编辑可用；后续 RawOutcomeReview 有真实浏览器补验。 |
| A13 | B、U、H | 多建议显选、部分提交与未选不写；后续按主题确认/保存清选择已补验。 |
| A14 | B、U、H | Concept 模板/人工字段、审核和正式回读；新结构化笔记不取消旧手动 Concept。 |
| A15 | B、C | Entity 手动创建/类型/模板；复用原独验，后续共用存储兼容与当前全量由主线复核。 |
| A16 | B、L、E | Process 模板和分析建议标识，人工纠偏与未知保留；不把 AI 机会当已落地事实。 |
| A17 | B、L、E | Metric 来源/范围/公式边界；双年数值/比例与单位反例真实样本补证。 |
| A18 | B | 真实 SYN 双源一致/冲突/待确认及当前集成正式综合；旧截断引文限制保留，非无限来源综合质量保证。 |
| A19 | B、C、H | 正式 YAML 字段/枚举与实际导出解析；人工修订不移除既有来源与版本保护。 |
| A20 | B、U、H、O | 正式来源回 Raw、导出追溯 ID；新版正文/图片引文按当前 SHA/位置验证，过期拒绝。 |
| A21 | B、C | 中文 Wikilink 往返与歧义/失效提示，后续公共阅读/存储兼容；不声称本轮重新逐页点击。 |
| A22 | B、L | 既有目标候选、更新/新建/暂不处理无自动覆盖；后续维护动作显式审批。 |
| A23 | B、L、U、H | 实际真实更新预览保原页与人工说明；后续标准维护显式确认/版本冲突保护。 |
| A24 | B、L、E | 双公式/双方口径保留与冲突待确认；新真实跨年与主体/单位样例未混写。 |
| A25 | B、C | 整页/段落 Audit 记录及反馈字段，当前入口由集成/兼容独验支持。 |
| A26 | B、C | open→resolved、decisionHistory、刷新保持；完整重启/恢复 B 已验。 |
| A27 | B、C | 文本+上下文 anchor 在行号移动后定位、歧义拒绝；当前 Audit 字节变动不以旧 SHA 未变冒称，回归由主线复核。 |
| A28 | B | 真正读取 Wiki+Raw+反馈并返回可审核建议；明确为有指导措辞样例，不是自主发现全部问题。 |
| A29 | B、C | 接受才改，拒绝/取消不改，唯一处理历史及幂等；后续公共修订/存储兼容保持。 |
| A30 | B、C、LINT01 | 实际 UI 扫描且只读；LINT01 调整引用识别后的实际 HTTP/行号另见下述说明。 |
| A31 | B、LINT01 | 不存在链接定位具体页/行；当前 `audit.test.ts` 保留冻结检测回归，主线统一执行。 |
| A32 | B、LINT01 | 非 Source 无有效知识入/出链的冻结孤儿定义保留；不是所有页都必须有链接。 |
| A33 | B、LINT01 | 直接扫磁盘缺 YAML，不被列表过滤掩盖。 |
| A34 | B、LINT01 | sources/knowledge_status/confidence/source_level 缺项报告；实际多行引用/未引段落检测补证。 |
| A35 | B、C、U | 标题/别名/标签/正文/分类中文搜索，公共搜索/界面后续兼容。 |
| A36 | B、C | qmd 非前置；现行独立服务与搜索无外部索引依赖。 |
| A37 | B、U、C | 手动 Prompt 创建及完整回读；新版 Library 实际链已验。 |
| A38 | B、U、C | 编辑落盘、版本保护与其他记录不受影响；后续反馈绑定版本不改正文。 |
| A39 | B、C | 列表/搜索/重启不复活，知识仍可用；删除原 store 边界及兼容回归复用。 |
| A40 | B、U、C | Library 中文名称/标签/正文搜索及清空恢复；不是本轮再次 UI 输入。 |
| A41 | B、U、C | 默认分类、筛选和真实数量；Library 后续反馈功能未改分类契约。 |
| A42 | B、U | 中文/重复变量、缺值与字面替换；新版 UI 真剪贴板使用填值结果，模板保留。 |
| A43 | B、U | 实际剪贴板复制至普通文本目标逐字一致；本轮没有读用户剪贴板。 |
| A44 | B、P | 单个自然语言主要输入真实外发，Brief 可后改；未要求起步填写全表。 |
| A45 | B、P | 真 Brief taskName/taskType+七字段完整；同业务代码/契约等价核查已做，原两次 FULL3 格式失败保留。 |
| A46 | B、P、U | 人工修改确实进入正式生成请求/产出；B 的末三分钟条件及 P 两模板实测。 |
| A47 | B、P、U | 显选/取消 Wiki 与必要背景完全对应；17 标题空壳失败已由18补证，不回写17。 |
| A48 | B、P、U | Brief 确认后真实完整 Prompt、结构元数据及预览；当前 AI 服务编译等价。 |
| A49 | B、U | 生成/重生成/退出不自动进 Library，明确保存才写；新版 UI 正式集合/SHA 实测。 |
| A50 | B、U | 用户编辑后的名/正文/变量用于复制保存，历史真实与新版 UI 读回组合。 |
| A51 | B、U | 显式保存、中文搜索/读取 source=ai_generated；不把预览算正式。 |
| A52 | B、P、U | 优化原文完整快照与比较，原旧版本正文保持。 |
| A53 | B、P、U | 九维弱/完整两类真实样本；完整样本无缺项不强造缺项。 |
| A54 | B、P | 弱样本具体可执行建议，完整样本 improvements 为空合法；保留事实边界。 |
| A55 | B、P、U | 真实完整重写，变量/目标/未知边界保持，可编辑复制；新版保存 UI 补验。 |
| A56 | B、U | 同 ID 新版 ai_optimized、旧正文/来源可读、更新时间和版本递增；反馈按版本隔离。 |
| A57 | B、C、L、H | 手动与真实四链 23 文件刷新/同根重启/新根恢复，以及后续维护事务恢复；不以仅构建推定持久化。 |
| A58 | B、C | 实际下载 Markdown，YAML、正文、双 Raw 及 Wikilink 独立读取；大附件不新增入库。 |
| A59 | B、C | 实际 Prompt Markdown 独立读取正文、变量和必要元数据，起源与版本修改来源分开。 |
| A60 | B、P、C、O | 鉴权/超时/非法/空响应不造正式资产，错误可见；后续 OCR 失败/降级保原文，fake 仅证明错误路径。 |
| A61 | B、U、C、H | 禁 Provider 时 Raw、手动 Wiki/Prompt 创建编辑/搜索/重启可用；本轮解析/长文未用 Key。 |
| A62 | B、C | 演示资产/入口标识和初始化幂等；未把示例数据当真实公司事实，未向正式库重灌种子。 |
| A63 | B、U、L、E、H、O | B 已有桌面真实四链；后续 Prompt UI、标准链真实/回放、审核编辑和图片 UI 分别补证。可交付已验核心流程，不声称本轮在最新代码重新付费跑完四链或所有扩展功能。 |

LINT01 指 [LINT01 独立验收](LINT01-review.md)，交付 `5ddf358`，实际 TEMP HTTP 18/18、回归25/25、只读扫描82文件保真；本轮已读报告的最终版本绑定。不能把 B09 的旧 `lint.ts 未变` 理由沿用至今。

## FULL3 旧 FAIL/BLOCKED 逐项去向

| 旧 ID/状态 | 原缺口 | 后续具名关闭证据 | 当前裁决 |
|---|---|---|---|
| A06 BLOCKED | 成功提取/更新/放弃组合不足 | B 的 I01 创建/更新、I02 Audit、原失败/放弃保全；L/H/O 后续 Raw 字节/原件/人改边界 | PASS；不能扩大为 AI 可改 Raw。 |
| A09 BLOCKED | 真实提取超时、合法结构不足 | B 的 HUMAN/OQ/R22 实际草稿与 strict 拒绝；E 真录制、本轮现行代码回放 | PASS；保留旧超时，不承诺长文任意成功率。 |
| A10 BLOCKED | 真实事实/整理/推断质量不足 | B 的人工主题/原候选保全；L 真实跨年/推断边界；E 反例/分区检查 | PASS；旧自动主题误放 FAIL 不改写为当时通过。 |
| A18 BLOCKED | 真实综合超时 | B 引用 SYN 真实双源冲突/一致/问题，并完成 I01 显审/正式综合 | PASS；不是只凭 B05 fake。 |
| A23 BLOCKED | 更新因提取前置未执行 | B 的真实 U05 预览 v1 不变→明确确认 v2/双 Raw/唯一日志，L 后续真实标准维护 | PASS。 |
| A24 BLOCKED | 同前置，冲突保留未验 | B 的 A 真20/30冲突及 U05 不覆原文；L 年份/口径并存，E 单位/主体反例 | PASS。 |
| A45 FAIL | Brief schema/context 与 invalid JSON 两次失败 | P 七类真实 Brief，B 的 Brief16 原请求/响应/AX，当前代码/契约编译等价 | PASS；原失败仍为历史。 |
| A46 BLOCKED | 修改进请求但无生成产出 | P 编辑目标影响两类生成；B 原17/新18相同 Brief、末3分钟条件实际保留 | PASS；17上下文失败不被此子条件掩盖。 |
| A48 BLOCKED | 真实生成超时 | P 两类真实生成保存，B 修复18真实生成/保存/刷新 | PASS；原超时及17失败保留。 |
| A53 BLOCKED | 弱/完整检查超时 | P 两类九维真实质量，B check19 完整样本九维全 present | PASS。 |
| A54 BLOCKED | 未得可审建议 | P 弱样本实际改进、完整样本不造缺项，B check19 复验 | PASS。 |
| A55 BLOCKED | 未得完整优化正文 | P 三 rewrite 与新条目/新版本，B rewrite20 原稿/显式保存 v2/旧版保留 | PASS。 |
| A63 BLOCKED | 桌面真实四链未齐 | B I01–I06 真四链+23文件恢复；U 新版完整App链，L/E/H/O后续范围补证 | PASS，限定已验核心流程；本轮真实外发0。 |

上表合计13个历史未通过项：1 FAIL、12 BLOCKED。原 FULL3 总109项 `78/3/28` 是全表数量，不能直接当 A 系列数量。其余50项沿已有独验并按上表补受影响范围；没有仅因“新批次PASS”就直接覆盖全部旧行。

## 未扩大交付的限制

- 原模型自动归属/重复/截断单引文等已披露质量局限仍存在其历史语义；人审闭环通过不能宣称模型自动语义缺陷全部根治。E 的短合成样本通过也不代签所有 deep、长 PDF、媒体视觉语义或所有现实业务输入。
- 既定正式库历史图片迁移已完成；用户正式 PDF 草稿尚待明确确认，这是操作边界，非 A 系列已实现能力失败。
- 本轮没有新增已确认产品缺陷；没有创建攻击、绕过或漏洞 PoC。主线的工程/浏览器最终检查及 R/会议裁决若出现新的实际失败，应据受影响 ID 回退本表结论，不能让历史 PASS 抵消当前 FAIL。

本报告的施工交付状态：**证据对账及离线补验完成**。**施工者自查建议 PASS，独立裁决由 CLOSE01-review。** 全项目批次状态由主 Agent 结合其余范围和必要门禁裁决。
