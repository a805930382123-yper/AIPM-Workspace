# SYN01 seq242 零调用诊断与待确认最小方案

2026-10-26，Sol High 诊断交接。受测 HEAD `c59c6fbc17af6b5c14cca7fc1d3f31162b591485`，Node `v24.20.0`，Windows PowerShell。**诊断完成，未施工，待 Astra 确认协议及允许范围。** 原 seq242 仍 FAIL，R04 NOT_RUN，SYN01/全产品未通过。真实调用0、实际配置读取0、启动服务0；知识242/500、Prompt15/24保持。

本轮只新增本报告及 `tests/acceptance/SYN01-DIAG-20261026-offline.mjs`。未修改产品、旧响应、旧测试/报告、正式数据或配置，未提交/推送。已存在的 AGENTS.md、.agents/、AGENT-ROUTER 报告及主 Agent 的 status/agent-control 改动保留。

## 直接事实与责任边界

唯一原始材料为已脱敏 `SYN01-REAL-20261025-export-1792936917825.json`（SHA256 `17b8eb6db27db107f01cca85addbf56c7f476d977a44682530b1beffeca21978`）、固定 Raw 和独立最终报告。脚本重新核正文 SHA、请求正文与导出 Raw 完全相同，并核导出运行前后 SHA 不变。

| 层次 | 本轮直接检查 | 责任及含义 |
|---|---|---|
| 综合请求 | knowledge-workflows.ts:172–173 只传两个 `{id,title,body}`；system 列出了七个字段、引用五字段和 UTF-16 左闭右开规则。没有“七字段必填、空数组也须出现”的明确示例、category ID 枚举、定位目录。 | 模型确实收到 suggestedAdditions 与 end 规则，不能归因于请求完全漏写；产品仍把精确数偏移计算交给模型，且未给合法分类可选值。 |
| 原模型输出 | 合法 JSON，finishReason=stop；缺 suggestedAdditions，8条 end 均少1，category=`铺货率数据核对`。 | 结构与引用未履约为直接事实；不能把 end 的一致差1证明成模型采用了哪一种内部索引，也不能推测漏字段的内部原因。 |
| 结构校验 | call():208 的五数组校验先拒绝缺字段；没有默认补数组或重新调用。 | 正确 fail closed；没有合法草稿。 |
| 分类校验 | createSynthesis():174–178 检查 schema.categories.id；原 category 不在13个合法 ID 中。 | **新增诊断事实**，被缺数组遮挡；不是 seq242 已执行到的运行时错误。当前请求没有提供合法 ID 是可修的输入契约缺口；不应靠 label→id 猜测映射。 |
| 证据校验 | validateEvidence():256–264 按返回 rawId 找所选 Raw，并检查 slice===quote。原输出尚未运行至此。 | 此次8条偏移错误由离线逐条核验确认，不冒称实际已返回 EVIDENCE_INVALID。保留该严格校验。 |
| 旧输出语义 | 冲突文字每条都写A/B两方，但每条只附单方引文。 | 定位正确不等于复合断言都被支持。最小提示应要求每条只陈述所附来源支持的断言，双方冲突分别列证；真实语义质量仍未验证。 |

schema 合法 ID：industry_basics、category、channel、sales、store、distributor、supply_chain、product、metric、ai_application、company_business、customer、other。不将 `metric` 写成这份真实原稿实际返回值；它仅用于合成隔离诊断。

## 实际回放与 wire 证据范围

使用生产 KnowledgeWorkflowStore.createSynthesis、call、分类和 validateEvidence；Raw get、wiki.schema 包装及 save 是内存桩，不初始化 Store，不落草稿或 Wiki，不开 HTTP。每例仅回放一次内存响应，无 retry。原输出以原字符串完整传入，合成变体分别标记；没有修改历史证据。

| 回放 | 实际结果 | schema读取 / save |
|---|---|---|
| REAL_SEQ242_ORIGINAL_UNCHANGED | LLM_SCHEMA_INVALID，字段 suggestedAdditions 无效 | 0 / 0 |
| SYNTHETIC_ONLY：仅补空数组，隔离下层问题 | LLM_SCHEMA_INVALID，综合标题或分类不符合 Schema | 1 / 0 |
| SYNTHETIC_ONLY：再换合法 category=metric，隔离证据问题 | EVIDENCE_INVALID，conflicts 引用无法定位 | 1 / 0 |

上述合成副本只是证明校验层次，**不是建议产品补 JSON 或改原稿**，均未成功出草稿。脚本 exit0 表示诊断断言满足，不是原样本或批次通过。

八条 quote 在各自对应 Raw 中均仅出现一次；脚本枚举所有出现位置作诊断，未以首匹配生成/修正产品引用：

