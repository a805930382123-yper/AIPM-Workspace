# B09集成阶段独立验收

最终代码关联：产品修复/测试/入口提交 `c6474fe98c63440d7b9cbdb7fe15e98eb8b6aba8`。独立 `git rev-parse HEAD` 与该提交对本轮七个产品/测试/脚本/fixture文件的工作区diff核对，无字节变化。I01–I06范围结论见后文；矩阵另保留R13 FAIL，B09整体不PASS，旧17失败保持。

2026-10-29，integration_audit，实际gpt-6-astra/medium，独立于Sol High施工。沿冻结B评分0/2/2/1=5。代码基线0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89加UI最小修复，文件SHA及102文件freeze核验见prepare报告。新freeze `d63870be02d27c115326518de23d9eaa326e9dee523441bb0333642cb76af902`。本实例仅只读核证据并写audit，未外发请求、未改隔离数据或产品。

## U05真实更新：PASS

执行分支7SOfcf，workflow `bf23201b-74cd-49ac-a5f9-c43592fe2110`，target `b57c36ac-0e0e-49cf-bf2b-6dceace5f288`。主线程实际UI过程及preview/confirmed的AX、PNG、导出与磁盘互证；本实例读取JSON与原响应、查看confirmed PNG，独立比较以下结果。

- `u05-preview-export.json`目标仍revision1、正文逐字等于I01正式原版；`u05-confirmed-export.json`目标revision2，完整原正文作为前缀保留，追加“本次来源整理”与“本次更新审核”，未覆盖原栏目。
- 请求原文包含人工说明“此处仅解释官方功能，不推断本地业务成本。”；输入字段快照与正式附录分别标记人工说明/AI整理，保留完整事实f-c1-1、两原证据c1-l001/c1-l002、Raw与位置。正式双Raw来源及D等级保持；两Raw文件SHA与I01/原档相同。
- 模型返回suggestedAdditions/conflicts/inferences为空，agreement为原功能陈述，openQuestions保留功能边界和本地成本两个问题，没有把人工说明转换为新增事实或虚构成本结果。完整Raw支持功能陈述；agreement单条引文仍截在JSON，Schema尾词仅在另条原证据中，沿既有限制，不签逐引文完整性修复。
- 新workflow预览未审，主线程实际完整审查后显式确认；confirmed workflow revision3。completed operation `9bbaf7ff-4fc4-4d52-8a3e-a103bfbda63a` 的humanReviewDigest与workflow审批一致。知识日志唯一新增一条target update/revision2，原四条create保持。
- calls/update记录sequence262、mode real、httpSent1、provider-returned；响应finishReason stop，2615输入/315输出token。此次模型1调用，无自动重试。首次arm审批拒绝在外发前，主线程取得具体数据发送授权后再放行；拒绝本身不计模型请求。更新后账本知识262/500、Prompt15/24；剩本批知识1与Prompt4，首失败停仍有效。real配置读取未逐次计数，不能沿用准备config0。

实际命令：`Get-Content`读取两导出、原request/response与calls/update、knowledge/logs/wiki.jsonl及operation；PowerShell `ConvertFrom-Json` 比较preview/original正文、确认后正文StartsWith、原Raw文件摘要、请求人工说明、审批digest；`view_image`查看u05-confirmed.png。未重跑模型或同版工程测试。

本轮旧UI阻断工程修复及U05真实闭环均关闭。结合prepare报告I01创建/综合子链，**I01本卡知识创建/更新链PASS**；不等于Audit/Prompt/完整恢复或B09整批通过。

## I05/I06无模型手工子链：PASS（范围限定）

独立读取i05-before/after-restart及i06-restored-export，核manual根158Bue与新恢复根nYqs7q。三个导出files列表相同；在两根逐文件 `Get-FileHash` 实查各5文件、0不匹配，calls均0。读取手工禁用提示、重启Wiki/Prompt与恢复Wiki/Prompt AX，及Prompt实际版本JSON。

