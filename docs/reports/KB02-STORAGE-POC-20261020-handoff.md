# KB02 存储修复最小试验交接

结论：**在真实 runner/store 的隔离源码副本中，最小修改能够使三类 rename 持续失败变为可读取的存储恢复问题，并在解除故障后仅做存储对账。** 原版三个已知坏行为均复现；修改版三个 proof-of-fix 场景通过；原预算测试两项原断言通过；修改后 jobs.ts 及实际依赖的严格类型检查通过。本结论是施工受控试验，不是生产实现、HTTP/UI 可见性或批次 PASS。

## 范围与实物

- 施工按 coordination 指定 gpt-6.1-sol/high 执行，只使用本地 fake；真实 Provider 新增 0。
- 正式 97 产品文件、62 默认测试首尾 SHA256 无变化。成功副本内 54 个已复制保护文件逐字节核对原始输入，无差异；只有 patched 副本的 `services/storage/files.ts` 和 `services/llm/jobs.ts` 有有意修改。
- 不复制正式 workspace、`.env` 或运行时配置；测试只创建 `kb02-budget-*` 虚构数据。没有修改 status、当前批次卡、正式产品或默认测试；没有改 ACL、依赖/lock、真实预算，没有提交/部署。
- 保留临时目录：`C:\Users\80593\AppData\Local\Temp\kb02-storage-poc-hf0jWJ\{original,patched}`。两份成功副本和故障 fixture 均保留，可直接检查；临时目录可能随后由系统清理，因此将两个已测修改文件归档为同时间戳 `jobs.ts.txt` / `files.ts.txt`，SHA256 记在 build/results JSON。
- [可重跑构建/验证脚本](../../tests/acceptance/kb02-storage-poc-20261020-build.mjs)、[故障场景脚本](../../tests/acceptance/kb02-storage-poc-20261020-case.mts)、[jobs 差异](KB02-STORAGE-POC-20261020-jobs.patch)、[files 差异](KB02-STORAGE-POC-20261020-files.patch)。差异由 git --no-index 产生，路径为被测临时副本；exit 1 表示存在差异，已保存，不是验证失败。

## 精确实现

1. 只在副本 `writeFileAtomic` 原有 temp-write/rename 的 catch 中包装安全的 `StorageError('STORAGE_WRITE_FAILED', …, 503)`，只带 operation 与白名单 errno，不把路径/原异常正文带入恢复视图。原最多六次 rename、300ms 累计退避、temp 清理和原子替换顺序均未改变。
2. 副本 runner 保存实际后台 task Promise；`waitForSettlement` 能等待收尾，`readJob` 返回 `{job, recovery, settled}`。`job` 仍由原真实磁盘 getter 读取，绝不把内存 desired status 冒充已落盘状态。恢复 issue 明确 `persisted:false`、阶段和 errno。
3. `saveCheckpoint` 在写入前保存原待写 checkpoint；成功后才更新已保存 checkpoint。遇到本次存储故障不再覆盖成 `LLM_INTERNAL_ERROR`，不再继续盲写失败收尾。coverage 场景保留管线已经计算的原诊断，不重新生成诊断。
4. 普通模型错误仍保留原业务错误与诊断，按 cp→raw→job 持久化；任一步存储失败保留恢复 issue。progress 写入 Promise 收集并 drain 后才进入终态，避免在“settled”后还有已知进度写覆盖现场。
5. `reconcileStorage` 与 `start` 共用 startQueue，先检查后台已结算，核对已有 draft 与 job/raw 的关联，再 cp→raw→job，全部成功才清 issue。该函数没有 Provider 调用路径、没有 draft.create。恢复 issue 未清前 `start`（包括显式 restart）在 processing/running 复用分支前阻断。注册表采用 100 条的简单 admission 上限，不静默淘汰待恢复内容。

## 实际执行与证据

命令（工作目录为正式仓库，仅构建工具和报告写在这里，所有产品执行在临时副本）：

```powershell
node tests/acceptance/kb02-storage-poc-20261020-build.mjs
```

首次默认沙箱运行的 8 个子进程都在 tsx 初始化阶段出现 `uv_os_get_passwd ENOMEM`，未进入产品。完整首次 logs/results 保留在 `KB02-STORAGE-POC-20261020-2026-10-19T16-16-47-589Z-*`。随后以相同窄脚本按工具 require_escalated 重试，8 个子进程全部 exit 0，总工具执行约 8.1 秒。实际运行时 Node **v25.2.1**，没有声称重现历史 Node24.20 原环境。

主结果：[results JSON](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-results.json)，[完整性与安全摘要](KB02-STORAGE-POC-20261020-integrity-summary.json)。各 case 的完整磁盘快照、runtime view、每次 rename 时间/目标 SHA256、helper 拒绝后的目标 hash、Provider 次数都在同前缀 `original|patched` + `failed-job|done-checkpoint|coverage-checkpoint.json` 中。