| 字段 | 来源 | 原[start,end) | 对应连续原文区间 |
|---|---|---|---|
| agreement[0] | A | [0,22) | [0,23) |
| agreement[1] | B | [0,22) | [0,23) |
| agreement[2] | A | [43,61) | [43,62) |
| agreement[3] | B | [43,61) | [43,62) |
| agreement[4] | A | [74,98) | [74,99) |
| agreement[5] | B | [79,103) | [79,104) |
| conflicts[0] | A | [23,42) | [23,43) |
| conflicts[1] | B | [23,42) | [23,43) |

导出保存的是 **LlmCompletionRequest 级请求**（system/user/timeout/maxBytes/purpose），不是实际 HTTP wire 抓包，未保存完整 HTTP body/headers。它足够核原文、提示和消费端责任，不能证明服务端实际收到的字节或模型内部过程。

本轮用生产 OpenAiCompatibleProvider.complete、完全虚构凭证及内存 fetch 替身，离线重建现有 adapter 序列化：system/user 原样进入 messages，model/stream=false/temperature=0；匹配导出 host/model/purpose 的分支加入 reasoning_effort=low、response_format={type:json_object}。无 JSON Schema required/enum 约束，也不应把 json_object 等同严格 schema。**这是代码路径的合成重建，不是 seq242 实际 wire 证据，不使用实际配置或私有响应，不发网络请求。** 不需要再扩展 wire 探测。

## 可最小复用的机制

`services/llm/locators.ts` 的 buildEvidenceLocatorCatalog 已支持完整覆盖、512字符锚点、256个目录上限、UTF-16安全边界及确定性区间检查。双 Raw 分别生成一个锚点：A=[0,99)、B=[0,104)，二者 ID **都为 c1-l001**，不能把裸 ID 汇总成一张多 Raw map。现有默认锚点对本短样本较宽，引用整个 Raw 仍是连续原文，但不能据此承诺逐断言语义支持。

createUpdate 已有受限 evidenceId/旧 Wiki locatorId → 服务端派生原始 quote/rawId/start/end → 保持旧存储/UI结构的先例。提取 resolveLocatorEvidence 专用于 suggested_pages/source_evidence；不能直接套到综合字段，但可复用同一 catalog 构造器和归一化原则，无需改提取链。脚本额外仅用一份标合成的重复句+emoji文本，核现有 catalog 全覆盖、不拆代理对、ID唯一；没有建设新产品 resolver。

## 待 Astra 确认的最小方案

建议限于**新发起 synthesis 的 Provider 输入/输出协议**；保持产品 API、持久化 KnowledgeWorkflow、人审和正式确认协议不变，不加入外发审核、重试或全项目 schema 重构。

1. 在 provider 调用前读取 Wiki schema，把13个合法分类的 id/label 传入，明确只允许返回 id；提示给出所有必填数组的空数组示例，要求七业务字段和独立协议版本始终存在，不支持自动补字段。
2. 建议新协议固定 `synthesis_format_version:1`；五数组维持现名，inferences/openQuestions 保持字符串数组；事实三数组每项严格为 `{text,rawId,locatorId}`。模型只选请求提供的锚点，不返回或计算 quote/start/end，不允许混用 legacy 字段。title和category仍明确检查。
3. 每 Raw 使用现有 catalog，锚点命名加当前 rawId+实际正文SHA+序号绑定（长度须有界），以请求内 `(rawId,locatorId)` 精确匹配；不同 Raw、旧正文、未知 ID 全拒绝。完整目录传入本次请求并由服务端持有，禁止首匹配quote或猜测ID。请求保留完整正文+目录，或仅传可证明完整覆盖的目录文本；为最小变动建议保留正文+目录。不能截断正文/目录。沿用现有限额，目录超限或空正文在 provider 前明确失败，不绕过上限扩大目录预算。
4. 新分支先严格检查版本、顶层/条目字段和所有必填数组，再从当前目录派生 `{text,rawId,quote,start,end}`；验证范围及 slice 精确相等后，进入原 validateEvidence/草稿组装/人审。无证据则不输出事实；保留未知、未来和推断区分。双方冲突分两条各写单方支持的最小陈述；语义仍由模型和人审承担，不能借机械引用认定真值。
5. 新 synthesis 只接受此次请求指定的 v1；不做旧格式 fallback、不猜测 version，不默认空数组、不 end+1、不改历史原响应。createUpdate 的 evidence-id 分支和其它调用保持原样。旧已保存 Workflow 仍按原字段读/审/确认，无迁移、无后台重写；旧合法持久化记录不是新协议 Provider 响应兼容承诺。旧失败导出继续原样拒绝。已有受控真实入口为冻结历史，不改脚本解锁242；未来真实调用需主 Agent 单独授权和新冻结。