手工Wiki `e6ef12e4-b231-405d-86d6-b8e838329a16` 为revision2、D/low/needs_verification，正文保留人工修订和待确认问题；手工Prompt `2ebaefaa-bb62-477e-89b0-37e0bb65fda5` 有版本1/2及各自manual快照，版本2保留中文变量“主题”、所需证据约束、同一Wiki关联。重启与恢复UI仍显示版本2和原内容；尝试模型入口显示明确“此隔离实例已明确禁用Provider”且没有调用。

实际创建编辑、正常停止重启、正式backup/restore与实际浏览器回读由主线程执行，本实例复用其过程及AX/导出并独立验摘要，不将读取磁盘等同实际点击。此组只覆盖独立manual实例的Wiki/Prompt；本根无Raw/Audit/AI候选，**不联签I05全部、I06四链正式数据恢复及失败恢复，也不据此把A61整行所有子条件直接签PASS**。

## 当前整批结论

B09仍未通过：待I02 Audit、I03/I04 Prompt四阶段、四链同根重启/恢复与安全失败恢复、109行收口和交付说明。独立验收本阶段新增真实调用0/配置读取0；产品实际账本以主线程各阶段调用记录为准。最终代码提交标识由主线程提交后补关联。

## I02 Audit263接受子链：PASS，刷新待补

独立读取calls/audit、response-knowledge-263、i02-preview/accepted AX、i02-export及原u05-confirmed-export、Audit记录与operation和日志。`ConvertFrom-Json`逐字比较：新Concept正文精确等于旧正文仅把首段“Structured Outputs 结构化输出”替换为“Structured Outputs：模型响应遵循给定 JSON Schema 的功能。”，其余正文、事实、证据、问题不变。目标 `869df8fc-8634-4a60-8ba4-c041aefd6562` revision1→2，等级A保持，两Raw SHA不变。

本次明确是人工反馈指定措辞的修订，不声称模型自主发现错误。preview AX显示原页面/替换预览及明确接受按钮，accepted AX显示修订后第2版、0待处理、resolved/rev3/accepted。Audit `d2f069f3-4891-40b5-813e-fca4054e6606` 只有一次accepted decisionHistory，关联draft `3328141c-3840-405e-b8e7-367e8c27664d`、completed operation `b0d512ab-7da3-4a42-bf78-491a28c46bd9`、wikiRevision2。日志有一次正式Wiki update与一次audit处理日志，不冒称两次知识修订；旧anchor在正文改后显示stale/page-changed是历史锚点对应旧版，未误写其他位置。

知识263记录httpSent1、provider-returned；响应finishReason stop，1561输入/673输出token。知识本集成2/2用满、累计263/500；Prompt仍15/24，不挪知识余额补试。**建议/预览/明确接受/修订/resolved子链PASS，可继续Prompt Brief16**；任务卡要求的刷新回读需主线程补证后签I02完整项。无新增产品修复，B09整体结论保持未通过。本独立实例外发/配置读取0。

后补刷新证据：主线程真实reload后重开Concept，本实例读取 `i02-refreshed.txt`，仍显示第2版、指定替换句、Audit0待处理、resolved/rev3。结合此前完整磁盘/原响应/操作关联，**I02完整链PASS**。此刷新没有新的模型调用。

## Brief16与安全失败恢复复用

Brief16独立读取request/response/calls及i03-brief/edited-brief AX：单次httpSent1、finishReason stop、574输入/326输出token；taskName/taskType加7字段完整，30分钟、虚构企业、禁推ROI成本和未知背景待补充与输入一致。人工编辑加入结束前3分钟受访者核对，AX显示Concept已选、综合页已取消；**Brief阶段PASS**，允许generate17，所选上下文最终以17请求复核。Prompt账本16/24，不当Library已保存。

