# B09 模板候选更新施工交接

2026-10-29；Sol High structured_build，依据冻结任务卡。基线提交 `e04231e9440082c9a3f57e8da446040778c2740e` 加以下工作区差异，施工未提交。**U01–U04工程自查通过；U05真实完整App操作未执行，待主线程及独立验收。B09整体未签PASS。**

盘断连期间首补丁未成功写入；E盘恢复后重新确认任务卡与工作区，再实施本轮修改。没有覆盖AGENTS、外部报告、规划卡、集成卡或R22原始真实资料；未读真实配置/Key、未调用真实API、未改用户workspace。知识261/500、Prompt15/24保持。

## 交付行为

- 已审模板候选可生成旧Wiki更新；新增可选 `inputTemplateFields` v1，保存输入页ID/type、Raw ID、完整fields、事实目录及原引文/位置。人工归位evidenceIds、humanText、aiContent.text/factIds/evidenceIds及humanEdited完整保留，引用仅限该选中页。原无字段路径不变。
- 新模型请求携带快照及同源可读标签/出处，明确人工说明、AI整理不能独自充当事实证据，原 `newSource.facts/evidence` 未扩写；沿用五类更新建议输出及原证据校验，没有新增模型阶段。
- 预览显示只读“本次来源整理”快照；共享 `renderInputTemplateFields` 生成预览文字与最终独立附录，标来源摘录（人工归位）/人工说明/AI整理/AI整理（人工修改）。正式更新保留原目标正文及栏目，附录后接原更新审核章节，不自动合并覆盖旧栏目。
- 快照进入已有内容摘要及确认payload摘要；输入页字段/revision/reviewDigest变化时旧预览拒绝确认。新workflow仍须单独显审，编辑建议使审批失效；目标版本、Raw、事实归属校验保留。HTTP PATCH原未知字段保护拒绝注入/删除快照。
- 存储校验新增封闭快照结构与fact/evidence/Raw/page绑定；旧可选缺字段记录仍可回读。现有事务manifest无需新格式，实际正文已包含快照附录；payloadDigest及humanReviewDigest覆盖快照，重启/幂等不重复追加。R22目标等级及补Source继承保持。

改动仅7个产品/测试文件及本报告。共享呈现与边界校验放在既有template-fields.ts；未改Provider、rules、schema、human-review或新增产品路由。

## 实际命令与证据

```powershell
node --import tsx --test tests/b09-template-update.test.ts tests/r1618-field-editing.test.ts
node --import tsx --test --test-name-pattern='U0[1-4]|B05|HUMAN update|R22 update' tests/b09-template-update.test.ts tests/b05.test.ts tests/kb02-human-review.test.ts tests/r22-source-level.test.ts
node --import tsx --test tests/b09-template-update.test.ts
npm run build
git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check
```

第一组 **13/13 PASS**，exit0（新6项＋既有字段7项）。引用边界微调后第二组 **14/14 PASS**，exit0、1.479秒（新6项＋B05六项＋HUMAN更新1项＋R22更新1项）；最后仅强化磁盘事实回读/日志单次断言，新6项 **6/6 PASS**，exit0、1.357秒。以上分别运行，未虚报为一次累加全量测试，未重跑R22矩阵。

新增覆盖：Concept/Process分别包括未改AI栏目、humanEdited栏目、人工说明、人工证据归位，实际请求快照及原事实分离；预览附录同源；原正文/Raw/磁盘事实/问题/证据不变；跨页AI fact和未知证据拒绝；输入未审、新预览未审、建议编辑、源字段变化、目标冲突均阻止正式写入；PATCH快照注入/删除拒绝；损坏存储拒绝且原文件保留；重启后可读、相同幂等键无重复正文或日志；目标D/补Source B保持。

最终 **npm run build exit0**，tsc通过；Node v24.18.0、npm11.16.0、Vite6.4.3，214modules、2.14秒，仅既有大bundle提示。diff --check exit0，仅LF→CRLF提示。

U05当前真实R22 Concept的完整App更新及模型语义未测，不以本fake/本地HTTP测试替代。主线程在工程独立通过后按原集成预算最多一次update（预计262）执行，随后Audit预计263；Prompt4上限不变。本轮没有启动或消费这些真实请求。

## 冻结文件SHA256

| 文件 | SHA256 |
|---|---|
| services/wiki/template-fields.ts | `8016b741b2d507f49747920bce162d1d47506cece28239c1a5cc3e3557bdae44` |
| services/wiki/knowledge-workflows.ts | `b9721bf6836b0975c8b272a2ef1c0fde5210c029bb07f5d2ca502ab88b7e9e7c` |
| services/storage/record-validators.ts | `3fbc781129b8bf9464cad334ca7ba248ab81ebd1a90e66b7d6836c16276ac499` |
| app/api.ts | `f56ebf453a7712a3c5f28e77622fa8851d741d2a731095b4a3e2da85537e995d` |
| app/pages/KnowledgeWorkflowPage.tsx | `a2ff02400b65ff84a201040968143cb5b47366b7ba4bdf77bf404f9df356eb55` |
| tests/b09-template-update.test.ts | `dd1867cbb326d71877b987fc322e1d15620919924ad6ffc332455f8851a3e5c2` |
| tests/r1618-field-editing.test.ts | `34f1c3454206a39abb9bf46309da14d461fcbc57594aa37441f8aedaaac2911d` |

施工交接后停写，交Astra独立U01–U04验收，再由主线程U05；独立工程与整体验收结论分别维护。
