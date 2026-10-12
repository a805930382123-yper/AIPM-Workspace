# Meeting Hub：最小增量方案

日期：2026-10-11。状态：规划，未施工。依据：[用户完整提示词](requirements.md)、[现有项目检查](project-check.md)。本文件不授权自动开工，也不安排逐批施工或审查。

## 1. 首版范围与取舍

在现有左侧导航增加“会议档案”。完成会议列表/详情、创建编辑删除、类型与标签管理、元数据搜索筛选、HTTPS 云端来源、获授权的 Markdown/粘贴归档、原件与工作副本、显式本地 Raw 登记。继续使用当前单用户、本机文件持久化方式。

不做飞书 API/OAuth/同步、录音下载/播放/转写、AI 纪要或总结、任务提醒、CRM、看板、多用户、加密平台、全文向量检索或新 Provider。DOCX/PDF 虽有旧解析器，会议首版仍只做 `.md` 和粘贴，避免扩大权限与解析组合。

以下是为控制改动量确定的保守 MVP 取舍，应在界面和交付说明中明确：

1. **所有新 Meeting 来源暂不进入外部 AI，也不成为新 Wiki 的来源。** `external_ai_authorized` 独立保留但本版固定为 false；显示“本版不支持外部 AI 处理”，不做可解除限制的开关。
2. **仅 Public/Internal 可以显式登记本地 Raw。** Sensitive 允许独立确认后的本地归档，暂禁 Raw；Restricted 禁正文、Raw、AI。依据提示词第八、十三节的安全降级条款，不能把这称作已实现完整 Meeting→Wiki 流程。
3. **首版不开放降低已保存保密等级的操作。** 创建时可明确选择等级；后续只允许保持或提高。直接请求降级也拒绝，避免把改标签当成授权流程。纠正误分类的独立降级流程不纳入本版。
4. Restricted 只登记不含敏感信息的代称、日期、主类型和必要安全字段；标签、客户、项目、备注、云链接均留空。其余等级允许登记获准保存的元数据。

界面确认只记录用户声明，不验证公司授权。设置等级也不能防止用户有意重新输入同一内容；不作企业 DLP/RBAC 保证。

## 2. 数据与持久化

```text
<FMCG_DATA_DIR 或现有 workspace>/
  meetings/
    catalog.json             # 主类型、标签及 revision
    records/<meeting-id>.json # 一场会议的完整提交单位
  knowledge/raw/meetings/
    <raw-id>.md              # 仅 M04 显式授权登记后产生
```

不使用标题/文件名构造路径，不写 app/public/dist；默认 workspace 已被忽略。自定义数据根仍由现有配置决定，不另建云盘或仓库数据目录。`meetings` 加入现有备份与恢复白名单；新版能恢复不含 meetings 的旧备份。

纪要原件采用 JSON 中的原始文本字段，不必再保存一套同内容的 Markdown 文件。上传内容必须为合法 UTF-8；保存解码后的原文，不 trim、不替换换行、不由 AI 改写，并记录正文摘要。文件字节摘要可另存用于核对原上传；两种摘要含义不得混淆。

| 数据 | 约定 |
|---|---|
| 记录标识 | `schema_version: 1`、服务端 UUID `meeting_id`、`revision`、created_at/updated_at |
| 基本信息 | title、meeting_date（YYYY-MM-DD）、可选 meeting_time（本地 HH:mm）、meeting_type（稳定类型 ID）、tags（标签 ID 数组）、可选 customer/project/description |
| 云链接 | recording_url/minutes_url 可空；合法 HTTPS、无用户名密码、无控制字符；不限制为猜测的飞书域名 |
| 安全信息 | confidentiality、storage_mode、local_storage_authorized、external_ai_authorized、raw_transfer_authorized、policy_updated_at |
| 本地资料 | imports 数组；每项有 import_id、imported_minutes、editable_minutes、original_filename（粘贴为空）、imported_at、原文摘要；active_import_id 指向当前版本 |
| 版本含义 | imported_minutes 永不编辑；只改当前 editable_minutes；再次导入追加版本并冻结旧工作副本；不要求记录每次按“保存”的编辑历史 |
| Raw 关联 | raw_links 记录 import_id/raw_id/创建时间/关联状态，保留历史；raw_source_id 是当前导入版本的有效关联投影，不另作事实源 |
| 归档状态 | 根据模式、有效原件及 last_import_error 派生；失败只记受控错误码/时间，不保存失败正文、链接或堆栈 |
| 幂等 | 客户端操作 ID + revision；同一请求重试不重复创建会议、导入版本或 Raw |