安全失败恢复不重复运行：本实例读 `tests/b05.test.ts:94`，确为index写入注入EIO→WORKFLOW_COMMIT_PENDING→新WikiStore/KnowledgeWorkflowStore.initialize→confirmed/completed；之后人工编辑，再用不同幂等key确认得到reused且人工编辑不被覆盖。当前knowledge-workflows SHA `b9721bf6836b0975c8b272a2ef1c0fde5210c029bb07f5d2ca502ab88b7e9e7c` 与模板更新builder冻结一致；`git diff 59b94ca HEAD -- services/wiki/knowledge-workflows.ts services/storage/files.ts tests/b05.test.ts` 及同文件工作区diff均空。故复用该报告实际14/14中B05六项的此项PASS，覆盖本卡安全、零真实花费的知识提交失败恢复边界。不是新跑测试，也不替代四链当前同根重启/空根恢复。最初搜索误写不存在的b05-workflows文件和Windows通配路径报错，随后读取正确b05.test.ts核实，不计产品失败。

## Generate17：必要Wiki上下文FAIL，首失败停止

本实例实际读取原request/response-prompt-17、calls/generate及i03-preview AX，并检查 `services/prompt-ai/service.ts:129` 的context实现、BUDGETS与score及PRD§41。当前service SHA `02ce8684aafd3502187ce25e7e281b69acadc7ef3ecefa2caa48d420ef2b92de`。

请求仅包含已选Concept `869df8fc-8634-4a60-8ba4-c041aefd6562`，已取消综合未发送，人工加入最后3分钟核对条件保持；这两个子条件通过。但relatedWiki.excerpt精确为 **`## 原草稿一句话说明（未归位）`**，usedChars16/sourceChars1364/truncated=true，没有任何实际定义正文。完整页面本身小于单页3000/总12000预算，包含明确的结构化输出定义；不是预算耗尽或用户未提供知识。

模型返回结构合法、finishReason stop，并诚实提示Wiki具体内容待用户补充，未虚构来源。输出保留30分钟、末3分钟核对及禁止ROI成本约束，然而无法完成用户明确要求的所选Wiki概念背景。**I03必要上下文及R36当前受影响子条件FAIL**，不能因HTTP/结构成功签通过，也不能用Prompt预览人工补正文掩盖选中背景未送出的产品缺陷。

静态原因已定位：正文按空行分段后按精确terms匹配排序；excerpt为空时纳入第一段，之后所有score<=0段落被跳过。在本例首段独立Markdown标题胜出，兜底仅留下标题，没有关联正文。故应在原上下文选择边界做最小修复与离线回归，不追加模型抽样或扩大为新检索系统。本独立实例不改产品；主线程负责后续范围内返修派发。

generate17仅一次httpSent1、provider-returned，884输入/1083输出token。**实际知识263/500、Prompt17/24；本批新增知识2、Prompt2。已通知主线程停止，不放行check18/rewrite19、不自动重试17、不挪余量。** 原请求/响应及失败预览保留，未正式保存Library（当前prompts目录无文件）。后续即便工程修复PASS，也须分别记录17历史失败与新验证，不能追改旧失败。B09整体明确未通过。

## 已授权context最小返修验收标准（施工前冻结）

主线程确认首失败停止，授权Sol只修services/prompt-ai/service.ts、必要tests及新builder；独立验收仍由本实例完成，双方不混写产品。沿已有B模式，不增加模型预算。

| ID | 必须满足的边界 |
|---|---|
| C01 | 用原17 Brief与实际Concept正文离线重放，输出不得只剩Markdown标题，必须携带该正文已有结构化输出定义；选择ID与人工Brief条件保持。 |
| C02 | 零词匹配、正文以独立标题开头时，确定性兜底带实际非空正文，标题与对应正文不因空行拆段丢失。 |
| C03 | 存在匹配仍优先相关内容；未选Wiki不发送；原文片段不改写。 |
| C04 | 单页3000/总12000/最多6页及sourceChars、usedChars、truncated正确；允许预算边界字符截断，不把标题空壳当有效背景。 |
| C05 | 仅现有context边界最小修复，不扩检索框架、不改模型契约；必要现有回归与build通过，交接SHA及原失败fixture来源。 |

