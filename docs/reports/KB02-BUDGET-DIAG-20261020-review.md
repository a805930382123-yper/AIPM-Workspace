# 两项 KB02 预算测试失败：定位审查与修复方案

2026-10-19开始、2026-10-20交付。仅诊断和方案；未修改产品、原默认测试、旧验收报告或调用真实Provider。本报告不代替Q02独立批次验收，也不关闭KB02真实质量FAIL。

## 结论与置信边界

**已证实产品存在“存储写入失败后的终态与诊断处理缺口”，测试又缺少失败快照。没有证据证明S01预算公式失效，也不能将失败直接归因于Node 24。**

已用原两项测试和隔离故障注入稳定复现三种历史报错形态。临时重命名失败是最有实测支持的触发方向：原完整首轮有明确EPERM，本次无注入并发观测也捕获9次实际job文件rename EPERM，但都在原重试内恢复。原完整复跑未保存job.error和失败检查点，且finally删除现场，**因此不能唯一确认原两次失败的具体I/O点，更不能确定是杀毒、索引器、ACL或Node补丁版本导致**。

## 两项失败分别怎样产生

| 原测试及观察 | 代码审查与已复现因果链 | 尚未证明的部分 |
|---|---|---|
| `KB02 exhausted explicit replanning...`：复跑在第60行等待任务结束超时；更早首轮是planningRetry资格409 | jobs.ts:198–201在失败处理期间分别写checkpoint/raw-state/job，三处继续catch后丢弃异常。若终态job写入在原rename重试后仍失败，磁盘job保持running；后台finally移除controller，外层catch也不报告。注入该写入失败，原测试约15.6秒后得到同样`Budget fixture job did not finish`。若失败的是覆盖诊断checkpoint写入，诊断未保存，后续planningRetry资格409；该路径也已复现。 | 注入超时发生在原测试第56行，历史复跑为循环中的第60行，说明机制相同但不是对原第几次写入的精确重建。原首轮409是否由同一存储错误造成仍需原job快照。 |
| `KB02 last available planning call...`：第97行期待completed，实际failed | 在最后一次规划成功、draft创建后，`stage:done` checkpoint写入失败会进入通用catch。原始EPERM被归为LLM_INTERNAL_ERROR，最终job failed、attempts/callCount仍6。注入该写入失败，原第97行原断言稳定报`failed !== completed`。 | 原日志没有该次job.error，不能证明原失败恰好位于done checkpoint，也不能把所有failed状态归为同一原因。 |

关键代码：

- `services/llm/jobs.ts:163`：后台执行结果最终被`.catch(() => undefined)`丢弃。
- `services/llm/jobs.ts:184`：异步进度写入同样不报告失败。
- `services/llm/jobs.ts:195–202`：普通文件错误归LLM_INTERNAL_ERROR；三处失败收尾写入错误被吞；随后controller删除。
- `services/storage/files.ts:17–23`：原子rename已有最多6次尝试，退避等待合计300ms（不含文件I/O），不是完全没有重试。不能用“加一个重试”作为完整修复。
- `tests/kb02-planning-budget.test.ts:38–44`：按次数轮询，超时只有通用文案；第57行只验调用数，未先检查初次失败是否确为覆盖失败；第97行未附job.error；第81/103行finally清理现场。

S01的409前置预算判断和`min(128,2*chunkCount+4)`共享公式未发现本次失败所证明的计算错误。不能为了测试通过增加次数、清零attempts、重调Provider或放宽completed断言。

## 本轮实际验证

保留原产品及测试字节。诊断仅通过显式CLI preload观察隔离`kb02-budget-*`临时夹具；注入模式不会用于普通产品进程。完整测试只在逐字节副本，避免原B04测试覆盖旧报告。

| 验证 | 结果/证据 |
|---|---|
| 原两项测试，Node25.2.1及本机可用Node24.19.0各3次 | 6/6进程通过，两项原断言每次均过；[baseline](KB02-BUDGET-DIAG-20261019-baseline.json) |
| 每个运行时8进程并发，各进程仍运行原两项测试 | 16/16进程通过；预算夹具捕获9次实际rename EPERM并由现有重试恢复，未发生终态写入失败；[load](KB02-BUDGET-DIAG-20261019-load.json) |
| Node24.19.0，同冻结97产品/62测试逐字节副本、完整默认265项 | 265/265、0skip，18.648秒，copyMismatches=[]；原产品/测试变化=[]；[full24](KB02-BUDGET-DIAG-20261019-full24.json)、[日志](KB02-BUDGET-DIAG-20261019-full24.log) |
| 仅对隔离夹具注入“终态job rename持续失败” | 原超时报错；job最后仍running；这是预期的失败复现，不是产品PASS |
| 仅注入“done checkpoint rename持续失败” | 原第97行failed/completed断言失败，job.error=LLM_INTERNAL_ERROR、callCount=6 |
| 仅注入“覆盖诊断checkpoint rename持续失败” | 原planningRetry资格409，模拟首轮另一报错 |
| 三种注入记录 | [faults](KB02-BUDGET-DIAG-20261019-faults.json)，synthetic标记与实际rename错误分开；原断言未改 |

