# CLOSE01：R01–R46 证据对账

2026-11-23，证据审查子实例 `/root/close_r`。冻结产品基线 `aff5b325ad1b40c0f47e98171bccd46eae02f15c`。本实例只新增本报告，并按主 Agent 后续指令修正 `tests/pipe01.test.ts` 一行并发断言；未改产品、正式资料或模型配置，真实 Provider 调用 **0**，未创建攻击、绕过或漏洞 PoC。不提交，由主 Agent 统一收尾。

## 对账结果与适用标准

**R01–R46：46 PASS / 0 FAIL / 0 BLOCKED**，有相应历史独立验收、后续适用性依据及本次文档收口。曾发现R46的旧矩阵现行身份冲突，主Agent同步五份文档后已核关闭。这不是本轮重新运行46项UI/真实模型实验，也不是全项目最终裁决；当前全量测试和其他需求由主Agent与独立验收实例汇总。已证旧缺陷的关闭与CLOSE01整批通过分别判断。

起点 [delivery-matrix](../delivery-matrix.md) 是 FULL3 的 **2026-10-14 快照**，R 部分实际为 **28 PASS / 2 FAIL / 16 BLOCKED**。其旧失败不能直接搬作当前失败；也不能只因最新批次 PASS 就自动抹除。真实后续链为：[10-24 缺口归并](NEXT-PREP-20261024-gap-map.md) → [10-29 集成独立逐行审查](B09-INTEGRATION-AUDIT-20261029-matrix.md)（108 PASS / R13 FAIL）→ [R13 独立适用性收口](R13-MERGE-20261029-matrix-audit.md)（109 PASS，产品 `53c16918a9c284a1c18fd7e47f468d9b960a1c89`）。[B09 最终矩阵](B09-RESUME-20261029-matrix.md) 是该时点的逐项现行表，不是 FULL3 原表被追改为通过。

标准演进按实际授权处理：

- [产品规格顶部 2026-10-23 修订](../product-spec.md) 明确全部知识候选逐页人工审查，AI 不保证独立主题或业务归属正确；人工纠偏不能称历史模型误放已自动修复。[B09 集成卡「R16/R18 最终判定规则」](../handoffs/B09-INTEGRATION-20261029-task.md) 明确 Concept/Process 模板、真实正例、人工纠偏、失审/重审及正式回读可组合验收。R12/R16/R18/R23 据此裁决。
- R13「合并建议」和 R19「不同来源公式并列保留」仍见 [acceptance R13/R19](../acceptance.md)，没有被上述人工职责调整取消。R13 必须有无损合并实测，R19 必须保留实际冲突证据，不能用字段占位或新模型正例替代。
- R01 的五项导航、R43 的 MVP 排除清单结合后续已授权批次理解。会议、事项、资讯、单链接导入和自动化已有各自任务/独验；其中自动化不能直接写正式 Wiki/Prompt 的约束仍在。不能按旧「只有五项」把获授权扩展判为缺陷，也不能以扩展授权取消多 Agent 运行时、Prompt 自动执行等其余禁区。
- [RAWEDIT02](RAWEDIT02-20261114-review.md) 允许用户人工修正文并保存历史，AI 不改 Raw 的约束未变；[RAWOCR01–04](RAWOCR04-review.md) 将 OCR/VLM 内容存为派生记录。RAWOCR04报告记载的是当时隔离开发验收；随后正式库选定范围已由主Agent执行迁移，不能沿旧摘要继续记「未迁移」。

## 证据索引与版本

下列简称仅用于表格；每份原报告保留实际命令、样本、版本、限制和旧失败。

