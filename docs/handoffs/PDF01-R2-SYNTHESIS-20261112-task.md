# PDF01 R2 有证据的主题草稿写作：已批准施工

用户明确恢复原施工；B模式0/2/2/1=5，Astra规划独验、原Sol High施工。当前R1 PASS、R2 rev4 FAIL25/30；真实41/50余9，原gold不降、R3不开。保全部历史差异，无正式资料/配置修改、提交推送；OXR完全排除。

## 最小合同

复用已完成R1、4清理和rev4索引，新写作阶段替代纯选代表正文。允许组织改写AI草稿，Raw/R1/原unit、片段及证据不可改。继续现任务检查点/显式续/取消/版本绑定、Draft candidate.body/pdfEvidence与整体成果审核，不增审批或平台。

多主题有界输入`pdf_topic_write {topics:[{id,title,items:[{id,unitId,page,origin,kind,text,table?,mergedInto?}]}]}`。每批最多4整题、48输入、24KiB user JSON；超大主题按完整单元有限分批，不能静默裁事实。

strict输出`topics[topicId]={blocks:[{kind,text}],coverage:{[itemId]:{action:included|duplicate|metadata|promotion,blockIndex:number|null,reason:string|null}}}`。冻结每题/每输入key必需且禁止额外；included/duplicate必须指向同题有效段，metadata/promotion必须非空理由且无段索引。服务端从coverage反算每段依据；未知/跨题/空依据段拒绝。每段明确AI整理身份，不写成原文source_facts。表格、原推断/问题沿现独立类型/渲染保留，不能混成事实。

归属台账用于查遗漏，不要求每片段进正文；重复、纯宣传、Logo/页码可省正文但留底源/理由。空噪声主题无候选。About/序言含实际规模、方法、条件、新数据不得整页按宣传略。原人工内容、来源权限与确认摘要/版本保护不变。

数字检验针对每段有效依据，保量值、符号、单位和预计/实际等限定；允许合法标点/单位表达转换，不以全文字面相等限制总结。检验只能发现明确无依据数字/引用，不能证明语义完整；原六页gold仍独立评分。不同地区/年份/样本条件并列，事实与推断分开。

## actual pack与预算

旧真实26题188非skip项（125原文/63 AI，含exact merge/推断/问题；显式表格0），全量JSON31704B。上述界限7批：题数4/4/4/4/4/4/2，项数48/21/8/27/39/42/3；最大7493B，最大单题25项3697B。预计仅7写作调用，余9可行并留2，但最终wire/分类筛选后重算，不先请求，不重跑清理/索引。

## 所有权与验收

Sol仅cleanup.ts/render.ts及现专项/PDF02测试、隔离工具和施工报告；真实证据只TEMP。必要其他接线先报具体点。Astra仅本卡/独验报告/状态；UI原Sol仅必要合成浏览器/截图，产品UI若确有缺口再明确所有权。

工程：strict真实HTTP wire；全归属/非法引用/空来源/错数字符号单位；多个同义材料生成一段且合全来源；不同口径与新增事实保留；纯页码和宣传可无候选；人工编辑/确认前不写正式/确认后正确来源；旧结果只读、新版归档与同源复用、失败续/取消。fake只证明合同，不证明模型语义。定向+范围tsc/build及必要现表格/来源回归，实际Chrome查看正文和页依据。

工程独验后冻结同账新工具、原R1/清理/索引/全部旧结果SHA和最终产品版本，报root后再真实。失败立即停留响应，不为追PASS追加无依据调用。root已确认7批方案并授权施工，真实尚未放行。可按实际复杂度增加单一pdf-topic-writing.ts隐藏pack/decoder/guard边界，不扩平台。
