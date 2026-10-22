# KB02 两项测试异常：修复方案与最小验证

本轮范围是形成修复方案，并在隔离副本中验证关键机制；正式产品和原默认测试保持冻结。施工试验由实际指定的 `gpt-6.1-sol / high` 完成，不替代用户新窗口的 Astra 独立批次审查。

## 修复判断

优先修复“存储失败后错误被吞没、后台已结束却仍显示运行”的缺口，再补测试现场。不修改累计预算公式、调用次数上限、Q02 分类提示、严格 schema 或 Provider 策略。

此前已验证：持续拒绝终态 job 的原子 rename，会留下磁盘 `running`；成功规划、创建草稿后的 done checkpoint rename 失败，会被归为 `LLM_INTERNAL_ERROR`。两种机制可以分别产生等待超时和 `failed !== completed`。历史失败日志没有保留当时 job/checkpoint 快照，故不能把历史两次失败的具体 I/O 点、系统进程或 Node 版本认定为已查明。

诊断依据：[既有定位报告](KB02-BUDGET-DIAG-20261020-review.md)。

## 施工分三步

### 1. 保存能区分原因的测试现场

改进 `tests/kb02-planning-budget.test.ts` 的等待和失败信息：使用单调截止时间，失败时先记录安全的 job 状态/error、checkpoint 阶段/attempts/诊断是否存在、Raw 状态、fake 请求数及 Node 版本，再收尾后台任务和清理临时目录。重规划前明确断言上一轮确为覆盖失败，而不是把存储错误当成资格错误。

保留全部原业务断言：最后一次规划必须 completed、累计六次、同 job 和成功提取块复用、耗尽后立即 409、原诊断与三个文件字节不变、Provider 增量为零。不得以扩大超时、跳过、重跑至绿或接受 failed 来替代修复。

### 2. 让存储失败可见，并提供只落盘的恢复

主要责任放在 `ExtractionRunner` 内部，外部只增加“读取执行及恢复状态”和“显式对账”两个窄入口；`ExtractionJobStore.get` 继续表示真实磁盘记录。

建议读取结果分开表达：

```text
job: 磁盘上最后成功保存的记录
execution: running / settled
recovery: 可选的安全存储错误、失败阶段、persisted:false、可用恢复动作
```

这样既不会把后台已停止当成仍在计算，也不会把内存状态冒充已持久化终态。

- 在存储操作处将受支持的文件错误转换为安全的 `STORAGE_WRITE_FAILED`，记录操作阶段及受控 errno；对外不返回绝对路径、原始系统错误文本、正文或密钥。影响面优先限制在本执行链；若改公共原子写入助手，要补其他调用者的兼容检查。
- 跟踪后台 Promise 的结束和关键收尾结果，替换终态写入及外层空 catch。进度写入失败至少有记录，迟到的进度不能覆盖终态或清除恢复问题。
- 保留最后成功文件；恢复问题持续存在时阻止同 Raw 再次启动模型任务，包含显式 restart。不能在存储问题尚未解决时静默重复生成。
- 对账进入既有串行启动队列，确认任务已结束后重试必要的 checkpoint、Raw 状态、job 终态写入；全部完成才清除恢复问题。若中途再次失败，保留可重试状态，不返回完成。
- 已有合法草稿时核验其 Raw/job 绑定并复用，按 checkpoint → Raw 状态 → job 终态完成对账，不重复创建草稿或调用模型。累计 attempts/callCount 不回退；原业务覆盖错误及诊断保留。
- 现有 `startOnce` 先返回 `processing + running`，后查草稿恢复。正式集成必须优先识别实际执行是否结束及待对账状态，否则原有草稿恢复入口仍可能被旧 running 挡住。
- 内存恢复记录必须有容量限制，不能静默淘汰尚未恢复的问题；达到容量上限时限制新增任务并给出明确提示。保存待写 checkpoint 仍应遵守现有字节上限与秘密检查。

进程重启后不能依赖内存恢复记录。启动对账需先查验持久化 checkpoint、草稿和对应任务，再决定恢复完成或标记中断；不能无条件将已有草稿描述为“未生成草稿”。如果未成功保存的诊断已随进程丢失，应明确告知不可恢复，不编造诊断，也不暗中再调用 Provider。

### 3. 接通 HTTP 与界面后再做完整工程验证

正式集成需调整 `server/llm-api.ts` 的 job 读取与 `jobView` 白名单、`app/api.ts` 类型，以及 `app/App.tsx` / `app/pages/RawPage.tsx` 的轮询和操作入口。仅后端添加字段不会自动显示：当前界面以磁盘 job.status 决定轮询，以 Raw 状态决定按钮。

界面应明确显示“任务已停止，状态保存失败”，提供“重试保存状态”，说明该动作不会重新调用模型。存储问题期间禁用继续提取、重新规划和重新生成；成功对账后才允许审核草稿或执行原有后续动作。继续保留正常导航、取消及过期请求隔离。

