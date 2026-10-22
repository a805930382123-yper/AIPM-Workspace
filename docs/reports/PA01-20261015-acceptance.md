# PA01 主 Agent 独立验收：FAIL

2026-10-15。按用户指定由 Luna High 施工、主 Agent 亲自验收。本次只审查，未修改产品或默认测试，未自动发起返修、换模型、提交或部署。

**整体 FAIL；工程 Standards FAIL，受控使用 Spec FAIL，真实 Provider 质量 BLOCKED。** 两阶段正常链路已交付，但恢复快照、编辑隔离、损坏恢复和错误契约未达到冻结要求。SP-F01、Prompt 范围 BL-F01、ST-F01 均保持 OPEN；KB02/FULL3 历史 FAIL 不变。[返修要求](PA01-20261015-repair.md)。

## 版本与独立检查

冻结 [95 产品 / 56 测试文件](PA01-20261015-main-frozen.json)，相对施工前 8 产品文件修改、4 新增，2 测试修改、1 新增，详见 [范围](PA01-20261015-main-scope.json)。不以 Git 全部未提交差异误算本批范围。

| 检查 | 结果 | 证据与限制 |
|---|---|---|
| 完整默认测试 | PASS，233/233、0 skip | [测试 JSON](PA01-20261015-main-tests-writable-copy.json)、[完整日志](PA01-20261015-main-tests-writable-copy.log)；冻结产品/测试逐字节一致的可写临时副本，未改断言或 fs shim；31.852 秒。不是原目录测试 PASS |
| 构建 | PASS | [tsc + Vite](PA01-20261015-main-build.json)；同一副本，6.744 秒 / 4.122 秒；Vite chunk 大小提示不阻断 |
| 独立服务探针 | 13 PASS / 13 FAIL | [26 组](PA01-20261015-main-probes.json)，纯虚构隔离资料；F13 使用下述隔离校准证据 |
| 实际产品 HTTP | 2 PASS / 6 FAIL | [8 组](PA01-20261015-main-http.json)，真实服务与认证 localhost 假 Provider |
| React + 实际 HTTP | 2 PASS / 5 FAIL | [7 组](PA01-20261015-main-component.json)，jsdom，不冒称实际浏览器；C03 使用等待条件校准后结果 |
| 存储补充 | 1 PASS / 2 FAIL | [3 组](PA01-20261015-main-storage-supplement.json)，与上述失败有重复，不简单相加 |
| 六链秘密 / Meeting 回归 | 62/62 PASS | [独立回归](PA01-20261015-main-security.json)；长/短凭证、键/嵌套键/转义/干净重试，及会议提取/综合零外发。仅证明这些输出边界，不覆盖新增恢复快照漏洞 |
| 最终完整性 | PASS | [核对](PA01-20261015-main-integrity.json)；冻结后产品与 tests 不变，1669 保护文件、正式 workspace 7 文件、实际配置不变 |
| 真实 Provider / 实际浏览器 | BLOCKED / NOT_RUN | 工程门禁未过，不进入真实闭环；本批真实外部调用 0/24，不能签真实模型效果或稳定性 PASS |

主 Agent 实测通过的具体能力：七模板的受控 Brief 请求、严格拒绝非法 Provider Brief/受控字段、内容分节确定性渲染和中文变量保留、编辑后的 Brief 进入生成；现有 Wiki 选择和字符预算回归；check 原子落盘与 GET 零外发；重写失败保留九项检查、仅续 rewrite；失败请求 ID 不可复用、同草稿并发 409、成功重放零调用、三次尝试上限；启动中断转 failed 且零外发；原文/补充摘要和 Provider 身份、目标版本冲突能拦截；旧 optimize 两调用协调；HTTP 客户端断连能取消并保留检查；坏 Prompt JSON 返回 500 而非 404、健康邻居仍可读取、告警不展示原文且修复后刷新可清除。

## 阻断缺陷

