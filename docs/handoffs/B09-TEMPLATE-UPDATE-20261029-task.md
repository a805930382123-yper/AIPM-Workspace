# B09 带模板字段候选的旧Wiki更新补齐

2026-10-29，Astra resume_scope规划及独立验收，Sol High structured_build施工，主线程实际UI/真实放行/同步。基线e04231e9440082c9a3f57e8da446040778c2740e。仅本卡由规划写入，不改产品测试。用户已授权B09遗留修复，本批无需重新询问范围许可。

需求0、耦合2（更新请求/持久化/预览/审批/正式写入）、风险2（事实完整性及审批）、历史1（已观察常规候选受阻）=5，B模式。

## 缺陷与边界

knowledge-workflows.ts createUpdate的TEMPLATE_UPDATE_UNSUPPORTED阻断所有非空templateFields。R1618-FIELDS-20261026-task:13与plan:54仅为当批新建安全边界；PRD§23及顶部人工审查修订要求普通新资料生成旧Wiki更新预览并另行审查。当前R22真实Concept正常有字段，不能改用旧无字段材料回避。禁止只删guard、清空字段、把人工/AI字段静默丢掉或变成原始事实。

## 冻结最小方案

1. 沿现有inputDraft的draftId/pageId/revision/reviewContentDigest绑定，从已持久化且已审候选读取字段。仅带字段update新增可选版本化字段快照（建议inputTemplateFields），包含页type及字段结构、必要来源fact/evidence目录与Raw身份。复用既有TemplateFields/validTemplateFields契约；明确字段引用属于该选中页、Raw及事实，不造通用schema框架。旧无快照记录可读，不回写历史；新快照字段不能被客户端patch注入/删改。
2. 快照完整保留evidenceIds人工归位、humanText人工说明、aiContent.text/factIds/evidenceIds及humanEdited标记。展示及正式正文分别标“来源摘录（人工归位）”“人工说明”“AI整理”或“AI整理（人工修改）”。人工审阅不把AI/人工文字升格为原始来源事实。快照引用带Raw、事实/证据ID及原quote，缺失或跨页引用失败，不补引用。
3. 当前update请求增显式newSource.templateFields及可核对的字段出处，说明这是已审整理材料，不是新来源事实；事实建议仍须原newSource.facts/evidence支持，人工说明及AI整理不得单独成为事实证据。沿现有suggestedAdditions/conflicts/inferences/openQuestions/agreement输出协议，原有事实/冲突校验保持，不新建模型调用或自动字段合并协议。
4. 更新预览只读显示该字段快照及标签/出处，与现有正文、新来源及可编辑五类建议分开。需要改原字段时回原草稿编辑后重新生成，旧inputDigest/revision随之失效；不新增平行字段编辑器。预览不得把“已审输入”当作“更新已审”，继续要求当前workflow显审。
5. 快照加入现有contentDigest、确认payload/事务摘要及存储结构校验；审批确认覆盖实际可见内容。新预览字段/建议变化使原审批不可复用；原草稿字段变更后确认旧预览失败。继续校验目标Wiki revision、Raw摘要、全部unit覆盖。已有恢复manifest校验沿原机制，不能允许新快照绕过旧审批。
6. 确认时保留目标旧正文，并在“本次来源整理”独立附录无损写入字段快照及出处/标签，后接或并列现有更新审核章节；不自动覆盖旧模板栏目、不宣称去重合并。UI预览和最终正文必须同源生成或同一明确语义，避免同内容两套不一致。已有知识来源、日志、幂等和备份正常保留。R22已有目标等级不重置、补建Source使用已审来源等级、等级修改仍使审批失效。

## 文件所有权

Sol：services/wiki/knowledge-workflows.ts、必要的template-fields.ts或render.ts复用呈现、services/storage/record-validators.ts、app/pages/KnowledgeWorkflowPage.tsx、必要共享workflow类型；确需时human-review.ts限摘要输入。定向tests/b09-template-update.test.ts及受影响既有workflow测试，docs/reports/B09-TEMPLATE-UPDATE-20261029-builder.md。仅必要修改，不为方案凑文件。若旧持久化manifest validator所在文件不同，在交接说明实际落点。

规划/验收仅本卡和独立audit；主线程拥有status/Git。共享工作区中既有集成准备文件与AGENTS改动不得覆盖。施工不启动真实请求、不读key、不改R22或OQ历史证据；交接后停写。集成入口产品依赖部分等本批通过再冻结。

## 验收U01–U06

U01 Concept与Process各一：含AI栏目、humanEdited栏目、人工说明及人工证据归位；已审输入可生成更新预览，无字段候选旧路径不变。实际Provider请求包含完整快照、标签职责和出处，原facts未被追加整理文字。
U02 预览及最终正文均保留字段文字/标签/原引用，Raw/原事实/证据不变；未知与冲突不会变成事实。输入字段带非法或跨页引用拒绝，不能删字段后成功。原正文不被覆盖。
U03 输入未审拒绝；新预览未审拒绝；建议编辑或审批内容变化失效；输入草稿字段更新后旧workflow确认拒绝；目标revision冲突拒绝，正式资产均不部分改写。只读快照不可通过PATCH改删。
U04 确认后刷新/重启及相同幂等键回读无重复更新，版本/来源/日志正确；含新快照存储可读且损坏拒绝，旧workflow/完成记录仍可读。R22目标等级/补Source继承/审批失效保持。仅运行受影响定向集与npm run build，不重跑R22完整矩阵。
U05 主线程在当前完整App用R22真实已审Concept候选实际生成更新→查看字段快照→显审→明确确认→刷新正式页，核正文附录/出处/等级；无字段或人造样本不能替代此真实目标。Process字段路径由定向工程测试覆盖，已有Process真实提取/HUMAN证据复用，不为对称再花提取请求。
U06 独立验收收到停写交接后核差异、版本/SHA/定向结果及UI证据，分别裁工程修复和B09整体。U01–04准备通过后才可U05；不得以HTTP或fake代UI真实闭环。真实更新语义失败按原首失败停，不以附录保全掩盖错误AI建议，必要人工纠偏须显式记录。

## 预算与顺序

本工程准备零真实/config读取；知识261/500、Prompt15/24不变。沿B09-INTEGRATION已冻结知识2：本update占1（预计262），Audit占1（预计263），Prompt4至19；本卡不追加提取、综合或真实预算，不创建独立新额度。主线程逐阶段放行，首失败/超时/未知结果计数并停；先零调用诊断。U05可作为I01更新证据，避免重复执行。

当前小批修复后再继续依赖它的集成准备/四链，不清空重新做已通过R22。短引文按已核结论是定位显示边界，I01/I06核Raw全文与sourceId/两段定位覆盖即可，不在本批扩修。