原失败环境是Node24.20.0/另一Temp路径，本机可用比较为24.19.0与25.2.1；不能据此排除24.20补丁或原机器环境差异。一次当前完整通过不能抹去原263/265记录。

默认sandbox的tsx初始化`uv_os_get_passwd ENOMEM`记录另存sandbox前缀，尚未进入测试，不计产品失败；随后同命令获额外权限运行。首次故障钩子错误解析Raw Markdown，已限制到job/checkpoint JSON，首败另存instrumentation-initial前缀；首次全套副本漏复制.gitignore，在校验前停止，修正诊断副本准备后才执行完整测试。上述诊断校准不计因果证据。

## 建议修复方案（未实施）

### 1. 先补测试现场和断言上下文

范围：`tests/kb02-planning-budget.test.ts`及窄测试支持模块。

- 等待超时或期待completed却失败时，输出安全快照：job状态/阶段/error、checkpoint阶段/attempts/lastError、Raw状态、实际fake请求数和运行时版本。不得输出Key、业务正文或完整Provider payload。
- 第一次覆盖失败后及每次重规划前先断言确为LLM_PLAN_COVERAGE_INVALID且诊断存在，错误必须附真实job.error，避免把存储错误误读为预算资格错误。
- 使用单调时钟截止时间和终态条件；超时先保存快照、再停止/收尾测试后台任务、最后删除临时目录。扩大等待只用于已测得的正常调度抖动，不能遮掩永不结束的running。
- 保留completed、累计6次、三文件哈希不变、诊断保留、零额外调用等全部原断言，不允许skip/失败自动重跑到绿/把failed也视为通过。

### 2. 修产品持久化错误分类与收尾可见性

主要范围：`services/llm/jobs.ts`；必要时窄改`services/storage/files.ts`和既有恢复错误通道/`server/llm-api.ts`。不要触碰S01公式、Q02分类或模型调用策略。

- 将存储errno及操作阶段保留为受控storage错误；API/UI只返回安全类别、阶段、是否已保留checkpoint/draft、是否需要对账，不能只剩LLM_INTERNAL_ERROR或泄露绝对路径。
- 跟踪后台任务执行与收尾结果，替换终态写盘和外层的无声catch；进度写盘与关键终态写盘区别处理，至少登记有界、可读取的恢复错误。
- 若磁盘暂时无法写入，保持最后成功文件，不伪造“已持久化failed/completed”。现有job读取接口直接读磁盘，必须接入可见的运行时持久化失败状态/恢复信息，避免后台已结束却只向用户显示仍在运行。
- I/O恢复后只重做状态落盘/已有draft对账，不再次调用Provider、不减少attempts。done checkpoint失败但draft已存在时优先核查并对账已有草稿，沿用现有显式恢复/幂等路径。
- 持续权限失败时不承诺能强行写出终态；明确恢复错误并保留原文件，重启按现有检查点和任务记录恢复。不得删原件、改ACL或降低校验。

### 3. 加故障回归，按测量决定是否调文件重试窗口

- 三个上述写入点分别注入短暂失败与持续失败：短暂失败在有界窗口内恢复，持续失败可观察、不中断账本保护、不伪装成功。
- 测恢复/重启/取消与已有draft对账，确认Provider增量0、attempts不回退、无重复草稿或正式资产；存储故障用独立测试，不污染正常预算测试期待。
- 原子rename已有300ms退避；是否调整为更合理的有界窗口，应基于原环境失败持续时间采样，不能盲目提高全局次数或改变Provider超时。文件级重试不等于模型重试。
- 原失败环境Node24.20.0优先复验，并保留当前24.19.0/25.2.1对照；跑原两项、默认并行完整副本以及故障用例。串行通过不能替代默认并行，所有首败和最终结果分别记录。

## 交付和仍缺证据

已提供可执行复现工具与明确修复范围；未施工，不启动Sol返工或Astra批次审查。原两项历史失败的唯一触发点仍缺“失败时job/checkpoint/errno快照”，应先由方案第1步补齐再在原环境捕获。本轮发现的异常吞没/终态不可见缺口已由注入证实，可按第2步修复，不必等到猜出某个系统进程是谁。

诊断入口：`node tests/acceptance/kb02-budget-diag-20261019-run.mjs baseline|load|faults|full24`，三种faults预期使原断言失败。所有实验报告sourceChanges=[]，未改产品/原测试；真实新增0，既有真实账本和历史异常不在本报告中被改写或签收。