| 简称 | 独立证据与受验版本/边界 |
|---|---|
| B | [B09 最终矩阵](B09-RESUME-20261029-matrix.md)、[集成逐行版本核对](B09-INTEGRATION-AUDIT-20261029-matrix.md)。基础 B01–B09、解析、搜索、Library、种子等分支按原始实测及冻结核对复用，非本轮重测。 |
| I | [完整 App 集成阶段独验](B09-INTEGRATION-AUDIT-20261029-stages.md)，产品 `c6474fe98c63440d7b9cbdb7fe15e98eb8b6aba8`。知识 update262、Audit263；Brief16、generate17 历史 FAIL、修复后 generate18/check19/rewrite20；两根各 23 文件 SHA 保真及真实 UI 重启/恢复。 |
| M | [R13 独验](R13-MERGE-AUDIT-20261029.md)、[46R/63A 适用性核对](R13-MERGE-20261029-matrix-audit.md)，产品 `53c16918`；M01–M06，独立 9/9、实际完整 App。无 Provider 新调用。 |
| P | [PA01 最终续验](PA01-CONTINUE-20261016-acceptance.md)，96 产品/58 默认测试冻结；241/241 等为该冻结历史结果。真实七种 Brief、生成及弱/完整 Prompt 优化，15/24 调用；SP-F01、Prompt BL-F01、ST-F01 关闭。 |
| K | [KB02 HUMAN 收口](KB02-HUMAN-CLOSE-20261023-acceptance.md)、[A 更新及公式冲突](KB02-K204-A-AUDIT-20261023-resume-final.md)、[C 长文](KB02-K204-C-AUDIT-20261024-final.md)，由 B/I/M 逐行关联；106400 字符、14 区域、人工归属及 Raw 保真，非所有模型自动质量承诺。 |
| S | [SYN01 双来源最终独验](SYN01-VERIFY-AUDIT-20261026-final.md)，新 seq244 真综合及显审/三页/日志闭环；旧242结构 FAIL、243语义 FAIL 原样保留，当前综合由 I 进一步集成。 |
| T | [Concept/Process 模板独验](R1618-AUDIT-20261026-final.md)、[Concept 真实 COVER](R1618-COVER-AUDIT-20261028-real.md)、[Process HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)、[strict O/Q](OPENAI-STRUCTURED-AUDIT-20261029-real.md)。O255–256 动作状态、Q257–258 question-only；旧自动失败不追改。 |
| L | [R22 工程/UI](R22-AUDIT-20261029-engineering.md)、[真实259–261](R22-AUDIT-20261029-real.md)，交付 `e04231e`；官方 A、未知 D、综合最低 D、人工改级使审批失效。不是外部真实性核验。 |
| D | [KB03 R10](KB03-R10-20261031-review.md)，产品 R9 `f8ca1e3ec9bcaff2af1975472bf1dfc9b7010fb2` / revision19；固定33/40及反例通过，与 R1–R4、R6/R9 工程/UI/恢复组合。不能把深度结构笔记的后续能力倒称 10-29 已实测。 |
| U | [首页 HOMEUI01](HOMEUI01-20261108-review.md)（`8a8d7741`）、[RAWEDIT02](RAWEDIT02-20261114-review.md)、[RAWOCR02](RAWOCR02-review.md)、[RAWOCR03](RAWOCR03-review.md)、[RAWOCR04](RAWOCR04-review.md)。后续新入口、人工编辑、正文/图片失效和阅读位置有独立覆盖；浏览器、HTTP、组件与回环模型证据分别标注。 |
| E | [ENG04 独验最终段](ENG04-20261122-review.md)（`6a5eff6`）：411 文件格式化复算/核心语义等价、本地及 Windows Node22/24 CI。825 警告和9项候选问题为已披露基线，不能称本次已全部修复。 |

## R01–R46 当前逐项结论

「历史」列为 FULL3 原表的 RUN 状态；PASS 均按当前已授权产品范围，并保留最后一列的真实边界。本表尚未取得主 Agent 本次全量/新浏览器检查的最终汇总，不将其列为本实例实测。

