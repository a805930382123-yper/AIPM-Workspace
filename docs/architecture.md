# 工程方案

## RAWEDIT02 人工正文修订边界（2026-11-14，独立验收通过）

用户明确授权从 Raw 详情人工编辑正文，取代下文历史“Raw 不可变”对人工操作的限制；AI 仍不得改写 Raw。见 [RAWEDIT02 任务卡](handoffs/RAWEDIT02-20261114-task.md)及[独立验收](reports/RAWEDIT02-20261114-review.md)。稳定 Raw ID 和来源身份保持，PATCH正文校验预期SHA及bodyRevision（旧记录0），先将修改前完整Markdown原字节写入 knowledge/raw/history/<id>/<revision>.md，再原子替换正文；原件字节不修改。编辑与启动/确认复用Wiki锁，进行中处理及未完成确认阻止编辑。旧普通派生依据按正文SHA失效，已有正式Wiki不自动改写。PDF人工改的是提取文字，bodyRevision非零时旧页链与按页草稿不再用于当前正文，原PDF仍可打开；不能把改后文字冒充原PDF页内容。带Meeting来源身份的Raw仍保持桥接原件一致性，不开放直接正文修订；普通meeting分类不受此限制。

## 2026-10-23 HUMAN增量设计（已实现，人工门禁验收通过）

当前实现与验证边界见[独立收尾报告](reports/KB02-HUMAN-CLOSE-20261023-acceptance.md)：HUMAN工程门禁通过，KB02整体仍因K2-04真实质量证据未齐而未结批；不将下列设计的实现等同于模型质量修复。

以[HUMAN任务卡](handoffs/KB02-HUMAN-20261023-task.md)为本轮冻结接口边界：revision13新提取链在机械合法规划后直接组装未审候选，不再外发B1审核；新计划调用下界chunks+1，旧revision12历史下界chunks+2保留。新规则指纹拒绝旧未完成恢复；已完成草稿不重提取。

Draft/KnowledgeWorkflow新增版本化审查元数据：服务端不可变来源unit目录、唯一页归属或未解决、绑定完整可写内容摘要的逐页明确确认。现有原子文件/锁/revision继续使用，不增通用审批框架。开始审查显式持久化旧记录目录，GET不隐式改盘；legacy目录保留实际旧条目及证据，不虚构模型ID/来源。新KB02目录从实际planningInput携带，update继承输入页来源及预览提议，synthesis从已有sections/evidence建立带真实类别的审查条目。原文事实与人工修改区分。

CommitStore及KnowledgeWorkflowStore正式确认服务层统一拒绝未全审/有未解决/内容摘要失效，update再次检查输入draft及目标版本。Source写入也受门禁；新事务快照包含审查绑定。旧已完成幂等兼容；旧零写prepared不是豁免，不能恢复时偷偷写入；旧真实部分写且磁盘匹配冻结清单才可恢复原事务，冲突保持停止。全部具体迁移/并发/入口测试见卡。以下架构段落保留既有实现与历史；本增量实现及验收范围以上方收尾报告为准。

## 范围与部署

桌面优先、单用户、本机运行的 Web 工作台。先通过 localhost 使用；本轮不创建云资源。长期知识资产由用户本机文件承载。产品包含首页、知识库、Raw、会议档案、Prompt 工作台、设置六项导航。
LIFEOS L6周期回顾由首页入口主动打开，使用只读`GET /api/home/review?start=YYYY-MM-DD&end=YYYY-MM-DD`，上海时区开始日包含、结束日不含。Wiki按created统计期间新增且当前仍保留的记录，缺失/无效时间单列；反馈按用户usedOn归属，保留Prompt使用版本；待办直接复用homeActions当前快照，不按周期筛选。严格枚举当前正式文件，排除回收与已删反馈，各来源错误独立显示，不以读取失败冒充无记录。回顾不持久化、不调用模型、不定时执行；反馈展开明细为本次读取快照，Wiki和待办导航沿已有身份/版本检查。口径及证据见[L6任务卡](handoffs/LIFEOS-L6-20261031-task.md)与[独立验收](reports/LIFEOS-L6-20261031-review.md)。

