# B07 Prompt Library 施工报告

- 批次：B07（Prompt Library，手动模板库）
- 执行角色：B07 施工 Agent（依 `docs/handoffs/B07-deepseek-prompt.md` 执行）
- 完成日期：2026-10-07
- 交接状态：产品代码写入已停止，等待 Codex 主 Agent 独立验收
- 本报告性质：**施工自测记录，不是独立验收结论**。本报告中的 PASS 只表示施工 Agent 自己写的自测脚本通过了，不能替代独立验收 PASS。

范围边界：本批只做 B07。B08 的 Brief、AI 生成、Wiki 背景注入、Optimizer、AI 保存流程**未实现**，界面上 Generator/Optimizer 入口标注「B08 后续开放」并真实禁用。未推进 B08，未覆盖任何历史验收证据或正式用户资料。

---

## 一、实现范围与契约

### 1.1 变更文件

**新增（产品代码）**

| 文件 | 作用 |
|---|---|
| [services/prompt/errors.ts](../../../services/prompt/errors.ts) | `PromptError`（code/message/status/details），沿用统一 `{error:{code,message,details?}}` 契约 |
| [services/prompt/limits.ts](../../../services/prompt/limits.ts) | 长度上限的**唯一定义处**，服务端、界面文案、本报告同源引用 |
| [services/prompt/variables.ts](../../../services/prompt/variables.ts) | `{{变量}}` 扫描、提取与单次字面量渲染 |
| [services/prompt/validate.ts](../../../services/prompt/validate.ts) | 严格白名单校验、系统字段拒绝、变量值归一化 |
| [services/prompt/store.ts](../../../services/prompt/store.ts) | Prompt 存储：原子写入、版本快照、回收、搜索、导出、关联读取 |
| [server/prompt-api.ts](../../../server/prompt-api.ts) | Prompt HTTP 路由（静态路径先于 `:id` 注册） |
| [app/pages/PromptLibraryPage.tsx](../../../app/pages/PromptLibraryPage.tsx) | Library 界面：列表/筛选、编辑、变量填写与复制、版本页、删除确认、导出 |
| [app/prompt.css](../../../app/prompt.css) | Prompt 页面样式，复用既有按钮/错误/空态/加载样式 |
| [rules/prompt-rules.yaml](../../../rules/prompt-rules.yaml) | 冻结的六个分类 id 与显示名（服务端与界面同源读取） |

**修改（产品代码）**

| 文件 | 改动 |
|---|---|
| [server/index.ts](../../../server/index.ts) | 构造 `PromptStore` 并 `initialize()`；把 store 传入首页统计；注册 Prompt 路由 |
| [services/stats/index.ts](../../../services/stats/index.ts) | 首页 `promptCount` 改为复用 `countActivePrompts` 的有效读取逻辑，修正原先递归计 JSON 的方式 |
| [app/App.tsx](../../../app/App.tsx) | Prompt 页面接入路由与导航 |
| [app/api.ts](../../../app/api.ts) | Prompt 请求封装与类型 |
| [app/pages/HomePage.tsx](../../../app/pages/HomePage.tsx) | Prompt 卡片可跳转 Library，文案更新为 Library 已可用 |

**新增（测试与自测工具，均不计入 `npm test` 的验收测试）**

`tests/prompt.test.ts`（服务端单元测试）、`tests/prompt-ui.test.tsx`（jsdom 界面测试）、`tests/b07-harness.mjs`、`tests/b07-fault-hook.mjs`、`tests/b07-prompt-http.mjs`。

**文档**：[README.md](../../../README.md) 新增「B07 Prompt Library」章节（接口表、长度上限、变量语法、存储格式、回收与重试语义），并修正三处因 B07 落地而变为不准确的旧表述（首页统计口径、Prompt 工作台「仍属于后续批次」、`npm test` 覆盖范围）。

**未改动（受保护）**：`docs/handoffs/**`、`docs/batches/**`、`docs/status.md`、`docs/architecture.md`、`docs/coordination.md`、`docs/acceptance.md`、`docs/product-spec.md`、`tests/acceptance/**`、`workspace/**`、密钥与本地数据。

### 1.2 实现范围（本批实际可用）

新建、编辑、删除；中文搜索（名称/标签/正文/场景/分类名）；分类、标签、收藏筛选与组合；场景、输入要求、输出要求、示例、标签、收藏；关联 Wiki；变量提取与填写、最终正文复制；版本历史（完整正文、保存时间、changeSource、元数据，历史版本只读）；Markdown 导出。六个分类冻结，**不注入任何种子 Prompt，不显示假数量**。

### 1.3 接口

