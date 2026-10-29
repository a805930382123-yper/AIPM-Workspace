## 最新结论：R1 独立复验 PASS

2026-10-29：F-R22-01 CLOSED，E01–E04 工程条件 PASS；下文首次 FAIL 及原复现完整保留。R22 整项仍待 E05/E06，B09 整体未通过。未新增真实调用或读取配置。

受验基线仍 `91acd27332553a2fc6ae9fbeeb0e953e5e9b148c` 加工作区差异；按施工报告末尾同名SHA覆盖前值核验27文件，drift0。三个返修文件最新SHA：workflows `89c5f7db84dadd74b9c973a3f1bd440ea48d8b7836ae7cb09b78befa693e0205`；record-validators `053688a7c11518771e4eec04703ce858e192a07d8be44a52745092ddfd4b2c3c`；R22测试 `c5cb9d582a21faab0609ae705be329179ce7256cf00087e0c4f9ced5257882f9`。

独立实际执行 `node --import tsx --test tests/r22-source-level.test.ts`：18/18 PASS、exit0、1.081秒。包括完整综合数组等级拒绝且无持久化、document/workflow/sourceList/Wiki四个存储边界拒绝数组，以及原16项行为。再次执行首次直接解析复现（仅将promise结果改为断言拒绝），实际 `LLM_SCHEMA_INVALID`、exit0，旧错误已不复现。静态差异确认只收紧等级类型与对应测试，无额外框架或产品行为扩张。

复用同版施工24/24（R22+B05）、最终build exit0及diff --check exit0；前轮35项上下文/归属与strict回归对未改模块仍适用，不重复无关测试。UI/runner均未改；主线程正在旧非watch服务验证合法字符串UI，其操作可作为未改变的UI及合法保存路径证据，但不证明旧后端拒绝数组，类型拒绝由本轮最新代码实测承担。X5aXUd旧freeze不宣称为R1新版本全冻结。

允许进入E06脚本准备/新版本冻结审查；本报告不自动授权真实请求或增加3请求上限。主线程须合并E05实际证据与后续E06真实初判后再裁决R22整项。

---
# R22 工程独立验收（2026-10-29）

结论：**E01 FAIL；E02–E04 工程子条件 PASS；R22 未通过，B09 整体未通过。** 发现一项明确类型边界遗漏，需最小返修后复验；E05 由主线程实际 UI 另列，E06 NOT_RUN。未读取真实配置，真实调用0，知识258/500、Prompt15/24保持。

验收实例为规划者 r22_plan（Astra角色），未参与产品或测试施工；施工为独立 Sol 实例。受验基线 HEAD `91acd27332553a2fc6ae9fbeeb0e953e5e9b148c` 加施工报告工作区差异。独立按施工报告27项SHA逐一核验，27/27一致、drift0。当前UI准备 root X5aXUd 的98项 freeze由施工记录提供，本报告未冒称再次逐项核验该freeze。

## F-R22-01：综合等级接受数组而非字符串（P2）

`services/wiki/knowledge-workflows.ts` 的综合响应解析校验采用 `['A','B','C','D'].includes(String(item.source_level))`。因此真实模型可返回 `source_level:["A"]` 而通过本应拒绝的enum边界。新增 `services/storage/record-validators.ts` 等级字段校验也采用相同强制转换，可将数组当合法值回读。该情况违反卡 E01 的非法等级明确失败要求；不能把通过单个非法字符串E的测试视为覆盖类型。

独立复现命令（零网络、无文件写入）：

```powershell
node --import tsx --input-type=module -e "import {KnowledgeWorkflowStore} from './services/wiki/knowledge-workflows.ts'; const store=new KnowledgeWorkflowStore('unused',{},{});const value={synthesis_format_version:1,title:'test',category:'metric',sourceLevels:[{rawId:'x',source_level:['A']}],suggestedAdditions:[],conflicts:[],agreement:[],inferences:[],openQuestions:[]};const out=await store.call({name:'fake',model:'fake',complete:async()=>({text:JSON.stringify(value),bytes:1,finishReason:'stop'})},'','', 'synthesis-locator-v1');console.log(JSON.stringify({accepted:out.sourceLevels}));"
```