建议首版限额：单次 MD 不超过 2 MiB，原文与工作副本分别不超过 500,000 字符；单会议最终 JSON 不超过 32 MiB。超限明确拒绝，不截断、不自动删除旧版本；与现有备份单文件 64 MiB 上限相容。列表只返回摘要，不返回 imports/正文。

类型目录首次初始化八个默认类型：需求对接、项目进展、客户拜访、方案评审、内部例会、培训学习、业务复盘、其他。标签由用户维护，不硬编码示例标签。目录项用稳定 ID；名称去空白后去重；支持增加、改名、停用。已引用项只停用，不删除或偷偷改成“其他”；历史记录仍可显示和筛选，停用项不可用于新选择。

单会议写入复用原子文件替换；修改须带 baseRevision，旧版本返回冲突。目录也有 revision。服务层串行处理策略切换、导入、登记、删除，消除同一会议内的竞态；不为此实现通用事务平台。读取损坏文件必须报告，不能当作不存在覆盖新建。

## 3. 权限规则与状态迁移

默认：`Sensitive`、`cloud_index`、三个授权均 false。Public 新建也先用 cloud_index，可直接选择 local_archive；其默认允许本地归档不等于授权 AI/Raw。Internal/Sensitive 切到 local_archive 必须有专门的本地保存确认。

| 等级 | 云端索引 | 本地纪要 | 本地 Raw 登记 | Meeting 来源 AI/Wiki |
|---|---|---|---|---|
| Public | 允许 | 可直接启用 | local_archive + 单独 Raw 授权 + 显式登记 | 禁止 |
| Internal | 允许 | 独立确认后启用 | 同时满足本地授权、Raw 授权、显式登记 | 禁止 |
| Sensitive | 默认 | 独立确认后启用 | MVP 禁止 | 禁止 |
| Restricted | 最少元数据 | 硬禁止 | 硬禁止 | 禁止 |

服务端统一计算能力及拒绝原因，如 `canImportMinutes/canRegisterRaw/canUseAi`；UI 只展示计算结果，不提交能力字段。普通基本信息更新不能夹带正文、ID、来源信息、授权或策略时间。策略操作独立校验 revision 与用户确认，服务端生成 policy_updated_at；未知等级/非法枚举拒绝，缺省等级按 Sensitive。

导入在解析请求内容/落盘前检查当前策略，实际提交前再次检查 revision。HTTP 上传只放有上限的内存，禁止先写附件再发现无权限。禁止在浏览器 localStorage/IndexedDB/草稿缓存保存未经授权的正文。

切换 cloud_index、撤销本地授权或升级 Restricted 时，若仍有本地纪要或该 meeting_id 产生的 Raw，返回冲突并列明待处理的本地副本数量。用户须分别明确删除本地纪要、处理 Raw 后再切换；取消不改变现状。不能只改模式而保留正文，也不能把“解除关联”当成删除正文。检查包括已解除展示关联的来源 Raw。

升级 Internal/Sensitive 重新检查该等级所需确认，并清除 Raw 授权；任何策略变化均不自动复制、调用模型或写 Wiki。Restricted 转换前清除不允许的元数据需给出预览并明确确认。所有撤权都不自动删除飞书或已有知识。

## 4. 模块接口与错误语义

新增建议路径，均为未来文件：

