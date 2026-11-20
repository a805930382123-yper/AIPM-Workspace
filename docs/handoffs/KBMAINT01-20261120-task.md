# KBMAINT01 知识库定时巡检与周计划扩展 任务卡

属于 [阶段 2 自动化路线图](../batches/AUTO-STAGE2-ROADMAP-20261120.md) 第一批。目标：为 RUN01 调度器补齐周计划能力，并将已交付的 **Wiki 结构检查（LINT01/02）** 与 **主动知识检查（LW03/KBI01）** 接入定时巡检，自动沉淀结构健康变化与待核知识问题，供用户按既有流程审查处理；绝不自动修改正式 Wiki。

## 评分与模式

需求明确度 1（巡检范围与默认节奏已冻结，个别细节由规划者定）/ 模块耦合 2（调度器计划类型、运行账本兼容、WikiLint、KnowledgeInspectionService、来源门禁、自动化页/知识库页/首页联动）/ 变更风险 2（调度器持久化兼容性、知识检查来源权限门禁、自动触发模型调用的计量与取消边界）/ 历史失败 0 = **5，B**：Astra Medium 规划与独立验收，Sol High 施工。

依赖：RUN01、LINT01、LINT02、KBI01（均已 PASS）。

## 已冻结的产品决定

1. **只发现与归档，绝不自动修库**：`wiki.lint` 只产出结构检查快照与增量对比；`wiki.inspect` 只产出检查记录与待核发现（`findings`），**不自动生成维护草稿**，也不调用任何正式 Wiki 写入。用户仍在既有 KBI01/LINT02 页面人工审阅、选择发现后显式生成草稿并确认入库。
2. **默认频率**：`wiki.lint` 默认每天 `08:00`（Asia/Shanghai，0 模型调用），默认启用；`wiki.inspect` 默认每周一 `08:30`（Asia/Shanghai，会调用模型），默认启用，受全局“暂停全部自动化”与单任务启用开关控制。
3. **自动选页受既有硬上限约束**：`wiki.inspect` 沿用既有 8 页 / 48,000 JSON 字符硬限制与 `assertWikiSourcesAllowed` 会议来源门禁，不放宽限制、不静默截断正文，未覆盖页在 `scope.gaps` 如实说明。
4. **周计划通用化**：`weekly` 计划作为 RUN01 调度器一等公民，供本批 `wiki.inspect` 与后续 REVIEW01 周报共用。

## 必做

**K1 调度器周计划扩展（`services/automation/schedule.ts`、`types.ts`、`scheduler.ts`）。**
- `AutomationPlan` 扩展为三种：
  - `{ kind: 'interval'; minutes: number }`（既有不变）
  - `{ kind: 'daily'; time: string; timezone: 'Asia/Shanghai' }`（既有不变）
  - `{ kind: 'weekly'; weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; time: string; timezone: 'Asia/Shanghai' }`（`1` = 周一 … `7` = 周日，`time` 为 `HH:mm`）。
- 完整实现 `isAutomationPlan`、`firstDueAfter`、`planWindow`、`samePlan` 对 `weekly` 的精确计算（上海时区跨周/跨月/跨年、同日未到点与已过点、补跑窗口恰好 7 天周期）。
- 既有仅含 `interval`/`daily` 的 `schedules.json` 必须无损可读；自动化页编辑计划表单新增「每周」选项（周几 + 时间）。

**K2 定时结构检查任务 `wiki.lint`（0 模型调用）。**
- 在调度器注册 `wiki.lint`（显示名：`知识库结构巡检`），默认 `{ kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' }`、`allowsCatchUp: true`、`mayCallModel: false`。
- 执行时调用既有 `WikiLint.inspect()`（复用 LINT01 的 11 种规则与行级定位），将快照原子写入 `state/automation/wiki-lint/<runId>.json`（含 `runId`、`checkedAt`、`total`、`byCode`、`findings` 及每条确定性指纹 `fingerprint`）。
- 与最近一次成功的 `wiki.lint` 快照做确定性 diff：计算 `addedCount`、`resolvedCount`、`unchangedCount` 及新增条目列表；首次运行时标为基线快照（`isBaseline: true`，不虚报“全部新增”或明确标注首次基线）。
- 步骤记录摘要写明总问题数、较上次新增/消除数及主要规则分布；运行账本 `artifacts` 记录 `lintSnapshotId`。
- 保留策略：保留最近 90 天或 200 份快照（取较多者），随账本清理；损坏快照不阻断新巡检，单条上报 `issues`。

