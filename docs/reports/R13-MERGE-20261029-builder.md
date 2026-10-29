# R13 模板候选无损合并施工交接

2026-10-29，Sol High integration_prepare，依据已审 `R13-MERGE-20261029-task.md`，B评分0/2/2/1=5，基线 `f9e560974408d5974141b1fcf3ed81d72b6a0659` 加下列差异。**M01–M05施工自查通过；M06真实完整App CUA未由施工执行，独立验收待定，R13/B09不预签PASS。** 真实API0、真实配置读取0，知识263/500、Prompt20/24保持。未动正式workspace/已完成历史资产/用户服务，未提交；AGENTS与包装报告等并行内容保留。

## 最终实现

首目标沿原pageId/type/category与templateFields，其他原页字段进入version1扁平mergedTemplateFields，各自保留原pageId/title/pageType/rawId、fields、原facts及evidence目录。两个合法4000字AI项保持两个对象，不拼接、截断或改变原类型栏目的含义。再次合并保留原组且按原pageId去重，不嵌套。

合并只改变humanReview.assignments，原unit/fact/question、原文本、basisDigest均保持；全部审批清零。当前页全局证据仍由不可变units重建；仅merge路径将首目标人工引用按原Raw/位置/quote映射到稳定别名，AI绑定按原fact重建；普通move仍拒绝换引文。碰撞别名保留64字符既有引用长度边界。原页组持有自己的引用目录/命名空间，目录与当前归属units核对，避免同名不同位置串引。

普通PATCH只能编辑组内字段，不能注入/删除整个组、换原身份/顺序/事实/证据目录；AI只允许改文字或明确删项，原fact/evidence绑定保持，改文字保留humanEdited。人工说明和纯问题字段组可有空facts/evidence，不伪造事实。存储读盘拒绝非法/跨归属组；原文件保留。新增组与编辑进入原全内容digest及全部页审批失效机制，不增审批框架。

当前React保存快照携带全部组，共享字段编辑器显示原页/原类型/原命名空间、独立人工/AI标签及原引用；保存中及只读状态显式禁用控件。预览、正式Wiki及新建Source显示原组；原已存在Source仍按既有复用规则保持，不追写历史页。旧Wiki update的inputTemplateFields增加可选扁平组；相同捕获/校验/呈现用于模型输入、只读预览与正式附录，原输入编辑使旧更新失效。证据快照保持原精确6键投影，额外occurrences不进入封闭结构。未改模型返回协议、commits事务格式、Prompt或类型切换范围。

3MiB边界按当前UI实际发送的编辑快照（UTF8 JSON，含Source正文和全部字段组）检查：合并/组内容编辑若使后续保存超限，返回413 DRAFT_PATCH_TOO_LARGE，revision、审批、Raw及原草稿字节不变。没有额外小上限；单项AI4000字/256fact等原限制保持。正文、字段目录的重复序列化是现有快照保全成本，不以压缩或截断绕过容量。

改动产品仅7文件：drafts/template-fields/render/knowledge-workflows、record-validators、app/api、DraftReviewPage。commits与KnowledgeWorkflowPage直接使用原通路和共享呈现，无需改动；API结构解析、human-review公共函数也未改。