| 文件/模块 | 集中负责 |
|---|---|
| `services/meeting/types.ts`、`policy.ts` | 数据类型、校验、能力计算与状态迁移规则 |
| `services/meeting/store.ts` | 目录/会议存储、revision、原子修改、原件/工作副本与幂等状态 |
| `services/meeting/raw-bridge.ts` | M04 的明确登记、关联、恢复；隐藏跨文件步骤 |
| `services/meeting/source-policy.ts` | M04 的共享来源检查，被既有知识/AI 服务调用 |
| `server/meeting-api.ts` | 路由、有限上传、请求字段白名单、标准错误；业务权限仍在服务层 |
| `app/pages/MeetingPage.tsx`、`app/meeting.css` | 页面、表单、列表/详情；确有需要再拆内部组件 |

HTTP 契约按现有路由风格接入，建议如下；不要增加与业务无关的统一 CRUD 框架：

| 操作 | 建议 HTTP 入口 | 核心约束 |
|---|---|---|
| 目录 | GET/POST/PATCH `/api/meeting-catalog/...` | 类型/标签 ID、改名/停用、冲突检查 |
| 会议 | GET/POST `/api/meetings`；GET/PATCH/DELETE `/api/meetings/:id` | 列表仅摘要，详情按需；修改和删除检查 revision |
| 策略 | PATCH `/api/meetings/:id/policy` | 独立确认；元数据更新不得代替授权 |
| 导入 | POST `/api/meetings/:id/minutes/import` | MD 上传或 text 输入二选一；服务端查策略；追加原件版本 |
| 工作副本 | PATCH `/api/meetings/:id/minutes/:importId` | 仅当前版本 editable_minutes 可改；原文只读 |
| 删除本地副本 | DELETE `/api/meetings/:id/minutes` | 明确确认后删除全部原件/副本；不删除 Raw/云端 |
| 登记 Raw | POST `/api/meetings/:id/raw-links` | 指定真实 import_id 与幂等操作 ID；只读原文 |
| 解除关联 | DELETE `/api/meetings/:id/raw-links/:rawId` | 解除展示关联；不删 Raw 的来源/安全标识或正文 |

错误沿用现有响应结构，附稳定的 code 和可读原因：字段错误 400/422、权限不满足 403、不存在 404、revision/损坏/待处理副本冲突 409、上传超限 413、格式不支持 415、真实文件写入失败 5xx。正文、敏感链接、原始 Provider/文件异常不得拼到响应或普通日志中。日志只保留操作种类、稳定 ID、结果码与必要时间。

## 5. 纪要交互与阅读

详情顺序：基本信息、飞书来源、本地纪要、安全状态、真实关联。缺少链接显示“未添加”。URL 只由用户点击打开，使用新标签与 noopener/noreferrer；不抓取标题、预览或播放。

列表支持标题/标签/客户/项目文字搜索；类型、标签、客户、项目、保密等级筛选；日期升降序，日期相同用稳定 ID 排序。只搜索已获准登记的元数据，不建立全文索引。刷新和返回列表保留合理的筛选状态，迟到请求不串会议。

导入成功后工作副本初始等于原文。阅读、进入编辑、保存、取消编辑都是真实操作；取消只丢弃未保存工作输入。重导入前提示“将新增原始版本并以新内容作为当前工作副本，旧版本保留”，可取消；失败保持旧原件/工作副本与当前版本不变。已有原件的失败状态显示“重导入失败，旧纪要仍可用”，不把旧纪要隐藏。

安全 Markdown 需支持常见标题、段落、列表、引用和代码块。使用受限渲染方案，原始 HTML 不执行、不用未清洗的 dangerouslySetInnerHTML；禁脚本/data 等危险协议，远程图片不自动加载，外链只能由用户点击。保留查看原始文本入口。具体依赖在施工时择一并锁定，不在本规划中另建渲染器或许诺未验证的库安全性。

基本浏览/搜索/链接兼顾窄屏；桌面完成所有主要操作。权限用文字说明，不只用颜色。未实现功能不放假按钮；不自动灌演示会议，需要样例时明确标记 isDemo。

## 6. Raw 连接和服务层拒绝路径（M04）

会议导入成功不产生 Raw。用户单独授权并点“将原始纪要登记到 Raw”后，读取选定 import_id 的 **imported_minutes** 创建不可变 Raw；编辑工作副本不冒充来源原文。登记前展示来源版本和范围。