## 最小验证与完整修复的界限

最小试验使用同一份真实 runner/store 代码的原版与修改版副本，针对终态 job、done checkpoint、覆盖诊断 checkpoint 的持续 rename 拒绝做对照。故障必须经过原有原子写入和有界重试，不能只 mock 一个返回值。

要求验证：故障可读、后台已结束、失败 rename 不破坏原目标文件；故障解除后只对账，Provider 增量零、累计次数不回退、已有草稿不重复；正常模式原两项预算测试不变并通过。

本试验不接正式 HTTP/UI，不证明界面恢复、重启、取消竞态、容量上限或原机器 Node 24.20.0 已验证。后续生产集成仍须补短暂/持续故障回归、HTTP/UI、重启与取消、默认并行完整副本测试及构建；原环境复验保留失败快照。已有文件重试合计等待约 300ms，暂不盲目延长全局重试。

## 本次实测结果

Sol High 在原版与修改版两个隔离副本完成了真实存储链路对照，Node v25.2.1，八个验证子进程合计约 8.1 秒。修改仅在副本 `services/storage/files.ts` 和 `services/llm/jobs.ts`；原两项预算测试逐字节复制，未改断言。

| 场景 | 原版观察 | 修改版及解除故障后的结果 |
|---|---|---|
| 终态 failed-job rename 持续拒绝 | 后台结束，磁盘 job 仍 running | `settled:true`，明确 `STORAGE_WRITE_FAILED / persisted:false`；对账后 failed，原覆盖错误及 missing `f-c1-2` 保留；调用 2→2 |
| 已创建草稿后的 done checkpoint rename 持续拒绝 | failed / LLM_INTERNAL_ERROR，调用已为 6，已有一个草稿 | 明确存储故障；对账后 completed、Raw pending_confirmation，仍是原草稿 ID；调用 6→6 |
| 覆盖诊断 checkpoint rename 持续拒绝 | 磁盘诊断缺失，后续 planningRetry 资格 409 | 对账原待保存诊断后 failed / LLM_PLAN_COVERAGE_INVALID；missing `f-c1-2` 恢复；调用 2→2 |

三个修改版场景还逐项通过以下断言：

- 初次写入失败及故障持续时再次显式对账，均经过真实原子 helper 的六次 rename 拒绝；失败目标文件前后 SHA256 一致。
- 普通启动被 `STORAGE_RECONCILE_REQUIRED` 拒绝；恢复故障仍存在时明确失败，恢复标识保留，模型调用不增加。
- 故障解除后 attempts 不回退、成功提取块不变、草稿 ID 集合不变；再次对账三个状态文件 SHA256 不变，模型调用不增加。
- `readJob` 返回真实磁盘记录与单独的恢复信息，恢复信息不含夹具绝对路径。

正常模式原预算测试 **2/2、0skip**；副本 `jobs.ts` 及依赖的严格 TypeScript 检查通过。三个原版检查标为 `KNOWN_BAD_BEHAVIOR_REPRODUCED`，只是成功观察到缺陷，不是原产品通过故障测试。

父协调核对了实际 JSON、原预算日志和类型检查退出码；不以施工验证签独立验收。97 个产品文件和 62 个默认测试冻结条目的首尾指纹一致，`sourceChanges=[]`。真实 Provider 新增 0 次。

首次默认 sandbox 执行中，八个子进程均因 tsx 初始化 `uv_os_get_passwd ENOMEM` 在进入产品前退出；首败时间戳 `2026-10-19T16-16-47-589Z` 完整保留。随后同一窄脚本获额外执行权限后完成上述试验，没有修改 ACL。成功证据：[结果索引](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-results.json)、[终态 job](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-patched-failed-job.json)、[完成检查点](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-patched-done-checkpoint.json)、[覆盖诊断](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-patched-coverage-checkpoint.json)。

可重跑入口：`node tests/acceptance/kb02-storage-poc-20261020-build.mjs`，每次生成新的时间戳证据；副本实现也归档为同前缀 `jobs.ts.txt` / `files.ts.txt`。入口仅用于本地隔离试验。

[试验交接与精确补丁](KB02-STORAGE-POC-20261020-handoff.md)、[完整性摘要](KB02-STORAGE-POC-20261020-integrity-summary.json) 已保存。交接前补充了工具在子进程失败时返回非零退出码的检查，仅语法检查通过、未重跑全部试验；被测副本实现和断言未变。上述结果依据各子进程及场景证据判定。

**结论：关键恢复机制已在最小试验中验证可行，建议按上述三步正式集成。** 当前不是生产修复交付：HTTP/UI、重启、取消竞态、多任务容量及原 Node 24.20.0 环境尚未实测；不能直接将副本补丁整体复制并签收。Q02/KB02 当前验收状态不由本试验改变。