Meeting Hub M01提供会议元数据/目录/策略与备份，M02提供页面/目录/筛选/HTTPS来源与策略确认，M03提供授权纪要归档/原件/副本/历史/安全阅读/删除，M04提供Public/Internal独立授权的本机Raw登记/来源限制/两阶段恢复，M05完成跨页缓存/真实ID定位/迟到及后台选择隔离、完整本地闭环和MH48交付映射。M01–M05本机阶段PASS；接口见[M01](meeting-hub/M01-interface.md)、[M02](meeting-hub/M02-interface.md)、[M03](meeting-hub/M03-interface.md)、[M04](meeting-hub/M04-interface.md)、[M05](meeting-hub/M05-interface.md)。原全项目FAIL与真实AI阻塞以status为准。

采用 TypeScript 单仓库：React + Vite 提供 UI，Node 本地服务提供文件与 LLM 操作。单一 npm 启动命令兼容 Windows。使用持久化文件作为事实源；初期不引入数据库，未来 SQLite 仅作为可重建索引。依赖版本由 lockfile 固定。

## 目录与职责

```text
app/                      React 页面与 UI
server/                   本地 HTTP、校验、错误响应
services/
  raw/                    初始化、导入、读取不可变 Raw
  wiki/                   模板、草稿、人工确认、Markdown Writer
  search/                 中文搜索与候选重复检索
  audit/                  anchor、提议、决议
  prompt/                 Library、变量、版本、导出
  meeting/                元数据、目录、策略、纪要版本、Raw桥/来源门禁、严格读盘与revision
  llm/                    一个 Provider，六种结构化业务能力
  stats/                  从正式记录计算统计
rules/                    Schema、页面/写作/Audit/Prompt规则
scripts/                  初始化、导入、搜索、lint、audit_review入口
tests/                    模块契约、失败注入、端到端验收
docs/batches/             当前与后续批次任务卡
docs/reports/             施工与独立验收证据
workspace/                用户数据；可通过 FMCG_DATA_DIR 指定
  knowledge/
    raw/{articles,reports,meetings,company,customer,notes,other,assets}/
    wiki/                 六种页面类型、index.md
    recycle/wiki/         手动删除的Wiki文件；不进入查询/计数
    audit/                每条 Audit 与处理记录
    logs/                 仅知识相关操作日志
  prompts/                与 Wiki 分离的 Prompt 及版本
  drafts/                 AI 预览，绝非正式 Wiki/Library
  state/                  处理状态、可重建缓存
    wiki-operations/      B02写入操作记录；Index/Log未完成时供重启恢复
  meetings/
    catalog.json          稳定UUID类型与标签目录
    records/<uuid>.json   元数据、策略、revision、纪要原件/副本/版本、幂等账本与Raw收据
```

只创建本批真正需要的模块，其余目录是演进约定。

Meeting由`server/meeting-api.ts`装配，策略逻辑在`services/meeting`。创建输入只存SHA-256用于幂等，避免升Restricted后残留清除字段。imports原件/副本/版本及Raw收据严格读盘校验；目录损坏或缺失且已有记录不会自动重建。M04通过窄接口raw-bridge调用RawStore登记选定原件，不调用Provider；统一source-policy在旧Wiki/Audit/Prompt等实际服务入口阻止新Meeting Raw处理。备份白名单knowledge/prompts/drafts/state/meetings覆盖全部版本、Raw与收据，兼容无meetings的旧v1归档。

M02界面集中在 `app/pages/MeetingPage.tsx`，样式在 `app/meeting.css`，由App装配；`app/api.ts`增加契约类型。事实源为Meeting API；URL保存筛选/选择状态，不缓存会议正文或自动读取外链。元数据、策略、目录分别提交，以服务端revision防覆盖，以请求ID防重复新建，以读取/窗口世代和卸载标记隔离迟到响应。危险按钮样式限定在会议区域，避免覆盖旧页。

