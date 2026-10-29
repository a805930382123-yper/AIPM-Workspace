# OpenAI strict schema 真实独立验收

2026-10-29，Astra resume_scope独立验收，未参与施工或真实执行。受测基线2fe5318e70e188cf28c15af7867aacf460213d66加prepare报告列明差异，freeze逻辑摘要5ba9e4499e01326f3232605b734ff4a68344037967211ef6b448384dd6c6d75d；主线程提交后关联。

## O255–256：O01/O02及共同标准 PASS，可放行Q

证据root `.scratch-OPENAI-STRUCTURED-20261029-yO3s6e`。独立读request/response255–256公开文件、candidate-original、result；未读private文件/密钥，未调用API。两response均stop、structuredOutputApplied=true，请求带相应结构描述；结合已验同版本Provider精确分支证明本次strict应用，未将runner请求记录称作网络抓包。255原始抽取5事实/0问题，256自然单business_process，原始可选栏目null经规范映射，非法页未出现。

O01：非空outputs为“本次流程输出补货安排单；安排单已编制，仓库发货尚未执行。”引用fu-57-75-fact与fu-75-91-fact，来源分别明确安排单及未发货。无已交付或收益升格。其余六非空栏目逐项核对：business_goal对应第一事实；roles对应门店/计划员及待仓库执行；trigger/inputs/steps对应第二事实；rules对应第五事实。未新增负责人、系统、收益或痛点评价；无AI机会断言，未强造内容。

O02：独立Node只读assert核Raw SHA等于session、五事实拼接逐字等于Raw、完整证据quote等于Raw；全部事实及7个非空栏目AI文字均在真实preview.renderedBody中完整出现。Draft仍pending_confirmation/revision1，事实与AI整理标识分开，未审正式提交未执行。

实际独立命令为PowerShell Get-Content读取上述公开JSON，及 `node --input-type=module -e` 内存断言（读取candidate/session/request/response/result，以createHash校验Raw，assert检查facts拼接、证据quote、逐字段render.includes与structuredOutputApplied）；exit0，无新增产品测试/网络。result为2reserved/2sent/2real/config1，知识256/500、Prompt15/24；本审查额外真实/config0。

本样本证明当前strict技术成功及动作状态目标正例，旧254、248及旧P历史FAIL保持。允许主线程按冻结新预算执行Q257–258；Q尚未执行，R16/R18及B09整体仍未通过。未改原始候选或正式Wiki。

## Q257–258：Q01/Q02及共同标准 PASS

证据root `.scratch-OPENAI-STRUCTURED-20261029-eklVgy`。独立读257/258原始公开response与gate：抽取仅第一atom为fact，两个未知atom均只questions；gate逐一匹配qu-35-64、qu-64-83，均questionOnly=true，事实只有fu-0-35-fact。规划自然单Process，将两问题完整归属该页，无未知审批人或审批先后顺序答案。两阶段stop且structuredOutputApplied=true。

四非空栏目逐断言核查：roles/steps为第一事实的门店提交、计划员核对及形成安排；inputs“补货单和库存信息”对应提交补货单、核对库存的直接业务内容，未新增系统/审批数据或其他前提；outputs“补货安排单”对应原句。未将未知问题放入模板事实字段，其他栏目null省略、未补AI收益或痛点评价。

独立 `node --input-type=module -e` 只读assert exit0：fixture逐字拼接等于Raw，Raw SHA等于session；source_facts精确仅第一句，open_questions精确等于原两问题；完整evidence.quote等于Raw；三句原文及四个非空栏目都在preview.renderedBody；两response标记strict应用。原Draft pending_confirmation，未人工补稿/正式提交。本审查没有真实API、配置读取或产品测试。

result 2real/config1，知识258/500、Prompt15/24；连同O本批4real/config2，无重试。新4次封顶已用满。S01–05工程准备及O/Q目标通过；本轮两个覆盖缺口已补，历史失败不删除。

## R16/R18收口判定

已复核 acceptance R16/§13、R18/§15及COVER真实审查、HUMAN最终独立报告。Concept249–250质量/传递PASS与两型模板、HUMAN H01–04人工纠偏闭环证据仍可复用：本批不改模板/UI/人审持久化。O/Q补上当前版本outputs动作状态及question-only传递正例。

当前可确认的是R16概念模板/已有真实内容证据，以及R18流程模板/有据正例/人工纠偏交付路径覆盖。**本报告不将R16/R18整项联签为PASS**：旧P pain_points自动无依据评价的缺陷没有自动修复证据，HUMAN证明的是用户纠偏，并非自动消除。若项目收口以“AI草稿允许人工纠偏、正式内容有据”为验收口径，应由主线程在既有总表明确该缺陷的残留处置和允许范围后逐项裁定；若要求自动非空栏目均有据，则R18仍有明确残余失败，不能用O/Q新正例替代。无需为此重抽样或重跑Concept。

下一步建议零调用对齐R16/R18原标准与残余自动缺陷处置，不改旧报告、不把人工路径PASS说成自动修复。B09仍须R22及完整App四链等未闭合项，整体未通过。本批真实预算已满，不隐式续用。
