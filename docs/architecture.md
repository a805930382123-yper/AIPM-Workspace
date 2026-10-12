# 工程方案

## 范围与部署

桌面优先、单用户、本机运行的 Web 工作台。先通过 localhost 使用；本轮不创建云资源。长期知识资产由用户本机文件承载。产品包含首页、知识库、Raw、会议档案、Prompt 工作台、设置六项导航。

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

## LLM、导入与搜索

首版只接一个稳定 Provider，通过后端适配接口；具体 Provider 在 B04 落实时根据用户可用凭证确定，开发协作模型与产品 LLM 配置分开。Key 仅来自服务端环境/受保护本地配置，前端只见是否配置；日志、Raw、Wiki、Prompt 都不含 Key。

设置请求超时、可见错误、输入长度预算和结构校验；长文分块保留原文证据位置，再汇总候选页面。无 Key、超时、429、无效 JSON、schema 不匹配不能写入正式知识或空 Prompt。测试 fake 明确标示，只用于测试。

Markdown/TXT 先支持；DOCX/PDF 用真实样例验证文本提取，扫描 PDF 无 OCR 能力时明确失败。所有解析失败保留原文件/错误，并允许粘贴文本补救。中文搜索先使用 Unicode 归一化与子串/分词组合，不强依赖 qmd；重复检测覆盖标题、别名、分类、标签和正文相似性，显示理由，由用户决定。

## 本地运行约束

默认绑定 127.0.0.1；请求大小有清晰上限，错误提示与 UI 一致；不信任用户标题作为路径，Raw/Markdown 阅读时防止执行脚本。端口冲突报错，避免连到未知服务。演示数据显式导入并标记 `isDemo`；不在本轮塞入假数据充统计。备份/导出和恢复在 B09 实测。