### F-PA01-01 / P1 / OPEN：恢复快照未经完整校验和绑定，已知凭证可读出并外发

位置 services/prompt-ai/service.ts 的 get、check、doRewrite（80–84、153、162–167）。只对原文+补充计算摘要；rulesVersion 写入后未校验，checks/improvements 不重新校验或绑定。独立改 rulesVersion、删全部 checks、替换检查证据后，rewrite 都返回成功并多调用一次 Provider，而非 409 零调用。

进一步把持久化检查证据改成该隔离 Provider 已知的**虚构凭证**：实际 HTTP GET 草稿 200 回传该值；rewrite 200，并把该值送入 localhost Provider 的 user messages。见 probes F03–F06、HTTP H05/H06。只涉及本地虚构凭证，没有访问真实 Key、没有真实外发。这是新增恢复路径的安全缺口，62/62 旧输出边界回归不能替代此项。

### F-PA01-02 / P1 / OPEN：错误结构清单仍进入恢复执行器并被改写

位置 services/wiki/commits.ts:68–70、411–419；services/storage/files.ts:58；services/raw/state.ts:32–40。相关 caller 未按任务迁移到严格结构校验。缺少 phases/snapshot 等字段、但有 operationId/rawId/status 的 JSON，仍被真实 WikiCommitService.reconcile 执行并改写成 failed；不满足“坏文件不执行、不重建、字节保持”。[补充 R02](PA01-20261015-main-storage-supplement.json)使用真实 RawStore/WikiStore/DraftStore/RawStateStore 与提交恢复器，未替换执行器。

另一个实测：RawState 含合法 rawId、非法 status，get 静默返回 unprocessed，registry 也无告警。listJsonRecords 没有 issue 接收者仍对损坏返回空数组。见 probes F07/F11/F12。不能只在 UI 加提示绕过服务读盘约束。

### F-PA01-03 / P2 / OPEN：编辑和恢复未隔离，旧检查会用于新输入

位置 app/pages/PromptAiWorkbench.tsx:27、30–32、54–55。检查后编辑原文，旧“继续生成优化版”仍有效；实际点击送出的还是第一次检查的原文。补充编辑也未失效旧检查。恢复仅填原文/检查/预览，没有恢复 supplement 和目标 Prompt；恢复请求无世代/取消守卫，迟到响应把用户新输入覆盖为旧原文。见组件 C01–C04；C03 校准后的实际值 supplement=''、target=''。

手动 Brief 入口同时清空 candidates，已有 Wiki 时仍显示“知识库目前没有 Wiki”，无法选择背景，见 C06（同模块返修）。

### F-PA01-04 / P2 / OPEN：恢复扫描目录/结构不匹配，问题消失和重复计数

位置 services/storage/recovery.ts:6–12、services/storage/files.ts:49–58、app/components/RecoveryNotice.tsx。实际提交目录 state/wiki-commits 未列入；jobs 校验 jobId，但真实落盘字段为 id，健康完成任务被误报 shape。坏 wiki-commits 被列表发现后第一次扫描显示问题，第二次扫描就消失，文件仍坏。一个坏 Prompt 文件经列表和扫描产生两个不同 ID、重复计数。见 probes F08–F10、F13 校准及补充 R01。

静态审查还确认：500 限制只限制 issue 数，健康文件数量、单文件字节和观察队列无界；读取全目录/全文件后仍固定 scanned:true，不能完整表达部分扫描。全局提示首次无问题时返回 null，此后无运行时刷新接线，用户也看不到刷新按钮。权限/目录故障及扫描超限没有逐项实测，不标 PASS；这些属于仍须完成的冻结验收范围。

### F-PA01-05 / P2 / OPEN：错误分类、诊断及操作提示未完成