M03纪要区在`app/MeetingMinutes.tsx`。原件不改写、当前工作副本可编辑、再导入追加且冻结旧工作副本。单会议JSON串行原子提交，无正文幂等账本保存删除墓碑，防重试复活。原件2MiB/500000字符、工作副本500000字符、实际JSON32MiB；超限保留旧文件。schema1旧空imports/无账本可读，列表摘要不暴露账本，普通详情的无正文账本响应见交接。纪要路由先于全局JSON解析，导入/编辑解析前查权限、提交再查策略/revision，multipart仅有界内存；有副本切cloud/撤权/升Restricted均阻塞，清空和带正文档案删除需明确确认。Markdown使用react-markdown10.1.0的skipHtml、安全HTTPS链接和无img渲染，原文为纯文本。普通Raw导入不接受新origin或固定ID，不能绕过会议登记门禁；会议AI仍关闭。备份base64采用有界线性检查及规范编码/长度/SHA复核，保留原路径与目标保护。

M04 Raw区在`app/MeetingRawLinks.tsx`，同会同步revision/import，最新ID ref与独立raw:UUID父key隔离切会/后退迟到响应。Raw来源保留meeting/import/原件SHA/登记等级及meeting_local_only六字段；普通无origin的旧meeting分类不被批量加限。跨文件采用pending收据→固定ID Raw→linked，失败保留真实状态；恢复重查当前策略、原件及已有Raw完整来源/正文，linked重试也核查真实Raw，不复活已删记录。v2指纹不含可变revision；无版本旧收据按持久业务身份兼容，不枚举不可逆旧修订号。重导入/清空重算当前Raw投影并保留历史；档案删除另需保留Raw确认，删除/解除不解除来源限制。匹配SHA恢复仍检查来源，缺失来源fail closed，目标现有受限来源不能通过空字段清洗。具体契约与本机文件兼容限制见M04交接。

## 四层和核心接口

M05由Meeting Raw登记成功回调刷新App共享Raw/统计/状态，进入Raw/首页也读服务端；真实关联传固定Raw ID。App使用刷新世代、选择世代、当前选择ref和持续显式目标意图，分别处理旧快照、请求等待时用户改选、任务轮询旧render及缺失目标重连。只有普通导航/主动改选/正常删除明确改变目标，失效指定来源不替换成另一条原文；RawPage展示缺失状态。服务端文件/来源规则未变，部分成功不伪造零副作用；最终契约见M05交接。

规则层约束生成与检查；工具层确定性操作文件；LLM 层输出通过 schema 校验的结构化建议；UI 层负责预览和确认。所有持久化操作经服务端完成。

KB02 R2（2026-10-16，施工中）将新执行链升级为 kb02-2：服务端生成原文 atom 目录，模型只选 ID/分类，事实与摘要确定性派生；来源声明保留检查点元数据。覆盖失败返回有界 ID 诊断，planningRetry:true 明确触发仅重新规划且沿用同 job/累计账本。更新仅选择已验证 evidenceId，服务端派生原工作流证据结构；旧合法 Draft/Workflow 保持兼容，旧规则未完成检查点明确不兼容并保留。具体以 [本轮接口](handoffs/KB02-R2-interface.md) 与最新 status 为准；受控自测不能替代新规则真实质量，KB02 40/40 已用尽。下段为 R1 历史实现及验收记录。

KB02当前新Raw执行链已改为locator目录→精简事实/原文明示问题→整篇主题规划→确定性DraftRecord组装，半成品只进state/extraction-checkpoints。正式确认仍走原审核事务，Raw不改写。kb02-1按Raw实际SHA、规则、chunk参数与非敏感端点/model绑定，显式继续或restart:true，不自动外发。KB02 R1已修复有效恢复ID、严格有界checkpoint/409预检、旧fixture迁移，将提示修订纳入缓存身份。工程验收PASS，实际IAB同job复用14段通过；真实Spec仍FAIL：补充口径被擅补、更新旧quote/offset契约失败、长文规划漏事实，严格拒绝且不组装部分草稿。见[KB02 R1验收](reports/KB02-R1-20261015-acceptance.md)。

历史KB01 R4提取使用provider-only locator-v2输入：每个chunk由服务端建立完整、连续、UTF-16安全的Raw切片目录，单条≤512字符、最多256项；模型选择当前chunk定位ID，服务端派生原始引文/位置，严格验证后仍按原草稿格式存储。未知、跨块、格式混用和页内引用错误失败关闭；解析前和Raw映射后都扫已知凭证。聚合保留全部来源/事实，相同重叠证据去重、后缀占用确定性避让；文档汇总只返回document。旧quote输出兼容，不按首匹配猜位置、不丢失败chunk、不加重试或提高预算。

