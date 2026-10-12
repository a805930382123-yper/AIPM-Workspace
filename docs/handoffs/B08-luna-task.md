# B08 Luna High 施工任务（2026-10-08）

用户授权 GPT-6 Luna High 子 Agent 完成 B08，当前 Codex 主 Agent 独立验收。B07 已 PASS；B04–B06 真实 Provider 阻塞不解除，但用户授权继续 B08 实现。只交付本批，不进入 B09，不自签独立 PASS。先读 status/B08 卡，再按需读 PRD §36–46、54–55、architecture/coordination/acceptance 的本批部分。

## 冻结范围

- Generator：单个自然语言任务入口，六种场景模板（行业学习、业务流程分析、客户访谈、需求分析、AI方案设计、会议资料整理）和自定义。真实 Provider 结构化生成 Brief：任务名称、任务类型、role/goal/context/input/tasks/constraints/output；全部可修改。
- 相关 Wiki：基于现有本地页建议候选，用户勾选/取消决定下一次请求背景，默认零选。只读选择的 Wiki 必要片段，显示预算/截取提示，不自动加入全库。建议允许确定性搜索，不新增互联网研究。
- Generator 第二段：修改后的 Brief + 已选 Wiki 生成完整 Prompt 预览，含 B07 所有输入元数据。预览字段/正文可编辑，支持复制、返回 Brief、重新生成、显式保存。生成/取消/返回不增加正式 Library。
- Optimizer：可粘贴原文或从 Library 当前版进入。保留完整原文；一次结构化调用包含九维检查（目标、角色、背景、输入、步骤、约束、输出、事实/推断、防虚构）、实际改进点和完整优化 Prompt，不显示综合分。可补充需求后重新优化，编辑/复制，保存新 Prompt 或所选原 Prompt 新版本。
- 复用一个现有服务端 LlmProvider/config/providerFactory，三个能力 promptBrief/promptGenerate/promptOptimize 不执行生成的 Prompt，不引入开发 Agent/harness/第二 Provider。

## 接口与数据不变量

建议新增 `services/prompt-ai/**`、`server/prompt-ai-api.ts`，在 `server/index.ts` 最小接线；能力也可由 LLM 层薄入口调用上述模块，避免重写 B04 service。采用下列 API 名称，细节及响应类型在施工报告记录：

| API | 行为 |
|---|---|
| GET /api/prompt-ai/schema | 模板、九维 ID、输入/上下文预算 |
| POST /api/prompt-ai/brief | `{task,template}` → 结构化 Brief、Wiki候选及草稿ID |
| POST /api/prompt-ai/generate | `{brief,relatedWikiIds}` → Prompt预览、实际采用的背景摘要/预算及草稿ID |
| POST /api/prompt-ai/optimize | `{body,supplement?,targetPromptId?,baseVersion?}` → 原文/检查/改进点/预览及草稿ID |
| GET /api/prompt-ai/drafts/:id | 回读持久化预览与原文/目标/来源 |
| POST /api/prompt-ai/drafts/:id/confirm | 显式提交 `{requestId,mode:'new'|'version',input:<用户编辑后的B07字段>}`，从草稿受控来源写正式 Prompt |

输入必需字段、未知字段/ID、类型、长度、Schema 严格校验；Provider 输出空/非法 JSON/不完整/截断必须失败而不是补出成功预览。Brief/生成/优化结果只落 `drafts/prompts/<uuid>.json`，不能进入正式 Library、知识统计或知识日志。没有 Key 时明确错误，Library 所有手动功能继续可用。

上下文策略冻结最低门槛：最多选 6 Wiki；每页最多 3,000 字符背景，总背景最多 12,000 字符；按 Brief 关键词/段落标题相关性选片段，保留 ID/标题/知识状态，标明截取和实际使用量。空/被删 ID明确拒绝，不擅自代选；可配置较低测试预算，但生产上限和超限错误必须可查询。task 上限 10,000 字符，Brief 单字段 10,000、总量 30,000，原 Prompt/预览正文沿用 B07 100,000；调用超时和输出字节预算在规则中明确。正常产品文案不暴露开发细节。

确认使用编辑后的全部字段，变量由正文重算。保存来源由服务端草稿种类决定，不能让普通 B07 POST/PUT 任意伪装 AI 来源：生成新项 `source=ai_generated`；优化新项 `source=optimized`；优化原项保留其对象 source，追加版本 `changeSource=ai_optimized`。保存新项首版也使用明确 AI 修改来源，必要时新增 `ai_generated` 版本来源并向后兼容旧 JSON。现有 manual 语义不变。