工程通过不自动释放新模型调用。主线程拟在交付可审阅修复后再取得明确新增1次阶段预算授权：新generate18/check19/rewrite20，旧16/17保留；全球上限仍24。该拟案当前不是已获调用授权。

C06补充冻结：主线程已授权两集成脚本支持唯一具体continuation profile，基线知识263/Prompt17、cap知识0/Prompt3，仅generate/check/rewrite对应18–20。新session逐字继承7SOfcf资产并保留祖先关系及旧调用/失败证据，不覆盖旧账本，不把失败草稿变成功；旧普通profile仍保持原行为。离线核18–20、上限拒绝、首失败停及knowledge/brief不准放行。real仍需新freeze绑定与用户追加1次后主线程release。只增加此具体续接，不做通用预算框架；当前仍不授权外发。

## 用户批准后的Generate18：PASS

主线程收到用户明确批准补验3次（较原阶段增加1次）后，按新session oZSBMc及freeze87a1e3a执行唯一generate18。Generator未提供持久化Brief恢复入口，主线程实际点“手动填写Brief”逐字段填回原17输入，再选同一Concept；不冒称重跑Brief或使用不存在的自动恢复。独立读17/18原请求，**Brief逐字段JSON完全相同**；relatedWiki只有原Concept，已取消综合不发送。

独立比较新excerpt与原fixture实际Wiki正文.Trim()，逐字一致；usedChars1363/sourceChars1364，差1仅末尾空白，定义、全部事实/证据/待确认边界均在请求。UI `i03-repair-preview.txt` 同样显示1363/12000与1363/1364，正文引用Structured Outputs给定JSON Schema功能并标口径待核，没有把原17缺背景说法延续为要求用户补Wiki。输出保持未知企业/流程不虚构、禁ROI/成本、30分钟各段3+8+7+6+3+3=30、最后3分钟受访者核对。

calls/generate：sequence18、httpSent1、provider-returned；响应finishReason stop，1454输入/1316输出token。**generate18及必要Wiki背景修复真实PASS**，旧17失败不删除；可由主线程实际人工编辑/明确保存Library，再继续check19。I03完整保存/刷新链仍待后续证据，I04尚未通过。当前知识263/500、Prompt18/24；独立实例真实调用0。

## I03正式保存/刷新及Check19

主线程实际在18预览人工改名“经销商访谈·B09已审模板”，追加中文变量`{{访谈对象}}`及未知待确认说明，明确保存、reload Library中文搜索并回读。独立读i03-final-export、i03-library-refreshed AX及实际Prompt JSON：正式ID `ce473ac4-3902-4eeb-a6c2-13a4c7fbb000`，仅版本1，changeSource/source均ai_generated，变量/正文/名称/唯一Concept关联与编辑一致。知识日志SHA与新session继承前一致，没有伪造知识操作。**I03完整链PASS**，结合原16和修复18，不抹去17失败。

主线程选同Prompt版本1，明确约束保留时长/事实/变量且不编造缺项后，唯一check19。独立读原请求响应、calls/check、i04-check AX与optimizer草稿：九维全部present，每项证据确实来自原正文；improvements为空，不虚造改进点或总分。草稿 `198aeeb5-794f-4316-a8e5-babfb0b972b4` pending/baseVersion1，检查持久化及UI一致。httpSent1/provider-returned，1505输入/568输出token。**check19阶段PASS**，可按已批准固定序列继续rewrite20；I04完整版本保存待验。知识263/500、Prompt19/24。

## Rewrite20质量阶段：PASS

