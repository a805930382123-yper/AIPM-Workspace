# B09 当前109项最终裁决（R13完成，2026-10-29）

**109 PASS / 0 FAIL / 0 WAIT；B09按现行验收标准通过。** 本轮R13 M01–M06独立通过，关闭带模板字段候选合并缺口。代码提交 53c16918a9c284a1c18fd7e47f468d9b960a1c89。原108项按受影响边界补证和未变版本复用，不声称109项本轮全部重新执行。

**R13M**：[R13独立验收](R13-MERGE-AUDIT-20261029.md)、[矩阵影响复核](R13-MERGE-20261029-matrix-audit.md)、[实际UI与版本证据](R13-MERGE-20261029-main.md)。此前证据缩写、freeze及历史版本沿[前轮独立逐行报告](B09-INTEGRATION-AUDIT-20261029-matrix.md)。该报告保留当时108/1结论，不追改历史。

统计：63A+46R共109唯一行全部PASS。施工52/52与补1/1、独立9/9、build及实际完整AppM06分别记录；真实API新增0，知识263/500、Prompt20/24不变。旧模型质量FAIL、Prompt17失败及综合引文尾词限制保留，不等于模型可免人工审核；本轮不新增最低Node、跨平台或部署验收。

| ID | 最终裁决 | 证据 | 版本适用性与限制 |
|---|---|---|---|
| A01 | PASS | B01、B09、S | 当前手工空根/重复启动及完整四链同根重启、新空根restore实际通过；三份23文件SHA一致，初始化不覆盖现有资产，独立两根实盘0漂移。 |
| A02 | PASS | B01、C、P、I07 | 新manual yqIAZf实际粘贴与Markdown上传，刷新回读Raw81fcd7a5及asset27e44e6e，元数据/正文SHA和原件可见；保存入口变化已覆盖，不要求编辑不可变正文。 |
| A03 | PASS | B01、C、P | 106400字符保全历史实测；raw/store及解析/限制未见本轮变更，I01两Raw摘要保全补受影响读取边界；不称重跑长文。 |
| A04 | PASS | B03-recheck、P、I07 | 当前Markdown上传233B/原件及正文SHA一致并刷新；TXT与Markdown共用RawPage FormData上传入口及未变UTF8解析，历史TXT真实样本复用，不重跑PDF。 |
| A05 | PASS | B03-recheck、P | 正常/失败真实DOCX/PDF解析历史有效，parser SHA与锁文件不变；仅文字层、无OCR和旧Node实测限制保留。 |
| A06 | PASS |C、A、H、OQ、P、S、R13M |I01创建/更新及I02前后Raw SHA独立一致；历史失败/放弃不写Raw边界配当前拒坏/审批回归复用，不称覆盖所有模型语义。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A07 | PASS | B01、C、S | 完整四链同根重启/新根恢复后原Raw ID/正文/文件SHA保持，实际Raw页面回读；23文件及两根实盘独立比较一致。 |
| A08 | PASS | C、OQ、R22E、R22R、P | R22当前实际提取/规划及当前完整App候选回读组合；提取259/260为真实调用，I01明确是readback，非本轮再次点击生成。 |
| A09 | PASS |H、OQ、R22E、R22R、P、R13M |现行facts/planning契约、strict非法拒绝、R22等级类型拒绝及真实草稿保全已证；按现行契约解释旧document/suggested_pages文案。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A10 | PASS |A、C、R12、HUMAN、OQ、P、S、R13M |当前I01字段与原候选逐字段相等、人改标签及分区回读；U05原正文/事实不覆盖。旧自动误放FAIL不追改。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A11 | PASS |C、HUMAN、P、S、R13M |未审综合被拒、编辑失审、U05预览时目标仍v1，明确确认才v2；当前UI与磁盘证据匹配。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A12 | PASS |C、HUMAN、P、S、R13M |当前草稿/综合/更新预览及返回来源、审核与正式回读覆盖受影响UI；原子ID见P/S。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A13 | PASS |BR、R12、H、P、S、R13M |从60f83ad比对DraftReviewPage/drafts后，选中状态/全选/部分提交分支未改；新增模板校验与审批失效已被R22/当前I01覆盖，历史BR多页部分确认可复用。旧合并限制本轮已关闭。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A14 | PASS |T、COVER、P、S、R13M |Concept分型及真实有据解释历史与当前人工编辑、保存、显审、正式回读组合；模板更新只追加不覆盖。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A15 | PASS | B02、C、V2 | WikiPage/store及手动模板相对60f83ad未变；render新增仅Concept/Process模板分支，templateSections(Entity)为空，历史Entity创建/回读/表达继续适用。 |
| A16 | PASS |T、HUMAN、OQ、P、S、R13M |Process模板及分析建议标识、HUMAN真实纠偏回读、O/Q状态/未知保真，当前共用字段/审批路径I01覆盖；按任务卡组合规则。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A17 | PASS | B02、A、R22E、V2 | Metric模板、WikiPage/store相对60f83ad未变，新增templateSections仅Concept/Process；历史实际指标/范围/冲突加R22指标等级回归适用。 |
| A18 | PASS | SYN、R22R、P、S | 历史双源冲突/一致/问题质量与当前双Raw综合显审/正式落盘组合；A/D对应、整体D；单条引文尾词限制保留。 |
| A19 | PASS |B02、C、R22E、S、I07、R13M |当前正式Source/Concept/综合YAML字段及等级已由R22/P/S回读；新综合实际Markdown导出被YAML解析，id/D/双Raw/人工快照正确。恢复另归A57/I06。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A20 | PASS |C、P、S、I07、R13M |当前实际来源回跳Raw与ID/正文已证，新综合Markdown实际导出含两Raw追溯ID；不再把尚未恢复附加为本行必要条件。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A21 | PASS | B02、C、V2 | WikiPage相对60f83ad无差异、Wiki store和链接解析未改；历史中文多页Wikilink往返有效，当前i07-lint-real可见实际来源Wiki按钮与有效关联。复用未变交互分支。 |
| A22 | PASS |A、BR、P、S、R13M |当前合法历史pending分支选既有目标、预览与显式确认；旧创建/defer边界配同版B05回归，未自动覆盖。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A23 | PASS |A、S、R13M |U05预览目标v1逐字不变、确认v2附录、双来源及唯一update日志；当前新增模板快照保留人工编辑和原引文。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A24 | PASS |A、S、R13M |真实20/30冲突历史不作本轮新测；当前U05同工作流更新原正文完整保留，新字段追加和空冲突合法；冲突路径沿同版B05回归。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A25 | PASS | B06、S | audit/service自首次Git快照未变；B06整页/段落创建与字段实测复用，当前I02实际反馈/记录补WikiPage交互。 |
| A26 | PASS | B06、S | 当前accepted后resolved/rev3、真实刷新保持且decisionHistory一次；重启/恢复另属A57/I05，不扩大本条刷新要求。 |
| A27 | PASS | B06、S | 定位算法所在audit/service未变；复用行号移动、同文上下文、歧义/改删实测；I02目标精确替换提供当前输入链支持。 |
| A28 | PASS | S | Audit263真实输入/输出及UI预览接受、Wiki+Raw关联独立核验；明确为人工指定措辞，不称自主发现。 |
| A29 | PASS | B06、S | B06取消/拒绝保护及四决议机械路径未变；当前I02预览至显式接受才改正文、唯一operation和修订已证。 |
| A30 | PASS | B06、I07、V2 | 当前完整App实际点击Lint，空manual库0、真实4Wiki仅1个ORPHAN；扫描器自首次快照未变且无写路径，历史扫描前后SHA只读实测复用，不称本实例新做摘要对比。 |
| A31 | PASS | B06 | lint.ts未变，历史坏链注入与具体页/行定位实测可复用；不把当前未点击Lint说成新增UI实测。 |
| A32 | PASS | B06 | lint.ts及Wiki store未变，非Source且无有效入/出链的冻结定义与历史有效fixture适用。 |
| A33 | PASS | B06 | lint.ts直接扫描Markdown的缺YAML检测未变，历史移除YAML实物不被过滤的证据可复用。 |
| A34 | PASS | B06、R22E、I07 | 缺四字段fixture历史实测、lint.ts未变；当前含A/D等级与新增模板的4页实扫无缺等级/引用误报，仅合法孤儿警告，新增数据兼容已覆盖。 |
| A35 | PASS | B02、B03-recheck、P | search与Wiki store自首次Git快照未变；历史五字段中文匹配和当前I01中文搜索组合有效。 |
| A36 | PASS | B02、P | 搜索实现无qmd前置且未变；当前独立App中文搜索工作，不要求安装qmd重证。 |
| A37 | PASS | B07、S | Library页/store未变，当前禁Provider手工Prompt实际新建并独立回读成功。 |
| A38 | PASS | B07、S | 当前手工编辑v2及两个manual版本，重启/恢复SHA一致；不影响其他记录沿未变store边界复用。 |
| A39 | PASS | B07、P | 删除/回收/重启不复活及知识不变的历史实测；Library/store未变，当前共享存储重启手工写读成功支持适用，不称重做删除。 |
| A40 | PASS | B07、P | 中文名称/标签/正文与清空查询历史实测，Library/store搜索分支未变。 |
| A41 | PASS | B07、P | 默认分类/组合筛选及计数历史实测，Library/store分类逻辑未变；不联签首页新统计。 |
| A42 | PASS | B07、P | 变量模块与Library未变；历史中文/重复/缺值/字面替换实测有效，当前手工模板中文变量保持。 |
| A43 | PASS | B07、P | 历史按钮复制到普通textarea逐字符一致，Library/variables未变；不是本次新操作剪贴板。 |
| A44 | PASS | S | Brief16实际自然语言任务主要输入进入当前Provider，人工补充不改变此入口性质。 |
| A45 | PASS | S | Brief16单次真实响应taskName/taskType+7字段完整，原请求/响应和AX独立核验。 |
| A46 | PASS | S | 人工最后3分钟核对条件确实进入generate17请求/产出；上下文缺陷不否定此独立子条件。 |
| A47 | PASS | CX、S | 新18与原17逐字段Brief相等，只发已选Concept，excerpt=正文trim1363/1364且定义实际在请求；取消综合不发。旧17标题16字FAIL永久保留。 |
| A48 | PASS | CX、S | 新18真实完整Prompt含选中概念背景、30分钟和末3分钟核对；Preview实际可见，I03明确保存/刷新通过。原17失败不改。 |
| A49 | PASS | B08、PA、CX、S | 17/18预览均未自动入库，18仅明确保存才v1；当前11/11含生成保存幂等，重新生成/退出分支未因context修改改变，可复用旧边界。 |
| A50 | PASS | B08、PA、S | 18预览实际改名/追加中文变量与待确认说明，保存JSON与刷新回读完全相同；复制分支未变，复用历史真实剪贴板证据。 |
| A51 | PASS | S | ce473ac4正式v1，source/changeSource ai_generated；实际保存后中文搜索/刷新与名称、正文、变量、唯一Concept关联一致。 |
| A52 | PASS | PA、S | check19从已有Prompt v1读取完整原文，optimizer草稿originalBody与输入一致且baseVersion1；原文比较UI回读，旧正文未改。 |
| A53 | PASS | PA、S | 当前真实check19九维全present且证据来自原文，不虚报缺项；历史弱Prompt缺项质量样本对应未变九维契约可复用。 |
| A54 | PASS | PA、S | 当前完整Prompt确无缺项故improvements空合法，无虚造建议/总分；旧弱样本具体可执行建议仍适用未变检查契约，不能强迫完整样本制造改进。 |
| A55 | PASS | PA、S | rewrite20真实完整正文/预览保持变量、定义及事实边界，30分钟/末3分钟核对无虚构；人工改名及明确保存成功，复制路径未改沿PA/B08真实实操。 |
| A56 | PASS | S | 同Prompt ce473ac4第2版changeSource ai_optimized，更新时间递增，v1逐字等于check19 originalBody；实际保存/reload与JSON互证。 |
| A57 | PASS |P、S、R13M |手工5文件以及真实四链23文件分别完成刷新/同根重启/新空根恢复；Prompt v1/v2、Wiki/Audit revision、审批/来源/日志保真，代表UI回读独立核验。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A58 | PASS |B09、I07、R13M |实际浏览器下载wiki-export.md后独立YAML读取，综合v2/D/双Raw及人工快照/正文保持，旧格式与Wikilink导出路径未变；最终恢复独立留A57。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A59 | PASS | B07、S、I07 | 实际浏览器prompt-export.md独立读取v2完整正文、中文变量、场景/输入输出/分类/标签/时间/相关Wiki元数据；保存起源ai_generated与版本修改来源正确区分。 |
| A60 | PASS |H、OQ、R22E、CX、V2、R13M |同版11/11含非法JSON/不完整Schema/无效Preview不入库、重写失败保留已检查草稿；Provider鉴权/超时错误捕获相对60f83ad未改，strict新增拒绝已独立回归，安全提交EIO复用S。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A61 | PASS |B09、S、I07、R13M |当前明确禁Provider实例已实际仅保存Raw/刷新正文与原件；结合手工Wiki/Prompt创建编辑/回读/重启及当前知识/Prompt中文搜索，零模型路径成立；Raw不要求编辑。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| A62 | PASS | B09、P | demo/service未变，历史全资产/入口演示标识及幂等有效；本轮未再次灌种子。 |
| A63 | PASS |P、S、CX、R13M |I01知识创建/更新、I02真实Audit、I03 Brief16+修复18生成保存、I04检查19/重写20新版本均实际完整App独立PASS；旧17失败保留，R13本轮已补验关闭。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R01 | PASS | B09、I07、S | 当前完整App导航及Library/Generator/Optimizer实际入口和check可用；会议档案是后续单独授权功能，不以旧“只有五项”否定已授权扩展。 |
| R02 | PASS | B09、I08 | 已读open-source-reuse两上游逐文件映射/历史blob/许可限制及未复用范围；本轮只改既有UI/context无新复制，与产品差异一致，不冒称重新联网核上游。 |
| R03 | PASS | B09 | 当前范围是既有产品最小修复/入口，无新上游代码复制；旧版权与许可证边界沿报告，不伪称旧未取得的上游SHA已核。 |
| R04 | PASS | B09、P、S | 当前入口直接完整server+built App、原生Provider调用、禁Provider手工运行；开发协作工具不进入运行依赖，不声称另装无Codex机器实测。 |
| R05 | PASS | H、OQ、R22R、S、CX | 六业务均经产品统一Provider边界，当前update/Audit/Brief/generate/check实际证据及历史rewrite适用，context只改摘录不改调用职责；完整I04另留版本验收。 |
| R06 | PASS |H、T、R22E、PA、V2、R13M |rules读取校验实际加载schema/source-policy，Prompt import合同与pa01-1规则保持；Git规则差异仅KB02 schema和source-policy已被OQ/R22独立验，模板分支当前I01覆盖。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R07 | PASS |P、S、B09、I07、R13M |当前Raw/Source/知识/综合分层与Prompt分库成立；实际Wiki/Prompt Markdown独立读取及完整23文件恢复通过，无外部索引前置。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R08 | PASS | B01、C、I07 | Raw store完整元数据与类型枚举未变，新manual粘贴/上传及正文原件回读覆盖当前保存入口；可空作者/日期/URL明确显示未填写。 |
| R09 | PASS | H、C、OQ、V2 | raw/state、jobs相对60f83ad未变，H同版445项/核心恢复覆盖可复用；当前待审/confirmed和手工unprocessed回读补新路径，严格响应失败沿OQ证据，不重造真实失败。 |
| R10 | PASS | B03-recheck、I07、V2 | 新上传UI实际原件保留、文件名/格式/字节数/asset/正文SHA可读；TXT共用上传、历史各解析异常未变可复用，链接仍仅元数据。 |
| R11 | PASS |H、OQ、R22E、R22R、P、R13M |现行结构验证及unknown/非法拒绝、真实字段/证据/问题保全有当前证据，按已批准新契约解释document旧命名。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R12 | PASS |R12、HUMAN、OQ、P、S、R13M |当前事实/问题/人工标签分离与原候选保真，历史人工问题编辑及Q未知保持适用；不声称单条截断引文独立支持全部语义。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R13 | PASS | R13M M01–M06、H、BR | 同型/跨型/再次合并按原页组保全；人工与AI内容可编辑，原目录锁定，合并/编辑全部页失审，明确复审后正式创建/update保真。实际完整App及独立9/9通过；旧FAIL保留在前轮独立报告。 |
| R14 | PASS |B02、T、R22E、P、R13M |共用类型枚举未扩展，当前Source/Concept/Synthesis落盘与模板/校验历史组合；不等于A15所有Entity UI已测。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R15 | PASS |C、R22R、P、S、R13M |当前Source A/D真实关联Raw且摘要/事实/来源保持；Source仍摘要、Raw全文不改，历史完整字段表达复用。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R16 | PASS |T、COVER、P、S、R13M |严格按集成卡组合：Concept模板/有据内容、缺失留空、当前人工编辑/失审/显审/正式保真；旧自动FAIL保留，非自动完美承诺。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R17 | PASS | B02、C、V2 | Entity模板/手动编辑与WikiPage/store未变，render新增templateSections只处理Concept/Process；历史字段与实体类别表达能力适用。 |
| R18 | PASS |T、HUMAN、OQ、P、S、R13M |严格按卡组合Process模板/分析建议、HUMAN纠偏、O动作状态/Q问题未知及当前共用审批字段路径；旧P自动FAIL保留。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R19 | PASS | B02、A、R22E、V2 | Metric模板/正文栏目未变，真实20/30公式冲突与适用范围旧样本仍有效；新等级及更新附录不替换旧冲突内容。 |
| R20 | PASS | SYN、R22R、P、S | 历史冲突/一致/问题真实证据加当前双来源综合显审正式链；A/D来源ID保真；截断引文已披露不删除。 |
| R21 | PASS |R22E、P、S、I07、R13M |统一YAML保存/校验边界有R22类型拒绝和当前正式等级记录，实际综合导出解析完整字段；时间/revision由现有store，恢复保真单列A57/I06。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R22 | PASS |R22E、R22R、P、S、R13M |e04231e工程/实际等级改选UI/真实A-D初判通过；I01正式与U05保持等级，未知D不再固定C。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R23 | PASS |C、BR、HUMAN、P、R13M |依当前PRD人工逐页显审口径，历史多主题归属与当前编辑失审/再显审组合；不要求重抽自动完美或固定页数。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R24 | PASS |B05、A、BR、P、S、V2、R13M |重复引擎/search/store未变，WikiPage链接交互自60f83ad未变；当前U05实际目标/预览/原正文保留覆盖新更新分支。本轮M04补合并字段更新保全。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R25 | PASS | B06、S | audit/service未变，历史完整字段与context定位+当前Audit263记录/修订关联有效。 |
| R26 | PASS | B06、S | 未变服务历史四决策机械映射+当前真实accepted全过程；rejected/deferred不因本次未重复而重抽，明确非自主发现。 |
| R27 | PASS | B06、S | 未变定位算法历史多匹配/删除/修改拒绝，当前指定句精确替换；不把旧anchor stale视为误写。 |
| R28 | PASS |P、S、I07、R13M |首页最近变更对应知识create/update/audit真实ID，Prompt生成/优化前后知识日志SHA不变；Prompt数量1、优化不当新对象。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R29 | PASS | B06、R22E、I07 | 11类独立有效fixture复用未变lint扫描器；当前实际UI及新增等级/模板4页扫描兼容通过，合法ORPHAN未被当产品失败。 |
| R30 | PASS | B02、P、S、V2 | search/store及WikiPage查询分支未变，当前正式新增与Audit更新后中文查询/选页有效，历史删除索引同步复用；恢复专门门槛不重复附加到搜索整行。 |
| R31 | PASS | B09、S、I07 | 最终六计数2/4/6/2/0/1与对象及日志一致，待审是继承提取/综合各1；五必要入口实际点击，上海周界旧规则未变，Prompt改版不增加对象数。 |
| R32 | PASS | B02、B09 | 分类视图/分类数量逻辑未列入本轮变更，历史13类及数量证据复用；不扩新分类需求。 |
| R33 | PASS | B07、P、S | Library/store未变功能边界已具历史真实测试，当前manual编辑及ai_generated正式保存/中文搜索/刷新/版本1关联补共享存储路径；Optimizer新版本另由R39覆盖。 |
| R34 | PASS | B07、PA、S | manual既有字段与当前生成v1/优化v2保存、导出元数据/中文变量/相关Wiki回读齐全；source ai_generated保持起源、v2 changeSource ai_optimized。 |
| R35 | PASS | PA、S、CX | Brief16编辑与新18相同输入、选/取消、真实生成和明确保存完整；旧六模板/custom边界未改，组合成立不重抽七模板。 |
| R36 | PASS | CX、S | C01–C06工程独立3/3及同版11/11/build，真实18发送正确1363字定义/正文并输出运用；3000/12000/6页和未选排除有效，旧17失败保留。 |
| R37 | PASS | B08、PA、CX、S | 18完整Preview人工编辑/保存/刷新已证；复制/返回Brief/不自动保存分支不在context改动中，历史实操与同版生成保存回归可复用。 |
| R38 | PASS | PA、S | 当前19九维全present证据来自原文，20完整优化版无虚假缺项/总分；历史弱样本具体建议复用未变契约，补内容后重新检查机制未被context修复改变。 |
| R39 | PASS | B08、PA、S | I04实际同Prompt保存v2/刷新，v1原正文保持、v2时间递增及ai_optimized明确；历史保存新Prompt/复制分支未变可复用。 |
| R40 | PASS | B07、P、S | 未变Prompt store的删除/失效关联历史边界适用；当前AI Prompt关联Concept、知识日志不受保存影响，完整分库23文件重启/恢复及独立Markdown读回通过。 |
| R41 | PASS | H、OQ、R22E、PA、CX、V2 | config/manager相对60f83ad未变，Provider改动仅temperature/strict/refusal且既有脱敏错误捕获不变，CX确认secret门禁保持；当前公开请求未保存认证头/Key，复用旧模拟鉴权脱敏实测，不读真实Key。 |
| R42 | PASS |P、S、CX、R13M |四链实际UI及原子ID、真实调用/历史候选来源、正式Wiki/Audit/Prompt版本日志全关联；上下文17失败独立留存、新18验证关闭，本轮另由R13M关闭合并缺口。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R43 | PASS | B09、P | 本轮差异范围未引入排除功能，Meeting已有单独授权不以旧排除字眼误判；不是宣称新做全仓扫描。 |
| R44 | PASS | B09、P | demo/service自首次快照未变，历史种子1/5/4/1、幂等/不覆盖/演示标识可复用。 |
| R45 | PASS |B09、P、S、I07、R13M |当前完整App四链、长正文审核/Preview/Optimizer及来源/版本回读均实际可操作；保留旧专业桌面长内容截图适用范围，未新增营销装饰。 本轮新组受影响边界按R13M对应M01–M06补证，见独立矩阵映射。 |
| R46 | PASS | R13M、R13矩阵审查、I08 | README/delivery/status及本表更新为R13关闭、109项通过，明确实测/复用/版本/历史模型失败与未测平台边界；代码53c16918a9c284a1c18fd7e47f468d9b960a1c89。 |

