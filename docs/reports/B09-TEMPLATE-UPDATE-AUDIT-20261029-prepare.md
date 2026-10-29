# B09模板更新独立工程验收

2026-10-29，Astra resume_scope独立验收；Sol High structured_build施工，实例不同。本实例仅编写任务卡和本报告，未改产品/测试。基线e04231e9440082c9a3f57e8da446040778c2740e加builder列明7文件工作区差异，提交关联由主线程补充。

## 裁决

U01–U04工程准备PASS，未发现需要返修的范围内缺陷。原带字段候选被一律拒绝的工程缺口已在离线产品管线关闭；U05真实当前App更新及语义尚未验证，完整任务和B09整体不能签PASS。

U05目前BLOCKED：主线程报告两次CUA kernel初始化helper_unknown_error/setup refresh失败，CUA无升级参数；本审查未用HTTP替代浏览器，也未执行依赖UI的真实请求。解除该环境阻塞后用R22真实候选按原预算执行即可，不重跑已通过工程测试。

## 实际差异审查

核knowledge-workflows/template-fields/record-validators/API类型与预览UI实际差异：guard替换为已审输入的可选v1字段快照，保留人工归位、人工说明、AI文字及humanEdited，事实目录引用映射限定选中页。模型请求携带快照与同源可读标签，并明确不得仅凭人工/AI整理生成事实建议，原facts保持。现有五字段协议未改。

共享renderInputTemplateFields供只读预览与正式附录使用，明示整理不等于来源事实，原目标正文保持；字段text、fact/evidence ID、Raw、位置及quote保留。快照纳入candidateContent的整体内容摘要以及确认payloadDigest，来源草稿revision/reviewDigest/字段快照一致性复核保持；审批变更、目标冲突和未审门禁存在。PATCH未知字段拒绝快照注入。新存储结构闭合校验，旧可选记录仍可读；R22原目标等级及补Source已审等级不回退。

## 独立命令、结果与复用

实际独立执行：

```powershell
node --import tsx --test tests/b09-template-update.test.ts
Get-FileHash services/wiki/template-fields.ts,services/wiki/knowledge-workflows.ts,services/storage/record-validators.ts,app/api.ts,app/pages/KnowledgeWorkflowPage.tsx,tests/b09-template-update.test.ts,tests/r1618-field-editing.test.ts
```

6/6 PASS，exit0，duration4369.9875ms。Concept/Process各自覆盖快照请求、同源附录、Raw/事实/问题/证据保真、重启与幂等单次正文/日志；另含双层审批、修改源字段失效、目标冲突无部分写入、跨页/非法引用拒绝、PATCH注入/删除拒绝、损坏读盘拒绝与旧记录兼容。测试仅隔离本地fake及HTTP，不能证明真实UI/模型语义。

7个SHA逐项与builder冻结一致，故复用其受影响旧update/HUMAN/R22 14/14及最终build exit0，不重跑R22全矩阵。首次13/13与后续14/14/6/6是不同运行，不合并冒称新总数。源码/报告读取命令Get-Content、rg、git diff均只读。

本审查无真实模型API/实际配置读取，知识261/500、Prompt15/24不变。U05仍占原集成update1请求，不新增提取或额度。下一步等待CUA可用后当前完整App操作；无工程返修建议，不以环境阻塞重开产品修复。
