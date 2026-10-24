# A2按HUMAN规则验收通过

A2原文提取保全通过；原始自动主题质量仍未通过；实际Chrome明确人工纠正并全页重审后，当前A2阶段通过，可由主Agent签A3。此结论不称模型自动修复成功，KB02整体仍BLOCKED。

基线提交 `41ee7862305f71ae9a35c26b84a8db58dcc747c3`，adapter freeze `a6ba495b97cb271da732cbed32c0243ab4508a675333e3e1b440093d48d00aaa`。真实222提取、223规划各一次，HTTP200/stop，无重试。阶段A累计4次，知识223/500、Prompt15/24不变，A3尚未外发。

原candidate-A2完整保留100/30/30%、旧20/20%、口径或采样差异待确认、财务每周回款核对、审批负责人未知、AI仅未来且无上线收益，4fact+1question。原3页中孤立AI边界和“异常审批流程”标题仍有自动主题缺陷，已保留于resume-A2-content.json，未改原候选或历史FAIL。

PREP任务卡第29行明确允许“人工资料整理分组”，须标注人的组织选择且不声称原文蕴含业务关系。主Agent实际Chrome把AI完整unit移入第二页，删除空第三页；第二页改concept/other、标题“补充资料整理：回款核对、异常审批待确认与AI未来建议”，一句话说明明确三项并列且不证明同一流程/因果。Source标题改为人工并列分组；原document规划元数据仍保留原模型措辞，未将其作为已证明业务关系或A3输入。这里是显式人工资料编排，不是把AI事实判断成回款流程的一部分。

第一次两页审查后，为第一页选择A1 metric更新目标并保存，实际UI v7清为0/2；随后逐页重审，最终v9为2/2，A3预览按钮启用但未点击。证据为主Agent `KB02-K204-A-MAIN-20261023-A2-cleared-ax.txt`、`A2-reviewed-final-ax.txt`，中间v8/1页记录另存不冒称最终。

独立实际命令 `node --import tsx tests/acceptance/KB02-K204-A-AUDIT-20261023-resume-A2-readback.mjs` exit0。直接用生产RawStore/WikiStore/DraftStore只读回读并调用assertReviewed，验证Raw SHA、五unit全部原记录/ID不变、每unit唯一归属、两个现页全审且摘要匹配；metric两条来源事实/差异问题与原候选相同，第二页三项仅并列保全，无unresolved。A1目标revision2/body SHA与原A2 release绑定不变。原source facts、question无删改。

当前draft `708b3cd7-3cd1-4b56-b965-2f35576ff287` revision9；metric page `3d633dfd-c5ae-46b0-b83f-69d776aebe12`，reviewDigest `163a5dc5e221ec7ffd8a2df42ed629fb33eba9e5068c095c7c279a7804370405`。精确binding见resume-A2-readback.json；主Agent应再运行CLI bindings A3获取原样对象，不人工改摘要。

A2已扫描导出SHA `7763d42c3f07fb5c8021c1df92f9592c7d56b60cca2746a48d455e575354a347`核验一致。可引用resume-A2.json作为A3 previousEvidence，仅224/maxCalls1，实际Chrome生成预览一次后先独立核质量；任何失败停止，不改模型错误事实凑PASS。B/C未授权。
