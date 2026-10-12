# B04：DeepSeek V4.1 Flash 施工提示词

你是本项目的施工 Agent，运行在用户选择的 DeepSeek Harness，模型为 DeepSeek V4.1 Flash。工作目录是 `E:\AI\Work\AIPM Workspace`。用户授权你实现 **B04：AI 提取 → 人工审核 → 正式 Wiki**，完成后交接给 GPT-6.1 Sol High 独立验收。施工自测结果与独立验收结论分别记录。

这份提示词是主 Agent 为 B04 冻结的施工范围、接口与补充验收条件。优先级：用户最新指令 → AGENTS.md → 当前 status/任务卡及本文件 → 对应产品需求和验收条目。历史报告保留当时结论；最新 B03 状态以返修复验报告为准。

## 1. 读取与施工顺序

1. 先读 `AGENTS.md`、`docs/status.md`、`docs/batches/B04.md` 和本文件全文。B01/B02/B03 已 PASS；当前只授权 B04。
2. 读 `docs/architecture.md`、`docs/coordination.md`。本次 builder 明确由用户改为外部 DeepSeek V4.1 Flash，覆盖 coordination 中原 Luna builder 配置；主 Agent 与独立验收职责保持原约定。
3. 按章节读取 `docs/product-spec.md` §4、6、8–10、12、18–20、48、52；按 ID 读取 `docs/acceptance.md` 中 B04/E04、A06/A08–A13/A57/A60/A61、R04/R05/R09/R11–R15/R21–R23/R41。只取本批子能力，不在每轮重复加载全文。
4. 检查相关已有实现：`services/raw/store.ts`、`services/wiki/store.ts`、`services/stats/index.ts`、`server/index.ts`、`server/wiki-validation.ts`、`app/api.ts`、`app/App.tsx`、Raw/Wiki 页面和 `rules/` 三个 YAML。修改前读取文件；保留已通过的接口和行为。
5. 在 `docs/reports/B04-build.md` 记录实现文件分工、本文契约的代码映射、产品 Provider 配置来源、测试数据目录和端口。按 Provider/草稿 → 审核/提交两个实现步骤完成同一 B04；步骤完成不等于批次 PASS。
6. 完成全部必做项、受影响回归及施工交接后停止。只交付 B04，不自动进入 B05。

## 2. 边界与产品 Provider

目标闭环：导入的 Raw → 点击「AI整理知识」→ 后端 LLM 返回结构化 JSON → 本地可恢复草稿 → 用户选择/编辑/删除/合并/放弃 → 点击「确认写入 Wiki」→ Source、选中 Wiki、Index、Log 全部完成 → 读取/搜索/刷新/重启验证。

- 用户选择：**优先复用已有的产品服务端 API 配置（如有）**。先检查本项目及本 Harness 能访问的、用户明确用于本产品的服务端配置，只记录是否配置和非敏感 Provider/模型信息。当前规划环境未发现项目 `.env`、LLM 模块或常见 API 环境变量；你的 Harness 环境可能不同，应自行核对。
- 施工模型名称不作为产品模型默认值。产品运行直接调用 Provider，不依赖 DeepSeek Harness、Codex、Agent CLI、Obsidian或 Coze；不提取或复用开发工具内部凭证。
- 只实现一个后端 Provider 适配器。已有配置明确指定 Provider 时按其官方协议实现；若无既有配置，冻结为**单一 OpenAI-compatible Chat Completions 适配器**，Base URL/模型/Key 均由服务端配置，保持未配置状态，不猜供应商、模型名称或有效凭证。真正调用前核对选定供应商当前官方文档；不做多 Provider 管理器。
- 服务端配置名：`FMCG_LLM_BASE_URL`、`FMCG_LLM_MODEL`、`FMCG_LLM_API_KEY`，可由显式已存在的配置适配读取。优先环境变量；若新增 `.env` 加载，使用受忽略的本地文件并更新忽略规则，仅提交没有密钥的 `.env.example`。不要假设 Node 自动加载 `.env`。
- 设置页显示 Provider/模型、配置完整性和 `keyConfigured`，Key 仅显示统一占位掩码。B04 无需前端输入/保存 Key；README 说明本机服务端配置和重启方式。配置查询、错误、日志和报告不返回 Key 或鉴权头。
- 无配置时仍可运行导入、手动 Wiki、搜索、导出，AI 操作给出明确缺配置错误。完成产品实现与 fake 错误测试，真实成功项记 `BLOCKED` 并列出所需供应商/模型/配置步骤；不能以 fake、静态 JSON 或 Harness 回答代替真实 AI PASS。
- 本批实现 `LLMService.wikiExtract`；其余业务能力沿用架构接口约定，后续批次再实现，不增加返回假成功的占位 API。去重相似度、已有 Wiki 更新、多来源 Synthesis、Audit、Prompt、OCR 属于后续批次。