| 场景 | 原版实际结果（已知坏行为对照） | 修改版实际结果 |
|---|---|---|
| A：写 failed-job 的 rename 持续拒绝 | 实际后台已结束，磁盘 job 仍 running；calls=2 | 磁盘仍 running，readJob 明确 settled=true、STORAGE_WRITE_FAILED、phase=failed-job、persisted=false；解除后写回 failed，保留原 LLM_PLAN_COVERAGE_INVALID，calls/attempts=2→2 |
| B：第六次规划成功、draft 已创建后，done checkpoint rename 持续拒绝 | job failed，error=LLM_INTERNAL_ERROR；calls=6、一个 draft | 磁盘 running、独立存储 issue；解除后复用同 draft 对账为 completed，cp done、raw pending_confirmation；calls/attempts=6→6、同一个 draft ID |
| C：coverage 诊断 checkpoint rename 持续拒绝 | job failed、诊断缺失；planningRetry 返回 LLM_PLANNING_RETRY_UNAVAILABLE | 显示 phase=coverage-checkpoint 的存储 issue；解除后恢复原计算诊断 missing f-c1-2 和原业务失败；calls/attempts=2→2 |

每个原版场景的被拒写入都实际进入原 atomic helper 六次 rename 重试，失败后立刻在 store 边界读取目标，hash 与该次首个 rename 之前完全一致。修改版每场景还在故障持续时显式对账一次，再次六次拒绝、issue 保留、Provider 增量 0；没有宣称持续拒绝期间能强行写盘。

解除后每个修改版场景同时检查：Provider 增量 0、attempts 不回退、成功提取块一致、draft ID 列表一致；再次对账为无操作，checkpoint/job/raw 三文件 hash 均不变。B 明确验证了最后可用第六次调用成功后仅存储恢复；A/C 保留为 failed 是正确保留业务覆盖失败，并未把所有失败改成 completed。

未修改的原 `tests/kb02-planning-budget.test.ts` 在 patched 副本执行：**2/2、0 skip**，保留 exhausted/restart、同 job、累计 6 次、三文件不变、诊断及覆盖反馈等原断言。[原预算日志](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-patched-normal-budget.log)。窄类型检查命令为同副本 `node --import tsx node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions services/llm/jobs.ts`，exit 0。[类型检查日志](KB02-STORAGE-POC-20261020-2026-10-19T16-17-06-348Z-patched-typecheck.log)。

构建工具最初只记录子进程状态、外层不会因子进程失败而非零退出。成功证据以 results 中逐行 exitCode 及 case 断言判断，没有用首次外层 exit0 作 PASS。交接前补充“任一子进程失败/spawnError 或正式源码漂移时外层 exit1”，仅执行 `node --check` 通过；这个工具退出码修正没有重跑全部试验，也没有改变已测副本源码与断言。

## 边界与未验证项

- 这证明已知存储缺口可修，不能唯一确认历史两项失败的原始 I/O 点、杀毒/索引器/ACL 或 Node补丁原因。旧263/265失败证据仍有效，不被这次受控通过抹去。
- 仅 runner.readJob 可读到独立恢复 issue；没有接正式 GET/POST、jobView 白名单或 UI，不宣称用户界面已经可见/可操作。
- pending checkpoint 暂存进程内；没有证明进程重启、crash、丢失内存后的恢复。生产设计仍须按磁盘 checkpoint/draft 校验兼容性、Raw/rules/provider 身份、ledger 与冲突，不能直接把此 POC 当完整持久化事务。
- 没有新增全局 storage-read overlay；disk status 保持真实。因此生产接入必须明确处理“磁盘 running、后台已 settled、需对账”的组合，不能让原 start 先复用 running 分支掩盖 issue。
- 100条上限、start 的 restart/planningRetry 组合、cancel 与恢复竞争、重启 reconcile、损坏或被改动 draft/cp、容量/多任务压力尚未专门实测。未覆盖所有 mkdir/磁盘读取/目录同步故障，也没有验证系统断电耐久性。
- 此次按最小目标只用持续合成 EPERM 对照，并记录真实 helper 重试；没有追加新的短暂故障矩阵、EACCES/EBUSY/ENOSPC、全套默认测试、Vite 或真实浏览器。此前全套基线由父协调按已有265/265证据复用。
- 所有正式产品/默认tests 本轮哈希无漂移；这不追溯证明全部历史报告不变，旧 PA01 原因未知的历史漂移继续保留原结论。

施工已停止；不签 KB02/Q02/真实质量 PASS，不推进后续批次。