读接口（`GET`/`render`/`export`）不写盘；只有用户显式保存（`POST`/`PUT`/`DELETE`）才会改动 Library。

| 方法/路径 | 请求 | 成功响应 |
|---|---|---|
| `GET /api/prompts/schema` | — | `{categories:[{id,label,help}]}`，顺序即冻结顺序 |
| `GET /api/prompts` | `?q=&category=&tag=&favorite=` | `{items:[Prompt], categoryCounts:{[id]:number}}` |
| `POST /api/prompts` | `{requestId, ...十个可编辑字段}` | 201 `{prompt, reused:false}`；同 requestId 同内容重试 200 `{prompt, reused:true}` |
| `GET /api/prompts/:id` | — | `{prompt, wikiLinks:[{id,title,status}]}`，`status` 为 `resolved`/`missing` |
| `PUT /api/prompts/:id` | `{baseVersion, ...十个可编辑字段}` | `{prompt}`；内容无变化时返回原对象且不加版本 |
| `DELETE /api/prompts/:id` | `{baseVersion}` | `{id, deleted:true}` |
| `GET /api/prompts/:id/versions` | — | `{items:[PromptVersion]}` 升序 |
| `GET /api/prompts/:id/versions/:version` | — | `{version:PromptVersion}`（完整快照） |
| `POST /api/prompts/:id/render` | `{baseVersion, values}` | `{id, version, body, missingVariables:[]}`，**纯计算不写盘** |
| `GET /api/prompts/:id/export` | — | `text/markdown; charset=utf-8`，`Content-Disposition: attachment; filename="prompt-<id>.md"` |

响应样例（`POST /api/prompts`，201）：

```json
{
  "prompt": {
    "id": "0b0f6f8e-...", "name": "客户访谈提纲", "category": "customer",
    "scenario": "拜访重点客户前准备问题清单",
    "body": "请围绕 {{客户名称}} 的 {{访谈主题}} 输出访谈提纲。\n",
    "variables": ["客户名称", "访谈主题"],
    "inputRequirements": "客户名称、访谈主题", "outputRequirements": "三段式提纲，每段不超过 5 条",
    "relatedWikiIds": [], "examples": "示例：客户名称=华东某连锁商超",
    "tags": ["访谈", "客户"], "favorite": false,
    "createdAt": "2026-10-07T07:56:54.611Z", "updatedAt": "2026-10-07T07:56:54.611Z",
    "version": 1, "source": "manual"
  },
  "reused": false
}
```

`GET /api/prompts/:id/render` 成功样例：

```json
{ "id": "0b0f6f8e-...", "version": 3, "body": "请围绕 华东某连锁商超 的 陈列与动销 输出访谈提纲。\n", "missingVariables": [] }
```

`GET /api/prompts` 失败样例（`{error:{code,message,details?}}`）：

```json
{ "error": { "code": "INVALID_FILTER", "message": "favorite 只支持 true 或 false。", "details": { "favorite": "yes" } } }
```

错误码全表：

| 类别 | code | HTTP | 说明 |
|---|---|---|---|
| 校验 | `INVALID_BODY` | 400 | 请求体不是对象 |
| 校验 | `REQUIRED_FIELD` | 400 | 缺字段，或必填字段 trim 后为空（名称、正文） |
| 校验 | `INVALID_FIELD` | 400 | 类型不符（如 tags 非数组、favorite 非布尔） |
| 校验 | `INVALID_CATEGORY` | 400 | 分类不在冻结分类内 |
| 校验 | `UNKNOWN_FIELD` | 400 | 出现白名单以外的字段 |
| 校验 | `SYSTEM_FIELD_NOT_ALLOWED` | 400 | 客户端提交 `id`/`variables`/`createdAt`/`updatedAt`/`version`/`source` |
| 校验 | `FIELD_TOO_LARGE` | 400 | 超过长度上限（附 `limit`/`length`） |
| 校验 | `INVALID_ID` | 400 | id 不是 UUID（含 `..%2F..%2F` 形式的路径穿越） |
| 校验 | `INVALID_REQUEST_ID` | 400 | requestId 不是 UUID |
| 校验 | `INVALID_WIKI_ID` | 400 | 关联 Wiki 不是 UUID |
| 校验 | `INVALID_BASE_VERSION` / `INVALID_VERSION` | 400 | baseVersion 不是正整数 / 版本号不是正整数 |
| 校验 | `INVALID_FILTER` | 400 | `favorite` 非 `true`/`false`，或 `q`/`category`/`tag` 非文本 |
| 版本 | `VERSION_CONFLICT` | 409 | `details.currentVersion`；**不覆盖**用户已编辑内容 |
| 重试 | `REQUEST_ID_CONFLICT` | 409 | 同一 requestId 换了另一组初始内容 |
| 重试 | `PROMPT_RECYCLED` | 409 | 该 id 已被删除，永不复活 |
| 关联 | `INVALID_WIKI_LINK` | 400 | 关联目标 Wiki 当前不存在 |
| 变量 | `MISSING_VARIABLES` | 422 | `details.missingVariables` |
| 变量 | `UNKNOWN_VARIABLE` | 400 | `details.unknownVariables` |
| 变量 | `INVALID_VALUES` | 400 | values 非对象或含非字符串值 |
| 存储 | `PROMPT_WRITE_FAILED` | 500 | 原子写入失败，原文件与版本记录不变 |
| 存储 | `PROMPT_DELETE_FAILED` | 500 | 移入回收区失败，记录保留 |
| 存储 | `CORRUPT_PROMPT` | 500 | 磁盘上的记录结构不完整，保留原文件 |
| 规则 | `PROMPT_RULES_MISSING` | 500 | 分类规则文件缺失 |
| 通用 | `NOT_FOUND` | 404 | 记录、版本或导出的 id 不存在 |

