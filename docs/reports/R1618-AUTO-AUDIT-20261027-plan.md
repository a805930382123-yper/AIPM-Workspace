# R16/R18 自动字段方案独立审查

日期：2026-10-27。受审基线 `65818841df73ba350641eafa5cb638d8ab21fb68`；审查对象为 `R1618-AUTO-20261027-builder.md` 的只读诊断与9产品文件＋1定向测试方案。此为方案审查，未施工、未运行功能测试，不是功能验收通过。

结论：方案可采用，施工前落实以下一项必要修订。范围保持同一次planning生成可选字段、原ID持久化与草稿/正式新建；不加模型调用、框架或通用防御矩阵。

## 必要修订

AI说明可由用户编辑，编辑后若继续纯标“AI整理”会误报作者来源。建议 `aiContent` 增加可选 `humanEdited: true`，编辑文本时置位，保存/恢复保留；渲染为“AI草稿经人工修改（待核对）”。AI机会仍明确为分析建议。未编辑初稿仍标AI整理；人工独立说明仍保留 `humanText`。引用表示参考依据，不能把AI或人工改写说明显示成来源逐字事实。此修订属于现有字段类型、编辑和渲染落点，不扩大所有权。

## 接口核对

- `templateFields` 必须在wire、checkpoint、ExtractedPage、Draft链路均可缺省。旧无字段plan可读不等于旧未完成checkpoint可跨rulesVersion续跑；继续原版本不兼容提示并保全原件，不能静默迁移。
- `factUnitIds` 只引用本页事实unit；展开须包含unit全部原memberIds。project反向须核对完整member集合，不能用数组下标/标题或只匹配其中一个member。字段引用可重复使用同一事实，不改变页面事实归属恰好一次规则。
- Draft `factIds` 锚定原humanReview记录及当前页面归属；`evidenceIds` 为所引用事实实际证据的完整去重集合。未知/跨页/缺证据拒绝保全，相关事实移动保护、重命名引用稳定沿原方案；无需增加通用迁移机制。
- 语义归位由planning完成；无依据字段为空/待确认，AI机会与事实分层。工程fake证明管线，不代签模型自动内容质量。

## 最小验收边界

施工定向新链fake与tsc，独立验收在停写后核实际差异和受测版本；复用有效人工F04及其他未改行为证据，不重跑旧矩阵。新增AI文本控件应做一次最小浏览器修改、保存/刷新及来源标签核对；不重复人工两类型完整闭环。真实质量另批预算。

本轮实际只读命令：`Get-Content`读取Skill、status、B09、coordination、施工方案及相关planning/checkpoint/template源码；`rg -n`定位字段与协作条款；`git rev-parse HEAD`、`git status --short`核版本与外部修改。未运行产品、未读取.env或实际Provider配置、真实调用0。知识244/500、Prompt15/24不变。AGENTS/.agents/AGENT-ROUTER外部修改不触碰；平台token计量不可得。

本轮功能与批次均待施工后验证；R16/R18整项、B09和全产品未通过，历史质量结论不改写。
