# FULL3 2026-10-14 Standards 独立审查与证据适用性

结论：**PASS（Standards 静态审查与既有证据适用性轴）**。本次独立检查未发现已实测的新产品 FAIL。此结论不替代主 Agent 的真实 Provider、语义质量、浏览器、正式数据/配置保护与收尾检查，也不单独签全项目 PASS。36 项真实 AI 运行结论由本次主 Agent 新证据裁决。

## 输入与独立性

依据：AGENTS.md、docs/status.md、docs/batches/CFG01.md、docs/batches/FULL3-20261014.md、docs/coordination.md、docs/acceptance.md、docs/architecture.md；逐项核对 docs/delivery-matrix.md 及 M05-20261012-spec-matrix.md。审查 B01–B09、M01–M05、SEC、CFG01 已实现范围和相邻实际调用路径。

本审查 Agent 未施工，未调用 Provider、启动服务、运行浏览器、build 或 npm test；未读取实际 .env.local、其他密钥或正式 workspace。只新增 full3-20261014-standards-* 脚本与 FULL3-20261014-standards-* 报告。Windows 普通写入被 ACL 拒绝，获授权新增文件通过 require_escalated 的自动审查后写入，未改 ACL。宿主模型未知，仓库声明无法证明或切换宿主模型。子 Agent token 实数不可得。

## 冻结与历史适用性

纯读独立 SHA-256 核对：**84 产品 / 52 测试与 CFG01-20261014-frozen.json 全部一致**。证据：[最终核对](FULL3-20261014-standards-evidence-final.json)，脚本 tests/acceptance/full3-20261014-standards-evidence-final.mjs，Node v24.20.0 / Windows；实际命令退出 0，执行 0.474 秒。

首轮 helper 白名单漏列 .gitignore，返回83项及not-allowed，属于验收夹具错误；首轮脚本与 JSON 原样保留，没有把它判为产品冻结 FAIL。新增 final helper 补入 .gitignore 后84/84一致，没有修改产品或旧证据。

相比 M05 最终冻结，13个已有产品文件改变：app/api.ts、app/b04.css、SettingsPage、index.html、server/index.ts、server/llm-api.ts、llm/config、jobs、provider、service、prompt-ai/service、knowledge-workflows、tsconfig。相比 SEC，7个已有文件改变均属 CFG01。新增配置管理模块已在 CFG01 84文件最终冻结内。当前 MeetingPage/MeetingMinutes/MeetingRawLinks、App、meeting样式、会议存储/来源策略/Raw桥、Raw存储、Audit及备份实现不变；旧会议本机证据按原范围适用。安全服务变化由 SEC 独立验收及 CFG01 六链100/100回归补齐，不能直接拿 M05 当作最新安全门禁。

完整测试215/215与最终build采用2026-10-14 CFG01证据复用，没有在本次重新运行。原workspace npm test因ACL rename EPERM未PASS；字节相同可写临时副本215/215只证明该副本运行结果，不能改写为原地测试成功。见 CFG01-20261014-tests-writable-copy.json、CFG01-20261014-calibration.md。主 Agent 本次另作全项目保护与真实运行。

## Standards 核对