### 1.4 长度上限（[services/prompt/limits.ts](../../../services/prompt/limits.ts) 唯一定义）

| 字段 | 上限 |
|---|---|
| 名称 `name` | 200 字符（trim 后非空，不允许换行） |
| 场景 `scenario` | 2,000 |
| 正文 `body` | 100,000（**只做 trim 非空检查，原字符串原样保存**） |
| 输入/输出要求 | 各 10,000 |
| 示例 `examples` | 50,000（原字符串原样保存） |
| 单个标签 `tag` | 60 字符，最多 50 个（去重、去空、trim） |
| 关联 Wiki | 最多 50 个 |

正文 ≥10,000 字符可用（实测 10,914 字符模板字节级原样回读）；超限明确返回 `FIELD_TOO_LARGE`，**绝不截断**。失败一律返回错误或原始对象，从不返回成功或空 Prompt。

### 1.5 存储路径与 JSON 格式

- 正式数据：`<FMCG_DATA_DIR>/prompts/<id>.json`（默认数据根为项目 `workspace/`）。
- 回收区：`<FMCG_DATA_DIR>/prompts/recycle/<id>.json`。
- 每条记录**一个文件**同时保存 `current`、不可变的 `versions[]` 完整快照与 `creation`：

```json
{
  "id": "<uuid>",
  "current": { "...": "Prompt 对象（含 id/variables/version/source/createdAt/updatedAt）" },
  "versions": [
    { "version": 1, "savedAt": "...", "changeSource": "manual", "snapshot": { "...": "该版完整 Prompt" } }
  ],
  "creation": { "requestId": "<uuid>", "input": { "...": "十个初始字段" }, "createdAt": "..." }
}
```

放在同一文件是为了让「当前版本已更新、历史丢失」在结构上不可能发生。写入一律临时文件（`.<name>.<uuid>.tmp`，`wx` 独占）+ rename 提交，变更经 `SerialQueue` 串行化；读取只认 `prompts/` 顶层、文件名为合法 `<uuid>.json` 的记录，回收区/临时文件/其它 JSON 一律不算数。持久化只在服务端完成，产品运行**不依赖** Claude Code、Codex、Agent CLI 或 Obsidian。

### 1.6 变量语法与未填策略

- 语法：`{{名称}}`。名称按 trim 匹配，`{{ 客户名称 }}` 与 `{{客户名称}}` 是同一个变量。
- 变量由**服务端**从正文按首次出现顺序提取并去重，客户端不能提交 `variables`。
- **畸形占位符不算变量**，原样保留在正文中：名称为空、内部含 `{`/`}`、内部含换行、以及未闭合的 `{{`。扫描从左到右一次完成，畸形候选消耗自己那段 `{{ ... }}`，因此嵌套大括号不会被重新读成更小的合法占位符（`{{ {{x}} }}` 会匹配到第一个 `}}` 为止，余下的 ` }}` 作为普通文本）。该策略有单元测试与 HTTP 测试覆盖。
- 填充：**一次遍历、字面量拼接**完成，不使用正则、不使用 `String.replace`。值中的 `$&`、`$1`、`$'`、`$<`、反斜杠、换行都按字面输出；值里的 `{{客户名称}}` 只作为数据、不再递归替换。
- 只读取 values 的**自有键**（`Object.create(null)` 目标 + `Object.entries` 源），`__proto__`/`constructor` 无法触达原型，也不写原型。
- 未知变量名或非字符串值 → 400；版本不符 → 409；纯空白值视为未填写 → 422 并列出缺哪些。
- 复制：界面先列出未填变量并**禁止复制不完整模板**；全部填好后展示最终正文再复制；无变量模板直接复制。复制成功提示只在真正调用剪贴板成功之后出现，失败时提示失败并给出可手动选中的最终文本。填充/预览/复制**从不自动保存**。

