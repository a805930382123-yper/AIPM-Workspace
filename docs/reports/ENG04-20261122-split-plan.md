# ENG04 大文件拆分与前端状态治理方案（只出方案）

> 本文件仅作工程拆分与架构治理方案设计，**不在 ENG04 批次内实施代码拆分**。大文件拆分与前端状态治理须待用户另行授权后按对应批次执行。

## 1. 范围与基线统计（基于 Commit 2 `02ab4ca` 格式化后工作树）

在 ENG04 对 `app/`、`server/`、`services/` 全量格式化后，全部满足 **体积 ≥ `40 KiB`（`40,960 B`）** 或 **行数 > `800` 行** 的产品文件共 **26 份**（其中 ≥ `40 KiB` 共 **16 份**，`< 40 KiB` 但 > `800` 行共 **10 份**）。后端大文件共 **12 份**（集中于知识草稿/提交/工作流、会议存储、PDF 清理、LLM 任务与 Prompt/审计服务），前端文件共 **14 份**（13 个大页面/面板组件 + `app/api.ts`）。

| 分类 | 数量 | 代表红线风险 |
|---|---:|---|
| 后端数据完整性核心（事务 / 门禁 / 版本 / 原子写） | 5 | 涉及 Raw 不可改写、草稿审阅门禁、Wiki 事务提交与恢复、会议纪要/关联隔离 |
| 后端其余业务与 LLM 管道服务 | 7 | 涉及任务调度恢复、Prompt 契约校验、结构化抽取/问答/检查与审计 |
| 前端请求入口与大页面 / 状态重组件 | 14 | 单页多则 53 个 `useState`、手写世代 ref（触发 `react-hooks/refs` 告警）、手写 URL 清理 |

---

## 2. Agent Router 评分口径

