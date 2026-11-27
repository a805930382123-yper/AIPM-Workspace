# 工程方案

## RUN01 本机运行与自动化底座

生产入口先检查 `dist/index.html`，再用一个监听 `127.0.0.1` 的 Express 进程提供 API 和静态 UI。未知 `/api` 路径返回 JSON 404，普通页面深链接回退到 `index.html`。开发沿用现有 Vite 代理及 watch 命令。自动化 API 使用与模型配置相同的本机 Host/Origin 白名单判定，另外用独立进程令牌保护 JSON 写入。同源访问与显式 `FMCG_UI_ORIGIN` 按既有配置语义处理。

生产和开发在任何 Store 初始化前都取得 `state/runtime/instance.lock`。以数据根的规范路径确定 Windows 本机命名管道的排他名称，并用 `wx` 写入进程记录。管道防止并发启动在读取同一把陈旧锁后误删对方的新记录。正常退出先停止调度和 HTTP listener，再释放本进程记录。强制退出由系统释放管道，后续启动确认 PID 已退出后接管。v1 备份继续包含 `state/`，根指纹让恢复到新数据根的服务识别复制来的实例记录。

代码注册的任务、上海时区计划和用量账本位于 `services/automation/`。计划、revision、暂停和下一次时刻以原子 JSON 保存在 `state/automation/schedules.json`。运行文件按计划的 UTC 月份放入 `state/automation/runs/`。调度先记录已消费的时刻，再原子推进计划游标，启动时中断遗留队列或执行记录，每任务最多补跑最近一次未记录的触发。暂停和重叠的计划触发保留 skipped 记录。清理只移除超过 90 天且在最新 2000 条之外的终态记录。损坏文件留在原处，API 返回逐条问题。

既有 Provider 请求快照继续由 AsyncLocalStorage 绑定。调度为任务建立独立运行上下文，统一 Provider 工厂在每次实际调用时按该上下文累计用量。Wiki 与 Prompt 的正式存储拒绝来自该上下文的写入。60 分钟间隔的工作台自检检查数据目录、实例锁、恢复问题、Provider 配置状态和剩余磁盘空间。自检不调用 Provider。

## PIPE01 资讯流水线

`news.daily` 默认上海时间 07:30 触发，启用补跑。进程内调用 `NewsService.ensure(true)`，与每日资讯页共享当日版次和来源配额，自动任务发起的抓取等待来源材料就绪，预筛由独立开关控制。每批最多十条，校验输出结构、凭证、分数、枚举和 ID 集合，失败批保留未预筛候选及原因。候选与确认授权按上海日期原子写在 `state/automation/news-candidates/<date>.json`。关注主题、独立预筛开关与并发数经 revision 校验，写在同目录上一级的 `pipeline-settings.json`。

候选 HTTP 接口复用自动化 Origin/JSON/token 门禁。显式授权落盘后，队列才从快照原样保存材料，并仅为该授权拥有的来源收据发起整理。资讯页与队列共享 `NewsRawSave` 串行实例，沿规范 URL 复用同一 Raw ID。在 Wiki 锁内预先写入整理启动状态和任务 ID，调用既有 ExtractionRunner。启动时回收排队项，已发起整理关联原作业并等待显式继续，已完整落盘的草稿从既有 job 对账。全局暂停时保留确认授权。整理草稿进入既有首页待审，使用原人工确认事务。

每条 `pipeline.organize` 独立记录候选、Raw、整理任务、草稿及执行步骤。来源 HTTP 计数与 Provider 请求/Token 分开。发送前先记录请求及未知用量，收到响应后更新 Token，符合原 RUN01 账本兼容规则。实时列表及首页数字投影使用持久候选、来源收据、整理作业和草稿。阶段及契约见 [PIPE01 任务卡](handoffs/PIPE01-20261114-task.md)。

## KBMAINT01 知识库定时巡检

RUN01 增加到点严格向未来推进的上海时区周计划，周一为 1，周日为 7。周计划补跑窗口为 7 天，沿用最新一次补跑、暂停及防重复执行机制。初次升级从已有 `schedules.json` 补注册 `wiki.lint` 和 `wiki.inspect`，保留已有任务配置和 revision。

`wiki.lint` 默认每天 08:00，直接复用 LINT01 的结构检查。快照和差异原子写入 `state/automation/wiki-lint/<runId>.json`，首次结果记为基线。差异对比最近一次成功且可读的快照，保留逐条位置和指纹。随账本维护保留近 90 天的快照及最新 200 份快照的并集。损坏文件保留并作为读取问题报告。运行历史以 `lintSnapshotId` 指向快照，现有备份包含该目录。