既有单Provider仅在knowledge purpose、精确官方host及glm-5.3-flash范围内请求low reasoning与JSON object模式，客户端领域schema/证据/语义验收继续独立；JSON模式不保证模型满足业务字段。KB01 R4当时真实长文未通过，详见[历史验收](reports/KB01-R4-20261014-acceptance.md)；KB02首轮长文技术全量完成为历史证据；R1提取14段完整，但两次规划漏事实、无草稿，真实质量仍未过，以最新status为准。审核中可变字段与选择在操作期间锁定，显式侧栏导航清草稿/工作流覆盖，继续保留Raw选择及后台任务世代。

| 模块 | 对外接口 | 不变量 |
|---|---|---|
| RawStore | create/list/get/delete | AI 只读；UUID 路径；正文完整保存 |
| WikiStore | list/get/search/saveManual/confirmDraft/export | AI 不能调用正式写入；保存时校验六种类型与来源 |
| LLMService | wikiExtract/wikiUpdate/auditResolve/promptBrief/promptGenerate/promptOptimize | 只返回结构化建议；不接触正式文件写入 |
| DraftStore | create/get/edit/confirm/discard | 记录来源、目标版本、用户选择；确认幂等 |
| AuditService | open/propose/resolve/defer | anchor 包含前文/原文/后文；保留所有决议 |
| PromptStore | create/update/list/delete/renderVariables/export | 每次修改形成版本；生成预览不自动收藏 |
| WikiLint | inspect | 只报告问题，绝不自动修复 |

## 文件、状态和一致性

Raw 采用 `<UUID>.md`，YAML frontmatter 包含不可变来源元数据，正文为原始字符串；sha256 校验正文。初始状态 `unprocessed`；后续可变处理状态放 `state/`，不重写 Raw。八种来源类型映射到 Raw 目录；来源名、作者、日期和链接均保留。用户删除与重新导入是显式操作。

Wiki 同样用稳定 ID 文件名，标题/别名支持中文；Wikilink 由标题/别名解析，歧义提示用户。Wiki frontmatter 采用原需求字段，增加 aliases、revision；`sources` 指向 Raw ID，相关 Wiki 单独记录。Synthesis 必须能选取多个来源、列出一致/冲突/待确认，不能由单来源伪装综合结论。

草稿包含 `rawIds`、`targetWikiId`、`baseRevision`、建议分段和 provenance。确认时检查目标版本，旧预览返回冲突并重新审阅；按钮双击/重试不得重复创建。新增来源不得抹掉旧来源或冲突描述。

单文件先写临时文件再改名；正式写入串行化。跨 Wiki/Source/Index/Log 的变更在 B04 引入提交清单与恢复流程，写入全部成功后才报告完成；失败保留可恢复证据，不留半成功的 UI 状态。B01 每个 Raw 为一个完整提交单位。

B02手动Wiki采用单页提交加待恢复操作记录。Wiki已提交而派生Index/Log失败时，响应明确返回已提交的ID/版本及恢复提示；UI展示错误信息，提示先刷新列表、不要重复创建，重启后恢复。恢复依据记录重建Index并补齐具有operationId的操作日志。正式知识文件在wiki目录，回收文件在recycle/wiki，不计入首页/分类统计；B04再扩展多页草稿确认事务。

Audit 状态 `open/resolved`，决议 `accepted/partial/rejected/deferred`：accepted/partial 经确认提交修订再 resolved；rejected 保留原因后 resolved；deferred 保持 open。Anchor 无法可靠定位时阻止自动应用，要求重新定位。

Prompt 使用独立 JSON 记录与版本历史，Markdown 导出；`manual/ai_generated/optimized` 为对象来源，版本来源用 `manual/ai_optimized` 等明确值。变量填充只影响本次复制结果，不隐式修改模板。
LIFEOS L5使用反馈保存在同一`prompts/<id>.json`的可选顶层`feedback`（schemaVersion 1），与current/versions分离；每条记录绑定不可变Prompt ID/使用版本，独立revision处理编辑冲突，首次输入摘要处理创建重试，deletedIds只保留已删UUID防止旧请求复活。反馈CRUD复用现有队列与原子单文件写，不改Prompt正文、更新时间或版本快照，不调用模型。旧无feedback文件读取为空且不迁移；附属反馈损坏仅反馈入口报错，核心Prompt仍可读/计数，普通保存保留原反馈字段。