| ID | 历史 | 当前 | 依据与后续闭环 | 边界及本次适用性 |
|---|---|---|---|---|
| R01 | PASS | PASS | B/I 当前完整导航与三个 Prompt 子入口；U 首页后续改版。 | 后续会议/事项/资讯/自动化有单独授权；五项导航是 MVP 早期约束。 |
| R02 | PASS | PASS | [open-source-reuse](../open-source-reuse.md) 对两上游逐文件/规则/思想、改造和未复用范围说明，B/I 的 I08 独立核对。 | 本轮读取本地既有核验记录，未重新联网认证上游；活动分支无固定 SHA 的局限仍明示。 |
| R03 | PASS | PASS | 复用记录及 [MIT 原文](../../THIRD_PARTY_LICENSES/LLM-Wiki-KB-MIT.txt)；B/I08。 | 本地记录为独立 TypeScript 实现、仅参考思想；第二上游未取得 LICENSE，不能误称已核其 MIT。 |
| R04 | PASS | PASS | B/I 完整 server+App、禁 Provider 手工实例；当前 package scripts 独立启动。 | 开发 Agent 不进入运行依赖；没有本轮另装一台无 Codex 设备的实验。 |
| R05 | BLOCKED | PASS | K 提取/更新、P Brief/生成/优化及 I update/Audit/Prompt 四阶段使旧六业务成功缺证闭环。 | 当前服务仍使用产品 `LlmProvider`/统一 Provider 边界；模型质量按各原样本，不签所有服务永久成功。 |
| R06 | PASS | PASS | B/K 的规则载入；T/M 的分型字段；当前 `services/llm/rules.ts` 实读规则和 Schema。 | AI 规则并非空文件；HUMAN 修订取消前置模型语义审核，机械结构/证据/秘密门禁仍保留。 |
| R07 | BLOCKED | PASS | K Raw→Wiki、S 真实综合、I Markdown 独立读取/分库及23文件恢复，M 新字段解释保真。 | 后续 D 深度笔记、U OCR 为增量；未把历史全表机械搬运当新字段解释验证。 |
| R08 | PASS | PASS | B、K长文及 I07 当前粘贴/上传元数据回读；U 新网页入口与人工正文历史。 | 元数据可空；新增导入/采集修订不让 AI 改正文，不声称所有网页可采。 |
| R09 | BLOCKED | PASS | K 阶段/取消/恢复、O/Q 拒坏与合法候选、I 未处理/待审/confirmed；U 编辑后旧派生失效。 | 旧超时是历史实际失败；当前状态机械路径有验证，无须制造付费故障重跑。 |
| R10 | PASS | PASS | B03-recheck 的真实 MD/TXT/DOCX/PDF解析，I07 原件上传/元数据/刷新，U 新导入。 | 链接抓取按 RAWURL01 后续显式授权；PDF/OCR 局限由后续任务说明，不承诺任意加密或扫描文件皆成功。 |
| R11 | BLOCKED | PASS | K 事实→规划→组装现行契约，T/OQ与 L 实际结构字段，I/M 回读。 | 旧 `document/suggested_pages` wire 已演进，不要求回退旧协议；非法结构必须拒绝，未知事实不能靠补造通过。 |
| R12 | BLOCKED | PASS | [R12 独验](R12-AUDIT-20261026-final.md) 人工问题独立显示/失审/14页重审/正式回读；I/M、OQ question-only。 | C09/10 自动分类旧 FAIL 保留；原件三项专门验收依赖归档真实材料，本轮按 testing.md 不运行、不改 SHA 或造替代材料。 |
| R13 | PASS | PASS | 后续发现带字段候选 `TEMPLATE_MERGE_UNSUPPORTED` 为新 FAIL；M 修复同型/跨型/再次合并、字段/来源完整、编辑全页失审和明确写入，9/9及实际UI。 | 仍保留首目标类型，类型切换限制与3MiB原子上限披露；标准草稿合并不等于深度笔记可更新任何既有知识卡。 |
| R14 | PASS | PASS | B 六类型、T 分型、M 合并保持首类型；当前 `rules/fmcg-schema.yaml` 仍六类。 | 后续知识笔记是内容结构而非新增 Wiki 类型；未用 UI 标签或 Prompt 分类当新类型。 |
| R15 | BLOCKED | PASS | K/C 与 L 真实 Source→Raw，I Source/正文/来源/正式回读，M 合并来源完整，D 深度 Source。 | Source 为摘要/笔记，Raw 保全文；来源登记日期和链接是线索，不是已核真实性证明。 |
| R16 | BLOCKED | PASS | T 模板、COVER Concept 正例、HUMAN字段编辑/失审/重审与 I/M 正式保真组合，集成卡明确接受此组合。 | 缺支持字段留空/待确认；不是证明每次模型自动填充、语义都正确。 |
| R17 | BLOCKED | PASS | B02 Entity 模板，K/C 14区域 entity/store 来源/时间口径/关联与正式回读；B/I/M 适用性确认。 | 不把一次实体样例扩大为所有企业/平台/机构输入的模型质量保证。 |
| R18 | BLOCKED | PASS | T Process 模板/分析建议、HUMAN 纠偏保存/审批1→0→1、O输出状态/Q未知及 I/M 共用路径。 | seq246/248/252 自动栏目/完成性/痛点评价旧 FAIL 保留；当前人审门禁已补，不称其自动修复。 |
| R19 | BLOCKED | PASS | K/A 双源20/30公式与边界、B02 Metric完整模板；I 原正文保留与冲突路径、M 下游update保全。 | `page-templates.yaml` 仍定义定义/含义/公式/范围/来源/解读/误区/关联；当前 `b05.test.ts` 保留两公式/旧revision拒绝回归，不因HUMAN取消冲突要求。 |
| R20 | BLOCKED | PASS | S seq244 双Raw一致/冲突/待确认、三页/日志/正式回读；L A/D综合与 I 完整集成。 | 旧综合242结构/243语义失败保留；L 单条 locator 止于 JSON 后缺尾词 Schema 的局限保留，不能签逐引文独立支持全部语义。 |
| R21 | PASS | PASS | B YAML/枚举，L 等级类型校验，I 综合Markdown独立YAML读取，M 正式存读。 | 草稿主题/归属批准与 Wiki `review_status` 是不同字段；正式入库不自动升级 verified/reviewed。 |
| R22 | BLOCKED | PASS | L 工程/UI及真实259–261：官方 A、未知 D、多来源最低 D；人工显选保存及改级失审。 | A/D 正例不能保证 AI 能自动验明任何来源身份；用户仍可纠正等级。 |
| R23 | BLOCKED | PASS | K 多区域归属与整unit迁移、全部页逐页批准；I/M编辑失审/再次显审，按规格10-23修订。 | 不要求固定页数或自动稿主题绝对正确；未解决归属阻断全部正式写入。 |
| R24 | BLOCKED | PASS | K/A、BR 后续候选/目标/更新闭环；I U05 真实预览原v1不变→确认v2追加，M 合并字段更新保全。 | 原 duplicates 404 及模板更新入口缺口已各有后续验证；内容相似是候选，不自动覆盖。 |
| R25 | PASS | PASS | B06 字段/anchor及 I Audit263 当前记录、Wiki版本和operation关联。 | 历史定位算法分支与本次指定纠错句证据组合，未重做每类severity浏览器实验。 |
| R26 | PASS | PASS | B06四决策和状态映射，I 当前建议→预览→显式accepted→resolved/rev3及日志、刷新。 | 本次真实纠错由人工明确指定措辞，不能称模型自主发现；deferred不伪报resolved。 |
| R27 | PASS | PASS | B06上下文、多匹配/改删拒绝，I 精确句替换与旧anchor stale解释。 | 行号不是唯一定位；旧版anchor失效是可见历史，不是静默修改错误位置。 |
| R28 | PASS | PASS | I 当前create/update/audit日志及Prompt生成/优化前后知识日志SHA一致，M 幂等2create日志。 | 后续自动化运行/事项日志独立，不冒充知识新增；优化新版本不增加Prompt对象数。 |
| R29 | PASS | PASS | B06 十一类有效fixture，I07 当前4页实际Lint仅合法ORPHAN，L/M新增等级/字段兼容。 | 自动化巡检后续授权没有放开自动改知识；扫描结果不代表事实已经外部验证。 |
| R30 | PASS | PASS | B 中文五范围/无qmd；I 当前创建/更新后的中文查询，后续Wiki UI仍调用同产品搜索。 | 不引入强制qmd、图数据库或向量服务；旧删除索引同步按原实测复用。 |
| R31 | PASS | PASS | I 六计数2/4/6/2/0/1与对象/日志一致；U 首页四入口+更多工具/待审/Audit操作；当前首页仍六计数。 | 首页布局经授权演进，原五快捷入口可以分布在四入口/更多工具；上海周界与Raw+Wiki口径仍在。 |
| R32 | PASS | PASS | B02/B09 分类视图与13分类；当前Schema提供分类，后续首页/知识页调整未移除分类能力。 | 分类视图不是知识图谱；不将未安装qmd视为地图不可用。 |
| R33 | PASS | PASS | B07完整Library，I手工编辑与ai_generated保存/中文搜索/刷新；后续L5使用反馈为独立扩展。 | 收藏/标签/复制/版本沿相应历史实测及默认回归；不是本轮再次操作剪贴板。 |
| R34 | PASS | PASS | B07元数据/中文变量；P/I 当前v1生成/v2优化、独立导出完整字段。 | source=ai_generated表示生成起源，v2 changeSource=ai_optimized表示此次修改，不混为互斥来源。 |
| R35 | FAIL | PASS | P七种真实Brief关闭FULL3契约失败；I Brief16人工编辑→generate18→保存，保留旧17上下文FAIL。 | 六模板+custom旧样本不必重复调用；不会以手填Brief冒充AI第一阶段成功。 |
| R36 | BLOCKED | PASS | I先发现17仅发16字标题为新FAIL；CX工程和generate18实际1363字定义/正文、仅选中Concept进入请求及生成结果关闭。 | 单页3000/总12000/最多6页的工程边界，预算不是全文无限输入保证；旧17失败不删除。 |
| R37 | PASS | PASS | P/B08及 I18 Preview编辑/保存/刷新，UI复制/返回/不自动保存分支历史适用。 | 当前实例未操作剪贴板；历史保存与复制分开说明。 |
| R38 | BLOCKED | PASS | P弱Prompt实际缺项及可执行建议；I19九维present/不虚造建议与20完整优化。 | 完整输入可无改进点，无92分等伪总分；旧60秒超时保留，不声称全部输入质量。 |
| R39 | PASS | PASS | P新条目/旧条目新版本，I原ID第2版、旧v1逐字等于check.originalBody、时间递增/ai_optimized。 | 人工编辑和显式保存后才正式写入；版本历史不被重写。 |
| R40 | PASS | PASS | B07删除/失效关联边界，I知识/Prompt分库及23文件重启/恢复和独立Markdown。 | 关联失效可见但Prompt正文可继续使用；Prompt不能成为知识搜索/导出的前置。 |
| R41 | PASS | PASS | [SEC S03/S04](SEC-20261013-acceptance.md)六链脱敏/拒绝/资产保全、P/I/L严格输出及公开请求无认证头；当前默认安全回归由主Agent汇总。 | 本实例未读取真实密钥、未新建安全PoC；不是签所有未来Provider/新外部系统安全，也不把0真实调用当真实Provider验证。 |
| R42 | FAIL | PASS | I四条真实业务完整App链+版本/来源/日志/重启恢复，M关闭新发现R13合并缺口。 | 四链明确关联真实样本与readback，生成17历史失败、新18成功分别保存；不是当前再调四链模型。 |
| R43 | PASS | PASS | B范围核对；后续任务卡已授权会议/事项/资讯/RAWURL/自动化，当前 `services/automation/context.ts` 禁正式写入。 | 按授权演进判断；仍不承诺全租户权限/复杂CRM/GraphRAG/多Agent产品运行时/Prompt自动执行等原排除项。 |
| R44 | PASS | PASS | B09演示1Raw/5Wiki/4Prompt/示例任务及幂等保护，I/M未改变其职责。 | 演示要显式导入、全标演示且不覆写用户资料；本轮未向正式库灌种子。 |
| R45 | PASS | PASS | I/M长正文审核与Preview实操、U桌面/390px及后续自动化UI独验，E纯格式化等价。 | 不是只凭截图签数据链；当前新浏览器证据由主Agent独验汇总，未把回环模拟数据当真实模型。 |
| R46 | PASS | PASS | 原I08/M及[README11-09独验](README-20261109-review.md)作为历史；本轮实际读取主Agent对README、delivery、delivery-matrix、status、raw-media-migration五份文档差异。 | 旧FULL3已明确历史快照，当前入口指向本次A/R/独验报告，四链/真实样例/维护项/用户待审与正式迁移状态分别说明。最终代码提交与检查结果由结项独验绑定，不以本报告先行冒签。 |

