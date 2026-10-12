# B04 独立验收（2026-10-05）

**最终独立结论：FAIL。** 已读取并合并主 Agent 的真实浏览器报告及本轮构建/单测记录。本轮只验收 DeepSeek V4.1 Flash 交付的 B04，不修产品、不修改 status/历史报告，不进入 B05。缺真实 Provider 是独立外部 BLOCKED；下述可运行缺陷已实际复现，不能以缺 Key 免验，也不能用施工方 80 项自测给本批签 PASS。

验收 Agent：GPT-6.1 Sol High。依据为 AGENTS.md、status、B04 卡、[冻结施工契约](../handoffs/B04-deepseek-prompt.md)、architecture/coordination 和 acceptance 的 B04 对应 ID。测试通过公开产品 HTTP 调用，没有 import 产品模块；fake 是验收脚本自建的 localhost HTTP OpenAI-compatible 服务，模型名明确为 independent-fake-model，无真实 Provider 调用。

## 版本、证据与计数

- [独立汇总 JSON](B04-independent-review.json)：有效 30 个 B04 业务场景 **18 PASS / 12 FAIL**，另冻结检查 PASS，合计 **31 检查 19 PASS / 12 FAIL**。同一根因有多个失败场景，归并为下列缺陷 ID，不把错误矩阵子例另加到场景总数。
- [B04 全量 HTTP/文件](B04-independent-http-2026-10-05T12-55-45.407Z.json)：99.766 秒；包括 12 类 Provider 错误子例、实等 60 秒调用超时、长文和确认恢复。汇总场景原 fixture 三段摘要相同，被合法去重后未触发额外调用；该场景原结论明确作废，由 [独立定点更正](B04-independent-http-2026-10-05T12-57-59.204Z.json) 0.810 秒补齐，实际捕获三段汇总请求并发现缺陷 F04-11。
- [B02 独立 HTTP 回归](B04-independent-b02-regression-2026-10-05T12-54-45-798Z.json)：**12/12 PASS**，2.254 秒；[B03 独立 HTTP 回归](B04-independent-b03-regression-2026-10-05T12-54-51.510Z.json)：**16/16 PASS**，9.494 秒（15 业务＋冻结检查）。回归脚本复制既有独立验收，再更名输出到 B04 新文件，没有覆盖历史 B03 证据。
- 冻结范围为 README、package/lock、忽略/示例配置以及 app/server/services/rules 的 **47 个产品文件**。完整 SHA-256 在独立汇总的 fingerprint 中，开始/结束无变化，施工报告指纹表中所有被覆盖的产品文件一致。builder 测试文件/施工证据不冒充本轮冻结产品文件。
- [主 Agent 独立检查](B04-main-checks.json)：build PASS（tsc/Vite39 modules）、npm test **80/80 PASS**，12.571 秒，[实际 stdout](B04-main-test.log)。[真实浏览器独立报告](B04-browser-independent.md) 与 DOM、API、截图已读取；F04-01/F04-02/F04-03/F04-05 在实际交互中失败。

原有 npm test 会重写 `B04-http-evidence.json`。主 Agent 首次复跑前没有归档施工原始内容，原件已被覆盖，无法核对原始内容；施工报告记录的原 SHA 保留但不把后来文件冒充原件。本轮独立结论只依赖独立 JSON/浏览器报告。此侧效应在 main-checks 透明记录，不涉及产品文件指纹变化。

默认沙箱首次运行真实原子 rename 被 EPERM 拒绝，整次 [沙箱环境记录](B04-independent-http-2026-10-05T12-51-32.936Z.json) 不计产品 FAIL。获得隔离命令 escalation 后正常运行。早期 [脚本调试记录](B04-independent-http-2026-10-05T12-51-58.880Z.json) 含验收脚本错误的 search URL/stats 字段/具体 evidence 错误码期望，已被修正全量覆盖；这些脚本问题不计产品缺陷。所有原记录保留，汇总逐条注明排除原因。

## 已复现缺陷与最小复现