### 1.7 source / version 策略，以及 B08 的显式保存方式

- 创建：`version=1`、`source=manual`、`changeSource=manual`；系统字段（id/variables/createdAt/updatedAt/version/source）由服务端维护，客户端提交一律 400。
- 每次**有效**保存追加一份完整快照并把 `version` 加 1；内容无变化的保存既不加版本也不改时间，旧快照不可修改。
- 更新/删除必须带正整数 `baseVersion`，过期返回 409 且保留用户已编辑内容；并发的同 `baseVersion` 更新只有一个成功。
- 创建重试：界面为一次显式「新建」会话生成一个 UUID `requestId`，重试沿用；同 requestId 且初始字段（归一化后）相同 → 返回当前对象、不加版本、不覆盖之后的手工编辑；初始字段不同 → 409；已回收的 id → 409，永不复活。
- **B08 落地时的保存约定（已预留，本批未使用）**：
  - 来源枚举已冻结在 [services/prompt/store.ts](../../../services/prompt/store.ts)：`PromptSource = 'manual' | 'ai_generated' | 'optimized'`、`PromptChangeSource = 'manual' | 'ai_optimized'`。
  - 把 AI 预览保存为**新 Prompt**：走同一个 `POST /api/prompts`（新 requestId + `source: 'ai_generated'`），系统字段仍由服务端写。
  - 保存为**已有 Prompt 的新版本**：走同一个 `PUT /api/prompts/:id`（带 `baseVersion`，`changeSource` 由服务端置为 `ai_optimized`）。
  - 两条路径都由用户的显式保存动作触发；AI 结果本身只进入草稿，不会自动落盘。

### 1.8 与知识库的耦合与隔离

关联只保存 Wiki UUID，标题在每次读取时实时解析、**绝不写回**记录。新关联必须指向当时存在的 Wiki，保存时对新增的那些重新校验；旧关联指向的 Wiki 之后被删除时标记为「关联已失效」，而编辑、解除关联、变量、复制、搜索、导出都照常工作；关联解析失败不会拖垮 Library。删除 Prompt 不动 Wiki，删除 Wiki 也不级联。知识库搜索、Index 与 Lint 不把 Prompt 当作 Wiki。首页 `promptCount` 只统计有效的 `<uuid>.json`；Prompt 的手动操作**不写** `knowledge/logs/wiki.jsonl`。

---

## 二、实际执行的命令与逐项证据

以下命令均在项目根 `E:\AI\Work\AIPM Workspace` 执行，结果取自本轮最终冻结代码。

| 命令 | 退出码 | 耗时 | 结果 | 日志 |
|---|---|---|---|---|
| `npm run build` | **0** | 4,667 ms（vite 自身 977 ms，44 modules transformed） | 通过 | [docs/reports/B07-builder-build.log](../B07-builder-build.log) |
| `npm test` | **0** | 17,123 ms（node:test 汇总 16,516.82 ms） | **135 pass / 0 fail** / 0 cancelled / 0 skipped / 0 todo | [docs/reports/B07-builder-test.log](../B07-builder-test.log) |
| `node tests/b07-prompt-http.mjs` | **0** | 2,508 ms | **11 PASS / 0 FAIL / 1 NOT_RUN** | [docs/reports/B07-builder-http-evidence.json](../B07-builder-http-evidence.json) |

`npm test` 中与 B07 相关的测试：`tests/prompt.test.ts` 的 17 个服务端单元测试、`tests/prompt-ui.test.tsx` 的 5 个 jsdom 界面测试，例如：