## 真实旧失败的后续处理

FULL3 R部分的 **2 FAIL +16 BLOCKED** 在上表逐项列出真实后续依据，当前均找到后续闭环。另有后续新 FAIL 必须保留：R12原C09/10分类、R16/R18原246/248/252自动稿、SYN01的242/243、R36生成17、R13模板合并不支持；它们分别经人工职责修订后的明确纠偏/审查链，或新代码与新受控验证收口，不能靠其他样本HTTP200或批次标题PASS消除。

最新 U 报告也不是无失败史：RAWOCR01首轮乱码分词漏判、RAWOCR02旧转录进入上下文及孤立图片引用两轮返修、RAWOCR04目录损坏误报空库，均有原失败记录和最终独立复验。主Agent本会话后续正式库迁移交接为：已备份、9/9位置回读、原528文件字节一致；本实例复用该执行交接并核对现行五份文档，没有重新访问正式资料、公开ID或本机路径。PDF01-GLOBAL待用户确认入库、ENG04候选问题未实施仍是实际限制，不能转写为「草稿已正式入库」或「候选问题全修」。

## 本实例实际命令与独立验证交接

1. `git rev-parse HEAD` 返回上述 `aff5b32`；初始 `git status --short` 为空。`Get-Content`/`rg` 读取实际规格、验收、旧矩阵、B09最终逐行表及上述独立报告；`git diff --name-only 53c16918 aff5b32 -- services app server rules scripts/backup_workspace.ts` 确认后续存在广泛功能变化，故不声称53c16918全部代码原封不动沿用。用更新批次D/U/E等补充变化边界，当前全量仍由主Agent负责。
2. Node只读提取 `delivery-matrix.md` 的R行：46唯一行、28 PASS、R35/R42两个FAIL及16个BLOCKED，与上表历史列一致。读当前 `page-templates.yaml` Metric八栏目、`b05.test.ts`两公式保留用例，R13/R19没有被10-23修订删除；读当前Provider调用、规则载入、首页六计数与自动化禁正式写入源码，未启动产品或读正式配置。
3. **NEWSRAW02最小测试修正**：只将 `tests/pipe01.test.ts` 中固定第二请求 `created=false` 替换为 `assert.deepEqual([third.created, duplicate.created].sort(), [false, true])`。`NewsService.saveRaw()` 先等待edition读取，再进入共享 `NewsRawSave` 队列；并发参数顺序不保证入队顺序。[NEWSRAW02任务卡](../handoffs/NEWSRAW02-task.md)只要求现存同源记录幂等，没有规定第二请求必为复用者。相同Raw ID、第三代唯一ID、材料采集3次、现存Raw1条、不重复整理等断言保留，未弱化不重复创建的契约。
4. Windows Node **25.2.1**，新TEMP/空配置、清除继承 `FMCG_LLM_*`、代理不用于回环，四个独立子进程依次执行：`node --import tsx --import ./tests/support/css-stub.mjs --test --test-reporter=tap --test-name-pattern="with three failures" tests/pipe01.test.ts`，四次分别 **1/1 PASS，0skip**，exit0，耗时1.872/1.798/1.786/1.795秒。模拟源/模型均在夹具内，无真实Provider。临时目录经专属前缀与绝对父目录核对后删除。两次此前沙箱内执行在654行因candidate缺失而失败，未到改动断言；允许回环执行环境完成四次验证，未隐去环境失败。
5. `git diff --check -- tests/pipe01.test.ts` exit0；冻结测试 SHA-256 **`A875002A6C7DE73204F674F7701663F55596C524DB2CC6E64EC3645C94F0C9A2`**。已交独立 `/root/close_review`：该实例另用 Node22隔离复验1/1 PASS；最终裁决以其报告及主Agent提交为准。基线提交加这一行是测试受验版本，不冒称基线提交本身包含新断言。

6. 文档返修后实际执行 `git diff -- README.md docs/delivery-matrix.md docs/delivery.md docs/status.md docs/raw-media-migration.md`：五份现行入口均已同步，旧FULL3标题改为历史快照、链接本次A/R及独验报告，正式迁移状态与主Agent交接相符，R46文档缺口关闭。Node只读校验46唯一R行、18个旧非通过ID齐全、相对文件链接全部存在；报告最终46 PASS。主Agent最终独验报告正在落盘时的链接由最终整体验收统一核对。

本实例施工状态：R证据对账与一行测试修正已交接，停写；产品修改 **未执行**。独立验收状态：历史产品结论按原独立报告复用，本次测试修正已另交独验；R46本次文档缺口已核关闭。CLOSE01整批及最终提交/同步仍由主Agent与独验裁决，本报告不单独签全项目最终PASS。