| ID | 优先级 | 问题及实际结果 | 位置 | 证据 |
|---|---|---|---|---|
| F04-01 | P1 | Source 在 UI 改标题/正文/来源等级后点保存，编辑全部丢失；saveEdits 仅 PATCH pages，与页面“Source 编辑一起持久化”说明相反。 | app/pages/DraftReviewPage.tsx:76 | [浏览器U02](B04-browser-independent.md)、[保存后截图](B04-browser-source-save-lost.jpg)、持久化JSON |
| F04-02 | P1 | 本地知识页标题/定义修改后直接确认，界面成功却提交持久化旧内容，未保存修改被静默忽略。 | app/pages/DraftReviewPage.tsx:103 | [浏览器U03](B04-browser-independent.md)、[正式旧标题](B04-browser-formal-old-title.jpg)、API回读 |
| F04-03 | P2 | 草稿初始 3/3 selected=true；UI 亦 2/2 全选，违反冻结“页面默认未选”。 | services/wiki/drafts.ts:149 | E04-04-default-unselected；主 Agent 浏览器 |
| F04-04 | P1 | 同草稿不同 key 重试 409 IDEMPOTENCY_KEY_MISMATCH；同 key 换 selectedPageIds 却 201 reused，未拒绝不同 payload。 | services/wiki/commits.ts:78、81 | E04-05-different-key-reuses-operation / same-key-different-payload-rejected |
| F04-05 | P2 | 复用 Source 的新页链接草稿 Source title，实际 Source ID 正确但 Wikilink missing；仅确认一页时新 Source 正文仍带另外两条未创建建议的 Wikilink。 | services/wiki/commits.ts:175、186；services/wiki/drafts.ts:131；services/wiki/render.ts:40 | E04-04-source-reuse-valid-link-unchanged-old / source-selected-link-set；浏览器未选条目断链 |
| F04-06 | P2 | 默认 Source 正文只有 Raw 标题/ID，未保留真实来源类型、来源名、作者、日期和链接。原始资料独立面板的 rawView 确有这些字段，但 Source 对象/正文未包含，确认快照原样复制缺失正文。 | services/llm/jobs.ts:127、services/wiki/drafts.ts:116、services/wiki/render.ts:40 | E04-04-source-metadata-complete 的 raw/source/rawView 对照 |
| F04-07 | P1 | 合并两个事实不同的建议后第二页事实丢失，第一页事实重复；证据和其它分类仍存在，无法视为合法合并。 | services/wiki/drafts.ts:295–296 | E04-04-merge-facts-preserved |
| F04-08 | P1 | 同 Raw 并发 extract 创建两份 job/draft；extract 与 DELETE 同时发起时 Raw 已 404，晚到提取仍创建 pending 草稿。 | services/llm/jobs.ts:70–102；server/index.ts:166–179 | E04-08-parallel-extraction-single-active / raw-delete-extract-race |
| F04-09 | P1 | Source 已正式写入时，后续提交清单 rename 持续失败，HTTP 500 INTERNAL_ERROR 丢 operationId、committed、recoverable 和已写 IDs，只提示“重试”；清单仍 committing，解除故障重启能恢复，失败当下不如实披露部分提交。 | services/wiki/commits.ts:258；server/index.ts:274 | E04-07-manifest-after-file-write-failure-honest-response |
| F04-10 | P1 | 非法 JSON 的模型正文若回显测试 Key，error.details.preview 原样带 Key，GET job 和任务 JSON 两个表面命中；配置掩码没有保护这条错误路径。 | services/llm/service.ts:66 | E04-11-fake-key-error-response-no-leak：hitCount=2；证据只存位置/数量，测试值已脱敏 |
| F04-11 | P2 | 长文确实触发额外汇总时，请求包含每块 document，但 pages 仅有 title/type/definition，来源事实/证据/整理/推断/问题等结构化结果被剥离；违反冻结“汇总输入必须包括所有块的结构化结果”。 | services/llm/service.ts:302 | 更正定点 E04-09-summary-complete-structured-input，捕获三段完整 request payload |

F04-01、F04-02 为主 Agent 真实操作发现，本验收 Agent 已读取其最终浏览器报告、API持久化JSON及具体预期/实际并合并最终FAIL；其余后端问题为本 Agent 实际 HTTP/文件复现。浏览器另通过明确保存知识页、确认选择数量、Raw正文摘要不变、放弃、取消晚到响应、401可见错误和无配置重启子条件；合并交互只核对页面数/交互，不冒称不同事实内容完整性通过。优先级表示风险，不授权本验收 Agent 改产品。

**F04-04 最小复现与契约裁定。** 对同一 pending draft，用 revision=1、selectedPageIds=[p1]、key=A 首次提交成功；再用同 payload/key=B 返回 409，冻结要求复用持久化同一 operationId。另一个新草稿首次 key=A/[p1] 成功后，以 key=A/[p2] 重试返回 201 且返回旧 p1 的 wikiIds，冻结要求同 key 不同 payload 明确 409。这两项均没有复制页面，但“没有重复页面”不足以满足重试语义。施工报告把不同 key 被拒绝记在 E04-05 PASS，本轮按冻结契约裁定 FAIL。