独立读取response-prompt-20、calls/rewrite与i04-rewrite-preview AX。唯一httpSent1/provider-returned、finishReason stop，1751输入/1196输出token。重写仍保留中文变量`{{访谈对象}}`、选中Concept定义及口径待核、未知背景/回答不虚构、禁止ROI/成本；各段3+8+7+6+3+3合计30分钟且末3分钟核对。新增明确可选追问、核对更正等执行说明，无新增业务事实或伪造缺项。

UI仍显示九维无缺失、没有强造改进列表，同Concept关联和“保存为第2版”可用；本阶段仅质量/预览通过，正式版本写入及旧版保持待下一证据。**Prompt累计20/24，获批补验3/3已用满，知识263/500；后续不再请求模型。** 原17失败保留。

## I04保存刷新及当前导出/首页：PASS

独立读i04-saved/library-refreshed AX、i04-final-export、实际Prompt版本JSON与check草稿。主线程人工改名回“经销商访谈·B09已审模板”后明确保存同ID第2版，随后reload回读。v1 changeSource=ai_generated、v2 changeSource=ai_optimized，保存时间递增、变量“访谈对象”与同Concept关联保持。v1正文逐字等于check19持久化originalBody，原版本未被重写；generator.preview是人工编辑前预览，不拿它误作保存后v1基准。**I04完整链PASS**。

独立读取prompt-export.md，版本2、必要元数据、中文变量、关联Wiki及v2完整正文可独立阅读。source=ai_generated保留生成起源，ai_optimized为版本修改来源，两者不混淆。知识日志SHA与续接前一致，Prompt生成/优化均未添加知识日志。

首页i04-final-home AX六计数Raw2/Wiki4/本周新增6/待审2/OpenAudit0/Prompt1与对象导出及日志一致：两Raw四Wiki均本周创建；待审由继承pending提取draft与pending综合workflow各1构成，不误把已接受Audit或Prompt计入。首页最近变更是知识创建/更新/Audit真实日志。以上不替代当前同根重启/空根恢复，后者待主线程补证。

## I05/I06完整当前资产重启与恢复：PASS

主线程正常停止real服务后，同oZSBMc根以manual模式重启并实际打开Prompt、Concept/Audit与Raw；正式backup导出后restore到新空根ofqyDv，完整App以manual模式启动，再实际打开同代表记录。本实例读取i04-final-export、i05-restart-export、当前i06-restored-export，逐路径SHA列表比较：**三者23文件完全相同**；再对oZSBMc/ofqyDv实际文件逐项Get-FileHash，各23文件0漂移。两根Raw/Wiki/Draft/workflow全JSON与基准一致，保留全部ID、原文、等级、审批快照、来源关系、版本和日志。恢复Audit另读确为resolved/rev3/accepted。

独立读最新i05-restart与i06-restored的prompt/wiki-audit/raw AX：Prompt版本2和旧版本1、中文变量仍可见；Concept第2版/Audit resolved rev3仍可见；Raw原文仍可回读。知识日志和Prompt文件同SHA，含AI优化新旧两版本。UI未展开的accepted决议由实际恢复Audit JSON及先前接受UI证据支持，不冒称当前AX有该展开文字。

结合前述manual手工子链及同版安全失败恢复测试适用性，**I05/I06本卡要求PASS**。本轮没有新模型调用，oZSBMc calls仍只有18/19/20各httpSent1；实际累计知识263/500、Prompt20/24。备份不含integration控制/真实调用私有原件，这些按独立取证目录保存，不把其未进入产品资产备份误称数据丢失。

证据归属澄清：主线程后续使用了同名i05-restart-prompt.txt、i06-restored-prompt.txt及i06-restored-export.json，当前内容已属于四链oZSBMc/ofqyDv，不再是早先manual158Bue/nYqs7q快照。早先手工子结论依据当时独立读取结果、仍保留的i05-before/after-restart、manual根逐SHA核验和manual Wiki图文；本报告不将当前同名文件冒称早先manual证据。无需重复运行已通过流程。