```
✔ B07 UI：切换模板时身份、变量、预览与消息互不串页，迟到的旧响应不会覆盖当前选择
✔ B07 UI：未填变量时不能复制、不出现成功提示，剪贴板失败时给出可手动选择的最终正文
✔ B07 UI：无变量模板可直接复制；查看历史版本为只读，且不请求当前版本的渲染
✔ B07 UI：保存冲突时保留用户输入并提示刷新；删除必须二次确认目标
✔ B07 UI：B08 入口真实禁用，新建 Prompt 走 requestId 且只提交可编辑字段
✔ 变量扫描：中文、重复、边界空格，以及必须原样保留的畸形占位符
✔ 变量填充：单次替换、字面值、缺值与 0
✔ 变量值只接受由自己键读取的字符串，原型键不会污染原型
✔ 输入校验：白名单字段、系统字段与长度上限
✔ 创建：requestId 成为 id，版本 1，变量由服务端提取，文件同时保存 current 与快照
✔ 保存：每次有效保存追加完整快照并递增版本；同内容保存不产生版本也不改时间
✔ 冲突：同 baseVersion 只有一个成功，过期写入与删除返回 409 且不改动资产
✔ 创建重试：同 requestId 同内容返回当前对象，不同内容 409，已回收 id 不复活
✔ 删除：原子转移到回收区，从读取/版本接口消失，其他 Prompt 不受影响
✔ 列表：中文名称/标签/正文搜索、分类标签收藏筛选与分类计数
✔ 变量渲染：纯计算、缺值 422、未知键 400、版本不符 409，都不改文件
✔ 导出：YAML 元数据 + 正文原文，围栏与反引号不会被破坏
✔ 关联 Wiki：已失效的旧关联仍可读，新增不存在的关联被拒绝
✔ 统计：只统计顶层有效的 current 记录，回收/临时/其他 JSON 一律不算
✔ 分类规则文件提供六个固定分类且不带任何预置 Prompt
✔ 保存失败时报告可读错误，且不产生新版本或半成品文件
✔ 系统字段由服务端维护：客户端提交的一律被拒绝
```

### 2.1 E07 逐项结果

证据文件：[docs/reports/B07-builder-http-evidence.json](../B07-builder-http-evidence.json)（脚本自启隔离服务，`llmConfigured: false`，临时数据根 `C:\Users\80593\AppData\Local\Temp\fmcg-b07-builder-J2MJi2`）。