`wiki.inspect` 默认每周一 08:30。主题页逐页通过来源门禁后，按派生依据版本变化、上次主动检查后更新、更新时间和 ID 排序。所选页和相关扩展共用 8 页、48,000 JSON 字符的完整页数组上限。排除原因记在本地检查范围和运行步骤。合格主题缺失时以 0 次模型请求结束。正常检查经既有 Provider 计量，复用主动检查的严格结构、证据校验和去重。取消信号传至 Provider，检查记录以原子写入保留。只有已完成或部分完成的检查链接到成功运行的 `inspectionIds`。巡检产生结构快照或检查记录，正式页和草稿由现有人工流程操作。

自动化的两个只读入口 `/api/automation/knowledge-health` 与 `/api/automation/wiki-lint/:snapshotId` 分别用于了解最近成功巡检和查看结构快照的详细差异。主动巡检摘要读取检查记录的当前待核状态。任务卡见 [KBMAINT01](handoffs/KBMAINT01-20261120-task.md)。

## WORKAUTO01 工作事项提醒

`work.reminders` 默认每 60 分钟扫描未关闭事项，关闭失效提醒，模型调用次数为 0。上海自然日确定到期和逾期天数，同一事项到期时优先于久未推进。产品事项按可选来源与最近一轮完成分析的实际覆盖范围对比，含已明确继承的来源。首轮分析前，已关联且可以分析的 Raw 都属于待分析资料。事项、分析和来源经原有读入校验，逐条报告不可读取的依据并保留无法确认是否消解的提醒。

提醒状态、设置版本和读取问题原子保存在 `state/automation/reminders.json`，由现有备份包含。站内条件键保留已读、延后和消解状态，延后在目标上海日期重新未读，已消解 30 天后清理。桌面投递按事项与类型的自然日去重，待分析提示按合规资料集合指纹去重。先落盘记录投递尝试，再跨进程调用 Windows 通知；中断保留未确认结果，同条件窗口不自动重发。免打扰和桌面通知关闭只影响桌面投递，超过上限的提醒合并为一条汇总。

通知适配器限制输入为事项标题、固定类型和数量，WinRT XML 转义并限制单段文本长度。Windows 实现通过 Windows PowerShell 的已注册应用标识调用 `CreateToastNotifier`，以 5 秒为硬超时，系统失败保留在相应提醒。非 Windows、CI 和测试上下文使用安全返回值；测试可注入假通知器。自动化 API 写操作沿用本机 Origin、JSON 和进程令牌约束，设置修改使用 revision 校验。测试通知使用固定非业务文案。 [任务卡](handoffs/WORKAUTO01-20261120-task.md) · [WinRT 桌面通知接口](https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast)

## REVIEW01 每周工作回顾

`review.weekly` 默认上海时间周一 09:00，从计划触发时点选择上一完整 ISO 周。补跑沿用计划时点。手动指定当前周时以执行时刻为上界。快照复用 L6 期间与当前待办来源，加上事项关闭历史、资讯版次和保存收据、知识巡检、自动化用量与事项提醒。时间窗口左闭右开，来源错误按独立栏目显示。

标题投影复用 Raw 会议来源门禁和 Wiki 来源链校验。未知或受限来源只进入安全计数。周报先原子写到 `state/automation/weekly-reviews/<weekKey>.json`，再将允许的栏目、日期、状态、标题、引用键和统计量发给配置的 Provider。单次结构化调用走运行账本计量，响应中引用必须属于本次快照。失败仅记录安全错误与事实。关闭 AI、模型未配置或没有变更和待核风险时保留事实快照。设置同目录落盘，现有备份包含周报。

自动运行保护人工编辑及已审阅周报。手动重生成走相同任务和账本，需版本匹配，已有人工内容时还需明确确认。事实写回与 AI 返回后分别校验 revision，较新人工版本保留。导出依次包含事实、AI 整理和人工备注。定时任务和导出限于周报档案，正式资产沿人工写入边界保护。CI 对四组合成案例离线回放。 [任务卡](handoffs/REVIEW01-20261120-task.md)

## RAWEDIT02 人工正文修订边界（2026-11-14，独立验收通过）

用户明确授权从 Raw 详情人工编辑正文，取代下文历史“Raw 不可变”对人工操作的限制；AI 仍不得改写 Raw。见 [RAWEDIT02 任务卡](handoffs/RAWEDIT02-20261114-task.md)及[独立验收](reports/RAWEDIT02-20261114-review.md)。稳定 Raw ID 和来源身份保持，PATCH正文校验预期SHA及bodyRevision（旧记录0），先将修改前完整Markdown原字节写入 knowledge/raw/history/<id>/<revision>.md，再原子替换正文；原件字节不修改。编辑与启动/确认复用Wiki锁，进行中处理及未完成确认阻止编辑。旧普通派生依据按正文SHA失效，已有正式Wiki不自动改写。PDF人工改的是提取文字，bodyRevision非零时旧页链与按页草稿不再用于当前正文，原PDF仍可打开；不能把改后文字冒充原PDF页内容。带Meeting来源身份的Raw仍保持桥接原件一致性，不开放直接正文修订；普通meeting分类不受此限制。

