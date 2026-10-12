# B07 外部施工提示词：Claude Code / DeepSeek V4.1 Flash

把下列正文交给已经打开本项目的Claude Code会话。施工模型由用户在harness中配置；提示词本身不切换模型。

---

你是本项目B07施工Agent，用户指定在Claude Code中使用DeepSeek V4.1 Flash。你负责完成本批产品代码和自测，完成后由当前Codex主Agent独立验收。只做B07，结束时停止产品写入并交接，不自签独立PASS、不推进B08、不自行切模型或安排其他施工Agent。

## 1. 先读与完成顺序

工作区：`E:\AI\Work\AIPM Workspace`。先读根`AGENTS.md`，再读`docs/status.md`、`docs/batches/B07.md`和本文件；随后读`docs/architecture.md`、`docs/coordination.md`与`docs/acceptance.md`的B07/E07、A37–A43/A59、R33/R34/R39/R40及变量负面场景。完整需求只按需读`docs/product-spec.md`§33–35、46–47；不要每轮加载全文。

用户本次授权B07外部施工；本批覆盖默认Luna施工配置。B01–B03已PASS，B04–B06确定性实现通过、真实Provider验收仍BLOCKED。B07为完全手动能力，无LLM配置也须交付，不能因上游缺Key停止本批，也不能把上游补签PASS。施工模型与产品Provider分开。

按顺序完成：①核对已有代码/接口与数据保护基线；②PromptStore、校验、HTTP、变量和版本；③Library UI/关联Wiki/导出/首页；④隔离测试及必要回归；⑤施工报告、实物指纹、停止写入交接。遇到规范与实物冲突，记录具体冲突与最小建议交回主Agent裁决；普通实现细节自行完成，不停在方案或空壳。

## 2. 本批产品范围

启用五项导航中的“Prompt工作台”，交付真实可用的Library：新建、编辑、删除、中文搜索、分类、标签、收藏、场景、正文、输入/输出要求、相关Wiki、示例、变量填写、最终结果复制、版本历史、Markdown导出。沿用现有中文桌面UI、错误/空态/加载样式。

六个默认分类固定ID/显示名：`industry_learning`行业学习、`business_analysis`业务分析、`customer`客户、`product`产品、`ai`AI、`office`日常办公。分类帮助可引用PRD例举场景；不自动注入种子Prompt或伪造数量。

B08的Brief、AI生成、Wiki背景注入、Optimizer、AI保存与新版本流程本批不实现。若展示Generator/Optimizer入口，标明“B08后续开放”并禁用；Library实际可用。保留B08需要的来源枚举和保存接口约定，不能假装已有AI结果。Raw/Wiki/Audit/Lint继续正常使用，Prompt操作只读关联Wiki。

## 3. 冻结数据与存储契约

新增`services/prompt/`，正式数据位于`<FMCG_DATA_DIR>/prompts/`。使用UUID文件名的JSON，Prompt正文完整保留前后空白、换行、中文和特殊字符。持久化经服务端完成；知识资产与Prompt分开，产品运行不依赖Claude Code、Codex、Agent CLI或Obsidian。

对外`Prompt`字段固定：

```ts
type Prompt = {
  id: string; name: string; category: string; scenario: string;
  body: string; variables: string[];
  inputRequirements: string; outputRequirements: string;
  relatedWikiIds: string[]; examples: string; tags: string[]; favorite: boolean;
  createdAt: string; updatedAt: string; version: number;
  source: 'manual' | 'ai_generated' | 'optimized';
};
type PromptVersion = {
  version: number; savedAt: string;
  changeSource: 'manual' | 'ai_optimized';
  snapshot: Prompt;
};
```

创建version=1；`variables`由服务端按正文首次出现顺序提取并去重，客户端不指定它。B07创建`source=manual`、版本`changeSource=manual`，二者含义分开。id、时间、版本和来源等系统字段由服务端维护，拒绝客户端伪造。所有用户元数据都有真实编辑/回读界面。

每个活跃文件建议为`prompts/<id>.json`，同一原子文件包含`current`与`versions`。每次有效保存（包括收藏、标签等元数据）追加完整快照并递增version；未变化保存不递增版本、不改时间。旧快照不可回写修改，拿当前对象改字段不能改变历史。同一文件先临时写再rename，写入串行化；版本和current一次提交，避免多文件出现“当前更新、历史丢失”。