**K3 定时主动知识检查任务 `wiki.inspect`（有界模型调用）。**
- 在调度器注册 `wiki.inspect`（显示名：`知识库主动巡检`），默认 `{ kind: 'weekly', weekday: 1, time: '08:30', timezone: 'Asia/Shanghai' }`、`allowsCatchUp: true`、`mayCallModel: true`。
- **确定性选页策略**（独立纯函数，易于单测）：
  1. 枚举正式非回收 Wiki 页，先过滤 `type !== 'source'`（聚焦主题页），并逐页校验 `assertWikiSourcesAllowed`（会议受限来源及缺失底源页直接跳过并记入步骤说明，绝不送模型）。
  2. 优先级排序：有派生快照且关联源页自上次检查后发生版本变化的页 → 上次主动检查以来新增或 `revision` 变化的主题页 → 最近更新的主题页（同优先级按 `updatedAt` 降序 + `id` 升序稳定排序）。
  3. 依次累加直至达到最多 **8 页**或 **48,000 JSON 字符**预算（与 `KnowledgeInspectionService` 上限一致）；不截断任何单页正文。
  4. 若没有任何合格可选主题页（例如空库、全部仅 Source 页、或全部受限/单页超限）：步骤明确记录原因后以 `succeeded` 结束，**0 模型调用**。
- 在 `AutomationContext` 中调用既有 `KnowledgeInspectionService.start({ requestId: randomUUID(), wikiIds, includeRelated: true })` 并等待完成（复用其完整严格 schema、精确原文引用校验、快照比较与历史指纹去重）；Provider 调用经 `meterAutomationProvider` 计入运行账本 `usage`。
- 取消边界：若调度器触发取消（用户点取消或进程停机），等待层响应 `AbortSignal` 并将运行记为 `cancelled`；不破坏正在持久化的检查记录。
- 运行结果写入步骤摘要（实读页数、跳过页数、新发现待核数、历史已处理复用数）及 `artifacts.inspectionIds`。若 Provider 未配置，明确失败并提示配置模型，不伪造空发现。

**K4 运行账本兼容与 API（`services/automation/ledger.ts`、`server/automation-api.ts`）。**
- `AutomationRun['artifacts']` 向后兼容扩展可选字段：`lintSnapshotId?: string`、`inspectionIds?: string[]`（旧运行记录不含这两项仍合法校验通过）。
- 新增只读 API：
  - `GET /api/automation/knowledge-health`：返回最新一次成功 `wiki.lint` 摘要（总数、较上次新增/消除、检查时间、`runId`）与最新一次成功 `wiki.inspect` 摘要（检查 ID、实读页数、待核发现数、检查时间），无历史时返回 `null`；同时返回读取异常 `issues`。
  - `GET /api/automation/wiki-lint/:snapshotId`：返回指定 Lint 快照及与前一次快照的 diff 详情。

**K5 UI 与导航联动（最小侵入，不破坏 UIFIX02/LINT02/KBI01 既有布局）。**
- **自动化页（`AutomationPage.tsx`）**：
  - 计划编辑弹窗支持 `weekly`（周几选择 + 上海时间）。
  - 新增「知识库巡检摘要」区：显示最新结构检查（总问题 / 较上次新增）与最新主动检查（待核发现数），提供「查看结构检查」直达知识库 Lint 视图、「查看主动检查」直达知识库主动检查视图（对应 KBI01/QAUI03 视图状态）。
  - 运行历史详情对 `wiki.lint` 展示新增/消除明细并可跳结构检查，对 `wiki.inspect` 展示发现摘要并可跳对应检查记录。
- **首页（`HomePage.tsx`）**：在既有自动化状态区或行动区增加只读轻提示（仅当最新 Lint 有新增问题或最新主动检查存在待核发现时显示，点击直达对应知识库视图；无异常时不增加视觉噪声）。

**K6 文档。** `docs/architecture.md` 新增 KBMAINT01 小节；`README.md` 自动化使用说明补充周计划与知识库定时巡检边界。

## 排除

- 不自动生成维护草稿、不自动修复 Lint 问题、不自动写入正式 Wiki 或 Raw。
- 不修改 LINT01 的 11 条规则定义、不修改 KBI01 的 8 页 / 48,000 字符上限与审查协议。
- 不做 Windows 桌面通知（属 WORKAUTO01）、不做周报草稿（属 REVIEW01）。
- 不修改工作区中其他未提交文件（如 `QuickCaptureDialog.tsx`、`RawOutcomeReview.tsx`、`app/b04.css`）。

## 文件所有权