## 历史：执行前零调用准备草案

以下内容为执行前记录，其PENDING/NOT_RUN及旧预算已由上方最终表覆盖。

# B09 当前109项证据适用性草案（2026-10-29）

续接说明：R22已独立通过（代码e04231e），模板更新U01–U04工程已通过（代码59b94ca，状态提交0cbb918）；本表下方保留初稿统计，尚未完成I01–I08，不能据此把PENDING批量转为PASS。当前知识261/500、Prompt15/24。未受影响解析/搜索/教学/Prompt存储的逐项版本核对见[集成准备独立审查](B09-INTEGRATION-AUDIT-20261029-prepare.md)；解析最终依据为B03-recheck报告，原始历史矩阵的初验FAIL链接不作为最终通过证据。浏览器工具初始化失败，当前完整App四链仍未执行。

主线程授权 gap_map 独占创建本文。**这是零调用准备草案，不是独立验收结论，当前B09未通过。** 本实例只读文档并写本文，没有产品测试、服务/浏览器启动、真实API、配置/Key读取或产品/状态/旧矩阵修改。主线程接手后按真实结果更新。

基准：strict交付提交 `91acd27332553a2fc6ae9fbeeb0e953e5e9b148c`（主线程提供关联）；[O/Q独立验收](OPENAI-STRUCTURED-AUDIT-20261029-real.md)O255–256与Q257–258均PASS，知识258/500、Prompt15/24。R22施工中，尚无独立最终结论，集成执行须在R22通过后重新冻结。