**F04-05 最小复现。** 先通过手动公开 Wiki API 建立唯一 Source「既有真实Source」，sources=[rawId]；fake 提取建议 document.title=「reuseSource」；GET draft 正确显示要复用旧 Source ID，confirm 成功返回相同 Source ID，GET 新知识页却出现 [[reuseSource]]，links.status=missing。旧 Source 字节前后相同，问题在新页链接目标。另从三建议草稿直接 confirm 只传 p1（无需保存其它内容），Wiki 仅新增 Source＋p1，但 Source 正文仍含 p2/p3 的链接，未选内容应保留待处理文本，不能伪装现有页。

**F04-07 最小复现。** p1.source_facts=[事实0→e1]，p2.source_facts=[事实1→e1]，证据 quote 不同且各自精确匹配 Raw；PATCH merge[p1,p2] 后返回 [事实0→e1,事实0→e1]，事实1 消失。第 296 行 else 归属到内层“证据 ID 已含”判断而非外层 duplicate 判断；修复须同时回归同事实多证据和不同事实，不能只把遗漏文字塞入推断。

**F04-08 最小复现。** Promise.all 发两次 POST raw/:id/extract，实际两次均 202、jobId 不同，终态出现两份 pending 草稿；另 Promise.all(extract,DELETE raw) 返回 202/200，最终 Raw404＋pending 草稿。提取 start 的读取/检查/插入与删除没有共同串行化，单独队列只序列化单次写 JSON，不能保证跨动作“只一个活动任务”或“来源仍存在”。

**F04-09 故障性质。** 独立 acceptance-only preload 包装 Node builtin fs rename/appendFile，不导入产品模块，也不改产品文件；故障规则仅放本轮隔离 FMCG_DATA_DIR 的 .acceptance-fault.json。第 3 次 wiki-commits rename 起持续 EIO：prepared 第 1 次落盘、committing 第 2 次落盘、Source 已正式写入，第 3 次 source-done 清单更新失败。catch 内再次保存失败冒泡成通用 INTERNAL_ERROR，所以调用方拿不到本已存在的 operationId。解除故障同目录重启完成原清单，证据完整保留 failed response、已存在 Source、旧 committing 清单和 recovered completed。

**F04-10 风险边界。** 使用的是随机无效测试 Key，无真实 Key 被读取/打印。Provider HTTP 服务可读取 Authorization，因此回显探针是这条错误通道的有效负例；模型正文即使不是可信输出，也不应进入普通错误持久化时泄漏 API 凭证。检查的是字符串完全相等命中，报告不保存测试密钥本体。

## 通过检查与保留边界