更新/删除必须检查正整数`baseVersion`；旧版本409并保留人工编辑内容，不能静默覆盖或清空表单。并发同baseVersion不同更新只能一个成功。删除原子移动到`prompts/recycle/<id>.json`，从有效列表/搜索/统计/读取/版本API中移除，重启仍删除；保留回收文件但本批无需恢复UI。服务端路径只能由有效UUID组成，初始化重复运行不重置用户数据。

为避免新建按钮重试产生重复记录，UI每次明确新建编辑会话生成UUID `requestId`，失败重试复用。创建使用已校验的requestId作为稳定id；同requestId同规范化初始字段重试返回当前对象且不新增版本，不覆盖之后的人工修改；不同初始字段409。已回收ID再次创建409，不复活。再次明确新建使用新requestId，允许两条同名Prompt。初始比较依据保存在同一记录内的创建输入或v1快照。

输入采用严格类型/字段白名单，正文仅以trim检查非空，存储原字符串。至少拒绝空名称/正文、非法分类、非数组tags/relatedWikiIds、非布尔favorite、路径穿越ID、非法baseVersion及伪造系统字段。将长度上限集中定义、UI/API一致并写入交接；正文须支持至少10,000字符有效模板，超限明确失败、不截断。失败不能返回成功或空Prompt。

## 4. 公开接口

实现`server/prompt-api.ts`注册到现有Express，错误沿用`{error:{code,message,details?}}`。静态/schema路径在`:id`之前注册。

| API | 输入/结果 |
|---|---|
| `GET /api/prompts/schema` | `{categories:[{id,label}]}`；若返回长度规则需与服务端同源。 |
| `GET /api/prompts?q=&category=&tag=&favorite=true` | `{items:Prompt[], categoryCounts:Record<string,number>}`；query/分类/tag/favorite条件相交，清空恢复；categoryCounts为整个有效库各分类数量。 |
| `POST /api/prompts` | `{requestId, name,category,scenario,body,inputRequirements,outputRequirements,relatedWikiIds,examples,tags,favorite}`；创建201 `{prompt,reused:false}`，同请求复用200 `{prompt,reused:true}`。 |
| `GET /api/prompts/:id` | `{prompt, wikiLinks:[{id,title:string\|null,status:'resolved'\|'missing'}]}`；关联状态现查，不写回正文/历史。 |
| `PUT /api/prompts/:id` | 可编辑字段与`baseVersion`；200 `{prompt}`，无变化不递增；旧baseVersion409。 |
| `DELETE /api/prompts/:id` | `{baseVersion}`；200 `{id,deleted:true}`，不存在404；不改任何知识文件。 |
| `GET /api/prompts/:id/versions` | `{items:PromptVersion[]}`，序号明确；只读。 |
| `GET /api/prompts/:id/versions/:version` | `{version:PromptVersion}`，可读取完整旧快照；不存在404。 |
| `POST /api/prompts/:id/render` | `{baseVersion,values:Record<string,string>}`；成功 `{id,version,body,missingVariables:[]}`；未填422并在details中给缺少变量名，旧版本409。纯计算，不持久化。 |
| `GET /api/prompts/:id/export` | 原模板Markdown附件；UTF-8、`text/markdown`，下载名安全；独立读取必要元数据、变量、正文。 |

PromptStore提供create/update/list/get/delete/getVersions/getVersion/renderVariables/export等确定性接口。GET/搜索/渲染/导出均只读；用户明确保存才能改变正式Library。若现有结构使某接口命名必须调整，先记录映射交回主Agent，不静默改变冻结协议。

## 5. 变量、复制、关联与UI状态