## 实际验证

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --test tests/r13-merge.test.ts tests/r13-merge-ui.test.tsx tests/r1618-field-editing.test.ts tests/b09-template-update.test.ts tests/kb02-human-review.test.ts tests/ui-b04.test.tsx
npm run build
node --import tsx --test --test-name-pattern='same type distinct fields' tests/r13-merge.test.ts
node --import tsx tests/acceptance/R13-MERGE-20261029-run.mjs smoke
node --import tsx tests/acceptance/R13-MERGE-20261029-run.mjs prepare
git diff --check
```

最终组合 **52/52 PASS，exit0，3.199秒**：R13服务7、真实React+实际HTTP1、既有字段编辑7、模板update6、HUMAN whole-unit/审批/恢复19、既有UI12。随后整理M01覆盖补一项同型不同栏目与组内明确删除AI，**1/1 PASS，exit0，0.322秒**；这是另一次运行，不冒称一次53项。测试后仅新增此测试，没有改产品/入口或重建dist，故52项同版与build仍适用。

build升级执行 **exit0**，tsc通过、214modules、Vite1.25秒（命令7.510秒），生成 `index-D7IIAE2W.js`；仅既有大bundle提示。diff --check exit0，仅LF→CRLF提示。实测Node v25.2.1，不联签最低版本/跨平台。

| 项 | 具体覆盖与证据 |
|---|---|
| M01 | Concept+Concept、Process+Process两项各带2个4000字AI项、混合humanEdited、原人工说明/人工引文；不同栏目补项保留scenarios和definition，明确删组内AI不删原说明/其他栏目。Raw字节与units/basisDigest不变，全部页审批清零。 |
| M02 | 两个首目标方向的Concept/Process跨型；再以第三页为首目标合并，旧组扁平保持；重复文本、同shared证据ID但不同原位置按正确目录呈现。 |
| M03 | 组人工/AI编辑保存、新DraftStore回读、全部页失审；原身份/目录注入、空整个组数组、未知引用拒绝且字节不变；未审与未解决不能提交；损坏盘记录拒读并留原字节；450000字人工说明的合法输入合并后完整快照超3MiB原子拒绝。 |
| M04 | 显审后Source+合并Wiki正式创建含原组；新group快照进入fake update输入、预览与正式附录；原正文保留；完成confirm重放日志不重复，原输入组文本编辑后旧workflow被INPUT_REVIEW_CHANGED拒绝；兼容额外occurrences的原证据。 |
| M05 | 真实React+正式B04 HTTP路由实际先同型再跨型合并、编辑组说明、保存、卸载重挂载、重新审批与明确确认，最后Source+Wiki各1；既有无字段merge、whole-unit移动/未解决、碰撞ID、普通字段/类型切换拒绝、旧update6与UI12均回归通过。 |

自查中间失败均如实处理：最初重建前用临时merge别名校验导致假拒绝、全局重绑会误放旧move换引文，已限定merge重绑并调整校验顺序，旧拒绝回归通过；容量初fixture未选中故Source不含组、Source初断言误用了update已存在Source复用分支，均改为任务真实目标fixture/执行顺序后通过；UI测试等待按钮保存中文字的定位错误已修正。组合回归曾因新字段控件只靠fieldset禁用而旧断言看disabled属性失败，以及旧说明文字断言失败；现控件显式禁用、说明断言按新语义更新后52项通过。没有放宽审批或字段校验来通过测试。

## M06 主线程可执行入口

新入口仅创建本轮TEMP离线fixture，未复用旧预算/真实冻结入口。prepare从 `tests/support/r13-merge-fixture.ts` 构造明确offline-fixture/no-provider候选：Raw原文自带“离线虚构”，3页Concept1/Concept2/Process3，各1原fact/unit/evidence，Concept前两页文本相同但坐标不同；人工说明/AI项及第二页humanEdited标志都明示为工程夹具，不声称真实模型生成。首次preload使用Windows绝对路径触发ESM scheme错误，子进程已退出/隔离服务已停；改为import.meta.url后smoke通过。最终唯一成功smoke **exit0、5个HTTP200、Provider禁用、正式Wiki0**，smoke根 `...\r13-merge-20261029-fxKnfi`，随后正常停止；不代替CUA。

最终准备root **`C:\Users\80593\AppData\Local\Temp\r13-merge-20261029-2UhW57`**，尚未启动。freeze **`b66943d1168155bc2dbc1713f2f07a7efb0eacc8d2833a4df3976aa34a1c0974`**；rawId `d7baedd6-2bf3-49aa-9f57-fe28d1364123`，body SHA `26a030f6db406584436fbbe661780e26ff701585cec24dac274df6ef37670564`；draft `57d5f56c-f856-49f1-8c78-dd062476c335`；units SHA `b2f92f3c49eb4ad4bac05d196f1fe8e63ca3e62c9647db82f027170d20108f2c`。

| 初始页 | pageId | 原字段/预期 |
|---|---|---|
| 补货概念1 | dd901b2f-beb0-4d78-afb3-6e301a590538 | concept / definition；fact-1；原页1人工说明。 |
| 补货概念2 | c9d3b701-fd4f-4ee6-9727-2ad6960bbf7b | concept / definition；fact-2；humanEdited=true；原页2人工说明。 |
| 补货流程3 | 01782a12-0b3a-4011-b749-9b0a1c6c1724 | business_process / steps；fact-3；尚未发货；原页3人工说明。 |

共享用户TEMP的启动/辅助取证命令：

```powershell
$r13Root='C:\Users\80593\AppData\Local\Temp\r13-merge-20261029-2UhW57'
node --import tsx tests/acceptance/R13-MERGE-20261029-run.mjs serve $r13Root 5182 63995
# 另一shell辅助导出，不能替代真实点击：
node --import tsx tests/acceptance/R13-MERGE-20261029-run.mjs snapshot $r13Root
curl.exe --noproxy '*' 'http://127.0.0.1:5182/r13/export' -o "$r13Root\main-export.json"
```

完整server/index.ts与built App正式全部路由，清除3个LLM环境字段，指定隔离empty.env；预加载另将Provider.complete明确拒绝，启动/点击不向真实Provider发送。没有停止/重启用户服务。

主线程从首页/Raw“继续审核”打开3页，先逐页确认让旧审批存在，再选Concept1/2合并（首选1），检查已审归零及原页2组独立保留；当前列表顺序可能变为流程3在前，**再次先勾包含原页2字段组的已合并Concept，再勾流程3**，保留首目标Concept类型。跨型后仅1页、2个原页组（原Concept2 definition、原Process3 steps），3个原unit都归到原Concept1，全部审批0；不截断AI项、流程不变“尚未发货”。

编辑原页2组中的一条人工说明（建议“R13实际UI合并组人工说明”），保存并刷新重开，核文字/原组/AI人工修改标签保持且未审不能正式写入；勾写入、保存再明确审合并页，最后显式确认，应有Source+Concept正式2页、2条create日志，无多余Prompt或请求。两正式正文含原页2/3字段组及人工说明/原引用，Raw全文/bodySHA与units目录SHA保持。Source/Wiki版本1、知识状态/等级沿fixture，草稿主题显审不等于Wiki真实性verified。单独反方向的Process首目标由服务测试覆盖，不冒称实际浏览器也操作过。

## 冻结文件SHA256

| 文件 | SHA256 |
|---|---|
| app/api.ts | `10144ae0612441bb7a31d3920b7211441c611126372bae8601be1553bd835d0d` |
| app/pages/DraftReviewPage.tsx | `6e099fffa9bc608268d0a030f2c37e280248ee844e93be249d43bf95613cb8fe` |
| services/storage/record-validators.ts | `9b3bec7fe65a07d14eb3d80b3b50e7feadc1ac7815eb180dda937910842ae813` |
| services/wiki/drafts.ts | `1b6b3bfbc11288b01ff5eae3509435676613e95ac5e5b2461da8ce5389e1cedf` |
| services/wiki/knowledge-workflows.ts | `85683892998c22eecb2cd8cd9d6ebef348513594aa5daf8b71ee896ba698c8e7` |
| services/wiki/render.ts | `8e65aa7f9ebff86ca96ea383bb7a36e6e5b2cb641fcbdf7471bbb466428d8b7f` |
| services/wiki/template-fields.ts | `bc7cbccb47903f97bea17d13c94f6bc9ef383d9c8d1641e1befbacb8af0245ce` |
| tests/r1618-field-editing.test.ts | `da899b83671de2e792d2d1fba612252f7b8315c827199b09c807540f039a3a34` |
| tests/ui-b04.test.tsx | `b264d9e1274c2334a4f2fafc4f2ee172fb06571d99874008b84a7a9ddeceae24` |
| tests/r13-merge.test.ts | `23fd852fec6ecc58b6e3e8550ead8809baa9eb5a35c7ca808d7acdd5e549c65f` |
| tests/r13-merge-ui.test.tsx | `12c76f62a9d365cd8a9e2173d9dcbb535dbc854385f4c6916fef223727b7de56` |
| tests/support/r13-merge-fixture.ts | `a06e8130e8a041a0262d0f47b9d5b907b7bd0c4532a42b30174d348032f82d9b` |
| tests/acceptance/R13-MERGE-20261029-run.mjs | `53dc6956b55f9acfce71ef4438f7ee079f78113e92ef626d0eb14e0fbd7b6bd4` |

最终全部停写，交Astra独立M01–M05，主线程M06实际CUA，再由独立验收分别裁R13与B09整批。无新增真实预算请求；尚未完成UI不先改矩阵PASS。