位置 services/prompt-ai/service.ts:35–41、88–96、133、168；app/pages/PromptAiWorkbench.tsx:15、26。用户提交非法 Brief 被报告 Provider LLM_SCHEMA_MISMATCH / 502，预期输入 400。Brief 非法 JSON、check 鉴权错误缺 stage/category/requestId 等 details；重写截断被归为 configuration、retryable:false、建议检查配置，实际应是响应不完整。取消也被归为配置问题。缺少每调用安全耗时/finishReason/usage 与 schema 字段类型诊断；UI 仍只显示 message，并吞掉 Prompt/Wiki/草稿列表加载错误。见 probes F01/F02、HTTP H01–H04/H07 的真实返回。

### F-PA01-06 / P2 / OPEN：契约描述仍与验证分离且不完整

位置 services/prompt-ai/contract.ts:9–19 与 service.ts:35–77。Brief 借用 required 名称，但限制和校验仍各自硬编码；内容描述未包含 B07 名称/场景/requirements/examples/tags 的全部限制，category.enum 是描述性字符串；九维对象没有完整 properties/items/type/严格未知字段描述，实际验证另写。已有严格拒绝功能不等于完整同源 schema 已交付。此项是静态代码证据，不冒称通过真实模型效果测试。

## PA01-01–10 判定

| ID | 判定 | 依据 |
|---|---|---|
| 01 完整同源契约 | FAIL | F-06；七模板受控请求 PASS 不等于真实质量 PASS |
| 02 调用策略与诊断 | FAIL | 精确 host/model Prompt guard、原预算回归通过；F-05 诊断/分类未过 |
| 03 内容组装/受控关联/预算 | PASS，受控工程范围 | 分节/变量/受控字段独立检查及完整 suite 原 Wiki 上下文边界；真实质量属于 10 |
| 04 两阶段持久化/显式续写 | PASS，受控正常和失败流程 | 并发/重放/三次上限/中断/只续 rewrite/只读零调用已实测；损坏绑定另列 05/08 |
| 05 快照/版本/迟到隔离 | FAIL | F-01/F-03，部分原文摘要/Provider/版本守卫通过不能代替全项 |
| 06 用户错误和输入保留 | FAIL | F-03/F-05，普通重写失败保留检查通过 |
| 07 存储坏项可见与不执行 | FAIL | F-02/F-04，正常 Prompt 截断 JSON 的安全告警通过 |
| 08 安全/来源/确认回归 | FAIL | 原六链/Meeting 62/62 和完整提交回归通过；新增恢复凭证边界 H05/H06 失败 |
| 09 同冻结完整测试/构建 | PASS | 233/233、0 skip；tsc/Vite PASS |
| 10 真实闭环/实际页面 | BLOCKED | 冻结卡要求受控工程全过后才真实取证；本次 0/24 外部调用，实际浏览器 NOT_RUN |

## 校准、保护及收尾

保留 [组件初始](PA01-20261015-main-component-initial.json)和[定点校准](PA01-20261015-main-component-calibration.json)：初始 C03 因挂载等待不足未找到字段，标 INVALID，等待草稿 option 后重测证实产品字段恢复 FAIL。保留 [探针初始](PA01-20261015-main-probes-initial.json)和存储补充：F13 初始数量包含另一条排队问题，不用于单文件数量结论；新隔离根一个坏文件仍返回两项。产品/tests 未因校准改动，未为了过测放宽断言。

施工误在原目录运行测试导致 B04-http-evidence.json 保护哈希变化。主 Agent先保留误覆盖内容，再找到与施工前 SHA-256 完全一致的既有备份，恢复原字节；[恢复证据](PA01-20261015-main-history-restoration.json)。最终 1669 保护项全部匹配，不能把中途旧 integrity FAIL 当最终结果，也不隐瞒该操作事故。

所有自有验收 HTTP/假 Provider 子进程已关闭，测试/构建进程已结束，临时可写副本保留供核查。未停止用户服务；收尾读取 4317/5173 未发现监听，不声称它们仍在运行。本轮无真实 Provider 请求；KB02 原 40/40、KB01 历史 27 独立保留。本轮结束于验收与返修卡，不自动进入施工或下一批。