| ID | 项目 | 结果 | 关键证据 |
|---|---|---|---|
| E07-01 | 记录与校验 | **PASS**（66 ms） | 分类表精确等于 `industry_learning=行业学习 / business_analysis=业务分析 / customer=客户 / product=产品 / ai=AI / office=日常办公`，无种子、无计数字段；创建对象 16 个字段齐全；10,914 字符正文（含首尾空白、换行、中文标点、反斜杠、`$& $1 $' $<`）字节级 `exact` 回读；磁盘上 `current`/`versions[0]`/`creation` 齐备；9 类拒绝码（`INVALID_CATEGORY`/`INVALID_FIELD`/`REQUIRED_FIELD`/`SYSTEM_FIELD_NOT_ALLOWED`/`UNKNOWN_FIELD`/`INVALID_REQUEST_ID`/`INVALID_ID`/`INVALID_BASE_VERSION`/`FIELD_TOO_LARGE`）均无残留文件（filesBefore=filesAfter=2） |
| E07-02 | 列表与中文搜索 | **PASS**（76 ms） | 4 条记录；分类计数 `{industry_learning:1, business_analysis:1, customer:1, product:1, ai:0, office:0}`；按名称「门店动销」、标签「趋势」、正文「上架计划」均可搜到；不存在的关键词返回空；`favorite=false` 只返回未收藏；空结果与组合筛选正确 |
| E07-03 | 版本历史 | **PASS**（498 ms） | v1→v5，`savedAt` 单调；旧快照内容不变；收藏/标签变化都产生真实版本；同内容保存后版本仍为 5 且文件未被重写；**真实进程重启后版本仍为 5** |
| E07-04 | 并发冲突与创建重试 | **PASS**（55 ms） | 并发同 `baseVersion` PUT → `[200, 409]`，`details.currentVersion=2`；过期 PUT 与过期 DELETE 都保留文件；同 requestId 重试 `reused=true`；编辑后再重试返回**编辑后**的对象（不被覆盖）；不同初始内容 → `REQUEST_ID_CONFLICT`；已回收 id → `PROMPT_RECYCLED`；新会话允许重名 |
| E07-05 | 变量提取与填充 | **PASS**（29 ms） | `variables=["客户名称","访谈主题"]` 顺序正确；`{{ 访谈主题 }}` 与无空格写法视为同一变量；`$& $1 \n {{访谈主题}}` 字面保留、不递归；畸形占位符原样不动；缺值/纯空白 → 422；未知键 → 400；非字符串值 → 400；`0` 为有效值；无变量正文直接可用；`__proto__`/`constructor` 按自有键渲染（`值：甲\|乙`）且无原型污染；render 前后文件 SHA 不变、未写知识日志 |
| E07-06 | 真实浏览器复制/粘贴 | **NOT_RUN** | 本机没有可由脚本驱动的真实浏览器，本轮不执行剪贴板实测。UI 层的复制分支由 `tests/prompt-ui.test.tsx` 用桩验证，但那**不是**真实剪贴板证据，不能替代。留待 Codex 主 Agent 用真实浏览器独立验收 |
| E07-07 | 删除与回收 | **PASS**（576 ms） | 删除后文件位于 `prompts/recycle/<id>.json`；随后 GET 404，列表/搜索/计数/统计均不含它；`notes.json`、`.<uuid>.json.abc.tmp`、`sub/<uuid>.json`、回收区 JSON 一律不计数（`junkIgnored:true`）；其他 Prompt 与 `knowledge/` 未被触碰；重启后依然如此 |
| E07-08 | 与知识库松耦合 | **PASS**（68 ms） | 新建 Wiki（`needs_verification`/`low`/`D`）后关联为 `resolved`；关联不存在的 UUID → `INVALID_WIKI_LINK`；Wiki 被删除后关联变 `missing`，而 render/搜索/编辑/导出仍可用，导出含「关联已失效」；`GET /api/wiki?q=<Prompt 名>` 返回 `[]`；`/api/wiki-lint` 200 且不提及 Prompt id |
| E07-09 | Markdown 导出 | **PASS**（8 ms） | `text/markdown; charset=utf-8`，`filename="prompt-<id>.md"`；YAML frontmatter 13 个键经 `js-yaml` 可解析；各节标题齐全；正文按原样围栏输出（正文内的围栏与反引号不破坏布局）；导出前后文件未变；不存在的 id → 404 |
| E07-10 | 磁盘故障注入与恢复 | **PASS**（534 ms） | 真实故障注入（hook 只允许改 `FMCG_DATA_DIR` 内的路径）：临时文件 `writeFile` EIO → `PROMPT_WRITE_FAILED`；最终 `rename` EIO → `PROMPT_WRITE_FAILED`；`prompts/recycle/` rename EIO → `PROMPT_DELETE_FAILED`。三种情况下原文件与版本记录均未变（`versionAfterFailures=2`），重试成功，无 `.tmp` 残留（`tempLeftovers=0`），重启后干净 |
| E07-11 | 首页数量与知识日志隔离 | **PASS**（50 ms） | `promptCount` 新建 +1、编辑不变、删除 −1（14→15→15→14）；列表条数与计数一致；`prompts/` 中文件数与计数一致（14）；`knowledge/logs/wiki.jsonl` 未变 |
| E07-12 | 无 LLM 可用与既有入口回归 | **PASS**（37 ms） | 未配置任何 LLM 时手动全链路可用；`/api/raw`、`/api/wiki`、`/api/wiki/schema`、`/api/stats`、`/api/audits`、`/api/wiki-lint`、`/api/prompts/schema` 全部 < 500；Raw 创建成功后**不假装**提取成功：返回 400 `LLM_NOT_CONFIGURED` |

### 2.2 真实浏览器操作与未实测项

- 本轮**没有**可脚本驱动的真实浏览器，因此**没有**执行任何真实浏览器操作：未做真实剪贴板粘贴（E07-06 = NOT_RUN）、未做真实页面点击链路的端到端人工验证。
- 界面行为由 jsdom + `react-dom/client` `act()` 测试覆盖（切换隔离、复制降级、只读历史版本、409 保留输入、删除二次确认、B08 禁用、requestId 提交），其中 `fetch` 用桩，且 render 桩直接复用产品自身的 `renderTemplate`，以免桩造出比产品更友好的行为。**桩测试不能替代真实浏览器验收。**
- 这属于环境限制（`BLOCKED` 性质），不是功能失败。

### 2.3 关于 PASS 的声明

上表全部 PASS **只表示施工 Agent 自写自测脚本通过**。自测通过**不等于**独立验收 PASS；本批的独立验收结论由 Codex 主 Agent 独立测试后作出。

---

## 三、指纹、快照与恢复记录

本仓库**不是 Git 仓库**（`git` 不可用），因此以文件 SHA-256 作为变更指纹，不编造任何 commit、分支或 tag。

### 3.1 修改/新增产品与文档文件 SHA-256