## 3. 结构化输出、证据和长文契约

新增 `rules/wiki-extract.schema.json` 及提取/写作规则，运行时加载参与实际请求和服务端验证。Provider 与人工编辑两条入口使用同一套业务约束。Provider 响应为 JSON 对象，核心形状：

```json
{
  "document": { "title": "来源标题", "main_topic": "主主题", "summary": "摘要" },
  "suggested_pages": [{
    "title": "一个明确知识问题",
    "type": "concept",
    "category": "industry_basics",
    "one_line_definition": "一句话说明",
    "source_facts": [{ "text": "原文支持的陈述", "evidenceIds": ["e1"] }],
    "ai_organized": ["对材料的整理"],
    "ai_inferences": ["明确标记的推断"],
    "related_pages": ["关联建议标题"],
    "open_questions": ["当前材料无法确认的问题"],
    "source_evidence": [{ "id": "e1", "rawId": "实际Raw ID", "quote": "对应原文片段" }]
  }]
}
```

示例 quote 仅解释字段；实际值必须匹配原文，不能拿示例当测试成功数据。

- 输出使用非空 document 字段和非空 suggested_pages；页标题/类型/分类/定义及各数组字段必填。类型/分类从既有规则加载；本批单 Raw 提取建议限 concept/entity/business_process/metric，Source 由 document 与 Raw 元数据构建；单来源不伪造 Synthesis。正式 Wiki 仍采用现有六类型集合。未知字段、错误枚举或错误类型明确拒绝，不静默删字段或改成默认值。
- `source_facts`、`ai_organized`、`ai_inferences`、`open_questions`、`source_evidence` 分别存储，人工编辑与合并后保留边界；正式 Markdown 也有对应分节。模板字段没有依据时为空/待确认，不让模型填造业务数值。
- 每个来源事实至少引用一个本页有效 evidenceId。证据 rawId 必须属于该草稿的实际 Raw；quote 非空且确实来自相应原文块，证据ID不歧义。服务端对块内唯一精确quote匹配计算全局位置，形成草稿的start/end；不要求模型凭空数字符。Provider可以提供可选start/end帮助消歧，但须按完整Raw的索引验证；多个匹配又无有效定位时明确报证据歧义，不能随便取第一处。
- 草稿规范化后的start/end是**完整 Raw.body 的 JavaScript UTF-16 字符索引，左闭右开**，须满足整数、合法范围、不切断代理对及 `Raw.body.slice(start,end) === quote`。UI可看原文上下文/回跳Raw；人工改证据同样重新验证。
- Provider 不直接决定 Wiki/Draft 文件路径和正式ID。服务端生成 UUID/pageId，附加原始 Raw bodySha256、规则版本和 provenance。前端修改不能替换这些锚定字段。精确原文定位验证不等于自动证明事实语义；预览明确留给人工核验，AI 不自动设置 verified。
- 规则要求一个条目解决一个知识问题；多主题材料分成多条，不能靠固定页面字数代替知识粒度。
- 冻结资源预算：单次 HTTP 调用超时60秒、一次提取总期限10分钟；分块并发最多2；输出正文JSON每次最多2MiB、汇总最多50个知识建议。只支持非流式响应，响应字节上限在读取中执行；Provider截断/不完整JSON明确失败，不修补成假成功。超时、数量和响应大小边界有契约测试。
- 长文：每块正文最多8,000个JS字符，重叠400，记录全局起止；切分避免拆代理对，原文最多500,000字符也不能静默截尾。文档已有更长Raw则给明确预算错误，原文完整保留。每块 evidence 转完整Raw全局索引后验证；全部块成功才形成一个完整待审核草稿。一块失败/总预算超限时整个提取失败，保留可检查状态，不把已完成前几块冒充全文结果。
- 分块响应保留块摘要/页结构/证据，汇总输入必须包括所有块的结构化结果；合并同主题建议保留全部 provenance 和分类边界。汇总仍受输入预算，超限显式错误或分层汇总，不静默丢块。报告真实调用次数/覆盖范围；100k中文长文至少在确定性测试中验证完整覆盖与原文末尾证据。真实长文调用若缺配置或未实测单列 BLOCKED/NOT_RUN，不推断通过。
- Raw 文本作为待分析数据，系统指令和业务规则独立；Raw中的“忽略规则/写文件”等内容不能授权工具或正式写入。