沿用 [协作规则](../coordination.md#agent-router-现行规则) 与当前 `$agent-router` 四维评分（每维 0–2 分，总分 0–8 分）：

- **需求明确度（0–2）**：目标与验收清楚为 0，局部结构/拆分边界有待冻结为 1，核心目标不清为 2。
- **模块耦合度（0–2）**：单点独立为 0，涉及少量内部接口为 1，跨多模块或核心调用链为 2。
- **变更风险（0–2）**：易回退影响小为 0，影响主要功能为 1，涉及数据完整性/安全/权限/升级兼容为 2（且直接触发 **B 模式**）。
- **历史失败（0–2）**：无相关失败为 0，曾有一次有效失败为 1，同类核心问题修复后再次失败为 2。
- **模式映射**：0–1 分 A 轻量；2–4 分 A 标准（3–4 分需独立验收者先审计划）；5–8 分或涉数据完整性/安全/升级红线直接 **B 模式**。

---

## 3. 全量 26 份大文件拆分清单（按字节降序）

### 3.1 后端数据完整性核心（5 份，全部强制 B 模式，逐批独立交付）

| # | 文件路径 | 体积 / 行数 | 现有职责 | 建议拆分子模块边界 | 对外接口保持方式 | 现有测试覆盖（直接 / 关键集成） | 暂定评分（明/耦/险/史）与模式 |
|---|---|---|---|---|---|---|---|
| 1 | [drafts.ts](../../services/wiki/drafts.ts) | `96,459 B` / `2,232 L` | Raw/PDF/Question/Inspection 四类草稿存储、摘要校验（`contentDigest`/`outcomeDigest`）、`HumanReview` 迁移与审查门禁（`reviewOperation`/`reviewStructuredNote`/`prepareReviewedCommit`）、`DraftStore` 持久化与补丁编辑 | `draft-types.ts`（类型与 `DraftError`）、`draft-digest.ts`（摘要与 `derivedTakeaways`）、`draft-review.ts`（人工审查/字段归位/结构化笔记审核）、`draft-migration.ts`（`legacyReview`/`migratedReview` 与兼容性迁移）、`draft-store.ts`（`DraftStore` CRUD 与文件持久化） | 原 `services/wiki/drafts.ts` 作为稳定门面与桶导出文件，保留 `DraftStore` 与全部类型/错误/函数导出签名不变 | 31 份直接引用（`kb02-human-review.test.ts`、`kb03-confirm.test.ts`、`kb03-structured-note.test.ts`、`r1618-field-editing.test.ts` 等） | 1 / 2 / 2 / 2 = **7 分，B 模式** |
| 2 | [pdf-cleanup.ts](../../services/raw/pdf-cleanup.ts) | `75,570 B` / `1,544 L` | PDF 清理流水线（按页去留/合并、长 PDF 目录归组、主题摘要/呈现选择）、Wire Schema 校验、并发任务控制与断点状态保存（`PdfCleanupService`） | `pdf-cleanup-schemas.ts`（wire schema 与 `CleanupError`/字段校验）、`pdf-cleanup-prompts.ts`（各阶段 prompt 构造与受保护术语校验）、`pdf-cleanup-planner.ts`（分批、目录合并与展示校验纯函数）、`pdf-cleanup-service.ts`（`PdfCleanupService` 状态机与持久化） | `services/raw/pdf-cleanup.ts` 保留 `export class PdfCleanupService`，通过内部组合调用纯函数模块 | 1 份直接单测（`pdf-cleanup-structured.test.ts`）+ 6 份 HTTP/UI/预算相关测试（`pdf02-http.test.ts`、`pdf02-ui.test.tsx` 等） | 1 / 2 / 2 / 1 = **6 分，B 模式**（需先补纯函数单元边界测试再拆） |
| 3 | [knowledge-workflows.ts](../../services/wiki/knowledge-workflows.ts) | `72,653 B` / `1,533 L` | 知识更新/多源综合工作流（`createUpdate`/`createSynthesis`）、证据定位目录更新、人工审查门禁、合并确认（`confirmLocked`）与崩溃恢复（`reconcile`） | `workflow-types.ts`（`KnowledgeWorkflow` 类型与快照）、`workflow-evidence.ts`（`updateEvidenceDirectory`/`validateEvidence`/`assertUpdateTarget`）、`workflow-review.ts`（`workflowReview`/`reviewOperation`）、`workflow-commit.ts`（`confirmLocked`/`execute`/`reconcile`） | `services/wiki/knowledge-workflows.ts` 保留 `KnowledgeWorkflow` 与 `KnowledgeWorkflowStore` 对外方法与返回契约不变 | 13 份直接引用（`b05.test.ts`、`b09-template-update.test.ts`、`kb02-final-agreement.test.ts`、`kb03-structured-note.test.ts` 等） | 1 / 2 / 2 / 2 = **7 分，B 模式** |
| 4 | [commits.ts](../../services/wiki/commits.ts) | `68,002 B` / `1,530 L` | 正式 Wiki 事务性提交编排（`confirm`/`confirmQuestion`）、维护草稿冻结（`freezeMaintenance`）、冲突检查、原子落盘（`execute`/`ensurePage`）、`scanWikiCommits` 与启动恢复（`reconcile`） | `commit-types.ts`（Manifest 类型、`CommitError`、`scanWikiCommits`、`pendingRawCommit`）、`commit-freeze.ts`（`payloadDigest`/`sourceBodyFor`/`freeze`/`freezeMaintenance`/`checkConflicts`）、`commit-executor.ts`（`execute`/`ensurePage`/`reconcile`）、`commit-service.ts`（`WikiCommitService` 协调入口） | `services/wiki/commits.ts` 保留全部导出类型、辅助函数及 `WikiCommitService` 方法签名 | 22 份直接引用（`kb03-confirm.test.ts`、`llm-flow.test.ts`、`lw01-recovery.test.ts`、`r1618-auto-fields.test.ts` 等） | 1 / 2 / 2 / 2 = **7 分，B 模式** |
| 5 | [store.ts (meeting)](../../services/meeting/store.ts) | `64,695 B` / `1,410 L` | 会议目录与记录验证器（14 个 `valid*` 函数）、会议 CRUD、保密策略更新、本地纪要导入/工作副本编辑/备份恢复与 Raw 登记关联状态机 | `meeting-validators.ts`（`canonical`/`digest`/`validMeeting`/`validMinute`/`validRawLink` 等纯校验函数）、`meeting-catalog.ts`（目录读取/校验）、`meeting-minutes.ts`（纪要导入/编辑/版本维护）、`meeting-raw-links.ts`（Raw 登记/解除关联事务）、`store.ts`（`MeetingStore` 门面） | `services/meeting/store.ts` 保留 `MeetingStore` 类及全部公共方法签名不变 | 4 份直接测试（`meeting.test.ts`、`meeting-minutes.test.ts`、`meeting-raw-m04.test.ts`、`MEETING-INPUT-20261030.test.ts`）+ 会议 UI/备份测试 | 1 / 2 / 2 / 1 = **6 分，B 模式** |

### 3.2 后端其余业务与 LLM 管道服务（7 份）

| # | 文件路径 | 体积 / 行数 | 现有职责 | 建议拆分子模块边界 | 对外接口保持方式 | 现有测试覆盖 | 暂定评分（明/耦/险/史）与模式 |
|---|---|---|---|---|---|---|---|
| 6 | [jobs.ts](../../services/llm/jobs.ts) | `58,401 B` / `1,394 L` | 抽取作业存储（`ExtractionJobStore`）、密钥泄漏检测（`findSecretHits`）、作业运行与中断/结算恢复（`ExtractionRunner`、`persistSettlement`、`reconcileStorage`、`reconcile`） | `job-store.ts`（`ExtractionJobStore`、`validStoredJob`、`JobError`）、`job-settlement.ts`（`validateSettlement`/`persistSettlement`/`reconcileStorage`）、`job-runner.ts`（`ExtractionRunner`、`prepareChange`/`start`/`cancel`/`reconcile`） | `services/llm/jobs.ts` 统一 re-export `ExtractionJobStore`、`ExtractionRunner`、`findSecretHits` 等全部导出 | 16 份直接引用（`kb02-storage-recovery.test.ts`、`kb02-job-file-access.test.ts`、`llm-repair*.test.ts` 等） | 1 / 2 / 2 / 2 = **7 分，B 模式** |
| 7 | [service.ts (prompt-ai)](../../services/prompt-ai/service.ts) | `57,668 B` / `1,468 L` | Prompt 模板与质检规则常量（`TEMPLATES`/`CHECKS`/`BUDGETS`）、契约与草稿校验器（`validStoredDraft` 等）、AI 生成与优化流水线（`brief`/`generate`/`check`/`rewrite`/`optimize`/`confirm`） | `prompt-ai-contracts.ts`（`TEMPLATES`/`CHECKS`/`BUDGETS`/schema 与 `assertContract`）、`prompt-ai-validators.ts`（`validStoredDraft`/`validPromptPreview`/`validReceipt` 等）、`prompt-ai-service.ts`（`PromptAiService`） | `services/prompt-ai/service.ts` 保留全部导出常量、校验函数与 `PromptAiService` 类 | 5 份直接测试（`prompt-ai.test.ts`、`lifeos-l4-flow.test.ts`、`security-output-sec.test.ts` 等）+ HTTP 集成测试 | 1 / 1 / 1 / 1 = **4 分，A 标准**（验收者先审计划） |
| 8 | [knowledge-extraction.ts](../../services/llm/knowledge-extraction.ts) | `42,529 B` / `778 L` | 标准知识抽取 2 阶段/多 chunk 管线（`runKnowledgePipeline`）、检查点完整性校验（`validateKnowledgeCheckpoint`）、`knowledgePlanCallMinimum` 与规划字段提示构造 | `extraction-checkpoint.ts`（`validateKnowledgeCheckpoint`、`knowledgePlanCallMinimum`）、`extraction-prompts.ts`（`sourceSummary`、`planningFieldInstruction` 与提示词常量）、`extraction-pipeline.ts`（`runKnowledgePipeline`） | `services/llm/knowledge-extraction.ts` 保持原 4 个导出符号签名与报错码不变（涉及 Eval 指纹，需严格隔离验证） | 16 份直接引用（`kb02-pipeline.test.ts`、`kb02-extraction-contract.test.ts`、`r22-source-level.test.ts` 等）+ `eval` 标准回放 | 1 / 2 / 2 / 1 = **6 分，B 模式** |
| 9 | [store.ts (prompt)](../../services/prompt/store.ts) | `38,761 B` / `930 L` | Prompt 模板库存储（`PromptStore`）、版本历史快照、Wiki 关联校验与回收站恢复、分类统计与搜索过滤 | `prompt-validators.ts`（`isPromptShape`/`isVersionShape`/`isRecord`/`buildPrompt`）、`prompt-wiki-links.ts`（关联 Wiki 状态与写保护校验）、`store.ts`（`PromptStore`、`countActivePrompts`） | `services/prompt/store.ts` 保持 `PromptStore`、`countActivePrompts` 及全部类型导出不变 | 11 份直接引用（`prompt.test.ts`、`lifeos-l4-flow.test.ts`、`lifeos-l5-backup.test.ts`、`pipe01.test.ts` 等） | 1 / 1 / 2 / 0 = **4 分，B 模式**（涉持久化与版本不可变） |
| 10 | [service.ts (audit)](../../services/audit/service.ts) | `35,021 B` / `850 L` | 知识纠错与审计（`AuditService`）、文本锚点定位（`locateAnchor`）、AI 纠错提议与校验（`propose`/`validateAuditDraft`）、决议应用与事务对账（`resolve`/`reconcile`） | `audit-anchor.ts`（`locateAnchor` 与锚点哈希工具）、`audit-draft.ts`（`validateAuditDraft` 与 `propose`）、`audit-resolve.ts`（`resolve`/`reconcile` 写入逻辑）、`service.ts`（`AuditService`） | `services/audit/service.ts` 保留 `AuditService`、`locateAnchor`、`validateAuditDraft`、`AuditError` 与类型导出 | 4 份直接引用（`audit.test.ts`、`audit-secret-integrity.test.ts`、`kbmaint01.test.ts`、`meeting-raw-m04.test.ts`） | 1 / 2 / 2 / 1 = **6 分，B 模式** |
| 11 | [knowledge-answers.ts](../../services/llm/knowledge-answers.ts) | `34,780 B` / `823 L` | 知识库问答调度与引用追踪（`KnowledgeAnswerService.ask`/`citation`）、问答草稿保存（`save`）、提交状态回写（`markAnswerCommitted`）与输入校验（`verifyQuestionInput`） | `answer-validators.ts`（`validAnswer`/`questionHash`/`verifyQuestionInput`）、`answer-service.ts`（`ask`/`citation`）、`answer-save.ts`（`save`/`markAnswerCommitted`） | `services/llm/knowledge-answers.ts` 保持原导出函数/类/错误类型不变 | 1 份测试夹具直接引用（`lw02-fixture.ts`，驱动 `lw02-boundaries.test.ts` 与 `lw02-main.test.ts`） | 1 / 1 / 2 / 1 = **5 分，B 模式** |
| 12 | [knowledge-inspections.ts](../../services/llm/knowledge-inspections.ts) | `33,429 B` / `801 L` | 主动知识检查扫描（`KnowledgeInspectionService.start`）、引用定位（`cite`）、问题判定与维护草稿转出（`decision`/`draft`） | `inspection-types.ts`（`KnowledgeInspection` 与校验器）、`inspection-analyzer.ts`（`analyze`/`cite`）、`inspection-service.ts`（`KnowledgeInspectionService`） | `services/llm/knowledge-inspections.ts` 保持 `KnowledgeInspection` 与 `KnowledgeInspectionService` 不变 | 4 份直接引用（`kbmaint01.test.ts`、`lw03-core.test.ts`、`lw03-fixture.ts`、`review01.test.ts`） | 1 / 1 / 2 / 1 = **5 分，B 模式** |

### 3.3 前端请求层、页面与大型交互面板（14 份）

| # | 文件路径 | 体积 / 行数 | 状态钩子数（State / Ref / Effect） | 现有职责 | 建议拆分子模块边界 | 对外接口保持方式 | 现有测试覆盖 | 暂定评分（明/耦/险/史）与模式 |
|---|---|---|---|---|---|---|---|---|
| 13 | [RawPage.tsx](../../app/pages/RawPage.tsx) | `93,076 B` / `2,457 L` | `53` / `9` / `12` | Raw 列表筛选、多源综合弹窗（`SynthesisDialog`）、详情阅读/引用高亮/AI 状态/翻译视图（`RawDetail`）、正文编辑与历史版本（`RawBodyEditor`/`RawBodyHistory`）、多通道导入（`ImportDialog`、`ResultPanel`/`PartialPanel`）、删除确认（`DeleteDialog`） | `raw/useRawSelection.ts`、`raw/SynthesisDialog.tsx`、`raw/RawDetail.tsx`、`raw/RawBodyEditor.tsx`、`raw/ImportDialog.tsx`、`raw/DeleteDialog.tsx`、`RawPage.tsx`（壳与组合） | `app/pages/RawPage.tsx` 保持 `RawPage`、`ImportDialog`、`DeleteDialog` 导出签名不变 | 15 份直接 UI 测试（`kb02-storage-ui.test.tsx`、`pdf01-ui.test.tsx`、`rawurl01-ui.test.tsx`、`rawzh01-ui.test.tsx` 等） | 1 / 2 / 1 / 1 = **5 分，B 模式** |
| 14 | [WikiPage.tsx](../../app/pages/WikiPage.tsx) | `71,685 B` / `1,935 L` | `46` / `11` / `19` | Wiki 分类/搜索/筛选、详情阅读、编辑/新建表单（`WikiEditor`）、删除确认（`WikiDeleteDialog`）、纠错审计面板（`AuditPanel`）、整合提问/检查/Lint 视图切换 | `wiki/useWikiWorkspace.ts`、`wiki/WikiEditor.tsx`、`wiki/WikiDetail.tsx`、`wiki/WikiDeleteDialog.tsx`、`wiki/AuditPanel.tsx`、`WikiPage.tsx` | `app/pages/WikiPage.tsx` 保持 `WikiCheckEntry`、`WikiPage` 导出不变 | 3 份直接 UI 测试（`wiki-selection.test.tsx`、`uifix01-ui.test.tsx`、`uifix04-ui.test.tsx`）+ `app-navigation` 等间接 | 1 / 2 / 1 / 1 = **5 分，B 模式** |
| 15 | [DraftReviewPage.tsx](../../app/pages/DraftReviewPage.tsx) | `60,589 B` / `1,515 L` | `16` / `1` / `3` | 草稿摘要/来源编辑、字段归位编辑器（`TemplateFieldsEditor`）、重名候选检测、逐页审查与确认写入进度轮询（`DraftReviewPage`） | `draft-review/TemplateFieldsEditor.tsx`、`draft-review/useDraftReviewState.ts`、`draft-review/DuplicateCheckSection.tsx`、`DraftReviewPage.tsx` | `app/pages/DraftReviewPage.tsx` 保持 `DraftReviewPage` props 与导出不变（同步修复第 268 行 `duplicateInput` 声明顺序） | 6 份直接 UI 测试（`kb02-human-ui.test.tsx`、`kb03-confirm-ui.test.tsx`、`r13-merge-ui.test.tsx`、`ui-b04.test.tsx` 等） | 1 / 2 / 1 / 1 = **5 分，B 模式** |
| 16 | [PromptLibraryPage.tsx](../../app/pages/PromptLibraryPage.tsx) | `55,963 B` / `1,479 L` | `26` / `12` / `5` | 模板库筛选/版本管理/变量渲染/复制、Prompt 编辑器（`PromptEditor`）、删除弹窗（`PromptDeleteDialog`）、版本详情（`VersionDetail`）与生成器工作台切换 | `prompt/usePromptLibrary.ts`、`prompt/PromptEditor.tsx`、`prompt/VersionDetail.tsx`、`prompt/PromptDeleteDialog.tsx`、`PromptLibraryPage.tsx` | `app/pages/PromptLibraryPage.tsx` 保持 `PromptLibraryPage` 导出不变（同步治理 `startCreate` 与 `ref` 同步写法） | 3 份直接 UI 测试（`prompt-ui.test.tsx`、`uifix01-ui.test.tsx`、`uifix04-ui.test.tsx`） | 1 / 1 / 1 / 1 = **4 分，A 标准**（验收先审） |
| 17 | [RawOutcomeReview.tsx](../../app/pages/RawOutcomeReview.tsx) | `55,779 B` / `1,325 L` | `17` / `4` / `3` | 抽取结果（RawOutcome）预览、结构化笔记/PDF 摘录查看、维护主题勾选与局部恢复提示（`RawOutcomeReviewContent`） | `raw-outcome/useOutcomeReview.ts`、`raw-outcome/OutcomePreviewSection.tsx`、`RawOutcomeReview.tsx` | 保持 `RawOutcomeReview` 导出与 props 契约不变 | 5 份直接 UI 测试（`pdf02-ui.test.tsx`、`quickux01-ui.test.tsx`、`rawedit01-ui.test.tsx`、`uifix01-ui.test.tsx`、`uifix03-ui.test.tsx`） | 1 / 1 / 1 / 1 = **4 分，A 标准** |
| 18 | [api.ts](../../app/api.ts) | `53,563 B` / `1,385 L` | `0` / `0` / `0` | 全前端 HTTP 客户端基础（`ApiError`/`api`/`apiForm`）及 Raw/PDF/Meeting/Wiki/Automation/WorkItems/LLM/Draft/Workflow/Prompt 全部类型与请求函数（>150 导出） | 按业务域拆分 `app/api/client.ts`、`raw.ts`、`wiki.ts`、`meeting.ts`、`automation.ts`、`work-items.ts`、`prompt.ts`、`llm.ts` | `app/api.ts` 保留桶导出（`export * from './api/...'`），全部 33 个前端调用方与测试无需立即改导入路径 | 90+ 测试文件直接/间接引用（所有 HTTP 与 UI 测试基础依赖） | 0 / 2 / 1 / 0 = **3 分，A 标准**（验收先审，极佳前置基础设施批） |
| 19 | [WorkItemsPage.tsx](../../app/pages/WorkItemsPage.tsx) | `52,420 B` / `1,334 L` | `37` / `1` / `3` | 工作事项列表筛选、新建/编辑表单、详情面板（`WorkItemDetail`）、关联材料管理、本地截图上传与分析面板嵌入 | `work-items/WorkItemDetail.tsx`、`work-items/WorkItemForm.tsx`、`work-items/useWorkItemsState.ts`、`WorkItemsPage.tsx` | 保持 `workKindLabel`、`workStatusLabel`、`WorkItemsPage` 导出不变 | 1 份直接 UI 测试（`uifix03-ui.test.tsx`）+ 后端 `work01-http.test.ts`（拆前建议补列表/表单 UI 测试） | 1 / 1 / 1 / 0 = **3 分，A 标准**（验收先审） |
| 20 | [MeetingPage.tsx](../../app/pages/MeetingPage.tsx) | `50,852 B` / `1,357 L` | `36` / `9` / `2` | 会议 URL 筛选同步（`saveFilters`/`readFilters`）、列表与详情切换、会议编辑弹窗（`MeetingEditor`）、安全策略弹窗（`PolicyDialog`）、目录管理弹窗（`CatalogDialog`） | `meeting/meetingFilters.ts`、`meeting/MeetingEditor.tsx`、`meeting/PolicyDialog.tsx`、`meeting/CatalogDialog.tsx`、`MeetingPage.tsx` | 保持 `MeetingPage` 导出不变；统一收口 `modalEpoch` 等 token 传参以消除 render 期读 ref | 2 份直接 UI 测试（`meeting-ui.test.tsx`、`uifix04-ui.test.tsx`） | 1 / 1 / 1 / 0 = **3 分，A 标准**（验收先审） |
| 21 | [PromptAiWorkbench.tsx](../../app/pages/PromptAiWorkbench.tsx) | `39,907 B` / `1,039 L` | `27` / `4` / `2` | AI Prompt 生成与优化双工作台（brief 阶段、生成预览、检查项与改写预览、保存确认入库） | `prompt/usePromptWorkbench.ts`、`prompt/GeneratorWorkbench.tsx`、`prompt/OptimizerWorkbench.tsx`、`PromptAiWorkbench.tsx` | 保持 `PromptAiWorkbench` 导出与 props 契约不变 | 2 份直接 UI 测试（`lifeos-l4-guidance-ui.test.tsx`、`uifix04-ui.test.tsx`） | 1 / 1 / 1 / 0 = **3 分，A 标准** |
| 22 | [PeriodReview.tsx](../../app/components/PeriodReview.tsx) | `36,982 B` / `1,002 L` | `27` / `2` / `6` | 实时工作总结（`RealtimeReview`）、周报归档与 AI 生成/编辑/导出（`WeeklyReviewArchive`、`WeeklyReviewContent`、`FactSection`） | `review/RealtimeReview.tsx`、`review/WeeklyReviewArchive.tsx`、`review/WeeklyReviewContent.tsx`、`PeriodReview.tsx` | 保持 `PeriodReview` 导出与对外 props 不变 | 2 份直接 UI 测试（`lifeos-l6-review-ui.test.tsx`、`uifix02-ui.test.tsx`） | 1 / 1 / 1 / 0 = **3 分，A 标准** |
| 23 | [AutomationPage.tsx](../../app/pages/AutomationPage.tsx) | `34,785 B` / `953 L` | `38` / `3` / `10` | 自动化三 Tab 容器、状态/调度/健康度轮询（`poll` helper）、候选筛选与运行抽屉联动 | `automation/useAutomationPolling.ts`、`automation/AutomationSummaryBar.tsx`、`AutomationPage.tsx` | 保持 `AutomationPage` 导出不变 | 5 份直接 UI 测试（`autoux01-ui.test.tsx`、`autoux02-ui.test.tsx`、`pipe01-ui.test.tsx`、`run01-ui.test.tsx`、`uifix02-ui.test.tsx`） | 1 / 1 / 1 / 0 = **3 分，A 标准** |
| 24 | [WorkAnalysisPanel.tsx](../../app/pages/WorkAnalysisPanel.tsx) | `37,777 B` / `896 L` | `16` / `4` / `4` | 工作分析运行列表、上下文与主题拆解展示（`AnalysisContext`/`AnalysisThemes`）、工作依据审查面板（`WorkBasisReviewPanel`）、草稿暂存（`stageDraft`） | `work-items/WorkBasisReviewPanel.tsx`、`work-items/AnalysisThemes.tsx`、`WorkAnalysisPanel.tsx` | 保持 `WorkAnalysisPanel` 导出与在 `WorkItemsPage` 中的调用不变 | 0 份直接独立测试（随 `WorkItemsPage` 间接挂载，拆前需补独立组件单测） | 1 / 1 / 1 / 0 = **3 分，A 标准** |
| 25 | [InboxTab.tsx](../../app/components/automation/InboxTab.tsx) | `30,450 B` / `869 L` | `9` / `2` / `2` | 自动化收件箱双子区（`WorkRemindersPanel` 工作提醒 + `NewsInbox` 资讯候选漏斗与批量处置） | 拆为独立文件 `WorkRemindersPanel.tsx`、`NewsInboxPanel.tsx` 与轻量组合壳 `InboxTab.tsx` | 保持 `InboxTabProps`、`InboxTab` 导出不变 | 1 份 UI 测试直接提及（`uifix02-ui.test.tsx`）+ `autoux02-ui.test.tsx` 覆盖 | 0 / 1 / 1 / 0 = **2 分，A 标准** |
| 26 | [HomePage.tsx](../../app/pages/HomePage.tsx) | `32,328 B` / `838 L` | `19` / `1` / `6` | 首页工作台概览、代办行动列表、快速入口、集成 `PeriodReview` 周报入口与调度状态卡 | `home/useHomeDashboard.ts`、`home/ActionQueueSection.tsx`、`HomePage.tsx` | 保持 `HomePage` 导出不变 | 5 份直接 UI 测试（`homeui01-ui.test.tsx`、`lifeos-l3-home-ui.test.tsx`、`lifeos-l6-review-ui.test.tsx` 等） | 1 / 1 / 1 / 0 = **3 分，A 标准** |

---

## 4. 拆分顺序与推荐下一批启动候选

### 4.1 总体拆分顺序（先边界基础设施与低耦合组件，后数据完整性核心）

1. **波次 1 — 公共基础设施（先铺路、零业务行为风险）**：
   - `app/api.ts` 按域分拆 + 保持桶导出（3 分 A 标准，90+ 测试立即回归保护）；
   - 前端轻路由与请求世代隔离基础 Hook（详见第 5 节，同时消除 `react-hooks/refs` / `immutability` 告警）。
2. **波次 2 — 前端重页面逐页瘦身（以弹窗抽取 + 状态 Hook 降维为主）**：
   - 先拆测试充分的页面：`InboxTab.tsx`（2 分） / `MeetingPage.tsx`（3 分） / `PromptLibraryPage.tsx`（4 分） / `DraftReviewPage.tsx`（5 分）；
   - 再拆 `RawPage.tsx`（53 个 `useState`）、`WikiPage.tsx`（46 个 `useState`）、`WorkItemsPage.tsx`、`AutomationPage.tsx`（先补齐 `WorkAnalysisPanel` 与 `WorkItemsPage` 测试覆盖）。
3. **波次 3 — 后端高风险数据完整性核心（必须逐文件独立批次、全 B 模式）**：
   - 推荐顺序：`services/wiki/commits.ts`（7 分 B） → `services/wiki/drafts.ts`（7 分 B） → `services/wiki/knowledge-workflows.ts`（7 分 B） → `services/meeting/store.ts`（6 分 B） → `services/raw/pdf-cleanup.ts`（6 分 B，先补纯校验/分批单测再拆）；
   - 原因：`commits.ts`、`drafts.ts`、`knowledge-workflows.ts` 互相强耦合，拆开时**严禁在同一批次并行修改其中两份以上**，每次只拆 1 份并通过全量 `npm run check` + 崩溃恢复/并发冲突回归测试后方可推进下一份。
4. **波次 4 — 其余后端 LLM 与存储服务**：
   - `services/llm/jobs.ts`（7 分 B） → `services/audit/service.ts`（6 分 B） → `services/llm/knowledge-extraction.ts`（6 分 B，需带 3 条 `eval` 对比） → `services/llm/knowledge-answers.ts` / `knowledge-inspections.ts`（5 分 B） → `services/prompt/store.ts`（4 分 B） / `services/prompt-ai/service.ts`（4 分 A 标准）。

### 4.2 推荐的下一批启动候选与评分

建议向用户提出以下**首选下一批（波次 1A）**，与一个**备选后端启动批（波次 3A）**供授权决策：

- **首选推荐：FE01 前端公共路由、`app/api.ts` 按域拆分与异步请求代次 Hook 建设**
  - **暂定评分**：需求明确度 `1` + 模块耦合度 `2`（覆盖 `App.tsx` 与多页面请求层） + 变更风险 `1`（纯内部架构重构、保持 `app/api.ts` 桶导出与既有 URL 参数兼容） + 历史失败 `0` = **4 分（A 标准，独立验收者先审计划）**。
  - **理由**：直接解除 `App.tsx` / `MeetingPage.tsx` / `WikiQuestionPanel.tsx` / `DraftReviewPage.tsx` / `PromptLibraryPage.tsx` 在 ENG04 ESLint 中暴露的 `react-hooks/refs` 与 `immutability` 疑似缺陷，且零后端存储落盘风险，可为后续拆解 `RawPage.tsx`、`WikiPage.tsx` 等 14 份前端文件提供统一 Hook 与路由基础设施。
- **备选（若优先治理后端核心体积）：BE01 拆分 `services/wiki/commits.ts`**
  - **暂定评分**：需求明确度 `1` + 模块耦合度 `2` + 变更风险 `2`（事务提交、重启恢复与并发锁） + 历史失败 `2` = **7 分（B 模式）**。
  - **理由**：已有 22 份测试直接覆盖原子提交与崩溃恢复，可作为 B 模式核心拆分的样板批次。

---

## 5. 前端状态治理专题方案

### 5.1 URL 状态与轻量路由方案（替代 `App.tsx` 手写 `page` 状态与分散 URL 清理）

- **现状问题**：
  - [App.tsx](../../app/App.tsx) 第 23、33、38、188–206 行用 `useState<Page>('home')` 手动切换页面，并在 `nav()` 内硬编码 `MEETING_QUERY_KEYS = ['meeting', 'mq', 'mt', 'mg', 'mc', 'mp', 'ml', 'mo']` 逐个删除会议页查询参数；
  - [MeetingPage.tsx](../../app/pages/MeetingPage.tsx) 第 43–57 行又独立调用 `history.pushState`/`replaceState` 与 `window.addEventListener('popstate', ...)`；跨页跳转仅靠内存态 state（刷新丢失当前页面及选中实体，浏览器前进/后退仅局部有效）。
- **设计方案（零三方路由库，保持包体与测试环境轻量）**：
  1. 新建 `app/router/routes.ts`：定义声明式路由表与参数白名单（每个 `Page` 声明自己拥有的 query keys，例如 `meeting` 拥有 `meeting/mq/mt/...`，`raw` 可选拥有 `raw`，`wiki` 可选拥有 `wiki`）。
  2. 新建 `app/router/useAppRoute.ts`：封装 `parseLocation(location)`、`navigate(route, { replace })` 与统一 `popstate` 订阅；离开某页面时**依据路由表声明自动清理旧页面私有 query keys**，不再由 `App.tsx` 硬编码 `MEETING_QUERY_KEYS`。
  3. 测试兼容：在 JSDOM 测试（如 `tests/app-navigation.test.tsx`、`tests/app-m05-raw-navigation.test.tsx`）中继续通过 `window.location` 与 `history` 工作，不引入破坏现有测试挂载方式的 BrowserRouter 上下文强依赖。

### 5.2 请求缓存与过期响应隔离方案（替代手写世代 ref，消除 `react-hooks/refs` 隐患）

- **现状问题**：
  - 各页面重复编写了十余套手工世代 ref 计数器和响应丢弃逻辑（例如 `App.tsx` 的 `refreshGeneration`/`rawSelectionGeneration`/`pageGeneration`、`WikiPage.tsx` 的 `selectionEpoch`、`MeetingPage.tsx` 的 `epoch`/`detailEpoch`/`modalEpoch`、`PromptLibraryPage.tsx` 的 `selectionVersion`/`listRequest`/`historyRequest`/`renderRequest`、`WikiQuestionPanel.tsx` 的 `askedId`/`generation`）。
  - 其中部分模块在 JSX render 阶段直接读取 `ref.current` 作为 `key` 或 prop 传递（如 `App.tsx:529, 567, 568, 588`、`MeetingPage.tsx:612, 633, 643`、`WikiQuestionPanel.tsx:200, 220, 388`），被 ESLint v7 React Compiler 规则标记为 `react-hooks/refs` 与 `react-hooks/set-state-in-effect`。
- **设计方案**：
  1. 新建 `app/hooks/useLatestAsync.ts`（写/动作防重入与过期丢弃）：内部用 `AbortController` + 递增 `requestId` 在异步 `run(async (signal) => ...)` 内校验是否为最新请求并透传 `signal` 给 `fetch`；**`requestId` 不暴露给 render，仅返回受控 state（`loading`/`error`/`data`）**。
  2. 新建 `app/hooks/useScopedQuery.ts`（读请求作用域缓存与竞态隔离）：以 `scopeKey`（如 `[page, selectedId, reloadToken]`）驱动 `useEffect` 拉取与 `AbortController` 取消；支持可选 SWR 级内存缓存（键包含 `scopeKey`，变更写操作后通过 `invalidateQueries(prefix)` 主动失效）。
  3. 弹窗/会话隔离代币改用 `useState` 递增计数器（如 `const [dialogSessionId, setDialogSessionId] = useState(0)`）或 React `key`（如 `<MeetingEditor key={editorKey} ... />`），彻底消除在 JSX render 阶段读取 `modalEpoch.current` / `pageGeneration.current` 的做法。

### 5.3 大页面拆分为自定义 Hook 与 `useReducer` 的实施路径、风险与验证

- **拆分层级（以 `RawPage` 53 个 `useState`、`WikiPage` 46 个 `useState`、`AutomationPage` 38 个 `useState`、`WorkItemsPage` 37 个 `useState` 为重点）**：
  1. **状态归组进 `useReducer`**：将强关联的加载/错误/筛选/表单状态合并为有限状态机（如 `RawDetail` 详情读取态 + 编辑草稿态 + AI 提取弹窗态；`PromptLibraryPage` 列表查询态 + 详情/版本态 + 表单新建/编辑态），用纯函数 `reducer` 替代十余个分散 `setXxx()`，防止遗漏重置字段。
  2. **独立弹窗拆出单文件**：如 `RawPage.tsx` 中的 `ImportDialog` / `DeleteDialog` / `SynthesisDialog` / `RawBodyEditor`、`MeetingPage.tsx` 中的 `MeetingEditor` / `PolicyDialog` / `CatalogDialog`、`WikiPage.tsx` 中的 `AuditPanel` / `WikiEditor`，各自持有局部表单状态并通过 `key` 重置（替代 `useEffect` 内批量 `setState`）。
  3. **自定义 Hook 封装副作用**：列表轮询（`AutomationPage`、`App` job polling）、快捷键监听（`Alt+N`、`Ctrl/Cmd+Enter`）、焦点恢复（复用已有 `useDialogFocus`）抽成独立 Hook。
- **迁移风险与控制**：
  - **风险 1（竞态回归）**：原有世代 ref 承担着防止 A→B→A 切回时旧响应覆盖新选中的职责（参见 `tests/wiki-selection.test.tsx` 与 `tests/app-navigation.test.tsx`）。**控制**：每个页面的 `useReducer` 必须显式在 `action` 中携带请求发起时的 `selectedId` / `requestToken` 并在 `dispatch` 前校验。
  - **风险 2（脏编辑防丢）**：`RawPage`、`WikiPage`、`DraftReviewPage`、`WorkItemsPage` 均有未保存编辑拦截。**控制**：在 reducer 中保留单一衍生标记 `isDirty` 或显式编辑态分支，不在多个 `useState` 间同步维护两份副本。
  - **验证门禁**：每页拆分必须覆盖其对应 UI 竞态与交互测试（`wiki-selection.test.tsx`、`app-navigation.test.tsx`、`prompt-ui.test.tsx`、`meeting-ui.test.tsx`、`uifix01~04-ui.test.tsx`、`npm run lint` 核实 `react-hooks/*` 告警严格下降且无新增 `error`、`npm run build` 生产预览无控制台错误）。
