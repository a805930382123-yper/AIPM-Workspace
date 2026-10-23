# KB02 HUMAN 独立验收收尾

主Agent提交关联：本报告对应的HUMAN产品、完整施工与独立验收证据已保存于 `60f83adba102d887fcd925df13a8021ff7669de1`。提交后实时 `ls-remote` 核实main同SHA；下文HEAD为验收运行基线，冻结指纹与双层结论不变。本附注仅关联版本，不冒称验收子Agent执行Git。

2026-10-23。本次角色为主 Agent 明确派发的 `gpt-6-astra / medium` 独立验收子 Agent；没有施工产品、修改旧报告或自行提交 Git。按 agent-router 执行入口及当前 HUMAN 卡验收；主 Agent 负责台账与提交关联。

**本轮 HUMAN 人工审查/正式确认门禁：PASS。KB02 整体：BLOCKED（未通过，剩余质量验收待验证），不能结批或进入依赖批次。** 原自动模型语义与结构质量历史 FAIL 保留；本卡是已批准的责任边界调整，不能说模型缺陷已修复。当前工程没有发现需退回施工的产品失败；批次 BLOCKED 指修订需求下必需的真实质量证据尚不齐，不将历史已知模型失败改称环境问题。

## 冻结与证据复用

- HEAD：`28b6d144a07d03d4e85fc8cc766027a763012c0e`，待提交 HUMAN 工作区变更以 [施工 freeze](KB02-HUMAN-20261023-freeze.json) 绑定：43 文件 aggregate SHA256 `b6205b532fccfdb4c0e620182fc7ef11b22276c1a53a269ea39c98f4c47d777e`。
- 本轮逐文件实查全部 43 项一致；历史独立 [engineering.json](KB02-HUMAN-AUDIT-20261023-engineering.json) 的 188 个源码/配置/测试指纹在本机运行前、隔离副本及运行后全部一致，零漂移。报告中的旧设备路径不代表本设备曾跑过旧命令。
- 因同冻结代码未改，复用之前独立实际执行的 Node 24.20.0 默认 **445/445**、Node 24.19.0 核心 **64/64**（零失败、取消、跳过），以及 `tsc -b`、`vite build` exit 0。它们是此前独立证据，不是此次本机全量重跑。施工自查 445/58 与独立 445/64 分开，不混计。
- 本次阅读实际产品差异：revision13 管线/预算，draft 目录迁移与编辑投影，服务锁/摘要绑定，commit/workflow confirm/execute/reconcile，HTTP 输入校验及两个实际 React 页面；原完整测试的 HUMAN 前置适配不被当成独立语义质量证明。

## 本机实际命令与结果

本机 `node` 为 **v25.2.1**。所有测试使用 fake 或历史响应，数据根为临时虚构 fixture；真实 Provider **0**，知识累计 **219/500**、Prompt **15/24** 不变。未读取或写入正式 workspace 数据。