## 4. 草稿、状态与 API

草稿存 `drafts/<UUID>.json`；可变 Raw 处理状态存 `state/raw-processing/<rawId>.json`；提取任务状态存 `state/extraction-jobs/<UUID>.json`。Raw Markdown/body/原件不因 AI 或状态变化而重写。已有 Raw API 返回值可以叠加状态视图，兼容旧记录默认未处理。

Raw 状态固定为 `unprocessed / processing / pending_confirmation / generated / failed`。新状态、jobId、draftId、已生成Wiki IDs、错误和进度在 state/ 中持久化：

- 开始任务→processing；完整校验/草稿落盘成功→pending_confirmation；确认完整提交成功→generated；提取失败→failed。
- 显式取消正在提取或放弃待审核草稿后恢复该次任务开始前的稳定状态（首次通常为unprocessed，已有成功历史仍generated）。晚到的响应不能复活已取消任务。
- 启动时孤立processing任务转明确中断失败，可重试；pending草稿恢复可继续审阅。提交中的事务按清单恢复，不因服务重启重调模型。不能留永久处理中状态。
- 同一Raw同一时刻一个活动提取/待审核草稿；重复请求返回现有job/draft或明确409，不能并行造多份。Raw已删除、原文hash变化、活动任务/草稿和删除/确认竞争均有服务端校验；删除须在共享锁中检查正式引用及活动工作，必要时409提示先取消/放弃。避免确认后出现坏来源。
- 首页面板「待确认」统计仅计算实际pending草稿，不能按所有历史JSON文件数计数；确认/放弃后即时更新Raw列表状态、Wiki列表、首页统计，刷新/重启相同。

冻结公开接口（保留原有API）：

| 方法/路径 | 请求与响应 |
|---|---|
| GET `/api/llm/config` | 仅非敏感配置摘要与keyConfigured；缺配置不影响服务启动 |
| POST `/api/raw/:id/extract` | 启动/复用任务，202返回jobId、状态、进度；初始配置/来源校验失败返回明确错误 |
| GET `/api/extraction-jobs/:jobId` | job状态/阶段/块进度/error/draftId；最终错误可见且已落盘 |
| POST `/api/extraction-jobs/:jobId/cancel` | 显式取消；晚到结果不落草稿/正式库 |
| GET `/api/drafts/:draftId` | 完整审核数据、revision、rawIds/哈希、稳定pageIds、状态及Source预览 |
| PATCH `/api/drafts/:draftId` | baseRevision＋选择的pageIds＋修改/删除/合并后的结构化内容，整体验证；旧版本409，来源/hash/证据原文保持服务端锚定 |
| POST `/api/drafts/:draftId/discard` | baseRevision；pending草稿显式放弃，幂等；committing/confirmed不允许当作取消正式提交 |
| POST `/api/drafts/:draftId/confirm` | baseRevision＋selectedPageIds＋idempotencyKey；以持久化审核版本执行确认，不接受客户端任意正式写入对象 |
| GET `/api/wiki-commits/:operationId` | 提交状态、所有目标ID、完成/未完成阶段和恢复提示；无敏感原始请求 |

统一错误继续使用 `{error:{code,message,details?}}`，code至少区分缺配置、401/403、429、超时、网络失败、非法JSON、schema/证据失败、空结果、输出截断/预算超限、草稿版本冲突、来源失效、重名冲突、落盘失败和部分提交。不可将Provider完整响应/鉴权头直接拼进error/cause。

## 5. 人工审核与 Source

UI复用现有布局：启用设置入口；Raw详情有AI整理、实际进度、取消、失败重试与继续审核入口；预览支持来源上下文、分栏事实/整理/推断/问题及证据。

