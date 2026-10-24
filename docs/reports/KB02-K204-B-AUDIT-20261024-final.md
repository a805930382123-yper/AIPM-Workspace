# 阶段B未通过：浏览器必需重复候选接口缺失

**本轮隔离接线FAIL，阶段B FAIL；KB02整体仍BLOCKED。** 原文真实提取完整，但实际Chrome发现重复候选查询404，按产品安全规则无法确认写入。人审修订/逐页确认/正式创建/刷新回读/真实幂等均未完成，不标PASS。旧独立engineering PASS报告原样保留，由本轮实际失败覆盖最终结论。

基线提交 `d2176eca0632e69a9b082acbb80a1ec0523bdc56`，产品60f83ad；受测B freeze `12dad741181e7e74a95d58d2f49a24774343c6f11903b1083d7bbb4d4f6f2463`。本轮225提取+226规划共2次，累计226/500、Prompt15/24，无重试、无更新调用、无追加模型诊断。主Agent已stop自有真实服务且进程exit0，并关闭本轮Chrome页。隔离session/Raw/候选/账本保留。

## 确定的接线缺陷

缺陷 **F-K204-B-ADAPTER-DUPLICATES-01 / P1**：B server为去除update/synthesis未注册`registerKnowledgeRoutes`，同时漏掉其中非模型的`GET /api/knowledge/drafts/:draftId/pages/:pageId/duplicates`。`DraftReviewPage.tsx`初始化/保存/确认均调用duplicateCandidates；确认时任一查询失败即DUPLICATE_QUERY_FAILED并阻止正式写入，这是正确产品保护，不是产品应放宽的限制。同模块的create/defer decision路由也缺失，应纳入随后最小接线检查。

实际Chrome两页均显示“候选查询失败……为避免漏掉已有知识，确认写入会被阻止”，已审0/2。主Agent保存完整 `KB02-K204-B-MAIN-20261024-candidate-ax.txt` 与candidate.png，本审查已核AX中两条错误。随后独立只读复现：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:65297/api/knowledge/drafts/4c2d4689-7827-4bec-a9d2-92517f12e3f4/pages/25971c2b-4f32-479c-b77c-58984a715a5d/duplicates' -SkipHttpErrorCheck
```

实际HTTP **404**，正文`Cannot GET /api/knowledge/drafts/4c2d4689-7827-4bec-a9d2-92517f12e3f4/pages/25971c2b-4f32-479c-b77c-58984a715a5d/duplicates`。仅GET，新增模型调用0；源码检查确认未注册路由，故无需再试请求或修模型。

17组fake及独立追加探针确实通过，但其正常链直接调用draft confirm，没有覆盖实际前端必经duplicate查询。独立工程审查同样漏查该前端依赖；不能用其历史PASS或直接API确认绕过Chrome失败。本次收紧最终结论，不修改原测试/旧签收JSON，也不把明确缺陷仅记作环境BLOCKED。

## 真实内容裁定与保存状态

已读取candidate-B、result225/226、job、账本及安全export。job completed、callCount2，两个响应HTTP200/finish_reason stop。4fact+1question完整保留虚构饮料甲/2026年9月/甲桥/100目标20在售、在售÷目标即20÷100=20%、门店数非销量、审批负责人待访谈、AI仅未来无上线收益。来源声明未当事实；原5unit/member ID保留且唯一分配，无事实遗漏或伪造。

原候选两页：metric经营记录，以及仅AI未来边界/负责人未知的独立concept主题。metric无需人为改type；本阶段并不要求metric。后者原自动主题质量仍未达成熟知识主题要求，历史问题保留；不能把提取完整称自动主题已修复。未来如接线获准修好，可按本卡HUMAN规则作明确人工资料整理：第二页改为“人工资料整理：异常审批待确认与AI未来建议”，明确两项并列记录、不证明同一流程/因果关系，保留两原unit而不造关系；或者审查者不能确定组织则留unresolved阻断。**本轮没有实施这些改动，也没有确认任何页面。**

session `0fb85966-323f-4cd8-a68e-040c8b573aa2`，root `.scratch-KB02-K204-B-20261024-J5hCNy`；draft `4c2d4689-7827-4bec-a9d2-92517f12e3f4` revision1/pending_confirmation，approvals0，wiki目录仅index.md、0正式记录/0commit。Raw SHA `d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515`，原candidate摘要 `f34123a314d2f28b11233f33b0077f62bb82bacfef3be11f0598c8d8230d57f2`。安全export `KB02-K204-B-20261024-export-2026-10-24T05-26-30-020Z.json` SHA `03702765434ecac8dc203585b845204461e09be03c24d89c2249171c2c165a70`已实际Get-FileHash核验一致。

## 下一轮建议：0模型复用现session

当前仅给最小修复建议，不施工。若获授权，Sol新修复前缀补现行产品的duplicates查询及必要create/defer decision接线；保留update/synthesis/提取等模型动作关闭，不能返回伪造空候选或直接confirm绕过产品门禁。可使用现行生产route注册配合明确写路由白名单，或窄复用同等生产查询逻辑；最终需审实际边界，不能因注册整个模块意外开放模型功能。

新离线恢复服务必须精确绑定上述session/root/Raw/原候选/账本与当前draft revision，复用已持久完成的结果，不创建新job、不重提取、不重置225/226、不改旧freeze/release/失败证据。Provider应不可构造、禁止配置加载及所有模型出口，预算新增0。必要修复fake用已有输出/合成数据，增加实际前端duplicate查询与保存/确认路径覆盖，之后主Agent实际Chrome完成显式HUMAN整理/逐页审查/确认/刷新重开，独立磁盘和幂等回读。

需要新卡/冻结/独立工程确认才恢复持久写流程；原真实2次已用完，不需要也不得通过再外发解决路由缺失。修复成功后仍分别记录“接线缺陷关闭”“阶段B全过程是否通过”，不能用局部路由200替代阶段验收。C未授权/NOT_RUN，KB02不能结批。主Agent统一保护/秘密扫描及本轮文件提交同步后汇报停止。