| SHA-256 | 字节 | 文件 |
|---|---|---|
| `397a820040ba71abcb3c2473af74f0630b16e77966bdf4d4e459e4be6c90af8a` | 296 | `services\prompt\errors.ts` |
| `f2d7518da64abdf4336c69cbe86291f821dbff93c2ebf505b46ccb99f60569b9` | 898 | `services\prompt\limits.ts` |
| `f081557ed74450c9fe1d824d338ea5afb3c725a0eeebe6cf40f990c5b929f2dd` | 19024 | `services\prompt\store.ts` |
| `368176f945ad37648a8a021a486ab9c43000dc746be9026b65d1533752bcecec` | 8128 | `services\prompt\validate.ts` |
| `94c56133e2ca8541027df58f5d3bb2ac22544634a6f9fee2555eeeb94e230b17` | 3865 | `services\prompt\variables.ts` |
| `36b95d7393d6650c21638c2dce95581f15343c5f92eba9f3ede623700ef5aafd` | 5742 | `server\prompt-api.ts` |
| `87d911779bb650971a43ca52852ce978b9f0bfaf86bbaef7452e9e3df84eaee4` | 16807 | `server\index.ts` |
| `c9630b9735a7f861b98013e9ac96cf509e8c82eeb98ed93585cbae4c109053ee` | 5025 | `services\stats\index.ts` |
| `e8411f7cf90d3874683d95295790d9de6a77cee6b5bf21f3700379ee0adf8583` | 34177 | `app\pages\PromptLibraryPage.tsx` |
| `6e96ad7cae315b3d5b5f47e58b06a3d05a8499d7a0be8e565392e35f6b726432` | 4865 | `app\pages\HomePage.tsx` |
| `ebd29c4696a9d707c32f121da6cac01bcebff35d49bcc2ffc9b9bcd3a7959714` | 6912 | `app\App.tsx` |
| `407b061cba0ca03f7033b5c7cb521d2929b75f1d5e33ed0d37a8fd6b8a17fcc5` | 21352 | `app\api.ts` |
| `31e6751550beb2c79ccab37c1e96042c80628821eefb28a91ae77b7c8e2ee256` | 7392 | `app\prompt.css` |
| `55c53d3d3a30bcdbf3a527aeccf76bd3f295a99f0879270ba071795ff41dc7a8` | 1342 | `rules\prompt-rules.yaml` |
| `5077152d58bbb33ce27af1fb18751e99dc939b1a2e8541732d48602015798da1` | 27516 | `README.md` |
| `7f26b4cc5b69c03183f2cf1c5fab94e84aa3afdf24769bac002ce6ee0b9686bd` | 24593 | `tests\prompt.test.ts` |
| `7daa561be1e87509935a4e53b091d55ea449b8b115fc9a10c4c225f4639b86d9` | 20104 | `tests\prompt-ui.test.tsx` |
| `eeb9d205219ffe006f0b5939be6701d82ce15b8c6bb83b13bee77959e460f93f` | 7498 | `tests\b07-harness.mjs` |
| `28dff58bf977a8210ebd267bd379f04847043b2173196855dc51da8d8f995ccb` | 2511 | `tests\b07-fault-hook.mjs` |
| `a5863388a2871fd51f61efaff3f15e6642b25d94843f7a7354df293ccda82841` | 48276 | `tests\b07-prompt-http.mjs` |

未改动打包配置：`package.json` 与锁文件在本批**没有**改动（无新依赖）。

### 3.2 正式 workspace 前后文件集与 SHA（一致）

| 文件 | 施工前 | 施工后 |
|---|---|---|
| `knowledge/raw/articles/daf6fde4-98e0-478d-8abe-f3abce1031ad.md` | `91ce67d21312797bf465bcbd2618e86b00b7f387c550f4ae662443bca6fb09d2` | 同左 |
| `knowledge/wiki/index.md` | `6ec470440a759e0459dd79b1c7e7e218d5513c1b5c1fd94711bab3133f81d733` | 同左 |

快照文件：[docs/reports/B07-builder-workspace-before.json](../B07-builder-workspace-before.json)（2026-10-07T07:53:33Z，2 files）与 [docs/reports/B07-builder-workspace-after.json](../B07-builder-workspace-after.json)（2026-10-07T07:54:56Z，2 files）；两者内容逐字节相同，`npm test` 与 E07 自测跑完后再次复核仍相同。正式 workspace 未被自测写入，本批也没有创建任何正式 Prompt。

### 3.3 历史验收证据的恢复记录

`npm test` 会重写 `docs/reports/B04-http-evidence.json` 与 `docs/reports/B04-repair3-merge-payload.json`。按交接要求，运行前已备份、运行后已还原，并逐一核对 SHA：