- 页面默认未选，用户可部分选择/全选、改标题/内容/分类、删建议、合并建议、放弃或确认。同一草稿内合并保留事实/推断分类、证据和来源；用户明确保留页类型/分类，删除的建议不能在提交时复活。编辑后可恢复审阅，版本冲突阻止陈旧确认。
- 来源等级、knowledge_status、confidence可人工修改，验证沿用现有规则。verified只能由用户明确标记且有有效Raw/已审阅，不能因LLM生成或点确认自动verified。
- Source预览单独展示：真实Raw标题/来源类型/来源名/作者/日期/链接＋document摘要与Key Takeaways＋涉及概念/实体/流程/指标、重要观点/待验证、Raw回跳。Source不是原文全文副本。
- 至少选择一个知识建议才允许确认。首次确认为这条Raw创建**恰好1个Source＋选中N页**；Source是明确展示的提交组成，不在模型成功或单独预览时写入。对Source的用户编辑同样持久化并版本校验。
- 若已有唯一合法Source绑定同一Raw，预览标出将引用它，确认可复用其ID而不修改原页，此次只新增N页；若Source归属不明或有多个候选则409要求人工处理，B04不自动合并/更新旧Source。Source及新知识页的sources均指实际Raw ID，正文中建立到Source/本次实际创建页的有效Wikilink；未选建议仅作待处理文本，不伪装成已存在页。
- 当前选中页或新Source标题与已有Wiki标题/别名冲突时，预览提示并在确认锁内再次检查；整个新提交返回409，允许改名或放弃，提示旧页更新属于B05。批内冲突也拒绝。禁止覆盖已有页面；不能只在UI拦截。

## 6. 多文件确认、故障与幂等

扩展现有 `WikiStore` 的校验/串行化/恢复设施，正式创建路径共享同一写锁；不要在已有withLock中调用会再次取得同一队列的public create导致死锁。保留B02单页写入恢复、B03删除/原件恢复行为。

- 第一次有效确认时，锁内检查revision/selection/来源哈希/重名，冻结**完整用户确认快照**（包括Source编辑）、UUID/稳定目标Wiki IDs、正文/元数据摘要及idempotencyKey，再将提交清单原子持久化到 `state/wiki-commits/<operationId>.json`；清单成功落盘前零正式写入。
- 同一draft只能有一个确认操作。双击、相同或不同key重试、响应丢失及重启后的重试均复用持久化操作，不新生成UUID/页面。相同key对应不同payload明确409；已有确认操作先查原操作结果，不被成功后revision变化误挡成新提交。
- 恢复依据已冻结的快照，不重新读取后来编辑的草稿来改变用户已确认内容；committing状态禁止编辑/放弃。已有正式记录与预定内容不一致时报告冲突，不覆盖。
- 依序写Source/选中Wiki、Index、去重Log，完成标记、草稿confirmed及Raw状态；全部必需阶段成功后才返回成功。Log包含稳定operationId，重启/重试不重复记同一操作。失选建议、已删除建议零落盘。
- 单文件写临时文件再rename。多文件不宣称天然原子：在中途失败时返回明确失败及operationId、已提交/待完成IDs、recoverable等详情；UI显示「部分提交/待恢复」而非成功或零写入。列表/统计如实反映已存在正式记录，用户不需盲目重新确认。
- 重启从清单继续补齐用户已确认操作；完成后同一operationId和页面IDs，原文、旧Wiki不变。故障仍存在时保持清单/可见错误、禁止假成功；手动链路尽可能可用。测试已写正式文件后、更新清单前中断，以及Index/Log/最终状态写入失败，恢复不得丢内容或复制页面。
- 对取消/放弃、模型失败、首次确认校验失败断言**零正式变化**；对用户已确认后的磁盘部分失败断言**如实记录部分变化＋恢复完成同一操作**，两类不要混为同一事务保证。

## 7. 文件所有权与测试

可改：`app/`本批页面/API/UI、`server/`路由/校验、`services/llm/`、`services/wiki/`草稿/Writer、必要Raw状态视图及stats、`rules/`、本批施工测试/fixture、README、必要package/lock和忽略规则、`docs/reports/B04-build.md`。

主 Agent 负责范围文档/status；独立验收方负责 `B04-acceptance*` 和独立测试。保留已有报告、独立测试和正式数据，不改历史PASS/FAIL，不把本批自测签成独立PASS。使用显式 `FMCG_DATA_DIR` 和闲置端口在临时/本批fixture目录测试，避开正式workspace及现有4317/5173服务；Windows后台服务隐藏运行，只关闭自建且核对PID/命令行的进程。