删除Prompt仍将完整文件移入prompts/recycle，反馈与历史随文件保留；现有v1备份白名单及递归恢复覆盖该文件，无新增备份格式。独立反馈JSON导出包含全部使用版本的有效记录，不含内部摘要/删除ID；原Prompt Markdown导出不混入反馈，反馈JSON不作为恢复归档。接口、约束及验收范围见[L5任务卡](handoffs/LIFEOS-L5-20261031-task.md)与[独立验收](reports/LIFEOS-L5-20261031-review.md)。

## LLM、导入与搜索

产品采用单一OpenAI-compatible非流式Provider，开发协作模型与产品配置分开。CFG01由服务端config-manager集中校验、读写、HMAC revision与串行原子提交；设置页显式保存/清除/连接测试，旧Key只以固定掩码返回。Host/Origin/JSON/writeToken门禁限本机可信页面，配置不进业务数据或备份。环境三字段按字段优先本机文件，任一非空环境覆盖锁定编辑。默认项目根.env.local，服务端FMCG_LLM_CONFIG_FILE可用于隔离测试。三LLM值采用版本化UTF8 base64url无损编码、旧单双引号格式保留内部反斜杠；编码不是加密，0600不声称Windows完整ACL保护。

server/index.ts为每个AI请求加载有效Provider并用AsyncLocalStorage绑定该请求，后台提取持有启动快照；不会全局交换Provider串线。配置读取/保存不调用Provider，测试仅发送固定非业务探针，15秒及响应体预算限制，无业务资产写入。地址/模型检查新、环境和可读本机已知Key及百分号编码，异常配置不成为公开摘要或发起请求。六链解析后秘密门禁与Raw/Meeting来源约束继续生效。详见[CFG01接口卡](batches/CFG01.md)与[验收](reports/CFG01-20261014-acceptance.md)。

设置请求超时、可见错误、输入长度预算和结构校验；长文分块保留原文证据位置，再汇总候选页面。无 Key、超时、429、无效 JSON、schema 不匹配不能写入正式知识或空 Prompt。测试 fake 明确标示，只用于测试。

Markdown/TXT和DOCX/PDF支持原文字提取。PDF01第一轮允许文件导入保存无文字层PDF：原件字节保留，Raw正文为空，不注入OCR或AI文本；通用parseFile仍沿用旧严格门禁。PDF.js与直接运行时canvas生成本机页图，页文字范围映射Raw原文，`state/raw-pdf/<rawId>`独立保存PNG和页级AI理解。显式启动才向现Provider发送逐页PNG及原文字层；取消/失败/重启须显式继续，结果不能写回Raw或自动进入Wiki。图像结果与原件SHA/页码绑定，原件inline路由支持页锚浏览。真实模型质量未测，内容清理/知识融合不在第一轮。所有解析失败保留原文件/错误，并允许粘贴文本补救。中文搜索先使用 Unicode 归一化与子串/分词组合，不强依赖 qmd；重复检测覆盖标题、别名、分类、标签和正文相似性，显示理由，由用户决定。

## 本地运行约束

PDF01 R2通过`/api/raw/:id/pdf/cleanup`及cancel/draft子路由处理已完成的明确页范围。每批最多4页/48单元/32KiB，主题索引每次16新标题，正文在本机按主题组织，不进入旧256事实聚合。清理状态保留单元处置和理由；DraftRecord的pdfInput/pdfEvidence把文字真实offset与无offset的图像衍生分开。正式确认沿既有Raw成果摘要及事务，pdfDerivations保底层来源；明确分列的续表使用现原生表阅读，结构不明保行待核。原文不改，真实模型清理质量未测；现50主题与候选10万字符容量超限提示缩小范围，不静默截断。

默认绑定 127.0.0.1；请求大小有清晰上限，错误提示与 UI 一致；不信任用户标题作为路径，Raw/Markdown 阅读时防止执行脚本。端口冲突报错，避免连到未知服务。演示数据显式导入并标记 `isDemo`；不在本轮塞入假数据充统计。备份/导出和恢复在 B09 实测。