Raw 沿用现有 UUID Markdown 格式，增加服务端专用来源元数据：`origin.kind=meeting`、meeting_id、import_id、原文摘要、登记时 confidentiality、`processing_policy=meeting_local_only`。名称仅是建议，含义必须保持。正文摘要机制照旧；普通 Raw 创建/文件导入请求不得设置或移除这些字段。

同一 meeting_id/import_id 同一登记重试只产生一个 Raw。RawStore 增加窄的会议来源创建入口，支持服务端预分配 ID，必须核对已存在记录的来源和摘要；不得借用 createDemo 或把任意 ID 写入接口暴露给前端。

跨文件最小顺序：会议 JSON 先保存 pending 登记（含固定 Raw ID 和原文摘要）→创建带来源限制的 Raw→会议 JSON 标记关联完成。只在全部必要步骤完成后报成功。启动/重试仅补齐已明确发起的登记，重查权限；冲突明确失败，不再次创建，不继续已撤销授权的操作。若 Raw 已写入，它必须始终带限制，并通过 pending/来源 ID 可追溯；不隐瞒部分成功或自动删除用户资料。

共享来源检查覆盖以下入口，不能只禁 Meeting 页按钮：

- Raw 提取任务创建、恢复/执行及模型调用前；综合/更新的全部输入 Raw 和目标 Wiki 的旧来源。
- 手动 Wiki 保存的旧/新来源；草稿确认与提交恢复。MVP 拒绝新 Meeting 来源进入 Wiki，不能通过先加入后删掉 sources 绕过。
- Audit 提议、确认与恢复；Prompt 生成所选 Wiki、优化目标 Prompt 的关联 Wiki。防御性地发现已有受限 Wiki/关联 Prompt 时，本版只允许本地读取，拒绝修改、确认和 AI 处理；更新必须先检查旧记录，不能靠提交空 sources/关联字段洗掉限制。新的手动 Prompt 也不能关联受限 Wiki。这避免再为 Wiki/Prompt 增设完整权限版本体系。

这些调用统一交给同一个来源检查模块，不各自复制一套权限表。遇到 Meeting 标识损坏、来源缺失或策略不明，拒绝处理；删除 Meeting、解除关联也不能解除 Raw 自带的 local_only 限制。原有未带新来源标识的资料行为保持兼容。不要把旧 `sourceType=meeting` 一律当成新档案或批量重写。

本版没有由 Meeting 生成的 Wiki；详情不得伪造关联知识。如果文件恢复等情形确实存在引用，只显示实际关系与受限状态，不能因此恢复 AI 权限。当前业务链路可控，任意手工复制到无来源输入不在技术保证范围。

## 7. 删除、恢复与旧模块兼容

| 用户动作 | 实际影响及确认信息 |
|---|---|
| 删除会议档案 | 删除会议 JSON（含它保存的原件和工作副本），明确列出本地版本和 Raw 关联数；保留 Raw/Wiki/飞书；不增加新回收站系统 |
| 删除本地纪要副本 | 清除该会议全部原件/副本，保留会议元数据和来源关联标识；若 Raw 仍有正文必须明示 |
| 解除 Raw 关联 | 只改变档案的关联展示；Raw 仍存在，其会议来源与处理限制不变 |
| 删除 Raw | 走现有 Raw 删除流程，增加会议引用提示/确认；继续执行原有 Wiki/任务保护；Meeting 显示“来源已删除”，不造替代来源 |

删除均检查最新 revision/关联状态并二次确认。已有 Raw 的来源元数据足以在会议被删后继续拒绝 AI，不另建存正文的墓碑。删除功能不能声称清除了外部备份、飞书文件或实现磁盘安全擦除。

Meeting 独立创建、编辑、导入不能改写 Wiki、Prompt、drafts、知识日志或计数。唯有显式登记 Raw 才自然增加 Raw 数量；不得触发提取任务、生成草稿或正式 Wiki。

新数据目录的备份/恢复须与现有白名单、路径穿越/符号链接和校验保护一致；旧版本程序不保证识别含 meetings 的新备份，应清楚报告不支持，不能静默丢掉会议。实现阶段再更新实际 README/架构文档，本轮不把规划当成现有能力。