| 实际命令 | 结果与证据 |
|---|---|
| `node tests/acceptance/KB02-HUMAN-CLOSE-20261023-run.mjs`（第一版 TEMP 副本） | 创建 node_modules junction 遇沙箱 EPERM，产品未运行。改为仓库内被忽略的 `.scratch-*` 同字节副本，依赖从父目录解析；没有改产品/测试。此准备失败由工具输出保留，本报告记载。 |
| `node tests/acceptance/KB02-HUMAN-CLOSE-20261023-run.mjs`（scratch 副本） | exit 1；fixture 创建 Raw 的原子 rename 被 Windows 沙箱拒绝。原 [execution](KB02-HUMAN-CLOSE-20261023-execution.json)、[core 首失败](KB02-HUMAN-CLOSE-20261023-core.log)、[HTTP 首失败](KB02-HUMAN-CLOSE-20261023-http-ui.log) 保留，没有重写为通过。 |
| `node tests/acceptance/KB02-HUMAN-CLOSE-20261023-run.mjs permitted` | 经自动审批允许隔离本地验证后，exit 0。**21/21，0 fail/cancel/skip**；另独立 React/HTTP probe 5 步全部通过。实际 child argv、运行目录及起止时间见 [permitted-execution](KB02-HUMAN-CLOSE-20261023-permitted-execution.json)，日志见 [核心](KB02-HUMAN-CLOSE-20261023-permitted-core.log)、[HTTP](KB02-HUMAN-CLOSE-20261023-permitted-http-ui.log)，逐步 DOM/响应见 [HTTP JSON](KB02-HUMAN-CLOSE-20261023-permitted-http-ui.json)。 |
| `node --import tsx tests/acceptance/KB02-HUMAN-CLOSE-20261023-long.mjs` | exit 0。原 106400 字 Raw SHA 匹配，14 主体逐页核对；55 unit / 101 原 ID 完整、唯一归属；每页 unit 原文区间属于对应区域，2026年9月、100家目标、11–24在售/百分比、未知及未来说明保留。0 次请求。见 [long.json](KB02-HUMAN-CLOSE-20261023-long.json)。 |

permitted 核心进程约 3.27 秒、独立 HTTP/组件约 1.96 秒；整个隔离复制及运行约 13.24 秒。token 计量不可得。失败是实际环境失败，后续同字节非沙箱重测通过才作为本机行为证据。

## H01–H11 裁定

| ID | 结论 | 实际覆盖与边界 |
|---|---|---|
| H01 | PASS | 本机重跑历史 204/205、207/208；每组只提取+规划两次 fake。第三次 B1 不请求；原 AI 坏主题仍保留，进入未审候选。独立 HTTP probe 再核两次及初始 0 approval。 |
| H02 | PASS | 本机服务/HTTP 直接确认未审、只审一页仍漏未选页、伪造字段、错误 digest 均拒绝。服务门禁检查全部页及唯一完整目录，普通 PATCH 不能写可信目录。零正式写入拒绝后，完整逐页审查才可创建 Source+Wiki。 |
| H03 | PASS | 实际 React+HTTP 将原边界 unit 移未解决→409→明确测试用户移归→删除空壳页，immutable units 前后一致；原始事实字段只读。另一核心用例覆盖有 unit 页删除转未解决及合并重复原条目不去重。归属选择仅证明操作，不宣称争议关系为客观真值。 |
| H04 | PASS | 移动/标题实改清空全部 approval；陈旧 revision 409；逐页确认不相互失效、no-op 不失效；重新实例化 DraftStore/卸载挂载组件后回读，已审状态持久化；最终 UI 不偷偷保存未审编辑。Source/目标等绑定由完整内容摘要及既有目标冲突回归覆盖。 |
| H05 | PASS（离线范围） | 新独立逐主体脚本与本机核心重放同时覆盖 106400 字、55 unit、101 ID、14 个主体日期/数值/未知/未来及位置/唯一归属。不是仅数14页；仅复用历史已验证提取/计划，不代表新 revision13 真实端到端长文质量。 |
| H06 | PASS | 本机旧 Draft GET 字节不变；明确 start 优先真实 cp ID；不可匹配时 legacy 独立条目，重复文本保留，无定位问题不造证据；移动/删除/合并及持久回读可操作。 |
| H07 | PASS | 本机真实磁盘故障注入：旧零写 prepared/虚报 writtenIds 阻断并可重新审查；部分真实匹配写入仅原快照恢复；实际冲突停止。新已审快照恢复与旧完成幂等保留，不凭 status 判已写。 |
| H08 | PASS（门禁工程） | 未全审输入发起 update 的 fake 调用数为0；全审后生成新未审输出；输出必须另审；非选中输入页撤审后确认被拒绝，已有目标正文保留。既有全量 B05/更新来源/目标版本测试同冻结复用。真实新 metric 更新质量不在本项通过范围。 |
| H09 | PASS | 本机新 synthesis 原提议不可变快照、人工纠正文案分离、未解决阻断→重新归属→独立确认；实际 synthesis React/HTTP 走通。旧 standalone update 明确迁移，缺新版输入绑定或损坏来源不得降级；旧 synthesis 事务迁移走通。 |
| H10 | PASS | 实际 confirm、执行故障及 reconcile 路径测试，重启固定快照、不追加请求、幂等不重复写；新建独立组件终态 confirmed，正式记录2（Source+选中Wiki），Raw正文一致。并发/事务防回归复用同冻结445。 |
| H11 | PASS | 本机 revision13 下界 chunks+1；revision12 完成账本2次拒绝、3次接受，保留旧下界；旧未完成恢复不兼容等由同冻结 planning-budget/storage 默认回归复用。没有用全局减一接受不可能旧账本。 |

