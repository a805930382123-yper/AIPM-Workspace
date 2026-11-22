<!-- ENG03 architecture:1 -->
## 2026-10-23 HUMAN增量设计（已实现，人工门禁验收通过）

当前实现与验证边界见[独立收尾报告](../reports/KB02-HUMAN-CLOSE-20261023-acceptance.md)：HUMAN工程门禁通过，KB02整体仍因K2-04真实质量证据未齐而未结批；不将下列设计的实现等同于模型质量修复。

以[HUMAN任务卡](../handoffs/KB02-HUMAN-20261023-task.md)为本轮冻结接口边界：revision13新提取链在机械合法规划后直接组装未审候选，不再外发B1审核；新计划调用下界chunks+1，旧revision12历史下界chunks+2保留。新规则指纹拒绝旧未完成恢复；已完成草稿不重提取。

Draft/KnowledgeWorkflow新增版本化审查元数据：服务端不可变来源unit目录、唯一页归属或未解决、绑定完整可写内容摘要的逐页明确确认。现有原子文件/锁/revision继续使用，不增通用审批框架。开始审查显式持久化旧记录目录，GET不隐式改盘；legacy目录保留实际旧条目及证据，不虚构模型ID/来源。新KB02目录从实际planningInput携带，update继承输入页来源及预览提议，synthesis从已有sections/evidence建立带真实类别的审查条目。原文事实与人工修改区分。

CommitStore及KnowledgeWorkflowStore正式确认服务层统一拒绝未全审/有未解决/内容摘要失效，update再次检查输入draft及目标版本。Source写入也受门禁；新事务快照包含审查绑定。旧已完成幂等兼容；旧零写prepared不是豁免，不能恢复时偷偷写入；旧真实部分写且磁盘匹配冻结清单才可恢复原事务，冲突保持停止。全部具体迁移/并发/入口测试见卡。以下架构段落保留既有实现与历史；本增量实现及验收范围以上方收尾报告为准。

<!-- ENG03 architecture:3 -->
KB02 R2（2026-10-16，施工中）将新执行链升级为 kb02-2：服务端生成原文 atom 目录，模型只选 ID/分类，事实与摘要确定性派生；来源声明保留检查点元数据。覆盖失败返回有界 ID 诊断，planningRetry:true 明确触发仅重新规划且沿用同 job/累计账本。更新仅选择已验证 evidenceId，服务端派生原工作流证据结构；旧合法 Draft/Workflow 保持兼容，旧规则未完成检查点明确不兼容并保留。具体以 [本轮接口](../handoffs/KB02-R2-interface.md) 与最新 status 为准；受控自测不能替代新规则真实质量，KB02 40/40 已用尽。下段为 R1 历史实现及验收记录。

<!-- ENG03 architecture:4 -->
KB02当前新Raw执行链已改为locator目录→精简事实/原文明示问题→整篇主题规划→确定性DraftRecord组装，半成品只进state/extraction-checkpoints。正式确认仍走原审核事务，Raw不改写。kb02-1按Raw实际SHA、规则、chunk参数与非敏感端点/model绑定，显式继续或restart:true，不自动外发。KB02 R1已修复有效恢复ID、严格有界checkpoint/409预检、旧fixture迁移，将提示修订纳入缓存身份。工程验收PASS，实际IAB同job复用14段通过；真实Spec仍FAIL：补充口径被擅补、更新旧quote/offset契约失败、长文规划漏事实，严格拒绝且不组装部分草稿。见[KB02 R1验收](../reports/KB02-R1-20261015-acceptance.md)。

<!-- ENG03 architecture:5 -->
历史KB01 R4提取使用provider-only locator-v2输入：每个chunk由服务端建立完整、连续、UTF-16安全的Raw切片目录，单条≤512字符、最多256项；模型选择当前chunk定位ID，服务端派生原始引文/位置，严格验证后仍按原草稿格式存储。未知、跨块、格式混用和页内引用错误失败关闭；解析前和Raw映射后都扫已知凭证。聚合保留全部来源/事实，相同重叠证据去重、后缀占用确定性避让；文档汇总只返回document。旧quote输出兼容，不按首匹配猜位置、不丢失败chunk、不加重试或提高预算。

<!-- ENG03 architecture:7 -->
KB01 R4当时真实长文未通过，详见[历史验收](../reports/KB01-R4-20261014-acceptance.md)；KB02首轮长文技术全量完成为历史证据；R1提取14段完整，但两次规划漏事实、无草稿，真实质量仍未过，以最新status为准。<!-- ENG03 architecture:end -->