<!-- ENG03 inserted:start -->
## 2026-10-23 HUMAN 增量设计（现行结论）

新提取链在机械合法规划后直接组装未审候选，Draft / KnowledgeWorkflow 通过服务端不可变来源目录、唯一页归属或未解决及内容摘要绑定进行逐页明确确认，CommitStore / KnowledgeWorkflowStore 在服务层统一拦截未全审、有未解决或摘要失效的确认请求；历史方案与验收范围详情见[架构历史归档](archive/architecture-history.md)。
<!-- ENG03 inserted:end -->
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

<!-- ENG03 inserted:start -->
现行 Raw 提取与主题更新流水线采用服务端 atom/locator 确定性证据派生与逐页人工确认门禁，半成品只存 `state/extraction-checkpoints`；KB02 R2、KB02 R1 与 KB01 R4 的演进详情及历史限制见[架构历史归档](archive/architecture-history.md)。
<!-- ENG03 inserted:end -->
既有单Provider仅在knowledge purpose、精确官方host及glm-5.3-flash范围内请求low reasoning与JSON object模式，客户端领域schema/证据/语义验收继续独立；JSON模式不保证模型满足业务字段。<!-- ENG03 inserted:start -->（KB01 R4 与 KB02 R1 历史未通过详情见[架构历史归档](archive/architecture-history.md)。）<!-- ENG03 inserted:end -->审核中可变字段与选择在操作期间锁定，显式侧栏导航清草稿/工作流覆盖，继续保留Raw选择及后台任务世代。

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

产品使用 OpenAI-compatible 非流式 Chat Completions，开发协作模型与产品配置分开。CFG01 由服务端 config-manager 负责主端地址、重档模型、Key 的校验、读写、HMAC revision 与串行原子提交。设置页可显式保存、清除及直测已启用的主端，旧 Key 只以固定掩码返回。Host、Origin、JSON 与 writeToken 门禁限本机可信页面。启动环境按字段优先于本机文件，主端三字段任一非空环境覆盖锁定对应的设置页编辑。默认配置文件是项目根 `.env.local`，服务端可通过 `FMCG_LLM_CONFIG_FILE` 使用隔离配置。设置页以版本化 UTF-8 base64url 编码写入三字段，旧单双引号格式保留内部反斜杠。配置文件和 Key 不进入业务数据或备份。

Batch 3-1 在产品 Provider 工厂接入重档与轻档路由。问答、维护、Prompt 生成优化、Raw/PDF 核心提取使用重档。资讯摘要、分类与建议、周期摘要和主动巡检的发现阶段使用轻档。每端的轻档模型留空时复用该端的重档模型。同一端的两档共用地址与 Key。按 [配置示例](../.env.example) 设置可选名称、超时和备用端。主端默认启用，备用端需显式启用且配置有效。每端缺省超时为 45 秒，任务可明确覆盖。若主端停用且备用端可用，请求直接发到备用端。

主端超时、网络故障或 HTTP 408、429、5xx 时，单个调用最多切换一次有效备用端。端点、模型和凭据完全相同时不会再发一次。调用取消、权限拒绝、响应契约错误及其他 HTTP 4xx 保持原错误。Embedding 保留独立的 `EMBEDDING_*` 配置、`/embeddings` 传输及独立使用统计，不参与聊天主备切换。

实际尝试以每行一条记录写入 `state/llm-routing/attempts.jsonl`，记录端、名称、模型、时间、延迟、可知用量、完成情况和错误分类。业务 API 响应的 `X-FMCG-LLM-Request-Id` 可用于本机可信页面读取 `GET /api/llm/routing?requestId=…`，同一标识覆盖后台任务的后续尝试。无过滤时返回近期 100 条尝试及各端累计统计，故障率分母扣除调用取消。诊断包含当前可用路由的模型与超时，账本不含输入、输出、地址或凭据。设置页固定测试只探测启用的主端，并以 `diagnostic` 标识入账。

server/index.ts为每个AI请求加载有效Provider并用AsyncLocalStorage绑定该请求，后台提取持有启动快照；不会全局交换Provider串线。配置读取/保存不调用Provider，测试仅发送固定非业务探针，15秒及响应体预算限制，无业务资产写入。地址/模型检查新、环境和可读本机已知Key及百分号编码，异常配置不成为公开摘要或发起请求。六链解析后秘密门禁与Raw/Meeting来源约束继续生效。详见[CFG01接口卡](batches/CFG01.md)与[验收](reports/CFG01-20261014-acceptance.md)。