实际 exit0：`{"accepted":[{"rawId":"x","source_level":["A"]}]}`。这是实际调用既有解析边界，不是完整综合持久化复现；它已证明拒绝边界失效，无需发真实请求确认。

最小返修：这几个本轮新增等级入口要求真实字符串且在ABCD枚举内，去掉String强转；补数组等级的综合拒绝及持久化校验定向用例。不得重构其他历史validator、扩大通用防御框架或重新跑真实模型。交接停写后独立复验此边界与受影响R22测试即可。

## 已通过的工程证据及适用范围

独立实际运行：

```powershell
node --import tsx --test tests/r22-source-level.test.ts tests/kb02-planning-context.test.ts tests/kb02-planning-attribution.test.ts
```

35/35 PASS、exit0、1.177秒，其中R22 16项。检查了请求元数据/政策、ABCD传递、缺失/非法字符串、人工改级保存与确认、Raw不变、混合来源最低初值、已有Source和已审草稿优先、审批失效、重复/未知Raw ID拒绝、更新保持目标等级、无AI默认D和旧checkpoint回读。测试未覆盖上面发现的数组类型缺陷，故整体不得PASS。

独立差异检查确认：planning schema必填enum进入现有strict路径；metadata选择避免重复全文；source-policy指纹与revision17使旧未完成checkpoint不兼容；旧完成路径仅允许既有回读。新字段进入原candidateContent及提交摘要、patch清空审批；Source/综合显选值在确认时写入，已有Source保留；未引入独立判级调用或重做OpenAI strict。E02/E03后端工程子条件通过，不代签UI。E04兼容与长文上下文实测通过。

复用施工92/92定向回归（metadata最终修正前）及最终build exit0记录：92项不称为当前版重新执行；最终metadata修正由本轮同版35项覆盖，27文件SHA一致支持复用其余未受影响检查。HTTP9/9沿施工报告作为工程支持，不冒称独立浏览器证据。无需重复无关全套检查。

下一步先修 F-R22-01 并复验；E05与E06继续分别保留独立证据门禁。局部修复成功也不能代签B09四链与整矩阵。


## E05 实际UI证据独立核验：PASS

独立读取 `R22-MAIN-20261029-ui.md`、`R22-20261029-ui-evidence/final-export.json`、`ui-http.jsonl` 并实际查看 `synthesis-confirmed.png`，对照TEMP原r22-session.json。主线程实际浏览器操作与导出一致：单Source B/指标D；综合C/新Source C；已有Source B、revision1且对象与prepare完全一致；5正式页全部unreviewed，draft/workflow均confirmed，3个Raw bodySha与prepare逐一一致。截图可见综合详情C、未审核及5页。HTTP轨迹13次变更均200/201，包含两链PATCH、review、confirm及后续GET。

审批1→0→1、未审综合前端阻止与刷新中间态依据主线程当场操作记录复用；单张终态截图和仅路径/状态HTTP不能独立重建所有中间值，本报告不将其描述成完整录屏。结合已独立验证的后端审批失效与最终实体回读，E05证据足够。未重复操作或调用真实API。

版本边界：UI为非watch旧freeze `6949dd5a8fdeef7a1365d8b1458dd23c50ae0ed1380734b673e88c583c173c92` 的合法字符串路径；R1仅改等级类型拒绝且UI/runner未变，故可复用合法值保存确认行为。R1数组拒绝依赖前述最新代码18/18和直接反例复验，不冒称旧服务运行了R1。E01–E05工程与UI条件已通过，E06真实初判仍待执行；R22及B09整体不签通过。

## E06 首次准备审查：技术准备通过，语义样本门禁待修正

独立只读检查 `tests/acceptance/R22-20261029-real.mjs`、builder交接、真实未放行session及freeze。98项实际文件SHA逐项一致、drift0，freeze为 `5099314764b5334672b8ef959b75b7a9296222e7d9da2f7350e5377a5d645f69`。分阶段release、预算3、259–260后独立通过才261、开始标记一次性、失败不重试、配置延迟读取及原响应留存符合卡；4fake/0real/0config smoke复用同脚本施工证据。验收未执行任何真实请求或配置读取。