- 识别正文`{{行业术语}}`、`{{客户名称}}`等非空变量；允许边界空格，`{{ 客户名称 }}`与`{{客户名称}}`为同一名称。重复变量填一次、所有原始出现位置都替换。变量名和输入为中文可用，`0`等非空字符串有效；只空白的值算未填。含换行或嵌套花括号的畸形占位不视为正常变量，策略写入规则并测试。
- 对原模板进行**一次**替换，使用字面值而非正则替换串解释。值中的`$&`、`$1`、反斜杠、换行、`{{客户名称}}`原样保留，不递归再次替换。安全读取values自有键，变量名不能造成对象原型写入。非字符串、未知键明确400。
- UI列出缺值并阻止复制未完成模板；成功后显示本次最终正文再复制。无变量正文可直接复制。复制成功提示只在实际剪贴板调用成功后显示；权限/浏览器限制导致失败要显示失败并提供可手动选取的最终文本。真实粘贴验收不能用DOM改值/测试桩冒充。
- 填写/预览/复制不自动保存、不改变模板/版本/收藏；版本页显示完整正文、修改时间、changeSource和元数据，可查看旧版，本批不必实现Diff/回滚。
- 变量填写针对当前已保存版本；编辑中先保存或取消再使用。旧版本详情只读，不调用当前版本render后冒称那是旧版本结果。切历史/返回当前版清理变量和预览，并明确显示正在查看的版本。
- 新关联选择仅允许当前存在Wiki UUID；保存时再次检查新增关联。旧关联后来删除，可保留并标“关联已失效”，仍允许编辑其他字段、解除关联、填变量、复制、搜索和导出。关联页状态失败不能使整个Library不可用。Prompt删除不碰Wiki；Wiki删除不联动删除Prompt。知识库搜索/Index/Lint不把Prompt当Wiki。
- 搜索覆盖中文名称/标签/正文，采用明确的Unicode归一化、大小写策略；至少保留原文不为搜索改正文。分类、tag、收藏筛选组合有效；保存/收藏/删除即时刷新列表与首页Prompt数量，其他知识统计与最近知识日志不受影响。
- 首页`promptCount`由实际有效current Prompt计算：历史、回收、临时文件/其他JSON不能充数。复用PromptStore有效读取逻辑；现有stats递归计JSON的方式需要修正。手动Prompt操作不追加`knowledge/logs/wiki.jsonl`。可启用首页Prompt卡跳转，并更新“后续开放”文案为Library已可用。
- 切记录/新建/查看历史/导航后，不沿用上一条的变量值、最终预览、编辑表单、版本选择、错误或复制成功状态；旧异步列表/详情/渲染/保存/删除响应不能覆盖当前选择。一次请求处理的是它启动时捕获的id/版本/数据，保存响应也不能把另一条记录切回来。适当守卫请求代次和选择身份。当前记录修改后旧预览应清理或显式标失效，重新渲染。
- 使用安全文本展示，恶意HTML/脚本、Markdown不执行。删除需明确用户动作并展示目标；加载/禁用/中文错误使操作可判断。结束时所有本批按钮真实可用，B08按钮真实禁用。

## 6. 隔离自测与交付场景

使用临时FMCG_DATA_DIR、独立端口、本地可控fixture；先核对目录和进程归属。正式`workspace/`完整文件集合与SHA应前后相同，测试不停止原4317/5173服务。Node子进程Windows使用windowsHide，不弹可见终端。保存检查前后的实物文件、公开HTTP响应及预期/实际；未运行写NOT_RUN，受环境限制写BLOCKED，真实失败写FAIL。

新增测试至少覆盖下表，各组允许合并实施但证据可逐项定位：

