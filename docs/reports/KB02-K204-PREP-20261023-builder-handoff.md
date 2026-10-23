# K2-04 最小补证准备：Sol 施工交接

2026-10-23。受测 HEAD `5de67e33e19d4dce3ca650c8c5ee9f1c472970ba`，产品 `60f83adba102d887fcd925df13a8021ff7669de1`。按冻结 [任务卡](../handoffs/KB02-K204-PREP-20261023-task.md) 和 [Astra spec](KB02-K204-PREP-AUDIT-20261023-spec.json) 施工。施工自查已完成，冻结后停止写入，交 Astra 独立复审；本报告不签准备验收或批次最终通过。

**真实调用 0，知识 219/500、Prompt 15/24 不变。KB02 仍 BLOCKED，真实质量 NOT_RUN。** 后续建议上限22（A1/A2/A3/B/C=2/2/1/2/15），预计最多241/500；五阶段 approved 全为 false。此次没有真实执行器、真实权限令牌、Provider 配置加载或可开启外发的参数。未来真实执行接线及逐阶段放行仍需另行授权和独立审查。

## 实际变更与接口

- [support.mjs](../../tests/acceptance/KB02-K204-PREP-20261023-support.mjs)：核卡/spec/历史原文/代码与规则SHA，调用当前 chunkText/loadExtractionRules 复核分块与22上限；只构造明确fake响应。fetch、http/https客户端均拒绝非已登记的127.0.0.1测试HTTP；没有实际端点探测。fake返回边界拒绝B1、超额及过早规划。
- [run.mjs](../../tests/acceptance/KB02-K204-PREP-20261023-run.mjs)：生产 ExtractionRunner→新持久检查点→DraftStore→实际 React/jsdom 与 localhost HTTP。metric不人工改type；全部页面审查后创建正式隔离目标并保存固定备注；A2选择update使全页清审，再逐页审查并通过实际组件生成一次新预览。更新输出另审、明确确认、重新挂载、磁盘回读和幂等；负面用例复制隔离数据根，不破坏正常链。
- [gates.mjs](../../tests/acceptance/KB02-K204-PREP-20261023-gates.mjs)：仅fake回调的账本/阶段/停止模拟。它没有任何真实transport，模拟approval与建议计划中的真实approved明确分离。

产品、rules、默认tests、依赖、锁文件、Provider wire/config、历史资产及正式workspace均未修改。未运行445全量或build；同源历史188指纹与先前完整验收证据一致，只复用，不称本轮重跑。AGENTS/.agents/AGENT-ROUTER外部工作保留；status/control/acceptance/Git由主Agent管理。

## 实测与首失败