这是提议而非已批准施工卡。若 Astra 认为协议版本字段或兼容方式需不同选择，先冻结决定再施工。当前不需要改 provider.ts，也不需要升级到服务商专有 json_schema 能力；现有 adapter 不提供严格 schema保证，应用本地严格校验仍必要。

## 建议允许文件及必要定向验收

产品只允许 `services/wiki/knowledge-workflows.ts` 的新 synthesis 请求、专用格式校验/归一化；复用现有 locators.ts，不改其公共算法。若单文件辅助逻辑确需拆分，可另确认一个专用 synthesis 契约模块，不能据此扩大到通用 Provider/提取链。

测试允许新增 `tests/acceptance/SYN01-DIAG-20261026-*` 或 Astra 冻结的新施工前缀，报告相同原则。默认单测中直接调用 createSynthesis 的 fake Provider 可能需迁移：b05.test.ts、kb02-final-agreement.test.ts、kb02-human-review.test.ts、pa01-r01-r02.test.ts；只调整受新请求协议影响的 synthesis 桩/断言，保留原业务目标，不改变历史 acceptance 原件或原 response。meeting-raw-m04 的前置禁止来源用例应仍在调用前拒绝，通常无需改。主 Agent 独占状态/Git，旧107项冻结报告不是待修源文件。

必要验收限于：

- 原失败原样离线回放继续拒绝、无草稿；合成新协议正例产生同样持久化证据字段，全部由当前目录派生，并核两 Raw/100/两冲突/未知与未来有意保留，明确只是 fake。
- 合成新协议负例小表：缺数组、错版本/多字段、非法分类、未知锚点、错Raw/他来源锚点、旧正文锚点、混入quote/start/end一律拒绝且无 save；重复quote与emoji使用指定ID得到正确不同位置，不走首匹配。
- provider 前原文SHA/受限来源/目录超限拒绝，零 fake请求；目录完整覆盖，空正文不截断或伪造。不要扩成全部Provider错误矩阵。
- 一条 synthesis 旧持久记录读/人审/确认兼容，与新协议草稿人审门禁定向路径；受影响 createSynthesis 默认单测及一条 createUpdate evidence-id 对照，证明格式分支隔离。编译只在实际TypeScript变更后按项目必要检查执行，不在诊断阶段跑build/445/旧11+6矩阵。
- Astra 独立核实际 diff、冻结代码和原oracle，分别裁定工程契约修复与SYN01整体。无真实预算时，即使新协议合成全过也不得签R03/R04或全产品通过。

## 实际命令、结果与版本证据

实际读取 AGENTS/agent-router/status、coordination、当前 B09/SYN01 任务及验收对应项、独立最终报告、脱敏导出和上述所需模块；使用 `git status --short`、`git rev-parse HEAD`、`git diff --stat`、`rg`/定点 `Get-Content`。初次搜索使用 src及Windows glob路径失败，随后按真实 services 路径和 rg --glob 限定，未因此扩大读取。

诊断运行命令：`node --import tsx tests/acceptance/SYN01-DIAG-20261026-offline.mjs`。首跑所有诊断断言后，试图写新增JSON报告时被文件系统返回 EPERM，exit1；没有生成该文件。移除非必要文件写入，保持stdout输出，同命令重跑 **exit0（0.698秒）**。只做这次受影响重跑，未读取真实配置/正式数据或启动服务，guard计数 networkDenied=0、configReadsDenied=0。3次内存响应回放和1次内存wire重建均是合成/离线操作，不计真实调用。

受测实物SHA256：

| 文件 | SHA256 |
|---|---|
| services/wiki/knowledge-workflows.ts | 1e3488ff85908403b3789d5c52dd0dd70dba31fae8e97a9404e83470bc6ae20d |
| services/llm/provider.ts | 7f80cb0b7758de5b4c74112ab831f01409896d49c4a2afe7c3e2b04fa05ca945 |
| services/llm/locators.ts | 5dcd3b37371ffab33ab628c63110ec4ffaaa281fc77add3c2a8f69fb6767ea38 |
| rules/fmcg-schema.yaml | 21e817f606fb0df1b6aeea724a9b227b8c9fa86c011165d0cdc29e853c0ca1b7 |

未执行全量、服务/Chrome、实际HTTP、真实模型、提交/远端同步；模型内部原因和新协议真实遵从率未知。该诊断不宣布局部修复或批次验收通过。交接后停写，交 Astra 审查原证据并冻结最小施工方案。