依据：[I01–I08任务卡](../handoffs/B09-INTEGRATION-20261029-task.md)、[缺口映射](B09-RESUME-20261029-gap-map.md)、[原109项索引](B09-delivery-matrix.md)、[现行验收](../acceptance.md)。保留原需求文字追溯ID；旧wire/自动主题职责按当前KB02/HUMAN修订解释，不要求退回旧协议或每次自动稿完美。

## 状态含义与实际统计

- REUSE_PASS：历史PASS可作未受影响边界的复用候选，**不是本轮新增PASS或已完成当前冻结适用性审查**；I07后由主线程裁定最终状态。
- PENDING：历史有PASS或子证据，但R22、I01–I06或I07/I08明确待执行/裁定。历史PASS仅指所列报告/样本。
- NOT_RUN：当前完整App四链组合未执行，分链PASS不补签整行。

| 索引 | 行数 | REUSE_PASS历史候选 | PENDING | NOT_RUN |
|---|---:|---:|---:|---:|
| A | 63 | 10 | 52 | 1 |
| R | 46 | 6 | 39 | 1 |
| 总计 | 109 | 16 | 91 | 2 |

统计来自下表实际109行，不复制旧73/36或78/3/28。**本草案当前整行最终PASS=0（未签新验收），不能将历史候选数当本轮通过数。** 历史246/248/252自动质量FAIL及O253/254结构FAIL原样留档，不由新正例删除，也不是本草案新发现的根因数。