施工必做验证（逐场景记DOC/RUN及证据，fake和真实分表）：

| ID | 场景与完成条件 |
|---|---|
| E04-01 | 无Key启动、缺字段、设置掩码，手动导入/Wiki/搜索/导出仍正常；AI错误明确，零正式变化 |
| E04-02 | 有配置时真实Provider调用：多主题中文fixture→合法草稿→证据定位可核验、规则参与请求；记录Provider/模型/耗时/调用数/返回结构摘要。缺配置则真实项BLOCKED，不伪造 |
| E04-03 | 模型成功后、审核编辑后、取消/放弃后对比正式Source/Wiki/Index/Log文件摘要与计数，均无未经确认的变化；Raw文件及原件字节摘要不变 |
| E04-04 | 部分选择、全选、编辑、删除、合并、Source预览、人工改来源等级；首次N个选中只新增Source1＋N，其余0；复用已有Source时仅N；正式事实/整理/推断/问题分节、来源/关联正确 |
| E04-05 | 前端双击、HTTP并发确认、不同key重试、响应丢失/重启再确认：始终同一操作/页面IDs/计数，无重复Log；过期审核revision与同key不同内容拒绝 |
| E04-06 | fake明确注入401/403/429、网络/超时、非法JSON、空结果、schema/枚举错误、证据越界/quote不符/未知Raw、截断/超限；失败不留processing，不写正式知识，错误可重试 |
| E04-07 | 真实磁盘故障在Source/第二个Wiki/Index/Log/清单或最终状态写入；区分零写入与已部分提交；解除故障、同目录重启完整恢复，再重启幂等。至少一个真实进程中断窗口或等价磁盘过渡fixture，明确证据性质 |
| E04-08 | 提取任务取消、晚到结果、放弃、刷新/重启、pending恢复、processing中断恢复；同Raw重复任务、删除vs确认/提取并发；无坏来源和永久处理中，待确认统计按状态正确 |
| E04-09 | 100k中文含空白/CRLF/emoji长文确定性分块覆盖、末尾证据、汇总未丢块；一块失败/总超时明确失败；500k上限与超预算不截尾。真实长文调用单独列状态 |
| E04-10 | 正式确认后UI即时刷新、搜索/来源回跳/导出、刷新与同目录重启；旧Raw/旧Wiki字节不变；B01/B02/B03受影响回归通过，尤其导入部分提交恢复与删除锁 |
| E04-11 | 无效测试Key泄漏探针覆盖配置返回、异常UI、普通日志、草稿/Raw/Wiki/导出/报告及错误details；只报告命中数/位置，不输出测试Key或真实Key |

运行现有 `npm test`、`npm run build`，为上述行为补契约/HTTP/文件/交互测试。新fake只能通过明确的测试依赖注入或独立fake HTTP Provider进入测试，不在缺Key时静默启用，也不让正式运行切换成成功演示。施工环境有浏览器则跑真实交互并留截图；不能操作浏览器时明确NOT_RUN，API/jsdom测试不冒充真实浏览器。

## 8. 交接与结束条件

`docs/reports/B04-build.md` 必须列：

1. B04已实现/未实现功能与修改文件；契约对应的实际schema/接口/状态/清单路径、版本或文件SHA。
2. Provider/模型/配置来源及缺配置说明，不含密钥；真实调用与fake各自的场景、命令、数据目录、预期/实际、PASS/FAIL/BLOCKED/NOT_RUN和证据路径。
3. 测试/构建与受影响B01–B03回归结果；浏览器是否实操；提交故障/恢复/重复确认的页面ID、数量和摘要证据。
4. 如何在新终端启动、配置服务端、复现实测和继续待审核/待恢复操作；依赖最低环境变化。
5. 未完成项、实际风险、所需用户配置和验收方待验证项。token计量不可得则写不可得，不编造成本。

完成可以在无凭证时交接实现与明确BLOCKED，但不能宣称B04完整PASS。出现需求/接口矛盾先给出最小问题与已有依据，继续不依赖该问题的工作；需要扩大当前范围交主Agent裁决。最终回复只汇报B04交付与测试状态，提示交给独立验收，然后停止。