新项 requestId 稳定 UUID、成功重试不重复/不覆盖后续编辑；保存原项必须使用优化起点 baseVersion，旧预览 409且不改旧记录。双击/请求失败重试幂等：Prompt 已提交但草稿确认标记失败时，重启重试能识别原提交，不重复追加新版本，也不伪报完全成功。保存方式/编辑 payload 变更后的同 requestId 必须冲突，明确错误。API 不能用某草稿任意写另一模板；粘贴优化未绑定原项时只允许新项（UI可先明确选原项再优化）。存储确认入口复用 B07 的队列/原子写入/冲突/关联验证，不绕过它直接改 JSON。

用户编辑、切 Generator/Optimizer/Library、返回 Brief、更换源模板、连续新建/重新调用时，迟到 200/422/500/409 不覆盖新表单、不串原文/预览/错误，旧 finally 不误解锁新请求。每个编辑会话各有稳定保存 requestId；新会话另取 UUID。保留 B07 七项修复，尤其同 ID 重选历史读取 token。

Raw/整个 knowledge 文件和知识日志不可修改；确认前后/重启核对。Key 只服务端读取，错误/草稿/Prompt/日志/导出不能泄漏。仅用隔离数据测试；先检查配置是否存在，不输出其值，不改用户配置。若没有现有完整配置，真实 AI 成功/质量标 BLOCKED，fake 只签确定性契约。

## E08 验收冻结场景

| ID | 必须验证 |
|---|---|
| E08-01 | 自然语言经销商首次访谈任务→Brief，七字段/任务名类型可编辑；六模板+自定义 |
| E08-02 | 修改 Goal/Constraints 后下一次生成请求与产出对应；返回/重新生成有效 |
| E08-03 | 勾选/取消 Wiki 请求背景准确；未选页内容不发出；必要片段/预算/失效ID可见 |
| E08-04 | 元数据/正文预览可编辑、真实复制到普通文本目标；显式保存前全部 Prompt/knowledge 字节与计数不变 |
| E08-05 | 保存 ai_generated 新项，所有编辑字段/变量/来源/时间/旧版本回读，刷新/同目录重启 |
| E08-06 | 弱 Prompt 九维实际缺项及可操作改进点；完整 Prompt 不凭空报缺项、不显示综合分；完整原文保留，补充后重新优化 |
| E08-07 | 优化预览编辑/复制；保存新项 optimized 或原项 ai_optimized 新版本；旧版原样、不自动保存 |
| E08-08 | stale baseVersion、重复/并发确认、rename故障/部分提交恢复及同payload重试；无重复项/版本、不覆盖已提交结果 |
| E08-09 | 无配置/鉴权/429/超时/网络/空/非法JSON/schema/超限，错误可见、不产生空正式项、现有资产/Raw不变、可重试 |
| E08-10 | 延迟 Provider/读取/确认后切上下文和再次请求，旧响应/旧finally不污染新上下文；B07关键异步和手动回归 |
| E08-11 | 生成/优化/取消/重生成全程不写知识与日志；新旧 Prompt 持久化/导出/统计正确 |
| E08-12 | 真实 Provider 成功与质量独立于fake标记；缺配置保留BLOCKED并完成其余实现/测试，不能称整批PASS |

对应 A44–A56/A60、R35–R39，推进 R34 AI来源和 A57/A61 子条件，不提前签B09全流程。

## 文件所有权与交接

你可修改本批新增 prompt-ai 模块/契约/规则/Schema/UI，`services/prompt/**`必要受控来源与提交幂等入口，`app/api.ts`、`app/App.tsx`、`app/pages/PromptLibraryPage.tsx`必要接线、prompt CSS、`server/index.ts`注册、B08自测、受影响既有 Prompt 测试、README本批运行说明。尽量新增组件，不整页重写Library/Raw/Wiki/Audit。不修改主 Agent 独立检查 `tests/acceptance/**`。

主 Agent 独占 status、B08任务卡、本交接、architecture/coordination/acceptance、历史报告、正式workspace。只有 `docs/reports/B08-build.md` 与 `B08-builder-*`施工证据归你。不覆盖已有独立报告，不降测试断言，不修改正式数据/密钥，不创建子 Agent。

执行独立自测构建 `npm run build` 和 `npm test`（Windows需要子进程权限时按工具规则申请）；测试前备份 `B04-http-evidence.json`、`B04-repair3-merge-payload.json` 到 B08-builder 目录，另存新生成输出后恢复原件。可针对新能力跑公开HTTP fake契约、磁盘、UI受控异步测试。没有真实浏览器则标NOT_RUN，主 Agent补操作。服务启动必须Windows hidden，结束仅关闭自己的PID，保留隔离fixtures。

报告必须记录：文件/接口/预算/数据结构，B08/E08自测逐项结果与路径，实际命令退出码/耗时，产品和修改测试文件SHA256清单、正式workspace/历史原件未变证据，真实Provider状态/限制、服务清理。子Agent token实数未提供则写不可得。最终交付“B08已完成施工，等待主Agent独立验收”，不要自动进入下一批。发现接口歧义及时向主Agent报告，继续不依赖答案的工作。