R16/R18按集成卡所引2026-10-23现行PRD允许人工纠偏、正式写入前逐页显审。模板/Concept/HUMAN/O/Q证据可组合复用，但整行PENDING，待R22/I01确认事实/问题/字段保真、编辑失审及正式门禁后裁定，不追加抽样洗掉旧FAIL。

## 109行证据适用性

版本摘自已读报告或主线程提供关联；“提交未复核”不宣称当前同字节。历史报告版本不清时保留冻结/报告引用，不编造提交。每行证据链接后的括号给版本及该报告真实范围；I07须与最终集成冻结比较。

| ID | 原验收要求 | 历史结论/范围 | 当前草案 | 待补门禁/限制 | 证据与受测版本 |
|---|---|---|---|---|---|
| A01 | 1 初始化个人知识库：空数据目录初始化成功；重复初始化不覆盖用户资产。 | 历史PASS：初始化/重复初始化不覆盖 | PENDING | I05/I06当前根重启/恢复与初始化资产保持 | [B01](B01-acceptance.md)（原文/初始化历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| A02 | 2 创建 Raw：从 UI 保存标题/元数据/正文，得到可读取的记录与稳定 ID。 | 历史PASS：原文/元数据/106400字符长文保全 | PENDING | R22/I01/I05新增Raw元数据兼容、原文SHA/ID及重启；无需重抽长文 | [B01](B01-acceptance.md)（原文/初始化历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| A03 | 3 粘贴长文章：至少 100,000 字符中文长文，含前后空白/多种换行/正文`---`，保存/回读逐字符一致；超出真实限制须明确提示。 | 历史PASS：原文/元数据/106400字符长文保全 | PENDING | R22/I01/I05新增Raw元数据兼容、原文SHA/ID及重启；无需重抽长文 | [B01](B01-acceptance.md)（原文/初始化历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| A04 | 4 上传 Markdown/TXT：真实两种文件解析并保存，中文/段落可回读。 | 历史PASS：真实格式正常/失败样本 | REUSE_PASS | 未受影响解析器证据复用候选；未重跑，扫描PDF无OCR限制保留 | [B03](B03-recheck-acceptance.md)（解析/上传历史PASS；提交未复核） |
| A05 | 5 DOCX/PDF 支持实际测试：真实格式正常及失败样本各测；准确报告支持/不支持/局限，不能以代码存在代替。 | 历史PASS：真实格式正常/失败样本 | REUSE_PASS | 未受影响解析器证据复用候选；未重跑，扫描PDF无OCR限制保留 | [B03](B03-recheck-acceptance.md)（解析/上传历史PASS；提交未复核） |
| A06 | 6 AI 不改 Raw：提取、更新、Audit 成功/失败/放弃前后原始正文摘要一致。 | 分散PASS子证据：提取/更新/Audit及失败安全Raw不变 | PENDING | I01/I02/I06关联成功/失败/放弃及原Raw SHA | [C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS）；[H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A07 | 7 Raw 刷新存在：刷新及进程重启后原始内容与 ID 一致。 | 历史PASS：Raw刷新重启保持 | PENDING | I05/I06当前同根重启/新根恢复原文和ID | [B01](B01-acceptance.md)（原文/初始化历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| A08 | 8 点击 AI 整理：操作真实发起配置 Provider 调用，进度与最终状态可见。 | 历史真实PASS：提取/规划发起、终态可见 | PENDING | R22/I01当前App状态；历史候选readback不称重新生成 | [C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A09 | 9 结构化知识：真实响应通过结构校验，含 document/suggested_pages；非法输出走错误路径。 | 历史PASS：现行facts→planning→Draft与拒坏 | PENDING | R22/I01扩等级后结构/错误与草稿适用性；不退回旧wire | [H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A10 | 10 区分事实/整理/推断：预览与正式内容分栏/分节标记，原文不能支持的陈述不放来源事实。 | 历史样本/人工纠偏PASS：事实/整理/推断/问题分开 | PENDING | R22/I01当前分栏/正文/证据保真；自动历史FAIL保留 | [A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[R12](R12-AUDIT-20261026-final.md)（基线340fc156cd309924d517ea5df2da93e1186703ce；11文件冻结；人工问题PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A11 | 11 不直接写正式 Wiki：AI 成功仅产生草稿，确认前磁盘/计数无正式新增或更新。 | 历史PASS：只产草稿、完整预览及确认门禁 | PENDING | R22/I01完整App编辑失审/逐页显审，确认前零正式写入 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A12 | 12 预览：看得到 Raw、建议内容、类型/摘要/证据/问题/关联，并能返回继续操作。 | 历史PASS：只产草稿、完整预览及确认门禁 | PENDING | R22/I01完整App编辑失审/逐页显审，确认前零正式写入 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A13 | 13 选择部分入库：多建议只选一部分，落盘/计数与选择一致，未选内容不入库。 | 历史PASS：只确认选中部分与对应来源日志 | PENDING | I01当前选择/审查/正式ID与计数关联 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[BR](KB02-K204-BR-AUDIT-20261024-final.md)（产品60f83ad；基线c35a350（短标识沿报告）；部分确认PASS）；[R12](R12-AUDIT-20261026-final.md)（基线340fc156cd309924d517ea5df2da93e1186703ce；11文件冻结；人工问题PASS） |
| A14 | 14 Concept：UI 创建/读回，类型正确，具对应模板。 | 历史PASS子证据：手动四类型与相应真实样本/模板 | PENDING | R22/I01/I05当前模板、AI机会标识、类型及保存回读；不要求一份资料齐四型 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[T](R1618-AUDIT-20261026-final.md)（分型模板工程PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[COVER](R1618-COVER-AUDIT-20261028-real.md)（d6cbb73ad690a071b94b9f6cfd88c03be54b7213；Concept真实质量PASS，P语义FAIL）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| A15 | 15 Entity：UI 创建/读回，类型正确，具对应模板。 | 历史PASS子证据：手动四类型与相应真实样本/模板 | PENDING | R22/I01/I05当前模板、AI机会标识、类型及保存回读；不要求一份资料齐四型 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[T](R1618-AUDIT-20261026-final.md)（分型模板工程PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[COVER](R1618-COVER-AUDIT-20261028-real.md)（d6cbb73ad690a071b94b9f6cfd88c03be54b7213；Concept真实质量PASS，P语义FAIL）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| A16 | 16 Business Process：UI 创建/读回，AI 机会标“分析建议”。 | 历史PASS子证据：手动四类型与相应真实样本/模板 | PENDING | R22/I01/I05当前模板、AI机会标识、类型及保存回读；不要求一份资料齐四型 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[T](R1618-AUDIT-20261026-final.md)（分型模板工程PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[COVER](R1618-COVER-AUDIT-20261028-real.md)（d6cbb73ad690a071b94b9f6cfd88c03be54b7213；Concept真实质量PASS，P语义FAIL）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| A17 | 17 Metric：UI 创建/读回，指标内容具来源和适用范围。 | 历史PASS子证据：手动四类型与相应真实样本/模板 | PENDING | R22/I01/I05当前模板、AI机会标识、类型及保存回读；不要求一份资料齐四型 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[T](R1618-AUDIT-20261026-final.md)（分型模板工程PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[COVER](R1618-COVER-AUDIT-20261028-real.md)（d6cbb73ad690a071b94b9f6cfd88c03be54b7213；Concept真实质量PASS，P语义FAIL）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| A18 | 18 Synthesis：实际多来源综合，显示主要来源、一致/冲突/待确认。 | 历史真实PASS：双来源一致/冲突/问题与正式闭环 | PENDING | R22/I01/I06新等级与当前综合/Source适用性；不重抽旧超时样本 | [SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS） |
| A19 | 19 统一 Frontmatter：所有正式 Wiki Markdown 由 YAML 解析器读取并校验必需字段/枚举。 | 历史PASS：正式YAML/字段/枚举 | PENDING | R22/I01/I06新等级及出处元数据正式/恢复回读 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS） |
| A20 | 20 Wiki 返回 Raw：来源点击可打开对应 Raw，内容/ID 正确，导出保留追溯标识。 | 历史PASS：来源回Raw/中文Wikilink | PENDING | I01/I06当前实际点击、中文搜索及恢复关联 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS） |
| A21 | 21 Wiki 关联：`[[标题]]`可指向实际页面，含中文标题，多页往返有效。 | 历史PASS：来源回Raw/中文Wikilink | PENDING | I01/I06当前实际点击、中文搜索及恢复关联 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS） |
| A22 | 22 创建前潜在重复：已存在页触发候选；用户决定更新/新建/暂不处理；无自动覆盖。 | 历史PASS：显式候选/更新创建defer，无自动覆盖 | PENDING | I01当前目标版本/历史候选合法迁移 | [B05](B05-acceptance.md)（去重/更新工程历史PASS；提交未复核）；[A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS）；[BR](KB02-K204-BR-AUDIT-20261024-final.md)（产品60f83ad；基线c35a350（短标识沿报告）；部分确认PASS） |
| A23 | 23 旧 Wiki 更新先预览：展示现有、新来源、建议、冲突/推断；确认前原页摘要不变。 | 历史真实PASS：20/30冲突、共同100、旧备注/双来源及更新显审 | PENDING | R22/I01预览前正式不变，确认后版本/冲突/来源/日志；必要当前update有界执行 | [A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS） |
| A24 | 24 冲突不静默合并：相反来源/指标公式均保留、标记冲突且进入待确认问题。 | 历史真实PASS：20/30冲突、共同100、旧备注/双来源及更新显审 | PENDING | R22/I01预览前正式不变，确认后版本/冲突/来源/日志；必要当前update有界执行 | [A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS） |
| A25 | 25 提交 Audit：整页及一段内容各建记录，可读取反馈字段。 | 历史PASS：整页/段落Audit，真实有指导反馈 | PENDING | I02完整App创建/打开合法Audit、字段/关联回读 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| A26 | 26 Open/Resolved：新建为 open，完成处理正确转换，状态刷新后保留。 | 历史PASS：open/resolved机制；F3确认走HTTP | PENDING | I02/I05/I06当前UI accepted→resolved及刷新重启恢复 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| A27 | 27 定位 Audit：保存目标文本和前后上下文；插入内容使行号变化后仍定位；歧义明确提示。 | 历史PASS：上下文anchor、插入/歧义/改删及重定位 | REUSE_PASS | 未受影响定位算法复用候选；I02如有新受影响失败则最小返修 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| A28 | 28 AI Audit 建议：真实调用读 Wiki+对应 Raw+反馈，返回可审阅修改建议。 | 历史PASS：真实有指导建议及HTTP确认前后保护 | PENDING | I02实际UI预览/accepted/修订日志，关联Wiki+Raw+反馈，不称自主发现 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| A29 | 29 确认才修改：Audit 建议出现/取消/拒绝不改 Wiki；显式确认才更新并记处理记录。 | 历史PASS：真实有指导建议及HTTP确认前后保护 | PENDING | I02实际UI预览/accepted/修订日志，关联Wiki+Raw+反馈，不称自主发现 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| A30 | 30 运行 Lint：UI 实际扫描当前库，结果可读，前后知识摘要不变。 | 历史PASS：Lint扫描、坏链/孤儿/缺Frontmatter | REUSE_PASS | 历史有效fixture/零改知识证据复用候选；未重跑 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| A31 | 31 坏链：构造 `[[不存在页]]`，检测并定位具体页面/链接。 | 历史PASS：Lint扫描、坏链/孤儿/缺Frontmatter | REUSE_PASS | 历史有效fixture/零改知识证据复用候选；未重跑 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| A32 | 32 孤儿：构造无有效知识关联的页，与冻结孤儿定义一致，检测可定位。 | 历史PASS：Lint扫描、坏链/孤儿/缺Frontmatter | REUSE_PASS | 历史有效fixture/零改知识证据复用候选；未重跑 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| A33 | 33 缺 Frontmatter：移除 YAML 的真实页被报告；不被读取过滤掩盖。 | 历史PASS：Lint扫描、坏链/孤儿/缺Frontmatter | REUSE_PASS | 历史有效fixture/零改知识证据复用候选；未重跑 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| A34 | 34 缺来源/可信度：分别缺 sources、knowledge_status、confidence、source_level 可报告。 | 历史PASS：缺来源/状态/可信度/等级分别报告 | PENDING | R22/I06新增等级契约与Lint缺字段适用性，只补受影响边界 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| A35 | 35 中文 Wiki 搜索：分别命中标题/别名/标签/正文/分类，中文短词和混合英文有效。 | 历史PASS：中文五范围搜索 | PENDING | I01/I06当前新增/更新/恢复页中文命中，细分历史边界复用 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| A36 | 36 无 qmd 搜索：环境未安装/不可调用 qmd，搜索仍能返回正确结果。 | 历史PASS：无qmd搜索仍可用 | REUSE_PASS | 无qmd依赖历史候选；I07核未新增qmd前置 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核） |
| A37 | 37 创建 Prompt：手动创建，正文/元数据回读正确。 | 历史PASS：手动创建编辑删除及版本/重启 | PENDING | I04/I05当前手工保存、版本/重启；删除历史边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A38 | 38 编辑 Prompt：修改后读取与磁盘一致，不错改其他记录。 | 历史PASS：手动创建编辑删除及版本/重启 | PENDING | I04/I05当前手工保存、版本/重启；删除历史边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A39 | 39 删除 Prompt：删除后检索/列表/重启均不出现；相关知识仍可使用。 | 历史PASS：手动创建编辑删除及版本/重启 | PENDING | I04/I05当前手工保存、版本/重启；删除历史边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A40 | 40 搜索 Prompt：中文名称/标签/正文有效，清空查询可恢复。 | 历史PASS：中文搜索/分类/重复中文变量 | PENDING | I03/I05当前Library和变量回读；细分历史边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A41 | 41 分类查看：默认分类可选，筛选仅返回对应 Prompt，真实数量一致。 | 历史PASS：中文搜索/分类/重复中文变量 | PENDING | I03/I05当前Library和变量回读；细分历史边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A42 | 42 变量填写：重复及中文 `{{变量}}`填值并替换；模板正文仍保持原变量；缺值明确处理。 | 历史PASS：中文搜索/分类/重复中文变量 | PENDING | I03/I05当前Library和变量回读；细分历史边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A43 | 43 复制最终 Prompt：实际复制填值结果并粘贴到普通文本目标，内容正确。 | 历史PASS：实际复制填值后粘贴普通文本 | REUSE_PASS | 历史真实剪贴板证据复用候选；本轮未再次操作 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核） |
| A44 | 44 自然语言任务：单个主要输入可提交真实任务，不要求起步填写十几字段。 | 历史真实PASS：7 Brief，六模板+custom及完整字段 | PENDING | I03当前任务→真实Brief实际点击，不再重跑七模板 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A45 | 45 结构化 Brief：真实 AI 返回任务名/类型与 Role、Goal、Context、Input、Tasks、Constraints、Output。 | 历史真实PASS：7 Brief，六模板+custom及完整字段 | PENDING | I03当前任务→真实Brief实际点击，不再重跑七模板 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A46 | 46 修改 Brief：修改并用于下一次正式生成，变化实际进入请求/产出。 | 历史真实PASS：修改Brief/选择Wiki进入请求及完整生成预览 | PENDING | I03当前修改/选取消Wiki→实际生成→Preview与请求关联 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A47 | 47 选相关 Wiki：可勾选/取消实际页，关联列表和请求背景与选择一致。 | 历史真实PASS：修改Brief/选择Wiki进入请求及完整生成预览 | PENDING | I03当前修改/选取消Wiki→实际生成→Preview与请求关联 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A48 | 48 Brief 生成 Prompt：用户确认 Brief 后真实生成完整 Prompt，显示结构和元数据。 | 历史真实PASS：修改Brief/选择Wiki进入请求及完整生成预览 | PENDING | I03当前修改/选取消Wiki→实际生成→Preview与请求关联 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A49 | 49 不自动进 Library：生成/重新生成/退出后库计数不变，显式保存才增加。 | 历史PASS：不自动入库、编辑采用、显式保存ai_generated | PENDING | I03/I05当前Preview计数/编辑/Library与刷新 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A50 | 50 编辑生成结果：编辑正文/预览字段后复制/保存采用用户编辑后的内容。 | 历史PASS：不自动入库、编辑采用、显式保存ai_generated | PENDING | I03/I05当前Preview计数/编辑/Library与刷新 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A51 | 51 保存生成结果：显式保存后可在 Library 搜索/读取，标记 ai_generated。 | 历史PASS：不自动入库、编辑采用、显式保存ai_generated | PENDING | I03/I05当前Preview计数/编辑/Library与刷新 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A52 | 52 粘贴旧 Prompt：完整原文显示，优化前后保留供比较。 | 历史真实PASS：弱/完整九维检查、优化、编辑与新旧版本 | PENDING | I04/I05当前check/rewrite实际点击→新版本，旧正文/修改来源保持 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A53 | 53 检查缺失：9 个要求维度有具体状态；弱 Prompt 暴露实际缺项，完整 Prompt 不凭空报缺项。 | 历史真实PASS：弱/完整九维检查、优化、编辑与新旧版本 | PENDING | I04/I05当前check/rewrite实际点击→新版本，旧正文/修改来源保持 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A54 | 54 具体改进建议：对应实际不足且可执行，不能只有泛化“更清晰”等文案。 | 历史真实PASS：弱/完整九维检查、优化、编辑与新旧版本 | PENDING | I04/I05当前check/rewrite实际点击→新版本，旧正文/修改来源保持 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A55 | 55 优化版本：真实生成完整正文，保留原目标/事实边界，可编辑/复制。 | 历史真实PASS：弱/完整九维检查、优化、编辑与新旧版本 | PENDING | I04/I05当前check/rewrite实际点击→新版本，旧正文/修改来源保持 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A56 | 56 保存新版本：选择原 Prompt 保存新版本，版本递增、旧正文与来源可读。 | 历史真实PASS：弱/完整九维检查、优化、编辑与新旧版本 | PENDING | I04/I05当前check/rewrite实际点击→新版本，旧正文/修改来源保持 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| A57 | 57 Wiki/Prompt 持久化：手动、审核生成及优化保存结果刷新/重启仍在；逐阶段增量检查。 | 历史PASS：手动/人审/生成/优化持久化子证据 | PENDING | I05/I06当前同根重启/恢复新根四链代表资产 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| A58 | 58 Wiki Markdown 导出：实际下载/导出并独立读取正文、Frontmatter、来源、Wikilink。 | 历史PASS：Wiki Markdown独立可读 | PENDING | R22/I06当前等级/来源/人审元数据导出恢复 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| A59 | 59 Prompt Markdown 导出：实际文件独立读取正文、变量与必要元数据。 | 历史PASS：Prompt Markdown正文/变量/元数据 | PENDING | I06当前Prompt版本/元数据导出恢复回读 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| A60 | 60 AI 失败无假知识/空 Prompt：鉴权/超时/非法 JSON/空结果均不入正式库，保留原资产并显示错误。 | 历史PASS：鉴权/超时/坏结构/空结果不正式入库 | PENDING | R22/I06当前失败恢复/安全与旧资产；不花真实请求制造故障 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| A61 | 61 无 LLM 手动可用：未配 Key 时 Raw、手动 Wiki、Prompt 创建/编辑/读取/搜索按阶段实际可操作；B01 仅 Raw 子能力，整项不提前 PASS。 | 历史PASS：无LLM手动Raw/Wiki/Prompt | PENDING | I05禁用Provider的当前App实际创建编辑/保存回读，零请求 | [B01](B01-acceptance.md)（原文/初始化历史PASS；提交未复核）；[B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| A62 | 62 演示标识：演示 Raw/Wiki/Prompt/示例任务入口和正文可辨“演示数据”，不冒充真实公司。 | 历史PASS：演示资产及任务入口/正文可辨 | REUSE_PASS | 种子/标记历史证据复用候选；未再次导入，不当真实企业 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| A63 | 63 桌面完整核心流程：在桌面真实 UI 完成知识入库/纠错及 Prompt 生成/优化四链路，交互无阻断。 | 只有分链PASS，旧B09主要fake，当前组合未执行 | NOT_RUN | I01–I06当前完整App四链/重启恢复；不能lab/API代签 | [C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| R01 | §1–2：产品名与 FMCG 定位清晰，左导航只有首页/知识库/Raw/Prompt 工作台/设置；Prompt 内含 Library/Generator/Optimizer，无空壳菜单。 | 历史PASS：五导航与Prompt三工作区 | PENDING | I01–I05当前完整App全部正式路由/入口 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R02 | §3、59：两个上游逐一说明实际复用文件/逻辑、改动内容与未复用范围；按代码复制/规则改编/思想参考区分。核对说明与实现，不接受一句“参考开源”。 | 历史PASS：两上游逐文件复用/许可/版权 | REUSE_PASS | I08核最终说明仍准确；无新代码复制不重复研究上游 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R03 | §3：如复制代码，保留对应许可证/版权声明；未复制亦需准确说明，禁止误称复用。 | 历史PASS：两上游逐文件复用/许可/版权 | REUSE_PASS | I08核最终说明仍准确；无新代码复制不重复研究上游 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R04 | §4、8、48：运行不依赖 Codex/Claude Code/Obsidian/外部 Agent CLI/Coze；应用自身 Provider 调用。未安装这些工具可启动核心功能，无 Coze ID/PAT/连接状态。 | 历史PASS：产品自身server/Provider独立运行 | PENDING | I05当前独立运行和禁用LLM手工，协作工具不进产品运行时 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R05 | §4、49：规则/工具/LLM/UI 职责可识别；UI 不写死 Provider；提取、更新、Audit、Brief、生成、优化通过同一独立 LLM Service。 | 分链PASS：统一Service职责与六功能真实证据 | PENDING | R22/I01–I04共享边界适用性；strict仅KB02指定路径 | [H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R06 | §4、49：FMCG Schema、页面模板、写作/拆分、Audit、来源、Prompt 生成/质量规范可查；工具实际读取/应用对应规则，不能只有空文件。 | 历史PASS：规则实际应用及严格业务校验 | PENDING | R22来源政策/schema/运行契约独立工程结论后关联 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R07 | §5–6、47、49：Raw→Wiki→Synthesis 信息层次；knowledge 与 prompts 分开，Markdown 是可独立读取知识资产；SQLite 如使用不阻断 Wiki 导出。 | 历史PASS：Raw→Wiki→真实Synthesis与分库 | PENDING | R22/I01/I06当前等级元数据/恢复适用性，SYN真实PASS保留 | [C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R08 | §6：Raw 支持微信/网页文章、报告、公司/客户资料、会议纪要、个人笔记、其他；记录 ID、标题、类型、来源名、作者/原日期/链接（可空）、导入时间、标签、正文、状态。 | 历史PASS：来源类型/原文/元数据 | PENDING | R22/I01/I05新增Raw来源信息、旧记录兼容及原文不变 | [B03](B03-recheck-acceptance.md)（解析/上传历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| R09 | §6：状态可表达未处理/AI处理中/待人工确认/已生成知识/失败；成功/取消/失败不滞留处理中，刷新后正确。AI 永不改正文；用户可手动删除/重新导入（B01 不含删除）。 | 历史PASS：阶段/取消/恢复工程与真实待审/确认 | PENDING | R22/I01/I06当前阶段/失败恢复，删除重导沿历史 | [B03](B03-recheck-acceptance.md)（解析/上传历史PASS；提交未复核）；[H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R10 | §7–8：文本入口标题/来源/链接/标签/正文可填；文件元数据、命名、原件/assets、统一导入结果真实可用。明确解析错误。链接只是元数据，不承诺公众号自动抓取。 | 历史PASS：文本/文件元数据、原件/assets与错误 | PENDING | R22新增Raw入口兼容；格式解析沿历史，不承诺自动抓取 | [B03](B03-recheck-acceptance.md)（解析/上传历史PASS；提交未复核） |
| R11 | §9：结构化 document 含标题/主题/摘要；建议页含标题/类型/分类、一句定义、facts/organized/inferences、related/open_questions/evidence。服务校验结构，未支持字段不得默默丢弃。 | 历史PASS：现行组装结构与严格拒坏 | PENDING | R22/I01新等级字段不静默丢失；旧wire按现行职责映射 | [H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R12 | §9–10：待确认问题独立显示；事实有可核对原文证据，整理不凭空补充，推断不冒充事实；人工编辑可纠正标记。 | 人工问题闭环PASS；新Q真实问题保真；旧C自动FAIL保留 | PENDING | R22/I01当前问题/审批失效及正式回读；不称自动缺陷修复 | [R12](R12-AUDIT-20261026-final.md)（基线340fc156cd309924d517ea5df2da93e1186703ce；11文件冻结；人工问题PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| R13 | §10：审核支持部分选择/全选、改标题/内容/分类、删建议、合并建议、放弃、确认创建/更新。取消/放弃不落正式库，合并保留来源与边界。 | 历史PASS：选择/编辑/删除/合并/放弃及显式确认 | PENDING | R22/I01当前显审/编辑失效/选择写入；未变合并等边界复用 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[BR](KB02-K204-BR-AUDIT-20261024-final.md)（产品60f83ad；基线c35a350（短标识沿报告）；部分确认PASS）；[R12](R12-AUDIT-20261026-final.md)（基线340fc156cd309924d517ea5df2da93e1186703ce；11文件冻结；人工问题PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| R14 | §11：Wiki 类型严格为 source/concept/entity/business_process/metric/synthesis；手动与 AI 路径使用同一类型约束，无额外无用类型。 | 历史PASS：严格六类型及自然规划 | PENDING | R22/I01等级扩展不放宽类型/协议 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R15 | §12：Source 实际创建并链接 Raw；来源标题/类型/作者/日期/链接、摘要/Key Takeaways、概念/实体/流程/指标、观点/待验证均可表达；Source 是摘要，Raw 存全文。 | 历史PASS子证据：Source/Raw/摘要/链接/待验证 | PENDING | R22/I01/I06当前元数据、等级及内容来源；不能按Source数量签字段齐全 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| R16 | §13：Concept 模板含一句解释、定义、重要性、业务位置、特征/分类、关系/场景、问题/来源；缺原文支持部分保持空/待确认，不能硬编。 | 模板、Concept真实有据字段、Draft与人工链子证据PASS | PENDING | R22/I01后按现行HUMAN口径裁整行；旧模型FAIL不称自动修复 | [T](R1618-AUDIT-20261026-final.md)（分型模板工程PASS；提交未复核）；[COVER](R1618-COVER-AUDIT-20261028-real.md)（d6cbb73ad690a071b94b9f6cfd88c03be54b7213；Concept真实质量PASS，P语义FAIL）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R17 | §14：Entity 模板含名称/一句说明、基本信息/业务角色、业务/概念/流程/来源；支持企业、品牌、产品、平台、系统、客户、机构。 | 历史PASS：Entity模板/14区域store真实样本 | PENDING | R22/I01当前字段/等级兼容，样本不保证所有实体输入 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| R18 | §15：Business Process 可表达目标/角色/触发/输入/步骤/输出/系统/规则/人工点/异常/痛点/AI机会/指标/关联/来源；AI机会标“分析建议”。 | 流程模板/HUMAN纠偏/O动作状态/Q未知传递子证据PASS | PENDING | R22/I01后按集成卡裁整行；旧248/252自动FAIL保留，不盲重抽 | [T](R1618-AUDIT-20261026-final.md)（分型模板工程PASS；提交未复核）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R19 | §16：Metric 可表达定义/业务含义/公式/范围/数据来源/解读/误区/相关指标/来源；不同来源公式并列保留。 | 历史真实PASS：metric定义/公式/零边界/采样及20/30冲突 | PENDING | R22/I01当前更新版本/双来源/等级，不替换旧冲突证据 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS） |
| R20 | §17：Synthesis 至少两来源，主要来源齐全，分别显示一致观点、冲突、待确认问题。 | 历史真实PASS：双来源一致/冲突/问题与显审正式闭环 | PENDING | R22/I01/I06综合/Source新等级及恢复适用性；不再列无真实综合成功 | [SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS） |
| R21 | §18：统一 YAML 语义含 id/title/type/domain=fmcg/category/created/updated/sources/tags/knowledge_status/confidence/source_level/review_status；创建/编辑正确更新，状态枚举受约束。knowledge_status=verified/source_supported/ai_organized/inferred/needs_verification，confidence=high/medium/low，source_level=A/B/C/D。 | 历史PASS：统一YAML/枚举/版本及元数据 | PENDING | R22/I01/I06新增判级出处/人工覆盖元数据正式与恢复保真 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS） |
| R22 | §19：A 正式公司/客户确认/系统/政府协会权威；B 专业研究/主流媒体/明确履历专家；C 普通公众号/个人/网络；D 未知/软文/未核验 AI；AI 判断可由用户改。 | 旧人工编辑PASS；固定C/未知D不一致已证，新施工未验 | PENDING | R22工程/真实/完整App等级控件独立验收，未通过不得启动I01–I06 | [GAP](B09-RESUME-20261029-gap-map.md)（映射基线2fe5318e70e188cf28c15af7867aacf460213d66；R22政策不一致已证，新施工待验）；[B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核） |
| R23 | §20：多主题文章按明确知识问题拆页，一个 Concept 一个主题；不生成“完整知识大全”巨页，不用硬字数阈值冒充粒度。 | HUMAN归属/显审PASS；旧自动主题粒度FAIL保留 | PENDING | R22/I01不绕过逐页审查，不新增自动稿全完美/固定页数门槛 | [C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[BR](KB02-K204-BR-AUDIT-20261024-final.md)（产品60f83ad；基线c35a350（短标识沿报告）；部分确认PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| R24 | §21–23：Wikilink 无图数据库强依赖；重复检查涵盖标题/别名/分类/标签/内容相似；展示候选和更新/创建/暂不处理选择；更新预览显示现有/新来源/增加/冲突/推断。 | 历史PASS：重复候选/404修复、显式目标及版本保护 | PENDING | R22/I01合法更新迁移/正式确认与真实A冲突证据 | [B05](B05-acceptance.md)（去重/更新工程历史PASS；提交未复核）；[A](KB02-K204-A-AUDIT-20261023-resume-final.md)（产品60f83ad；基线41ee786（短标识沿报告）；真实更新PASS）；[BR](KB02-K204-BR-AUDIT-20261024-final.md)（产品60f83ad；基线c35a350（短标识沿报告）；部分确认PASS） |
| R25 | §25：Audit 类型含错误/警告/建议/补充；保存 id、target page/text、context before/after、severity、comment、created、status。anchor 文本与前后上下文实际用于定位。 | 历史PASS：Audit字段、上下文anchor与真实反馈 | PENDING | I02/I06当前记录关联/恢复状态，anchor细分历史复用 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| R26 | §26：处理读取 Wiki+Raw+反馈、定位、判断、提出建议、人工确认；accepted/partial/rejected/deferred 均能留记录，rejected 不丢历史，deferred 不伪称解决。冻结方案明确决策和 open/resolved 的映射。 | 历史PASS：四决策机制与真实有指导建议/HTTP确认 | PENDING | I02实际UI accepted→Wiki修订/resolved/处理日志，不称自主发现 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| R27 | §27：anchor 不只行号；相同目标多次出现、目标已删/已改必须提示定位不确定，禁止静默修改错误位置。 | 历史PASS：多匹配/改删明确提示，禁止静默错位 | REUSE_PASS | 定位算法未受影响边界复用候选；有新差异再最小返修 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| R28 | §28：Log 只记录知识操作（导入/create/update/audit 等），含时间/对象，首页最近变更来自真实日志；Prompt 操作不冒充知识变更。 | 历史PASS：知识日志ID/operation，Prompt不冒充知识变更 | PENDING | I01–I06当前四链及恢复日志/对象ID关联 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R29 | §29：Lint 11 类齐全：坏链、孤儿、Index缺失、Frontmatter缺失、Source缺失、knowledge_status缺失、confidence缺失、source_level缺失、无来源事实、open Audit、疑似重复标题；逐类有效 fixture 可定位，不自动改知识。 | 历史PASS：11类Lint有效fixture/定位/不改知识 | PENDING | R22/I06缺等级/来源检测适用性，其余未变规则复用 | [B06](B06-acceptance.md)（Audit/Lint工程历史PASS；提交未复核） |
| R30 | §30：搜索 5 范围标题/别名/标签/正文/分类实际命中；可选 qmd，不作启动或搜索前置。中文索引在新增/编辑/删除后同步。 | 历史PASS：中文五范围/无qmd与索引更新 | PENDING | I01/I06当前新增更新/恢复搜索；细分边界复用 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R31 | §31：首页 Raw/Wiki/本周新增/待确认/Open Audit/Prompt 六计数来自真实数据；导入/新 Wiki/生成 Prompt/新 Prompt/Lint 五入口均有效。B01：本周为 Asia/Shanghai 周一00:00，本周新增=Raw+Wiki创建数，UI解释；其他对象为零，只有导入入口启用。完整入口与待确认口径后续验收。 | 历史PASS：六计数/五入口/上海周界/真实日志 | PENDING | I01–I05当前审核/Prompt/Audit与新增状态计数/入口 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS） |
| R32 | §32：学习地图是分类视图，行业基础/品类/渠道/销售/门店/经销商/供应链/商品/数据指标/AI应用/公司业务/客户/其他可用，数量真实。 | 历史PASS：13分类学习地图/数量 | REUSE_PASS | 历史分类视图复用候选，无新分类需求不重跑全样本 | [B02](B02-acceptance.md)（手动Wiki/搜索历史PASS；提交未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R33 | §34：Library 完整支持创建/编辑/删除/搜索/分类/标签/收藏/复制/变量/简单版本；收藏和标签刷新后保持。默认分类行业学习/业务分析/客户/产品/AI/日常办公（例举条目作场景帮助，不要求全量种子 Prompt）。 | 历史PASS：Library完整功能/变量/版本/来源字段 | PENDING | I03–I06当前正式保存/关联/版本/持久化，删除收藏等边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R34 | §35：Prompt 保存 id、名称、分类、场景、正文、变量、输入/输出要求、相关Wiki、示例、标签、收藏、创建/修改时间、版本、来源 manual/ai_generated/optimized。中文变量可用。 | 历史PASS：Library完整功能/变量/版本/来源字段 | PENDING | I03–I06当前正式保存/关联/版本/持久化，删除收藏等边界复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R35 | §36–40：Generator 主要入口为自然语言任务；两段生成有人工修改 Brief；任务名/类型+7字段+相关Wiki可编辑；六模板行业学习/流程分析/客户访谈/需求分析/AI方案/会议整理及自定义可用，不是固定死表单。 | 历史真实PASS：六模板+custom与编辑Brief两阶段 | PENDING | I03当前任务→Brief→修改→生成，不重复七模板 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R36 | §41：相关 Wiki 可建议、勾选/取消；LLM 获取已选 Wiki 必要背景，最终 Prompt 不默认塞入全库/全文；长上下文有明确策略与失败边界。 | 历史PASS：所选Wiki必要片段进入请求/未选不发及预算 | PENDING | I03当前选取消与上下文一致；长文工程边界不冒充全部真实输入 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R37 | §42：Preview 显示名/分类/场景/正文/变量/相关Wiki/输入/输出要求；支持编辑/复制/保存/重新生成/返回修改 Brief；多次生成不自动保存。 | 历史PASS：Preview编辑/复制/保存/返回/不自动入库 | PENDING | I03/I05当前Preview→明确Library保存/刷新，其余边界复用 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R38 | §43–45：Optimizer 逐维度检查目标/角色/背景/输入/步骤/约束/输出/事实推断/防虚构；显示原文、实际改进点、完整优化版；无 92 分等总分；补足内容后可重新优化。 | 历史真实PASS：弱/完整九维具体状态/建议、无总分虚造 | PENDING | I04当前check/rewrite实际点击，质量样本沿历史 | [P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R39 | §44、46：优化结果可编辑/复制/保存新 Prompt/保存原 Prompt 新版本；版本号、修改时间、正文、修改来源（manual/ai_optimized 等）可回读；修改不破坏旧版本。 | 历史PASS：优化新项/原项新版本与来源/时间/旧版 | PENDING | I04–I06当前版本保存/刷新重启/备份恢复 | [B08](B08-acceptance.md)（Prompt工程历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核） |
| R40 | §47：Prompt 不直接存 Wiki；关联 Wiki 不成为知识库成立/搜索/导出的前置；删 Prompt 不损坏 Wiki。删除 Wiki 后 Prompt 关联失效可见且正文仍可使用。 | 历史PASS：Prompt/知识分库、删除与失效关联 | PENDING | I03/I06当前关联/恢复不破坏独立知识资产；删除边界历史复用 | [B07](B07-repair3-acceptance.md)（Library历史PASS；提交未复核）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R41 | §48：一种稳定 Provider 足够；Key 不入源码、Raw/Wiki/Prompt/普通日志、完整 UI。设置仅显示掩码；模拟鉴权失败检查错误消息和请求日志不泄漏。 | 历史PASS：服务端Key/掩码/脱敏及新strict真实调用 | PENDING | R22/I01–I06新外发/错误/备份边界无Key；不读Key补证 | [B04](B04-recheck3-acceptance.md)（47产品冻结确定性PASS；提交未复核）；[H](KB02-HUMAN-CLOSE-20261023-acceptance.md)（产品60f83ad，188项工程冻结PASS）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[OQ](OPENAI-STRUCTURED-AUDIT-20261029-real.md)（基线2fe5318e+冻结差异；主线程关联交付91acd27332553a2fc6ae9fbeeb0e953e5e9b148c；O/Q真实PASS） |
| R42 | §50、52–55：四条真实闭环分别完成知识创建/更新与来源日志、纠错确认与状态日志、Brief/选Wiki/预览/保存、检查/优化/新版本；每条与原子 ID 证据关联。 | 分链PASS，当前完整App四链原子ID/日志无组合证据 | NOT_RUN | I01–I06全部：真实点击、实际版本/候选/调用关联，lab/API不能替代 | [C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[SYN](SYN01-VERIFY-AUDIT-20261026-final.md)（基线fcd0e23953e872d3f2bf733ef6d71617b7c98045；108项冻结；真实综合PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS）；[P](PA01-CONTINUE-20261016-acceptance.md)（96产品/58测试冻结真实样本PASS；提交见报告所链baseline，本文未复核）；[F3](FULL3-20261014-acceptance.md)（真实有指导Audit/HTTP确认；84产品历史冻结，当前版本未复核） |
| R43 | §51：不引入 GraphRAG/图数据库/复杂知识图谱/Multi-Agent/Agent自动执行/公众号或通用爬虫/自动互联网研究/SaaS多租户/权限/CRM/复杂项目管理/飞书导出/Marp/Chart/Canvas/Obsidian插件/独立Viewer/Prompt自动执行、多模型对比、A/B、Marketplace、自动评分、Eval/强制qmd/自动修改全部旧Wiki。库里“PRD/Eval/Agent”等 Prompt 分类不等于实现这些排除功能。 | 历史PASS：排除功能未擅引入，库中术语不等于运行功能 | REUSE_PASS | 范围复用候选；Meeting另有已批准范围，不按旧词反判越界 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R44 | §56：少量教学种子：Raw《快消行业基础知识示例》；Wiki FMCG/动销/渠道体系/门店补货/库存周转；Prompt术语学习/流程拆解/客户总结/AI机会；访谈示例任务。全标演示数据，初始化重复运行不重复灌入或覆盖用户数据。 | 历史PASS：1Raw/5Wiki/4Prompt/1任务、标记/幂等/不覆盖复活 | REUSE_PASS | 教学种子边界复用候选；本草案未重复导入 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |
| R45 | §57：桌面专业安静工作界面；阅读/表单/操作可用；避免营销首页、大渐变、发光、玻璃拟态、巨标题、聊天气泡与复杂装饰。截图审查关键长内容和审核页面可操作。 | 历史PASS：桌面长内容/审核截图与实际操作 | PENDING | I01–I05当前App等级控件/四链可操作，专项lab不替整体 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核）；[C](KB02-K204-C-AUDIT-20261024-final.md)（产品60f83adba102d887fcd925df13a8021ff7669de1；基线a9479b3348de605383811f4508d36cd7d45baeb2；真实长文HUMAN PASS）；[R12](R12-AUDIT-20261026-final.md)（基线340fc156cd309924d517ea5df2da93e1186703ce；11文件冻结；人工问题PASS）；[HUMAN](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)（5ed727128b12e5bb5c004f1205a2cf4a69f532ed；Process人审PASS） |
| R46 | §60：最终说明含真正已完成、启动/打开/数据位置、两上游复用、实际执行测试、未完成、已知风险；逐项说明 PDF/DOCX、LLM格式、中文搜索、去重、长文、API错误、Prompt质量、Wiki上下文、关联准确性。未经验证不得称完成。 | 历史DOC PASS：当时启动/数据/复用/风险说明 | PENDING | I07/I08当前109行结论、proxy/strict范围、实际数据位置与未测限制 | [B09](B09-acceptance.md)（71产品冻结确定性PASS；提交未复核） |

## 主线程接手与边界

I01–I04补当前完整App知识/更新、Audit accepted、Brief/生成、检查/优化点击及原子ID；I05补同根刷新/重启和明确禁用Provider的手工；I06补新空根恢复、失败恢复及代表记录回读。历史候选回读须标readback，当前真实模型阶段另记调用，不用fake冒充。I07逐行写实际命令/截图、受测提交、适用性与限制，重新统计；I08更新交付说明。

预算按任务卡及当时实际账本，不由本文放行：R22最多3，集成知识最多必要update1+Audit1，Prompt当前Brief/generate/check/rewrite各1；R22少用不得机械写261。失败/超时按实际外发计，首失败停止，不挪余量盲试。Meeting MH01–48本机历史证据在M05/FULL3会议映射，不混入109行；远端权限、跨平台、最低Node及部署未测边界保留。

实际准备：Get-Content/rg读取集成卡、新O/Q独立报告、status顶部、历史报告及原矩阵；Node内置fs生成本文并检查109个唯一ID、63A+46R与状态统计。第一次生成因文档模板反引号转义SyntaxError在解析阶段失败，未写文件；修正后生成成功。这是文档完整性检查，未执行产品测试或新增验收。交接后本实例停写。