真实 React 组件、事件、localhost HTTP 与实际隔离磁盘均已运行。**没有运行 Chrome，也没有视觉布局/真实浏览器引擎验收截图**；本卡“实际组件/浏览器”的功能闭环由实际组件+HTTP满足，不额外增加 Chrome 才能通过 HUMAN 的条件。更新的真实质量/完整浏览器链仍沿原未执行记录保留；组件证据不冒充浏览器证据。

## KB02 整体及剩余项

| 标准 | 当前裁定 |
|---|---|
| K2-01 原文/ID/来源 | 工程保护通过，HUMAN 离线原长文 ID/位置/事实保全通过；不推断所有新真实资料普遍完整。 |
| K2-02 候选主题与正式化 | 修订要求下人工纠正与逐页门禁通过；原自动误放/结构不稳的历史 FAIL 保留，不再作为新链强制 B1 前置，但也未被修好。 |
| K2-03 检查点/预算/恢复 | 同冻结独立工程及本机恢复重测通过；未追加真实恢复/重试实验。 |
| K2-04 完整质量与更新闭环 | BLOCKED / NOT_RUN 项未齐：新链真实短文、长文与更新组合验收、新明确 metric 目标及更新质量、对应完整更新 UI 实证尚需按修订标准补证。HUMAN 本轮0预算不授权外发。 |

历史 REGION 原长文有限通过是有效旧冻结证据，不写成“从未成功”；本轮进一步证明其已验证候选可被 HUMAN 原样保全。它仍不能替代新链真实长文提取→规划→人工审查→正式回读的全过程。原混合短文没有被强制要求必须 metric；新增明确写定义/公式的固定 metric 样本及真实更新能力仍缺证。原 SEMANTIC 阶段一失败后停下的长文/更新阶段没有自动因本次门禁通过而变成通过。

下一步建议：主 Agent 先提交并同步本次已完成门禁和独立报告，更新原台账为“HUMAN PASS、KB02 未结批”，然后停止。下一轮仅准备最小补证卡：沿用既有冻结样本，先证明明确 metric 目标及补充更新可形成可审预览和保留双来源/冲突，再决定新链长文必要范围；将离线可复用证据与必须真实调用部分分开，单列调用上限、首失败停止规则和人工回读标准，获相应授权后执行。不要重新运行相同 B1 协议试验或自动消耗旧预算。

## 保护与交接

本子 Agent 仅新增 `KB02-HUMAN-CLOSE-20261023-*` 脚本/报告；隔离 `.scratch-*` 被现行 gitignore 忽略，不提交。localhost 服务由测试 finally 关闭，组件卸载，fixture 清理；无 Chrome 会话或真实 Provider 服务。源43/188指纹前后无漂移。AGENTS.md、.agents/ 和 AGENT-ROUTER 报告按并行外部变更保留。主 Agent 的3954保护项检查及提交前密钥扫描另属其执行证据，不能冒称本子 Agent 运行。

本报告绑定提交前 HEAD+冻结指纹，后续由主 Agent 统一提交并在台账关联最终提交；验收子 Agent 未提交、未推送、未启动下一批。