**目前不建议放行真实阶段：预期A的语义依据存在样本歧义，属于验收样本准备问题，不是已证产品失败。** 第一Raw同时标注“虚构”“真实验收合成资料”，仅sourceName称公司正式经营报告；产品规则又强调未知/未核验AI内容D、不能单凭自称权威升A。可以将此理解为测试给定的假设来源身份，也可以理解为现实中未经核验的合成材料。当前session无条件要求A，不能保证拒绝D是在检查明确的产品要求，而不是要求模型接受测试方隐含假设。

最小准备修正：在冻结的合成材料元数据中明确这是“假设场景分类测试，场景前提已给定该资料由公司正式发布”，保留虚构标识，不直接给出目标字母，不声称现实核验。另一个来源仍明确未知。相应任务卡/预期说明明确只验证按给定身份进行等级初判与人工纠偏，不验证外部真实性。此为调用前消歧，不是在观察答案后改预期；不改产品提示或降级schema，不添加调用。修改后重新prepare/冻结并独立核验，旧未放行session保留不用。若主线程选择使用真实公司资料，则需另行准备有出处材料；此不是本轮必须扩展的外网研究。

固定A/D的fake工程测试继续有效，只证明传递及机制，不能解决上述真实语义歧义。当前原3请求预算未消耗，知识258/500不变。

### E06 样本消歧决策

主线程已实际打开 OpenAI 官方开发文档 `https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat` 核验其公司正式发布身份。选用短原文：“Structured Outputs is a feature that ensures the model will always generate responses that adhere to your supplied JSON Schema”。来源名OpenAI官方开发文档、author OpenAI、sourceType article、url为上述地址。该来源可作为A级初判样本，依据是实际可核的公司官方发布身份，不是虚构自称，也不意味着本产品已实现该文声称的全部技术行为。

第二Raw为同主题未知来源的独立待确认问题：“该特性对本地业务的成本影响尚未确认。”sourceName来源未知、note，不编造数字，不用官方来源替未知问题补证。未知D与综合最低D预期保留，模型看不到expected字段。

此方案替代上一节“假设场景”建议，不需要修改产品/strict适配或额外调用。须先更正任务卡及fixture（article原文件路径应遵循RawStore真实映射，不能继续硬编码reports/notes两类），重新prepare与冻结、确认旧会话未放行后再独立审查。准备尚未据此完成，故本条仅确认选材可用，不预签新准备PASS。


## E06 官方输入新版准备独立审查：PASS，可放行提取259–260

唯一会话 `.scratch-R22-REAL-20261029-1tqItB`，session `5ccf5a5f-f2d5-46cd-ad0d-e36b5362a46f`。独立逐SHA核98项无漂移，freeze `e234a9a6ad1a8089d7a9eee22574e7f8b652f909b8b1a78f16470a6289c8ccd7`，runner `4ef4cb355fa3571868374f74e5e99f6cf1db6cf02ef09a45817ddb48f41f5d4d`，卡 `17b142eed4938f9a13d4c9416a6f83030f910ae1b6a531feb6041ad9d8490b33`。无release/attempt/started标记。

独立用RawStore只读回读两Raw，官方原文、author、sourceName、url与卡逐字一致，正文无追加标点；未知正文匹配、没有author/url。两Raw重新计算body SHA及文件SHA均与session一致（4/4）。官方出处核验复用主线程实际打开页面证据，本验收未冒称再次浏览官网。此前虚构自称身份歧义已消除：官方公司文档支持A初判，未知D、综合保守D有明确规则依据。expected仅在session，不进入产品模型请求。

入口静态确认：release绑定新session/Raw/freeze；每次请求重核freeze；仅extract259–260最多2次，综合独立审核与新release后261最多1次；无release在开始标记/配置读取前拒绝。attempt先记reserved，实际fetch前sent递增，wire只保存url/method/body、不保存凭证头；原响应保留，秘密检查后公开副本。失败不自动重试，已开始stage不可重复执行。原Raw正文和文件先核对，阶段后再核正文摘要；均仅隔离根。新fixture article映射已改为articles。

同SHA脚本smoke4fake/0real/0config及未release两stage拒绝证据复用施工记录，本次不重复产品回归。准备验收本身0真实/0配置；知识258/500、Prompt15/24保持。

**主线程现在可仅对本新会话放行并执行extract259–260。** 原旧会话不放行。提取产物必须再独立核级与真实原始响应，PASS后才能另外放行261；准备PASS不等于E06真实PASS，也不等于R22/B09整体通过。