| 文件 | 备份 | `npm test` 后 | 还原后 |
|---|---|---|---|
| `docs/reports/B04-http-evidence.json` | `2b28d35e2b73a5a7aed00cd048de5032d2fc1c74758a372fea617eb380b89bcd` | `5ff62a4946bc0751c7426c73fcaf26fc3b3bc1b8b57f63af59d1f3cc06ec3729`（已确认被重写） | `2b28d35e2b73a5a7aed00cd048de5032d2fc1c74758a372fea617eb380b89bcd` ✅ |
| `docs/reports/B04-repair3-merge-payload.json` | `f3a425dd5e9cb8a72ce28f4a257a938199e495950d1e4c1fd607a023ccfe36af` | `4b0c4d4a0688e9c3819b5690b3734e752f034aefb2f3d6315c620cf12285d4dc`（已确认被重写） | `f3a425dd5e9cb8a72ce28f4a257a938199e495950d1e4c1fd607a023ccfe36af` ✅ |

备份留存：`docs/reports/B07-build-b04-http-evidence-backup.json`、`docs/reports/B07-build-b04-repair3-merge-payload-backup.json`。所有 B07 自测输出均使用 `B07-` 前缀，未覆盖任何历史独立报告。

### 3.4 隔离进程与关闭记录

- 自测一律使用**临时** `FMCG_DATA_DIR` + `freePort()` 动态分配端口 + 关闭全部 LLM 环境变量，`windowsHide: true` 启动子进程；正式服务端口 **4317/5173 在全程未监听、未被触碰**（多次 `Get-NetTCPConnection` 复核为 `none listening`）。
- 早期一次独立 smoke 运行：PID 22228，端口 4399，数据根 `C:\Users\80593\AppData\Local\Temp\b07-smoke-9cce1647`；已停止进程、复核 `port4399_still_listening=False`、并移除该临时数据根。
- 本轮 E07 自测：每次运行由 harness 启动一个产品服务并在 `close()` 中 `kill()` 等待退出；脚本退出码 0，事后检查机器上运行中的 node 进程**只有 Codex 运行时进程**，没有任何 `server/index.ts` 残留。
- **遗留项（如实记录）**：`%TEMP%` 下留有 8 个自测一次性数据根 `fmcg-b07-builder-*`（harness 有意保留以便事后查看），内容全部是自测生成的合成夹具（合成 Wiki/Raw 与 Prompt JSON），不含任何用户资料。尝试成批清理时被本机安全策略拒绝（不允许在共享临时目录按通配符递归删除），故**未删除**，在此记录位置而非绕过该限制。

---

## 四、未完成项、风险与阻塞

### 4.1 未完成项

1. **E07-06 真实浏览器复制/粘贴未实测**（NOT_RUN）。需要真实浏览器与真实剪贴板，本机无脚本可驱动的浏览器。界面复制分支只有 jsdom 桩证据。→ 需 Codex 主 Agent 用真实浏览器独立验收。
2. **无真实浏览器的人工端到端走查**（同上原因），页面的完整点击链路未经真人操作确认。
3. 独立验收本身未进行——本报告不是验收结论。

### 4.2 风险

1. **`npm test` 会重写两个 B04 证据文件**（既有行为，非本批引入）。若不先备份就运行 `npm test`，历史验收证据会被覆盖。已在 README 与本报告注明，备份与还原均已完成。
2. **畸形占位符策略是「按普通文本保留」**：`{{` 内含换行或嵌套大括号的片段不会被替换，也不会报错。这是有意的冻结行为并有测试覆盖，但对用户来说可能表现为「填了变量却没替换」；若后续要改成显式报错，需要作为契约变更单独评审。
3. **`{{ {{x}} }}` 只匹配到第一个 `}}`**，余下的 ` }}` 作为普通文本。同样是冻结行为，已在 README 与代码注释中说明。
4. **回收区会持续增长**：本批按要求不提供恢复界面，也没有清理策略。长期使用后 `prompts/recycle/` 需要人工整理。
5. **关联 Wiki 不级联**：删除 Wiki 后 Prompt 上的关联会变成「关联已失效」，需要用户手动解除。这是有意的松耦合设计。
6. 本机实测环境为 **Node v25.2.1 / Windows**；README 声明的下限 22.13 未在本机实测。

### 4.3 阻塞

无阻塞项。产品与接口可运行，自测已完成，报告与真实证据已落盘，改动文件指纹一致。

### 4.4 运行环境信息

- 模型：harness 报告的模型标识为 `deepseek-flash`（由运行环境提供，施工 Agent 未自行判定）。
- token 用量与成本：**不可用**（harness 未提供，未做任何估算）。

---

## 五、交接状态

- 本批产品代码修改**已停止**。
- B08 未推进，B08 相关入口保持真实禁用且标注「B08 后续开放」。
- 历史验收证据与正式用户资料未被覆盖。
- 待 Codex 主 Agent 独立验收。

**B07已交接，等待Codex独立验收**