| 项目 | 本轴结论 | 静态位置与适用证据 |
|---|---|---|
| 职责、授权、独立性与范围 | PASS | FULL3卡明确只审查；此Agent只写专属新报告/脚本，无施工、密钥读取或Provider调用 |
| 产品独立运行及四层边界 | PASS | server/index.ts仅装配本机React/Node文件服务；Provider来自服务端配置；package.json不引入开发Agent运行时；Raw/Wiki/Prompt/Meeting事实源分开 |
| Raw不被AI改写、来源完整性 | PASS（静态及旧运行适用） | raw/store.ts:60–65正文SHA校验，list/get均verifyIntegrity；llm/jobs.ts:99–100来源先校验，处理状态在state；SEC/FULL返修/CFG01安全证据 |
| 会议正文不自动发送Provider、限制不可清洗 | PASS（静态及旧运行适用） | source-policy.ts:44–59缺失来源/非法origin拒绝、meeting_local_only禁AI；wiki/store.ts:152–157、jobs.ts:100、knowledge-workflows.ts:42–43/68/178/262/274/315、audit/service.ts:103/154/194、prompt-ai/service.ts:109/148均在实际入口校验；M05/M04及CFG01回归 |
| 凭证不入错误、草稿、业务资产 | PASS（静态及旧运行适用） | provider.ts:28–84已知非空长短多凭证、JSON键值递归及错误脱敏；llm/service.ts:100、jobs.ts:157/183、knowledge-workflows.ts:99、prompt-ai/service.ts:93先检查后落草稿；Audit原保护保持；SEC及CFG01安全实际证据 |
| 配置文件、管理请求与业务隔离 | PASS（静态及旧运行适用） | config-manager.ts串行/原子/HMAC revision、安全summary；llm-config-api.ts:16–35本机Host/Origin/token/JSON，:48–59固定探针、15秒预算；.gitignore忽略私密本机配置；backup_workspace.ts:8只白名单业务根 |
| 新配置热生效、旧请求隔离 | PASS（静态及旧运行适用） | server/index.ts:60–64 AsyncLocalStorage，AI POST中间件为请求运行独立snapshot；jobs.ts:117–141启动时显式provider传run；CFG01 C06实际HTTP证据 |
| AI草稿及用户正式确认 | PASS（静态及旧运行适用） | Wiki draft/commit、KnowledgeWorkflow及Audit确认服务与UI分离；PromptAiService.call仅模型建议，generate/optimize保存pending，confirm才调用PromptStore.confirmAi；DraftReview、KnowledgeWorkflow、PromptAiWorkbench显式按钮；无自动入库 |
| 事实/整理/推断/待确认分别存储 | PASS（静态） | wiki/render.ts:16–27分节，schema/服务校验对应字段；KnowledgeWorkflowPage.tsx:26独立冲突/推断/待确认；真实正确性仍待主Agent人工语义核验 |
| 原子写入、恢复和备份约定 | PASS（既有规定范围；另附未实测疑点） | storage/files.ts:27–41临时写+rename；Wiki/Workflow/Audit提交清单和来源恢复；backup_workspace.ts:97–160路径/大小/SHA/Base64/空目标/竞态；CFG01/M05/FULL2原运行证据可追溯 |
| 设置页与使用说明一致 | PASS | SettingsPage.tsx:39/51–54/85–99显式保存/固定掩码/password清空/测试费用说明/确认清除/env只读；README、architecture及最新delivery前言有CFG01入口、保存不等于测试、快照隔离、测试边界；旧B09叙述明确历史 |
| 假响应与真实质量证据区分 | PASS | 109矩阵保留36BLOCKED，CFG01连接成功明确不能证明业务质量，MH48明确本机范围；本次真实结论必须由新的FULL3主证据逐项更新 |

## 109项与MH48

当前109项：DOC109 PASS；RUN73 PASS / 36 BLOCKED，全部27个不同本地证据引用存在，无缺失。36项为 A06/A08/A09/A10/A18/A23/A24/A28/A44/A45/A46/A47/A48/A53/A54/A55/A63、R05/R07/R09/R11/R12/R15/R16/R17/R18/R19/R20/R22/R23/R24/R26/R35/R36/R38/R42。本Agent不将其变成PASS。主Agent须以六链成功、长文/模板覆盖、事实证据与冲突、Brief/Wiki背景及Optimizer具体质量、四条闭环和Raw字节不变的新证据逐项裁决。

MH01–MH48共48行全部在明确本机范围PASS，6个不同引用存在。MH07外链入口已有本机证据，飞书登录/远端权限为NOT_RUN；MH28–33/38–40按MVP收窄为Public/Internal明确本机登记，全部新会议AI仍关闭；MH36/37本机兼容PASS而真实AI质量需要FULL3补验。M05旧矩阵中“S03/S04未修”是2026-10-12历史限制，最新SEC已CLOSED，不能继续误当当前安全FAIL；旧矩阵原件保留。

## 未实测观察与覆盖限制

静态疑点 OBS-ST01：services/storage/files.ts:50–60 的listJsonRecords注释称不可读会报告，实际readdir错误返回[]，单条JSON parse/read错误直接跳过。DraftStore.list（drafts.ts:110–114）、CommitService.list（commits.ts:68–70）及Workflow恢复（knowledge-workflows.ts:296）使用该函数。最短待验步骤：在隔离data根创建一条已确认待恢复的提交清单，然后将该JSON截断并重启，观察启动及列表是否明确报告损坏、是否保留可恢复状态。此Agent仅静态观察，**RUN=NOT_RUN，未标产品FAIL**，已交主Agent可定点验证；不以这个未验证观察抹除既有正常/故障恢复PASS。

真实Provider配置与本次请求/质量、实际浏览器、正式数据/配置历史保护及自有服务关闭由主Agent负责：此独立轴均NOT_RUN。此前“缺Provider”36BLOCKED是旧矩阵状态，本轮用户已配置不能仍把缺配置当当前阻断；实际成功或网络/格式/质量阻断要按本次事实重判。其它OS、最低Node、远端飞书权限没有新增实测，维持原限制。未部署、未推进施工。
