# 快消 AI 产品经理工作台

项目仓库：[GitHub · AIPM-Workspace](https://github.com/a805930382123-yper/AIPM-Workspace)。每次任务修改完成后提交并同步；本机已启用提交后自动推送，其他电脑按 [GitHub 同步说明](docs/github-sync.md) 配置。

B01 提供本机工作台骨架、Raw 原始资料粘贴导入与首页统计；B02 增加手动 Wiki、规则模板、来源回跳、关联与 Markdown 搜索/导出；B03 增加 Markdown/TXT/DOCX/PDF 导入和原件保留；B04–06 增加知识草稿、更新/综合、Audit 与 Lint；B07 提供手动 Prompt Library；B08 增加 Generator 与 Optimizer 工作流；B09 增加首页快捷闭环、显式教学数据和离线备份恢复。

截至2026-10-29，本轮模板更新界面与Prompt必要Wiki上下文缺陷已修复，完整App的知识审核/更新、Audit、Prompt生成、Prompt优化四条流程及重启/备份恢复已完成独立验收。带模板字段的候选仍不支持合并，R13未满足，**B09整体尚未通过**。逐项证据见[当前矩阵](docs/reports/B09-RESUME-20261029-matrix.md)和[工程状态](docs/status.md)；旧模型质量失败与第17次Prompt上下文失败保留，不用新正例删除历史。

Meeting Hub M01–M05本机建设已完成并通过独立阶段验收。「会议档案」支持会议管理、目录/标签、搜索筛选、HTTPS来源、独立策略、UTF-8 `.md`/粘贴纪要、不可改写原件/工作副本/历史，以及Public/Internal明确授权的本机Raw登记。默认Sensitive云索引，Restricted只登记最少信息；Internal/Sensitive本地归档还需单独授权。原件最大2MiB/500000字符，工作副本500000字符，会议JSON32MiB。新Meeting来源始终禁止AI/Wiki/Prompt背景使用，解除或删除档案不解除Raw限制；普通无新origin的旧meeting资料兼容。M05补齐无需reload的Raw/首页同步和真实ID阅读；缺失目标、重连、迟到请求及后台任务刷新保持当前选择。跨文件部分成功按真实Raw计数，可同请求恢复。见[M05报告](docs/reports/M05-20261012-acceptance.md)、[48项映射](docs/reports/M05-20261012-spec-matrix.md)、[接口](docs/meeting-hub/M05-interface.md)、[使用说明](docs/meeting-hub/M05-usage.md)。会议AI仍禁用，原S-03/S-04及真实Provider阻塞以[工程状态](docs/status.md)为准；历史FAIL证据保留，本机阶段PASS不等于全产品PASS。

## 运行

需要 Node.js 22.13 或更高版本（**下限由锁定的 `pdfjs-dist 6.4.299` 的 `engines.node`（`>=22.13.0 || >=24`）决定**，其余依赖要求更低；`package.json` 的 `engines` 与此一致）。历史完整文件解析与早期B09验收环境为 **Node v25.2.1 / Windows**；2026-10-29使用 **Node v24.18.0 / Windows** 验证本轮工程与报告所列样本。最低支持版本未在本机实测，不声称所有Node版本均已通过。仅开发测试用的 `jsdom` 声明 22.13.x 或 ≥24（Node 23.x 会打印一条 engines 警告，不影响运行）。在项目目录运行：

```powershell
npm install
npm run dev
```

在浏览器打开 <http://127.0.0.1:5173/>。开发服务器会同时启动 UI 和本地 API；默认 API 地址为 `http://127.0.0.1:4317`。仅监听本机回环地址。

Windows 需要通过已有 HTTP 代理访问 Provider 时，使用 `npm run dev:proxy`。该入口优先使用当前进程的 `HTTP_PROXY` / `HTTPS_PROXY`（保留 `NO_PROXY`）；两者都没有时读取 Windows 已启用的手动系统代理，支持单一地址及 `http=...;https=...`。不读取 PAC，不修改系统设置或保存代理配置。脚本通过 Node 原生 `--use-env-proxy` 启动并传给子进程；需要支持该标志的 Node（24.5+ 或 22.21+，见 [Node 官方文档](https://nodejs.org/api/cli.html#--use-env-proxy)），能力不足时会提示升级。普通 `npm run dev` 的 Node 下限保持不变。

也可通过同一入口执行 Node 脚本，例如离线检查（不会访问 Provider）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx -e "console.log(process.version)"
```

官方 `api.openai.com` 的 `gpt-6.1-terra` 请求使用模型默认 temperature 和默认推理设置；其他模型和兼容端点保留原请求参数。真实连接仍需显式点击设置页的「测试连接」，或运行另行授权的连接探针。

该精确端点与模型的知识提取/规划路径使用严格 JSON Schema 输出；这不代表 Audit、Prompt 或其他供应商全部使用相同模式，也不保证草稿语义正确。AI内容先进入草稿，须逐页人工审查；编辑会使原审批失效。带模板字段的更新预览保留人工说明、AI整理和引用，确认后以“本次来源整理”附录写入已有Wiki，保留原正文。Prompt生成已修复仅取独立标题而遗漏正文的问题，选定Wiki按相关性取段并保留标题与正文，单页3000/总计12000字符、最多6页限制保持。2026-10-29本轮工程验证使用 Node v24.18.0 / Windows；实际界面验收使用用户TEMP中的独立目录，默认用户数据仍在 `workspace/`。四链23文件重启/恢复逐SHA一致；无Provider手工Wiki与Prompt创建、编辑及恢复也已验证。

PowerShell 可通过环境变量修改数据目录或 API 端口：

```powershell
$env:FMCG_DATA_DIR = 'D:\FMCG-Workspace-Data'
$env:FMCG_PORT = '4318'
npm run dev
```

如果修改 API 端口，Vite 会读取同一个 `FMCG_PORT` 并更新代理。前端默认使用 5173；若该端口被占用，Vite 会明确报错。API 默认使用 4317；端口占用时 Node 会显示监听错误。

检查构建和存储契约：

```powershell
npm run build
npm test
```

`npm test` 包含 B01–B04 的契约、文件、fake HTTP Provider 端到端与 jsdom 交互测试（不会调用真实 Provider），以及 B07 Prompt 的服务端单元测试与 jsdom 界面测试。B07 的隔离端到端自检单独运行：`node tests/b07-prompt-http.mjs`（自启临时数据目录与独立端口，不影响正在运行的服务）。

## B06 Audit 与 Wiki Lint

Wiki 页面的「Audit 与健康检查」可提交整页或选中文本反馈，查看当前定位状态，在目标移动后显式重新定位，调用已配置的产品 Provider 生成建议，并预览/编辑后明确保存，再接受、部分接受、拒绝或延期。草稿保存后会按同一 draft ID 读回新 revision，刷新/重启后仍可找回；未经确认不会写 Wiki。接受与部分接受会更新 Wiki；拒绝记录理由并关闭 Audit；延期记录理由并保持 open。Raw 正文只读。若中断操作与实际 Wiki/Raw 不一致，原操作以 conflict 状态保留、Audit 保持 open，并在详情与界面显示冲突原因。Provider 未配置时，手动 Audit、四种决议和 Lint 仍可使用，生成建议返回 `LLM_NOT_CONFIGURED`。

主要接口：

| 方法/路径 | 用途 |
|---|---|
| `POST /api/audits` | `{wikiId,scope:'page'|'paragraph',severity,comment,anchor?}` 创建反馈；段落 anchor 为 `{before,text,after}` |
| `GET /api/audits?wikiId=&status=` | 查询 Audit；`GET /api/audits/:id` 返回最新定位、pending draft 与恢复冲突 |
| `POST /api/audits/:id/relocate` | `{baseAuditRevision,anchor}` 显式重新定位，拒绝过期版本 |
| `POST /api/audits/:id/propose` | `{}` 调用产品 Provider，返回 `{audit,draft}`；保存前校验 Audit/Wiki/Raw 版本与真实 Raw 引文 |
| `GET /api/audit-drafts/:id` | 刷新/重启后恢复草稿；`PATCH` 以 `{baseRevision,replacement,rationale?}` 编辑；`DELETE` 放弃 |
| `POST /api/audits/:id/resolve` | `{baseAuditRevision,decision,confirm?,draftId?,baseDraftRevision?,replacement?,reason?}`，返回 `{audit,decision,operationId,reused}` |
| `GET /api/wiki-lint` | 只读检查真实 Markdown 文件，返回 findings、summary 和可定位文件行 |

Provider 建议 JSON schema 为 `{replacement:string(1..200000),rationale:string(0..4000),evidence:Array<{rawId:string,quote:string(1..2000)} }`（对象只允许这些字段）。每条 quote 在所引用 Raw 的当前正文中逐字验证；Audit 草稿记录实际正文 SHA-256。resolve 使用 `baseAuditRevision` 与 `baseDraftRevision` 门禁，accepted/partial 必须显式 `confirm:true`。部分接受需传入预览后确认的 replacement。操作在 Wiki 写入、知识日志与 Audit 决议全部完成前不会标记完成；中断操作会保留 operationId 并在服务重启时对账。

独立 Node/tsx 命令不依赖 Obsidian、Python 或 Agent CLI，也不初始化/修复产品资产：

```powershell
node --import tsx scripts/audit_review.ts [data-root] [--open|--resolved|--all]
node --import tsx scripts/wiki_lint.ts [data-root]
```

`audit_review.ts` 参数正确时退出码 0（错误用法为 2）；`wiki_lint.ts` 有发现时退出码 1、无发现退出码 0。Lint 冻结 11 个 code：`BROKEN_WIKI_LINK`、`ORPHAN_WIKI`、`INDEX_MISSING`、`FRONTMATTER_MISSING`、`SOURCE_MISSING`、`KNOWLEDGE_STATUS_MISSING`、`CONFIDENCE_MISSING`、`SOURCE_LEVEL_MISSING`、`UNSOURCED_FACT`、`OPEN_AUDIT`、`DUPLICATE_TITLE`。缺失/失效的 Raw 来源由 `SOURCE_MISSING` 表示；独立的 `UNSOURCED_FACT` 检查 `verified/source_supported` 页缺少有效 Raw，以及「来源事实」节内每条陈述是否有可从有效 Raw 定位的证据，支持 B04 的 `（证据 id）` + `来源证据` offsets 格式及 B05 的 Raw offset 格式。

B06 施工结果、上游核验边界、完整接口/schema 与测试记录见 [docs/reports/B06-build.md](docs/reports/B06-build.md)，四项返修及复验记录见 [docs/reports/B06-repair-build.md](docs/reports/B06-repair-build.md)；这些B06历史报告当时未实测真实Provider。本轮真实Audit及独立裁决见[集成报告](docs/reports/B09-INTEGRATION-AUDIT-20261029-stages.md)。

## B07 Prompt Library

Prompt 工作台的 Library 是**手动**模板库：新建、编辑、删除、中文搜索、分类/标签/收藏筛选、场景与输入输出要求、关联 Wiki、示例、变量填写、复制最终正文、版本历史与 Markdown 导出都可用。整个 Library 在**未配置任何 LLM** 时仍可使用。

六个分类由 [rules/prompt-rules.yaml](rules/prompt-rules.yaml) 冻结，服务端与界面同源读取，不注入任何种子 Prompt，也不显示假数量：

| 分类 id | 显示名 |
|---|---|
| `industry_learning` | 行业学习 |
| `business_analysis` | 业务分析 |
| `customer` | 客户 |
| `product` | 产品 |
| `ai` | AI |
| `office` | 日常办公 |

主要接口（只读的读接口与显式保存分离；只有用户显式保存才会改动 Library）：

| 方法/路径 | 用途 |
|---|---|
| `GET /api/prompts/schema` | 冻结的六个分类（静态路径先于 `:id` 注册） |
| `GET /api/prompts?q=&category=&tag=&favorite=` | 列表 + 全库分类计数；中文经 NFKC + `toLocaleLowerCase('zh-CN')` 归一化后匹配名称/标签/正文/场景/分类名；`favorite=false` 表示「未收藏」，非法值返回 `INVALID_FILTER` |
| `POST /api/prompts` | `{requestId,uuid + 十个可编辑字段}`；新建返回 201，同一 requestId 同内容重试复用返回 200 |
| `GET /api/prompts/:id` | 单条 + 实时解析的关联 Wiki 状态（`resolved`/`missing`） |
| `PUT /api/prompts/:id` | `{baseVersion + 十个可编辑字段}`；内容无变化时不加版本、不改时间 |
| `DELETE /api/prompts/:id` | `{baseVersion}`；移动到 `prompts/recycle/<id>.json` |
| `GET /api/prompts/:id/versions`、`/versions/:version` | 全部版本快照；单个历史版本完整可读，旧快照不可改 |
| `POST /api/prompts/:id/render` | `{baseVersion,values}` 纯计算，返回最终正文，**不写盘**；缺变量返回 422 |
| `GET /api/prompts/:id/export` | `text/markdown` 下载，YAML frontmatter + 正文原样输出 |

错误统一为 `{error:{code,message,details?}}`。校验错误码：`REQUIRED_FIELD`、`INVALID_FIELD`、`INVALID_CATEGORY`、`UNKNOWN_FIELD`、`SYSTEM_FIELD_NOT_ALLOWED`（客户端伪造 id/version/variables/createdAt 等系统字段一律 400）、`FIELD_TOO_LARGE`、`INVALID_ID`（含路径穿越形式的 id）、`INVALID_REQUEST_ID`、`INVALID_WIKI_ID`、`INVALID_BASE_VERSION`、`INVALID_VERSION`、`INVALID_FILTER`。版本与重试：`VERSION_CONFLICT`（409，`details.currentVersion`，且**不覆盖**用户已编辑的内容）、`REQUEST_ID_CONFLICT`（409）、`PROMPT_RECYCLED`（409，已删除的 id 永不复活）、`INVALID_WIKI_LINK`（400，新关联必须指向当前存在的 Wiki）、`MISSING_VARIABLES`（422，`details.missingVariables`）、`UNKNOWN_VARIABLE`（400）、`INVALID_VALUES`（400）、`PROMPT_WRITE_FAILED`/`PROMPT_DELETE_FAILED`（500，原文件与版本记录保持不变）。

长度上限只在 [services/prompt/limits.ts](services/prompt/limits.ts) 定义一处，服务端、界面文案与本文件同源：名称 200、场景 2,000、正文 100,000、输入/输出要求各 10,000、示例 50,000、单个标签 60 且最多 50 个标签、关联 Wiki 最多 50 个。正文下限只做 trim 后的非空检查，**原字符串按字节原样保存**（首尾空白、换行、中文、`$&` 等特殊字符都不改写），10,000 字符以上的模板可用；超限明确报错，绝不截断。

存储：每条 Prompt 是 `<FMCG_DATA_DIR>/prompts/<id>.json` 一个文件，同时保存 `current`、不可变的 `versions[]` 完整快照与 `creation`（requestId + 初始字段），因此在同一个文件内原子更新，不会出现「当前版本已更新、历史丢失」。写入一律临时文件 + rename 提交，变更串行化。内存与界面都不持有事实源，持久化只在服务端完成，产品运行不依赖 Codex、Agent CLI 或 Obsidian。删除移入 `prompts/recycle/`，之后不再出现在列表、搜索、计数与各读接口中，重启后依然如此，界面不提供恢复。首页 `promptCount` 只统计 `prompts/` 下有效的 `<uuid>.json`（历史版本、回收、临时文件与其它 JSON 不计入）；Prompt 的手动操作**不写** `knowledge/logs/wiki.jsonl`。

变量语法为 `{{名称}}`（大括号内允许前后空格，按 trim 后的名称匹配）。变量在服务端从正文中按出现顺序提取并去重；填写时一处填写、全文替换，一次遍历用字面量拼接完成，不使用正则或 `String.replace`，因此值里的 `$&`、`$1`、反斜杠、换行和字面 `{{客户名称}}` 都原样输出，也不会递归替换；只读取 `values` 的自有键，未知变量名或非字符串值明确报错。纯空白的值视为未填写。**畸形占位符不算变量**：大括号内含换行或嵌套 `{{`/`}}` 的片段按普通文本保留，不参与替换（`{{ {{x}} }}` 会匹配到第一个 `}}` 为止）。填充、预览与复制**从不自动保存**：界面上先列出未填变量并禁止复制不完整的模板，全部填好后展示最终正文再复制；无变量的模板直接复制。复制成功提示只在真正调用剪贴板成功后出现，失败时提示失败并给出可手动选中的最终文本。

版本策略：创建时 `version=1`、`source=manual`、`changeSource=manual`；每次**有效**保存追加一份完整快照并把 `version` 加 1，内容无变化的保存既不加版本也不改时间。B08 落地时的约定保持兼容：来源枚举已预留在 `PromptSource`（`manual`/`ai_generated`/`optimized`）与 `PromptChangeSource`（`manual`/`ai_optimized`）；把 AI 生成的预览显式保存为**新 Prompt** 走同一 `POST /api/prompts`（新 requestId + `source: ai_generated`，由服务端写系统字段），保存为**已有 Prompt 的新版本**走同一 `PUT /api/prompts/:id`（带 `baseVersion`），两条路径都由用户显式保存触发，AI 结果本身只进入草稿。

与知识库的耦合是单向只读：关联 Wiki 只保存 UUID，标题在每次读取时实时解析，绝不写回记录；新关联必须指向当时存在的 Wiki，保存时会重新校验新加的那些；旧关联所指向的 Wiki 之后被删除时标记为「关联已失效」，但编辑、解除关联、变量、复制、搜索与导出都照常工作，关联解析失败不会影响 Library 本身。删除 Prompt 不动 Wiki，删除 Wiki 也不级联删除 Prompt；知识库搜索、Index 与 Lint 不把 Prompt 当作 Wiki。

Prompt 的隔离自检（独立端口 + 临时 `FMCG_DATA_DIR`，不影响正在运行的 4317/5173）：

```powershell
node tests/b07-prompt-http.mjs
```

它输出 E07-01…E07-12 的逐项结果并写入 [docs/reports/B07-builder-http-evidence.json](docs/reports/B07-builder-http-evidence.json)。`npm test` 另外包含 Prompt 的服务端单元测试与 jsdom 界面测试（变量与渲染、校验与长度、版本与重启、并发与重试、删除、搜索、导出、故障、界面切换与复制降级）。B07 施工范围、命令与逐项证据见 [docs/reports/B07-build.md](docs/reports/B07-build.md)；施工自测通过不等于独立验收 PASS。

B03 文件导入的端到端自检会自己启动隔离服务（独立端口与 `FMCG_DATA_DIR`）并写入证据文件：

```powershell
node tests/acceptance/b03-http.mjs
```

结果与证据路径见 `docs/reports/B03-fix-build.md`（返修交接）、`docs/reports/B03-build.md`（首次施工）与 `docs/reports/B03-api-evidence.json`；B04 见 `docs/reports/B04-build.md`。

## AI 整理与 LLM 配置（B04 / CFG01）

产品只调用**你自己配置的**服务端 Provider：单一 OpenAI-compatible Chat Completions 适配器（非流式），没有多 Provider 管理器，也不把开发工具的内部凭证当作产品配置。

| 配置项 | 环境变量 | 说明 |
|---|---|---|
| 端点 | `FMCG_LLM_BASE_URL` | 通常以 `/v1` 结尾，工作台会请求 `<Base>/chat/completions` |
| 模型 | `FMCG_LLM_MODEL` | 按 Provider 文档填写 |
| 密钥 | `FMCG_LLM_API_KEY` | **仅服务端读取** |

优先级：进程环境变量 → 项目根 `.env.local`（受 `.gitignore` 忽略，服务端显式读取）。进入「设置」填写 API Base URL、模型 ID、password API Key 并点击「保存配置」；已有 Key 时留空可保留，保存后输入框清空，回读仅固定掩码。修改地址/模型或替换 Key 后，新 AI 请求使用新配置，已开始任务继续用启动快照。页面加载/重新读取/保存均不会自动调用 Provider。

点击「测试连接」才发送固定非业务消息，可能产生少量 API 费用；成功仅证明连接可用，不证明业务质量。未保存修改须先保存再测试。「清除本机配置」须确认，仅移除三项 LLM 配置；环境变量任一非空覆盖会锁定编辑，须在启动终端移除后重启。HTTPS 地址不允许凭证/query/hash，HTTP 仅本机回环；Base URL 不要填写完整 chat/completions 路径。

配置不会进入 workspace 或业务备份/导出；Key 不回传、不进草稿/Wiki/Prompt或普通日志。保存的三字段使用版本化 UTF-8 base64url 编码保证引号/反斜杠等无损，编码并非加密；旧单双引号格式仍可读取，内部反斜杠保持原值。保留其它配置行/注释。高级本机隔离运行可设置服务端 `FMCG_LLM_CONFIG_FILE`，HTTP 不能指定文件；仓库仅提交无密钥 [.env.example](.env.example)。[CFG01验收与环境限制](docs/reports/CFG01-20261014-acceptance.md)。

未配置时：导入、手动 Wiki、搜索、导出、删除等手动链路完全可用；点击「AI 整理知识」会返回明确的 `LLM_NOT_CONFIGURED` 错误，不会伪造结果。

使用流程（Raw → 审核 → 正式 Wiki）：

1. Raw 详情点「AI 整理知识」→ 状态变为 **AI 处理中**，显示阶段/分块进度，可「取消整理」。
2. 提取完成后状态为 **待人工确认**，点「继续审核」进入预览：左侧是原始资料（含证据上下文与 Raw 回跳），右侧是 Source 预览与每条建议的分栏内容（来源事实 / AI 整理 / AI 推断 / 待确认问题 / 来源证据）。
3. 提取完成后的建议**默认全部未选中**：只有你勾选的条目才会成为正式 Wiki。你可以部分选择或全选、改标题/类型/分类/一句话说明、编辑事实与问题、改来源等级/知识状态/可信度、删除建议、合并建议，或放弃草稿。合并会把两侧不同的事实与证据完整保留、相同事实去重并合并证据，事实不会被并进推断。
4. 点「确认写入 Wiki」时会**先保存当前屏幕上的编辑快照再提交**，因此正式页面与你看到的内容一致；零选择时确认按钮不可用（接口也会返回 `NO_SELECTION`）。提交会一次性创建 1 个 Source + 选中 N 页，并写 Index 与知识 Log；Source 正文默认按本次创建的页重新渲染（只链接真正创建出来的页，未选建议以纯文本列在「本次未创建的建议」），并保留 Raw 的真实来源类型、来源名称、作者、发布日期与链接（缺失字段明确写「未提供」）。同一条 Raw 已有唯一合法 Source 时复用它（不修改旧页），新页链接该 Source 的真实标题。
5. 标题/别名与既有页面冲突、来源归属不明等情况返回 409，不会覆盖旧页（旧页更新属于 B05）。
6. 重试确认按**冻结的提交内容**判定：提交的每一个 `selectedPageIds` 都先校验（不存在的 ID 一律 400 `UNKNOWN_PAGE`，不会被静默丢弃）；内容相同（无论 idempotencyKey 是否相同）复用同一个 `operationId` 与同一批页面 ID；内容不同则返回 409，不会用旧内容冒充成功。中途磁盘失败会如实返回「已部分提交」、operationId、已写入 ID 与失败阶段，重启工作台自动继续该操作。Raw 原文与原件字节始终不变。Source 的所有派生段落（Wikilink、Key Takeaways、「本次未创建的建议」）都以本次确认的选集为准，而不是界面上的草稿勾选标记。

处理状态（写入 `state/raw-processing/<rawId>.json`，Raw 文件本身不重写）：`unprocessed / processing / pending_confirmation / generated / failed`。首页「待确认」只统计真正等待审核的草稿。提取预算：单次调用 60 秒、一次提取总期限 10 分钟、分块并发 2、每块正文 8000 字符（重叠 400）、单次输出 JSON 上限 2 MiB、每次提取最多 50 条建议；超限明确报错，不截尾、不静默丢块。

## Generator 与 Optimizer（B08）

Generator 从自然语言任务生成可编辑 Brief，允许选择 Wiki 背景后请求预览；Optimizer 检查现有 Prompt 并返回可编辑建议。预览本身不进入 Library；只有用户显式选择“保存新 Prompt”或“追加版本”才写入版本化 Prompt 记录。无 Provider 时返回明确错误，手动 Library 与知识库仍可使用。真实 Provider 的成功与输出质量尚未验收。

## 首页、教学数据与备份（B09）

首页六项统计来自当前数据根目录中的 Raw、Wiki、待审核知识草稿、Open Audit 和有效 Prompt。五个快捷入口分别直接打开资料导入、Wiki 新建、Prompt Generator、Prompt 新建和 Wiki Lint；最近导入与最近知识变更按对象 ID 定位，已删除的 Wiki 会显示失效提示。Prompt 操作不写入知识 Log。

启动不会自动创建演示数据。进入“设置”并点击“导入演示数据”后，产品才导入 1 条 Raw、5 条 Wiki 和 4 条 Prompt；条目、详情与 Markdown 导出均标记“演示数据”。它们是虚构的教学示例，不是公司事实。重复导入会复用现存数据并保留编辑；被删条目不会被自动恢复。设置页的示例任务只把文本预填到 Generator，不会自动调用 Provider 或保存。

数据默认在项目根目录 `workspace/`，也可通过 `FMCG_DATA_DIR` 指定。归档只包含数据根的 `knowledge/`、`prompts/`、`drafts/`、`state/`、`meetings/` 五个目录，包含原件、历史、回收、草稿、会议元数据和全部纪要原件/工作副本版本；不包含源码、依赖、`.env` 或密钥。当前版本兼容没有 meetings 的旧v1备份；旧程序不保证识别包含会议的新备份。导出前停止本地服务以避免并发写入；导出程序会比较读取前后的文件集合与 SHA-256，若数据变化就失败。恢复必须使用一个不存在或空的新数据根，不会覆盖已有非空目录：

```powershell
node --import tsx scripts/backup_workspace.ts export --data-root .\workspace --output D:\FMCG-Backups\workspace.json
node --import tsx scripts/backup_workspace.ts restore --input D:\FMCG-Backups\workspace.json --data-root D:\FMCG-Restored
```

归档采用 JSON，固定格式 `fmcg-workspace-backup`、版本 1，逐文件记录相对路径、字节数、SHA-256 与 Base64。单文件上限 64 MiB、总计 256 MiB、最多 20,000 个文件；符号链接与非法路径会拒绝。恢复前先校验全归档并写入同级临时目录，再提交新目录。CLI 在 Windows / Node v25.2.1 上施工自测；其它操作系统未实测。


## 数据与 Raw 格式

默认数据保存在项目根目录的 `workspace/`，不写入浏览器 localStorage。每条 Raw 是 `knowledge/raw/` 下的独立 Markdown 文件，YAML frontmatter 保存来源元数据，正文原样保存。来源目录为 `articles`、`reports`、`company`、`customer`、`meetings`、`notes` 和 `other`。微信公众号与网页文章都放在 `articles`。文件导入保留的原件在 `knowledge/raw/assets/`（不参与 Raw 列表与统计）。

正文限制为 500,000 个 JavaScript 字符（中文字符按一个字符计算）；粘贴用的 JSON 请求上限为 3 MiB。超限时 API 返回清楚错误，不创建 Raw 文件。每条记录提供正文 SHA-256，保存后可用于校验读取内容。文件以临时文件写完后重命名提交。

首页统计读取当前数据根目录中的文件：Raw 和 Wiki 统计正式记录，Prompt 只统计 `prompts/` 下有效的 `<uuid>.json`，待确认只统计知识审核草稿，Open Audit 根据记录状态统计。本周新增统计 Raw 与 Wiki 创建数，周期按 Asia/Shanghai 周一 00:00 到下周周一 00:00。演示记录由用户显式导入后作为已标记的真实文件计入对应统计，不会在启动时自动灌入。

## 文件导入（B03）

在 Raw 页面点击「导入资料」，可选择「粘贴文本」或「上传文件」。上传时元数据字段与粘贴流程一致；标题和来源名称留空时，用原文件名（去掉扩展名）补全。

支持矩阵（解析器一律检查实际内容，不只看扩展名或 MIME）：

| 格式 | 扩展名 | 解析方式 | 实际边界 |
|---|---|---|---|
| Markdown | `.md`、`.markdown` | 严格 UTF-8 解码 | 去除编码 BOM 后按原样保存正文：不 trim、不改换行、不把 frontmatter 当应用元数据 |
| TXT | `.txt` | 严格 UTF-8 解码 | 同上；GBK 等其它编码明确失败，不做猜测解码 |
| DOCX | `.docx` | mammoth 1.13.0 | 必须是真实 Word 包（含 `word/document.xml`）；段落之间以空行分隔；损坏包明确失败 |
| PDF | `.pdf` | pdfjs-dist 6.4.299 | 仅支持有文字层的 PDF；不做 OCR，扫描件无文字层时明确失败；加密 PDF 不支持 |

限制（服务端与界面、本文一致）：

- 单个上传文件上限 **20 MiB**；超限在接收阶段直接返回 `413 FILE_TOO_LARGE`，不保存原件。
- 提取正文上限 **500,000 字符**（沿用 B01 契约）；超限返回 `413 BODY_TOO_LARGE`，此时保留隔离原件但不创建 Raw。
- 扩展名与实际内容明显矛盾（例如 TXT 改名 `报告.docx`、Word 文档改名 `.txt`）返回 `415 FORMAT_MISMATCH`。
- 空文件 `400 EMPTY_FILE`；正文为空或纯空白 `422 EMPTY_CONTENT`；损坏 DOCX `422 DOCX_INVALID`；损坏 PDF `422 PDF_INVALID`；无文字层 PDF `422 PDF_NO_TEXT`；加密 PDF `422 PDF_ENCRYPTED`；非 UTF-8 文本 `415 UNSUPPORTED_ENCODING`；其它扩展名 `415 UNSUPPORTED_FORMAT`。
- 原文写入失败 `500 ASSET_WRITE_FAILED`；正文提取成功但 Raw 写入失败 `500 RAW_WRITE_FAILED`（原件保留、不创建 Raw）。
- **部分提交**（Raw 与原件都已写入，只有「原件 ↔ Raw」关联记录没写完）：`500 IMPORT_LINK_PENDING`，`details.committed=true`、`details.recoverable=true`，并返回实际已提交的 `rawId`/`assetId`、原文件信息与恢复说明。响应不会声称「未创建 Raw」；工作台在该数据目录下次启动时会自动补齐关联（若 Raw 实际未提交，则把原件记为待处理并保留原件），界面显示「部分提交 / 待恢复」并提示不要重复导入同一文件。
- 错误统一为 `{error:{code,message,details}}`；`details.retained` 表示「原件已保留、正文未入库」，`details.committed` 表示「Raw 已提交」。

原件与正文分开保存：

- 原件按**原始字节**存入 `knowledge/raw/assets/<assetId>.<ext>`，同时写入 `knowledge/raw/assets/<assetId>.json`，记录原文件名、实际格式、字节数、SHA-256、关联的 Raw ID、提取方式与失败原因。
- 原文件名只作元数据：落盘名始终是 `assetId`，文件名与标题都不参与任何路径。
- 解析失败时保留隔离原件与失败记录，不创建正式 Raw、不增加统计；界面明确区分「正文已入库」与「原件已保留」。
- 只有原件持久化、Raw 创建与关联记录都写入成功，才显示导入成功；部分失败以非成功状态如实报告，并在重启时自动对账、恢复到可解释的一致状态。
- 每次启动都会对 `knowledge/raw/assets/` 做一次对账：补齐缺失的关联、把中断的导入标记为待处理、把指向已删 Raw 的关联标记为已分离；对账不创建、不删除、不改写任何 Raw 正文。

删除与重新导入：

- 删除只由用户在 Raw 详情中显式确认触发。删除前先展示引用影响：服务端重新检查引用该 Raw 的**正式 Wiki** 列表，仍被引用时返回 `409 RAW_REFERENCED` 并列出页面，需先在知识库中解除来源引用。
- 无引用的 Raw 删除后不再出现在列表、统计与重启结果中；删除是用户的显式操作，正文不可恢复。
- 本批保留关联原件，不提供原件清理功能。
- 「重新导入」复用同一导入流程，预填原元数据并创建新的 Raw ID；旧记录、旧原件和 Wiki 来源引用都保持不变，不会原地覆盖或自动转移来源。

## Wiki

Wiki 页面以 `knowledge/wiki/` 中的 Markdown 文件为事实源，规则与六类页面模板从 `rules/` 读取；Index 和变更 Log 是可重建的派生文件。页面支持 Source、Concept、Entity、Business Process、Metric、Synthesis 六种类型，13 个学习分类、标题/别名 Wikilink、中文五字段搜索、Raw 来源回跳、入链查看和 Markdown 下载。删除的 Wiki 移入 `knowledge/recycle/wiki/`。Wiki 可手动创建和编辑；配置产品 Provider 后，Raw 整理、更新预览、多来源综合和 Audit 可生成待审核建议，只有用户明确确认才写入 Wiki。Prompt 的手动 Library 见上文 B07 章节，Generator 与 Optimizer 见 B08；无 Provider 时 AI 请求明确失败，本轮四链真实样本已独立验证，结论限于报告所列输入，不保证所有输入的模型质量。带字段候选合并/类型切换仍被明确拒绝，以避免丢失字段；R13合并要求尚未满足。

## 本批接口

- `POST /api/raw`：粘贴文本导入（B01 契约保持不变）。
- `POST /api/raw/import`：`multipart/form-data`，单个字段名 `file`，加一个 JSON 字符串字段 `metadata`（标题、来源类型、来源名称、作者、原发布日期、链接、标签；正文由解析器产生）。成功返回 `{raw, asset, extraction}`，`raw` 为正式记录、`asset` 为原件记录。
- `GET /api/raw/:id/references`：引用该 Raw 的正式 Wiki 列表（`id`/`title`/`type`）；Raw 不存在返回 404。
- `DELETE /api/raw/:id`：仅由用户的显式确认触发；不存在返回 404，仍被引用返回 409 并附 `details.references`。
- `GET /api/raw/assets?status=parsed|parse_failed|detached`：只读的原件与失败记录元数据（不含字节），用于重启后解释导入状态。
- 首页统计与 Wiki 的 B01/B02 接口未改动。

界面提示与输入规则：标签字段用同一个规则展示与解析（中文/英文逗号、顿号、分号），并实时显示识别到的标签数量；「重新导入」预填的标签未经编辑时按原标签数组保存，不会被合并成一项。文件导入提交成功后，无论点「查看这条资料」「关闭」「右上角关闭」还是「继续导入下一条」，列表与首页统计都会立即同步，不需要刷新页面。

## B04 接口

原有接口（Raw/Wiki/统计/导入）保持不变，B04 新增：

| 方法/路径 | 说明 |
|---|---|
| `GET /api/llm/config` | 本机可信读取安全地址/模型/固定Key掩码、environmentLocked、opaque revision与writeToken |
| `PUT /api/llm/config` | 显式保存；省略apiKey保留，旧revision返回409 |
| `DELETE /api/llm/config` | confirm:true清除三项本机配置，保留其它行 |
| `POST /api/llm/config/test` | confirm:true测试已保存配置，固定非业务探针、最多15秒、响应预算；无业务写入 |
| `POST /api/raw/:id/extract` | 启动或复用提取任务；新任务 202，复用现有任务/草稿 200 |
| `GET /api/extraction-jobs/:jobId` | 任务状态、阶段、分块进度、错误与 `draftId` |
| `POST /api/extraction-jobs/:jobId/cancel` | 显式取消；晚到的 Provider 结果不会落草稿 |
| `GET /api/drafts` | 草稿列表（可按 `rawId`/`status` 过滤） |
| `GET /api/drafts/:draftId` | 完整审核数据、`revision`、证据全局位置、渲染后的正文与提交预览（Source 复用、标题冲突） |
| `PATCH /api/drafts/:draftId` | `baseRevision` + 修改后的结构化内容（`pages`/`deletePageIds`/`merge`/`source`/`document`），整体校验；证据重新定位，锚定字段不可改 |
| `POST /api/drafts/:draftId/discard` | 显式放弃待审核草稿，幂等 |
| `POST /api/drafts/:draftId/confirm` | `baseRevision` + `selectedPageIds` + `idempotencyKey`；锁内检查后提交持久化清单 |
| `GET /api/wiki-commits/:operationId` | 提交状态、各阶段、已写入/待完成 ID 与恢复提示 |
| `GET /api/raw-processing` | 只读的 Raw 处理状态视图（Raw 响应本身不变） |

错误统一为 `{error:{code,message,details?}}`，代码区分缺配置、鉴权、限流、超时、网络失败、非法 JSON、schema/证据失败、空结果、输出截断/预算超限、凭据出现在 Provider 输出（`LLM_OUTPUT_CONTAINS_SECRET`，拒绝该结果）、草稿版本冲突、来源失效、重名冲突、落盘失败与部分提交（`details.committed`/`details.operationId`/`details.writtenWikiIds`/`details.failedPhase`）、清单写入失败（`COMMIT_MANIFEST_WRITE_FAILED`/`COMMIT_STATE_WRITE_FAILED`）与重试内容不一致（`IDEMPOTENCY_KEY_MISMATCH`/`CONFIRM_PAYLOAD_CHANGED`）。Provider 的完整响应与鉴权头不会进入错误、日志、草稿或 Wiki；服务端凭证在返回、持久化与日志三处都会按已知密钥值脱敏。
