# 阶段A独立工程验收准备

2026-10-23。Sol尚在施工，本文件不代表工具已审或阶段已放行。Astra medium仅准备探针；不运行未冻结资产，不读取真实配置，不外发。用户范围A1/A2/A3最多220–224共5；当前本轮真实0、总219，B/C禁止。卡SHA `cf647671ee3ebd01fddd38f13ca83789fdde775bed7fa69be4df57ddf2b5658f`保持不变。主Agent实际Chrome，Astra查服务/候选质量和账本。

冻结后先核Sol SHA及实际import/启动路径，再按其真实接口编写以下最小独立探针，避免提前猜接口或复制施工实现：

| 探针 | fake/本地操作 | 必须观察 |
|---|---|---|
| E01 门禁先于配置 | 无release/错误SHA/模板篡改/错误session/B/C/all/KB02_REAL变量启动 | 真实配置loader spy为0，transport为0；不仅报错，还须无账本/阶段推进副作用 |
| E02 有效release仅一段 | A1有效模拟release后走真实产品路径2fake；保持进程和UI可刷新 | 序号220/221先pending再send；不自动A2；启动/GET/刷新0send；并发启动同stage不双job，多个适配器实例共享持久锁 |
| E03 失败停止 | fake返回合法HTTP但非法schema、提取漏来源、规划非法；fake update返回非法schema | 分别查A1/A2 job.status与A3 route异常后磁盘session.stop；新的有效release也不能绕过已失败session继续send；失败占额，保留Raw/cp/原错误 |
| E04 账本及恢复 | pending落盘失败；并发重复调用；制造pending后重启；达到stage/global上限 | 写失败零send；序号唯一、全局不超过5；pending不重发/不reset；成功回应后的落账失败也停止，不假定成功后可继续 |
| E05 输入版本绑定 | A2明确decision后全页清审；A3 release绑定后编辑非选中输入页/撤审/改目标，或替换page/session | service重新加载后拒绝且update fake0；新workflow未审；旧目标不变，释放对象不能仅靠当前CLI参数改绑 |
| E06 网络与凭证 | 两个本机服务模拟登记目标/未登记sink；redirect/URL options/customtransport；假秘密回显 | 允许正常目标、拒绝绕过且sink0；headers/key不落证据；私有response先保存，已知假秘密扫描后只hash/脱敏导出并失败；不使用真实密钥做探针 |
| E07 完整fake接线 | 持久session API与真实组件/浏览器URL；按A1→明确检查→A2→检查→A3 | 总2+2+1fake，release不可自动签下一段，Raw/原ID/备注/双来源/20与30保护，完整root/path/端口与停止命令可交主AgentChrome操作 |

对真实配置模块的测试使用可审依赖注入或独立临时fake配置路径，不读取实际.env；若无法做到不接触真实配置即无法测试门禁，作为工程缺陷交主Agent。产品不可改，独立探针不可直接改候选JSON伪造审批来证明真实UI闭环；故障注入只在隔离测试根并明确区分正常链。

证据分别标记Sol自查、Astra独立命令、主AgentChrome后续操作。沿用修复后的网络计数口径：wrapper不代表全进程遥测；实际本机sink与源码无旁路交叉核验。接口尚未冻结，不提前声明已测支持哪些模式。

工程PASS交付：精确A1 release JSON结构/绑定值、release文件SHA核验方式、初始化/serve/单段执行/停服命令、localhost URL、隔离root、安全状态读取命令、账本位置与脱敏报告路径。**只给主Agent审阅签发，不自行创建有效release或真实外发。** 随后A1真实执行和独立裁定才按主Agentrelease进行；后两段重复证据放行而非重复向用户索权。