本机 Node **v25.2.1**。完整命令：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-PREP-20261023-run.mjs
```

同一入口的各次结果按时间戳独立保留，没有覆盖失败：

| UTC时间 | 结果 | fake次数 | 原因/处理 |
|---|---|---:|---|
| 12:16:57 | exit1 | 0 | 外发防护同步抛错，脚本错误地把已抛出的表达式交给assert.rejects；改为async回调，未修改防护或产品 |
| 12:17:10 | exit1 | 0 | Windows沙箱拒绝隔离Raw原子rename/EPERM，尚未抽取。保留原证据，自动审批允许后同字节本地离线重测；未放宽产品断言 |
| 12:17:22 | exit1 | 5 | 确认后页面不再显示审查按钮，脚本挂载等待条件错误；改为接受已确认终态 |
| 12:17:51 | exit1 | 5 | 测试对target.sources原地sort造成期望对象变序；改为复制排序，磁盘仍保持原序 |
| 12:18:09 | exit1 | 7 | fake统一document标题导致Source标题冲突；产品正确拒绝。fake标题改为带固定样本ID，不改变正文或type |
| 12:18:25 | **exit0** | **22** | 完整正常链通过，约5.28秒；localhost111次、外部发送0、预发送拦截探针2次 |

上述完整链最终证据：[offline.json](KB02-K204-PREP-20261023-run-2026-10-23T12-18-25-513Z-offline.json)、[plan.json](KB02-K204-PREP-20261023-run-2026-10-23T12-18-25-513Z-plan.json)。候选/实际unit与member ID、检查点、fake请求及响应、HTTP动作、人工组织操作、最终正式内容分别保存。这里只证明离线工程可通，不证明模型实际质量。失败运行的正常链fake合计17；不与成功22混计。

完整链通过后仅补强卡内fake边界拒绝和模拟计数，没有重复全套。最终support的guard已用此前正常链21条提取/规划trace逐条验证，A3另为1条update；另运行CLI子进程`--real`，即使KB02_REAL=true仍exit1/OFFLINE_ONLY。最终 **12项** 模拟自查通过，fake回调 **6次**，与正常链22分开；先前完整运行中的模拟也为6次，全部离线模拟累计12。证据：[最终gates](KB02-K204-PREP-20261023-targeted-final-gates.json)、[最终wirecheck](KB02-K204-PREP-20261023-targeted-final-wirecheck.json)。真实始终0。

最终定向命令如下（最后一项wirecheck实际通过inline Node运行，其完整输出及CLI错误保存在对应JSON；Astra可直接复跑最终完整入口）：

```powershell
node --import tsx --input-type=module -e "import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {gates} from './tests/acceptance/KB02-K204-PREP-20261023-gates.mjs';const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-k204-gates-targeted-'));try{console.log(await gates(root,'targeted-final-gates'));}finally{await fs.rm(root,{recursive:true,force:true});}"
```

## P01–P06 施工自查映射

| ID | 已测结果与边界 |
|---|---|
| P01 | 冻结SHA与各body、实际chunk边界、revision13和22计划一致，五阶段均未批准。update保留当前90秒/256000字节，抽取60秒/2MiB/600秒总限分别记录 |
| P02 | A1未审正式确认409且0写；组件来源/只读事实/全页审查/明确创建metric；A2未保存目标、未全审、unresolved、陈旧revision/digest拒绝且update fake0。decision清审后全页重审，实际组件生成A3一次；新的输出未审，既有目标不变。独立副本验证非选中页撤审、目标版本变化均阻断。WorkflowPage未解决阻断→归属→人工标题修正→保存清审→重审→明确确认→重新挂载→磁盘回读；重复确认复用且无新增调用。旧正文/定义/公式/零分母/单位边界/固定备注/双Raw/20与30差异均保留 |
| P03 | B新cp2fake、C空新cp14提取+1规划；本次C42unit/81member ID完整唯一归属，与历史55/101不同。另从Raw的14业务段逐字符核覆盖、各主体/月/100目标/11–24在售与百分比/独立性/未知未来逐项核对；非经营排版不进入事实。B/C实际全部组件逐页审查后正式隔离确认/回读，不把旧完成cp当新链 |
| P04 | --real实际CLI拒绝；环境/改授权对象不能创建真实transport；fake边界拒绝B1、extra、提前规划；fetch/http预发送拦截，实际外部发送0。此工具没有任何可执行真实授权对象 |
| P05 | 12项模拟：未批准不派发、请求前持久落账、落账失败不回调、A3硬上限、超时/取消/非法响应占额并停止、两个在途均记账/失败后无第三与规划、重启不派发。模拟不声称实际Provider已实现这些未来控制 |
| P06 | 各运行188源指纹前后0漂移，最终188再次匹配历史expected；fixture/负面副本/模拟数据根已清理，自有HTTP服务关闭、组件卸载。沙箱初始化失败没有返回fixture对象；精确检查其kb02-budget-ypCdwN根时已不存在，未删除其它路径。冻结清单与通用密钥模式扫描见freeze.json |

A2第二页标题明确标为“人工整理（组织选择）”；其归属只表示测试人的组织决定，不宣称原文唯一蕴含关系。模型候选、人工动作与终态分开；来源fact/question/ID不由人改写。现有fixture只覆盖本卡，不扩展产品质量结论。

## 限制与移交

没有Chrome或实际浏览器引擎证据；这里是实际React组件+localhost HTTP。真实模型能力、真实metric更新语义质量、新链真实长文与完整真实浏览器流程均未运行，不能宣布K2-04或KB02通过。未来动态planning/update字节须依赖实际前序模型/人工结果，不能预制fake请求代替实际链；需send前重载输入、冻结hash与来源、审批阶段并预记账。当前计划不会执行任何真实请求。

独立复审请核实际脚本差异及 [freeze.json](KB02-K204-PREP-20261023-freeze.json)，必要时运行最终完整入口。施工冻结后不继续写入，不提交Git，不追加调用。token计量不可得。