施工：`services/automation/types.ts`、`services/automation/schedule.ts`、`services/automation/scheduler.ts`、`services/automation/ledger.ts`、`services/automation/tasks/wiki-lint.ts`、`services/automation/tasks/wiki-inspect.ts`、`services/automation/wiki-health.ts`、`server/automation-api.ts`、`server/index.ts`（装配两新任务与路由的最小改动）、`services/llm/knowledge-inspections.ts`（仅若需支持外部注入 metered provider/signal 时的最小无行为破坏调整）、`app/api.ts`、`app/pages/AutomationPage.tsx`、`app/automation.css`、`app/pages/HomePage.tsx`（最小只读轻提示）、`app/App.tsx`（直达知识库 Lint/主动检查视图的最小跳转参数）、`tests/kbmaint01*`、`docs/architecture.md`、`README.md`、KBMAINT01 施工报告。
验收：只写验收报告与验收脚本。主线程：status、提交推送与远程 CI 核验。

## 验收项

- **KBM-01 周计划语义（假时钟单测）**：`weekly` 校验正反例、周一至周日跨周/跨月/跨年、同日到点前/后、补跑一次、`catchUp: false` 不补、暂停记 `skipped`；旧 `schedules.json`（仅 `interval`/`daily`）加载后自动补注册两新任务且不改已有任务 revision/配置。
- **KBM-02 定时 Lint 与增量 diff**：连续两次 `wiki.lint` 运行，中间人为引入 1 个坏链并修复 1 个旧问题，确认第二次快照精确报 `addedCount=1`、`resolvedCount=1`；0 模型调用；正式 Wiki 文件 SHA 100% 不变；快照损坏不阻断下次巡检；`backup_workspace` 导出/恢复包含快照且校验通过。
- **KBM-03 定时主动检查选页与门禁**：单测验证优先级排序、8 页与 48,000 字符硬上限、会议受限来源（`meeting_local_only`）被跳过且绝不进入发给 Provider 的 payload；空库/无合格页时 0 调用成功；fake Provider 下完成端到端运行并正确记录 `usage` 与 `artifacts.inspectionIds`；取消信号正确中止运行；运行结束后 `drafts/` 与正式 `wiki/` 均无新增写入，自动化上下文调用正式 Wiki 写入仍被 `403` 拒绝。
- **KBM-04 真实 Provider 验证（隔离 TEMP 数据根）**：至少准备 3–4 篇合成主题 Wiki（含明确可对比冲突/重复样例），手动或定时触发一次真实 `wiki.inspect`（如实记账请求数/token/未知用量，失败不盲目重试），验证产出的 `KnowledgeInspection` 可在知识库主动检查视图打开、引用可回跳，正式 Wiki 文件 SHA 不变、草稿新增 0。
- **KBM-05 真实浏览器 UI（1440px 与 390px）**：在隔离生产构建中验证编辑 `weekly` 计划、立即运行 `wiki.lint` 与 `wiki.inspect`、查看知识库巡检摘要与运行详情、从自动化页与首页轻提示分别直达知识库「结构检查」与「主动检查」视图；无水平溢出、控制台 0 报错、截图存证。
- **KBM-06 全量回归与远程 CI**：`npm run check`、既有回放评估（`standard-extract` / `news-relevance`）与推送后 GitHub Actions Windows Node 22/24 CI 全部通过。

## 需用户决定（施工中遇到再问，不阻塞开工）

- `wiki.inspect` 在大知识库（>8 页）下是否需要后续支持“轮转游标”逐周扫完整个库（本批按上述优先级每轮选最需检查的 8 页，如需轮转可留到后续优化）。

## 规划补充

2026-11-20，规划批准 K1–K6，沿用本卡的文件所有权和 KBM-01–06。实现和验收按以下口径进行。

- K1 上海时间恰好到点时，`firstDueAfter` 返回下周同一时间。离线跨越多个周期时按最新窗口补跑一次。加载旧配置后对比已有计划的 revision、开关和时间。
- K2 用相邻成功且可读的快照做差集；坏快照单列读取问题。保留范围为近 90 天的全部快照和最近 200 份快照的并集。基线、增一消一、只读文件哈希和备份恢复分别验证。
- K3 对完整 Wiki 页数组按 `JSON.stringify(pages).length` 计算预算，相关扩展计入同一额度。受限页和缺底源页的正文不得进入 Provider 请求。记录漏检原因；在隔离数据根核对实际请求、账本用量、取消结果及 Wiki 和草稿目录。`completed` 和 `partial` 都可归档，步骤说明实际覆盖范围；检查失败须传回运行账本。
- K4–K5 以成功运行的产物作为导航依据；最新待核数反映已保存的处理状态。用旧记录、空库、损坏产物及两个宽度的真实浏览器验证摘要、明细、首页提示和指定检查记录的跳转。
- K6 核对使用说明和架构说明与实现一致。整批签收须有一次隔离真实 Provider 运行、回放评估、全量检查及推送后的两档 Windows CI 证据；缺失项单列。