| ID | 最低有效证据 |
|---|---|
| E07-01 记录/校验 | 无产品Key创建所有字段并GET/实物回读；六分类/非法类型/空值/UUID/路径/超限失败不落盘；10k+含空白换行特殊字符正文保真。 |
| E07-02 列表 | 多条不同分类/标签/收藏、中文名称/标签/正文搜索，各筛选及组合结果/分类数正确、清查询恢复，不匹配为空。 |
| E07-03 版本 | 连续保存v1/v2/v3完整字段；旧快照内容、日期和来源不变；收藏/标签保存产生真实版本；同内容保存无新版本；刷新/重启仍可读。 |
| E07-04 冲突/重试 | 两个同baseVersion不同内容更新只一个成功；旧更新/删除409且资产不变；创建请求复用、不同payload冲突、后续编辑后的旧创建重试不覆盖、已回收ID不复活。 |
| E07-05 变量 | 中文/重复/空格别名/缺值/0/无变量；值含`$&`、`$1`、反斜杠、换行和`{{...}}`字面保留、不递归；前后整个Prompt文件SHA不变。 |
| E07-06 实际复制 | 浏览器填写→预览→点击复制→粘贴普通文本目标，逐字符与预期一致；模板和版本不变；未填/复制失败不会提示成功。无真实浏览器时保留NOT_RUN供Codex独立验收，不冒造剪贴板结果。 |
| E07-07 删除 | 删除后API/列表/搜索/统计/版本API/重启均不出现；有效统计不计回收/旧版本/临时JSON；其他Prompt和整个knowledge/ SHA不变。 |
| E07-08 松耦合 | 关联现有Wiki可读；显式删除隔离Wiki后原Prompt标missing且编辑/渲染/复制/搜索/导出仍可用；不存在的新关联拒绝。对知识变化只计算此显式删Wiki的预期差异。 |
| E07-09 导出 | 浏览器实际下载或HTTP附件读回文件；独立读取名称/分类/变量/来源/版本/输入输出要求/示例/关联/正文，保留原模板；含反引号/围栏的正文不被导出格式破坏。 |
| E07-10 错误/磁盘 | 隔离目录注入真实写临时/最终rename或回收rename失败，返回可读失败、不改旧current/versions、不虚增版本；解除故障可重试、同目录重启可读，临时残留不进入Library/统计。 |
| E07-11 UI切换 | 两条不同模板实际切换、查看旧版/新建/返回、延迟旧请求；当前身份、变量/预览/表单/消息不串页；保存冲突保留输入。创建/编辑/收藏/删除后首页数量正确，知识日志无Prompt事件。 |
| E07-12 无LLM/回归 | 未配置LLM时本批全手工链路可用；针对共享App/api/stats改动验证Raw/Wiki/Audit入口、已有统计/日志和B06跨页修复保持；明确本轮实测和复用历史证据。 |

执行`npm run build`及`npm test`，必要时针对失败/新增变更运行受影响检查。仓库测试会重写`docs/reports/B04-http-evidence.json`、`B04-repair3-merge-payload.json`：运行前先备份原件到B07专属施工证据目录，新输出也留B07前缀，结束后恢复原件。修改任何已有测试前先读它；保持已有断言有效，不为绿灯删测试或降低标准。所有新自测仅写B07施工前缀，不覆盖旧独立报告。

## 7. 文件所有权和结束条件

你可改：`services/prompt/**`、`server/prompt-api.ts`、必要server注册/校验、`app/pages/PromptLibraryPage.tsx`与必要组件/样式、`app/App.tsx`、`app/api.ts`、首页/stats接线、Prompt规则、`tests/prompt*.test.*`及B07施工自测脚本、必要package/lockfile、README的B07运行说明、`docs/reports/B07-build.md`和`docs/reports/B07-builder-*`施工证据。

本文件、任务卡/status、architecture/coordination/acceptance、历史交接/报告、`tests/acceptance/**`主Agent独立测试、正式workspace和密钥归主Agent/用户保护。必要范围以外改动先列理由交回裁决。修改共享文件只加入本批接线，保留既有行为；不要整页重写Raw/Wiki/Audit/LLM模块。正式数据、测试数据、密钥不提交；不安装harness插件或改用户模型配置。

交接`docs/reports/B07-build.md`必须包含：

1. 实际变更文件、实现范围、API响应样例/错误码、长度限制、存储路径/JSON格式、变量语法与未填策略、来源/版本策略及B08将如何显式保存预览为新Prompt或原Prompt新版本。
2. 实际命令/退出码/耗时、E07逐项PASS/FAIL/BLOCKED/NOT_RUN与证据路径、浏览器实际操作及未测项；自测通过不称独立验收PASS。
3. 修改的产品文件SHA256清单（与实物一致，含package/规则/共享接线），完整正式workspace前后集合/SHA、历史报告恢复记录、仅本次隔离进程关闭记录。无Git就用文件指纹，不杜撰commit。
4. 未完成项/风险/阻塞；模型实际信息仅在harness提供时记录，无法读取token/计费用量写不可得，不估造数字。

结束条件：上述产品和API可实际运行，必须自测完成或明确列实测阻塞，施工报告与真实证据已落盘，修改文件指纹一致，产品停止写入，返回摘要“B07已交接，等待Codex独立验收”。即使自测全绿，也不推进B08。