| 检查 | DOC | RUN | 实际范围/证据 |
|---|---|---|---|
| E04-01 无配置与手动链路 | PASS | PASS | 无 Key 正常启动；LLM_NOT_CONFIGURED 明确且零正式变化；手动 Raw/Wiki/中文搜索/Markdown 导出正常；keyConfigured=false。没有独立跑每种单字段缺配置组合。 |
| E04-02 真实 Provider | 待真实配置 | BLOCKED | 当前无用户配置产品 Provider/模型/Key；零真实调用。fake 通过真实适配器 HTTP、schema、规则参与、精确 UTF-16 证据定位，只证明确定性链路。 |
| E04-03 确认前门禁与 Raw 不变 | PASS | PASS | fake 完整草稿完成仅新增 drafts/state；Wiki/Index/Log 摘要和计数不变；失败/取消/放弃零正式新增。成功和恢复前后 Raw 文件 SHA 相同。 |
| E04-04 审核/Source | FAIL | FAIL | API 保存页/source 编辑可保留快照和等级；选择一页只创建 Source1＋N1；删除建议、陈旧 PATCH/confirm、假证据拒绝通过。默认未选、合并事实、Source元数据/有效链接和浏览器编辑有缺陷。 |
| E04-05 确认幂等 | FAIL | FAIL | 同 key 同 payload 并发/重启复用 operationId/IDs、文件及 Log 不增。不同 key / 同 key 改 payload 不合冻结。 |
| E04-06 Provider 失败与预算 | 部分PASS | 部分PASS | 独立公开 HTTP 12 类：401/403/429/500、非法 JSON、空内容、截断、unknown field、错误枚举、假证据、错来源、>2MiB；全部 failed、无草稿/正式知识，Raw处理状态 settled。实等60秒超时 LLM_TIMEOUT通过。独立网络断开、50建议/十分钟总期限边界 NOT_RUN。 |
| E04-07 多文件失败与恢复 | FAIL | 部分PASS/FAIL | 5 个阶段 Source/第二知识页/Index/Log/Raw状态故障明确500＋operationId，解除重启完成同操作，第二重启幂等；真实 index.md 目录占位故障亦通过。prepared 清单首次写失败零正式变化；清单后续更新故障不诚实披露部分提交，F04-09。最终 draft-confirmed/最终 completed 清单写故障没有另跑，不冒称通过。 |
| E04-08 取消/刷新/恢复/竞争 | FAIL | 部分PASS/FAIL | 取消后等待晚到应答不复活草稿；pending 同目录重启恢复，放弃后待确认0；processing 子进程终止重启转 LLM_INTERRUPTED failed。并发提取/删除竞争失败。 |
| E04-09 长文覆盖/汇总 | FAIL | 部分PASS/FAIL | 108k+中文 CRLF/空白/emoji，各块≤8000、全局区间逐段与Raw对照、覆盖头尾、末尾证据、并发≤2与实际callCount通过；确认Raw完整。三段独特摘要触发汇总时输入丢结构化内容。>500k legacy 原文提取、独立aggregate51和十分钟预算实等 NOT_RUN；B03公共输入500001拒绝已回归。 |
| E04-10 持久化/回归/浏览器 | FAIL | 部分PASS/FAIL | B02 12/12、B03 16/16 独立HTTP通过；正式页/Raw/Index/Log重启对照通过；真实浏览器保存Source/未保存页确认/默认选中/未选链接失败，其余已运行子条件见独立浏览器报告。 |
| E04-11 不泄密 | FAIL | FAIL | 配置未返回测试Key；INVALID_JSON preview 原样返回/持久化Key，F04-10。 |

启动/配置/Provider/规则分层由静态核对和公开调用共同佐证，产品进程直接请求 fake HTTP Provider；没有运行时开发 Agent 或 CLI。没有实现 B05 旧 Wiki 更新/去重/Synthesis，不把缺失未来能力算本批缺陷。

精确证据定位只验证 quote 为 Raw 原文且位置一致；fake 的事实文本用于分类存储测试，不能证明真实模型语义质量。A08/A09/R23 的真实成功、真实多主题内容质量继续 BLOCKED；A06 本批确定性 Raw 不变子能力通过，真实提取及 B05/B06 增量仍待验。A10/R12/R13 本批因合并事实丢失与人工编辑缺陷不能 PASS；A11 确认前零正式写子条件通过；A13 实际选择数量通过但 Source 未选链接缺陷未关闭；A60 错误不造知识通过，R41 不泄密 FAIL；跨批 A57/R05 等不签整项 PASS。

## 精确崩溃窗口与清理

E04-07-crash-file-written-before-manifest-update 实际让产品子进程在 Source 已写入、source phase 清单还 pending、准备第 3 次 rename 清单时 exit(86)。响应连接丢失；磁盘恰有 1 个 Source 文件和原 manifest，重启不调模型而据快照补齐成 Source＋3页，retry 复用同 operationId/IDs，总数仍4；该项目通过。它不抵消持续清单写失败的 HTTP 信息缺失。

每个后端场景创建新的 %TEMP%/fmcg-b04-independent-* 子目录，FMCG_DATA_DIR 显式设置，API/fake 端口由 OS 分配闲置 127.0.0.1 端口，避开4317/5173。脚本只关闭自己 spawn 的 PID 和自建 HTTP server；全部后端自有服务已关闭，cleanup 记录在独立汇总及原始报告。主 Agent 浏览器使用专属4335/5186/4336，fixture在docs/reports/fixtures/B04-browser-independent，其专属服务/标签清理由主 Agent 执行并记录到 runtime/B04-browser-cleanup.json。故障规则、崩溃窗口和数据保留在隔离目录便于复查；没有删除/修改正式 workspace，也没有读取开发工具凭证。独立 Agent token 计量平台未提供，记录为不可得。

**交接门禁：B04 不可 PASS；修复上述问题并对受影响行为及关键回归独立复验后再裁决。B05 未授权，不推进。**
