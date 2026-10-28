# R16/R18 revision14真实复验：独立裁定

2026-10-28，Astra medium `r1618_retest_plan`，未参与产品/入口施工或真实请求执行。受测提交 `99215280a04e81071a6d1abacf4108c250effde1`，沿用[既有QUALITY oracle](R1618-QUALITY-AUDIT-20261027-plan.md)及本轮卡；实际执行由主Agent完成，本实例在完成通知后读取公开证据，没有发模型请求、读取实际配置或private响应。

## 分层结论

**Q02真实自动质量FAIL。** 原响应只自然生成一个Business Process，没有Concept，冻结的两类型覆盖明确未达；outputs还将来源的“安排发货”表达为“由库管安排发出的补货发货”，引入已发出含义，不能据此签逐断言支持通过。

**Q03真实outcome→Draft及文本渲染PASS，限实际生成的单Process。** 九个非空字段原文从248响应进入Draft并出现在渲染正文；原事实、来源证据与Raw保真，未知问题和AI限定可见。该结论证明真实原稿传递与渲染，不证明内容正确、不涵盖缺失Concept，也不是浏览器或正式提交通过。

**revision14局部表现：旧格式阻断本样本未复现，真实语义修复不能整体关闭。** 本次字段全部位于templateFields，Process没有Concept专用definition，原异常负责人错引AI事实未复现；正常通过既有严格解析并出稿。但两类型缺口仍在且出现输出完成性措辞问题，不能称全部修复成功。原246 FAIL历史保持；R16/R18整项、B09/全产品仍未通过，准备P01–03 PASS保持。

## 原稿逐字段质量

依据[247原响应](R1618-RETEST-20261028-real-evidence/response-247.json)、[248原响应](R1618-RETEST-20261028-real-evidence/response-248.json)及[原稿/渲染/checkpoint](R1618-RETEST-20261028-real-evidence/candidate-original.json)。以下f1–f6分别指Draft的f-c1-1至f-c1-6及原文六句，不以单个宽证据ID代替语义核验。

| 栏目 | 引用与独立判断 |
| --- | --- |
| Concept覆盖 | FAIL：pages仅1个business_process。不能把Process来源事实内的定义句等同自然生成Concept；Concept解释、重要性及一句话质量未覆盖 |
| business_goal | f1/f2，按库存需求补货与降低缺货风险，来源支持 |
| roles | f3/f4，店长申请/提交、库管核对/安排发货，职责正确 |
| trigger | f3，低于安全库存触发，来源支持 |
| inputs | f1/f3，库存、需求、安全库存水平是原句内容的合理整理，未新增系统、数值或外部输入 |
| steps | f3/f4，申请→提交补货单→核对→安排发货，连贯且保留职责/顺序 |
| outputs | f4，补货单有据；“由库管安排发出的补货发货”超出仅安排发货的来源强度。至少存在完成性歧义，严格逐断言标准不能通过；无需依赖这一争议也已因缺Concept而FAIL |
| exceptions | f6，负责人未知并明确待确认，无具体负责人编造。本次引用实际未知句，不是旧246的AI未来句 |
| ai_opportunities | f5，明确分析建议，保留未来/未上线/收益未知/需验证，未复制旧fake的具体AI核对机制；可接受 |
| related_knowledge | f2/f3，库存/安全库存/缺货风险是原句直接涉及主题，“管理”作为相关知识主题整理可接受；未宣称已有独立系统、管理制度或实体Wiki。不能据此认定新增无依据正式事实 |
| systems/metrics等未填栏 | 渲染为待确认，无编造系统或量化指标 |

247把第6句同时列入facts和questions，因此这次为6事实+1问题；原句文本在两轨均完整保留。第6句“负责人未知”本身有来源支持，不能仅因双轨就断言本轮新失败；但也**没有验证question-only情况下省略字段的真实遵从**，不得把本次exceptions存在判为该分支成功。独立问题正文仍显示“【虚构】异常审批负责人未知。”。AI内容标“AI整理（待核对）”，机会标“分析建议”；没有人工说明或编辑补稿。

## 执行与保真证据

主Agent执行唯一真实run，结果exit0，`captured-awaiting-independent-quality-review`只表示抓取成功，非质量PASS。[result](R1618-RETEST-20261028-real-evidence/result.json)记录reserved/sent/realCalls均2、configReads1、knowledgeUsed248、promptUsed15；序号247/248已用尽本轮2次授权，不重试。实际模型在原稿为GLM-5.3-Flash，rulesVersion含planning-14。

本实例实际命令均PowerShell只读：`Get-Content`公开247/248响应及fixture；对candidate-original.json使用`ConvertFrom-Json`按preview.pages、outcome.pages选择读取，避免大JSON输出截断；逐9个templateFields比较原响应文本与Draft.aiContent并检查renderedBody包含原文，9/9为true；将六条source_facts与fixture.quotes比较、Raw正文与六句拼接比较、source_evidence.quote与Raw.Substring(0,137)比较，均true。rawUnchanged=true，humanNoteCount=0。`Get-FileHash`及`git rev-parse HEAD`核下列摘要及上述提交，命令exit0；未重跑smoke/tsc/浏览器，没有修改原稿。

| 对象 | SHA256 |
| --- | --- |
| candidate-original.json | `c8f83fcf3ddce847f3637a5466adae2fe00f6b4b2216d6cc5452ac92b4df5f68` |
| response-247.json | `0f350a841896187b49b9c875368edb4e7a5a290f018ac3b5731a5b2ec1368742` |
| response-248.json | `b8ed5dbad4f380af6375dd7d72c73aa3ce1e4d672a48db0a23f249219fc7d065` |
| 实际Raw文件 | `6666d1e1965dd230139c71924829ca94dfd6240443b7666b3216784b1a4786c1` |

Raw文件SHA与准备会话一致。Draft `197a29b8-92fc-4da9-9cae-0cb61b31154b`，原始root `.scratch-R1618-RETEST-20261028-iMU5d1`；主Agent将12个非private公开文件复制到本报告引用的稳定归档。实际请求返回usage：247为1686输入/104输出，248为5222输入/526输出，总6908/630；outcome的0/0聚合不作为真实零消耗依据。

## 后续建议与停止

本轮预算封账：知识248/500、Prompt15/24。保留成功传递证据与质量失败，停止真实调用，不人工补拆Concept、不补写输出后追认自动通过。建议下一步先沿B模式零调用诊断：区分页规划的自然类型覆盖与不应强制固定页数的边界，并针对“安排”到“已发出”的来源强度给最小方案；question-only真实分支仍缺证。存在修后仍未达的核心质量门槛，不能直接重复提示/再抽样，先有证据诊断再决定修复及新预算。本报告仅建议，没有启动施工或新增调用授权。