设置请求超时、可见错误、输入长度预算和结构校验；长文分块保留原文证据位置，再汇总候选页面。无 Key、超时、429、无效 JSON、schema 不匹配不能写入正式知识或空 Prompt。测试 fake 明确标示，只用于测试。

Markdown/TXT和DOCX/PDF支持原文字提取。PDF01第一轮允许文件导入保存无文字层PDF：原件字节保留，Raw正文为空，不注入OCR或AI文本；通用parseFile仍沿用旧严格门禁。PDF.js与直接运行时canvas生成本机页图，页文字范围映射Raw原文，`state/raw-pdf/<rawId>`独立保存PNG和页级AI理解。显式启动才向现Provider发送逐页PNG及原文字层；取消/失败/重启须显式继续，结果不能写回Raw或自动进入Wiki。图像结果与原件SHA/页码绑定，原件inline路由支持页锚浏览。真实模型质量未测，内容清理/知识融合不在第一轮。所有解析失败保留原文件/错误，并允许粘贴文本补救。中文搜索先使用 Unicode 归一化与子串/分词组合，不强依赖 qmd；重复检测覆盖标题、别名、分类、标签和正文相似性，显示理由，由用户决定。

## 本地运行约束

PDF01 R2通过`/api/raw/:id/pdf/cleanup`及cancel/draft子路由处理已完成的明确页范围。每批最多4页/48单元/32KiB，主题索引每次16新标题，正文在本机按主题组织，不进入旧256事实聚合。清理状态保留单元处置和理由；DraftRecord的pdfInput/pdfEvidence把文字真实offset与无offset的图像衍生分开。正式确认沿既有Raw成果摘要及事务，pdfDerivations保底层来源；明确分列的续表使用现原生表阅读，结构不明保行待核。原文不改，真实模型清理质量未测；现50主题与候选10万字符容量超限提示缩小范围，不静默截断。

默认绑定 127.0.0.1；请求大小有清晰上限，错误提示与 UI 一致；不信任用户标题作为路径，Raw/Markdown 阅读时防止执行脚本。端口冲突报错，避免连到未知服务。演示数据显式导入并标记 `isDemo`；不在本轮塞入假数据充统计。备份/导出和恢复在 B09 实测。

<!-- ENG03 inserted:start -->

## 现行不变量核对表

| 编号 | 现行不变量 | 在本文件中的位置 | 代码落点参考 |
| --- | --- | --- | --- |
| 1 | **Raw 不由 AI 改写** | `## RAWEDIT02 人工正文修订边界`（L47）；`## 四层和核心接口` `RawStore` 行（L123）；`## 文件、状态和一致性`（L131） | `services/raw/store.ts` |
| 2 | **AI 输出只进草稿** | `## 四层和核心接口` `WikiStore` / `LLMService` / `DraftStore` / `PromptStore` 行（L124–L128）；`## 目录与职责` `drafts/` | `services/wiki/drafts.ts`、`services/llm/service.ts` |
| 3 | **正式写入需人工确认** | `## PIPE01 资讯流水线`（L13）；`## KBMAINT01`（L21）；`## REVIEW01`（L39）；`## 文件、状态和一致性`（L131） | `services/wiki/commits.ts`、`services/wiki/store.ts` |
| 4 | **来源门禁** | `## KBMAINT01`（L21）；`## REVIEW01`（L39）；`## RAWEDIT02`（L47）；`## 目录与职责` Meeting/source-policy（L102） | `services/meeting/source-policy.ts`、`services/wiki/store.ts` |
| 5 | **原子写与串行** | `## RUN01 本机运行与自动化底座`（L3）；`## WORKAUTO01`（L31）；`## 文件、状态和一致性`（L131） | `services/storage/files.ts`（`writeFileAtomic` / `writeJsonAtomic`） |
| 6 | **实例锁** | `## RUN01 本机运行与自动化底座` 第 2 段（L7，`state/runtime/instance.lock` 与 Windows 命名管道） | `services/automation/instance-lock.ts`（`acquireInstanceLock`） |
| 7 | **自动化上下文禁写正式存储** | `## RUN01 本机运行与自动化底座` 第 4 段（L11，`AsyncLocalStorage` 任务上下文） | `services/automation/context.ts`（`assertFormalWriteAllowed`） |
| 8 | **本机 Host / Origin / 令牌门禁** | `## RUN01 本机运行与自动化底座`（L5）；`## WORKAUTO01`（L37）；`## LLM、导入与搜索`（L152） | `server/llm-config-api.ts`、`server/automation-api.ts` |
| 9 | **密钥不进业务数据或备份** | `## LLM、导入与搜索`（L152–L154，CFG01 与解析后秘密门禁） | `services/llm/provider.ts`、`scripts/backup_workspace.ts` |
<!-- ENG03 inserted:end -->
