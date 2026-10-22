# KB02 SR01 R1 独立验收（2026-10-21）

结论：**SR01 整体 FAIL，不签收。原 F-SR01-01、F-SR01-02 在本轮受控复验范围内关闭；完整默认工程门禁仍 FAIL。** 主审直接核查和执行，未修改产品或默认测试。真实质量 BLOCKED、实际浏览器 NOT_RUN；React/jsdom 结果不代替浏览器。

## 交付版本与范围

审查依据为最新 status、SR01原任务卡、20261020独立返修卡、20261021 R1交接/范围/冻结。实际98产品、69测试支持资产、2夹具及2施工脚本与 [施工冻结](KB02-SR01-R1-20261021-frozen.json) 一致；审查前保护2597份历史证据/验收脚本/正式数据/配置。仅jobs.ts相对交接原字节变化；启动前状态摘要、零调用部分启动验证、缺cp失败关闭及重启扫描符合声明，未更改Q02/schema/Provider/预算。内部startStateHash没有新增到HTTP jobView。

## 独立实测

| 项目 | 结果与证据 |
|---|---|
| 系统Node24.20.0，同冻结逐字节副本，默认并行44入口 | **298/300、2 fail、0skip**，50.717秒；[完整日志](KB02-SR01-R1-AUDIT-20261021-main-2026-10-21T09-42-03.240Z-fullsuite.log)。只运行一次完整套件，未重复刷绿。 |
| tsc / Vite | PASS，9.216秒 / 7.224秒；[执行记录](KB02-SR01-R1-AUDIT-20261021-main-latest-run.json)。副本执行前后冻结差异均为空。 |
| 本机Node24.19.0受影响对照 | **37/37、0skip**，25.290秒；[日志](KB02-SR01-R1-AUDIT-20261021-main-2026-10-21T09-42-03.240Z-node24-targeted.log)。不能替代24.20完整门禁，不能据此唯一归因Node补丁。 |
| R1新增回归 | 完整运行中10项服务/HTTP和1项React+HTTP均通过。覆盖同/新runner、外部转绑/history/body冲突、缺cp重启/按ID恢复/普通继续、旧完成草稿及新恢复ID。属于300项中的子集，不重复累加。 |
| 主审独立反例 | [首轮](KB02-SR01-R1-AUDIT-20261021-spec.json) 2通过，1在准备旧任务时遭call-count-job存储失败而未到达目标断言；[单项诊断](KB02-SR01-R1-AUDIT-20261021-spec-proof-diagnostic.json) 该反例通过，原首败保留。 |
| 最终完整性 | [PASS](KB02-SR01-R1-AUDIT-20261021-main-integrity.json)：冻结变化=[]，2597保护文件变化=[]，正式workspace/config新增=[]。不追溯消除旧PA01摘要异常。 |

F-SR01-01：独立旧失败任务→restart的Raw状态原子rename六次拒绝后，新的runner阻断绕过启动；故障解除后重启扫描恢复为failed、绑定到新job，重复HTTP保存字节不变，Provider增量0、旧job/cp不变、无重复草稿。额外移除启动前证明的旧孤立任务按ID保存409、保字节，不借此放宽绑定校验。原缺陷在受控范围内关闭。

F-SR01-02：独立已调用2次的失败任务移走cp后，普通HTTP继续返回LLM_CHECKPOINT_MISSING、按ID保存409，job数/Raw状态/调用不变；放回原cp后沿同job只重规划，累计2→3且成功，无隐式新账本。完整回归另覆盖中断running任务的重启失败关闭与旧合法完成草稿。原缺陷在受控范围内关闭。

## 未通过门禁 G-SR01-R1-01

两个原预算测试在第3次调用前失败，均为 `STORAGE_WRITE_FAILED / call-count-job / persisted:false`：磁盘job为running/planning、callCount2；cp为planning、attempts3、成功块1、无诊断；Raw为processing；Provider仅2次；执行已settled。产品确实暴露待恢复状态而非伪装成功，但正常路径未达到原测试要求，完整工程门禁不能签PASS。

独立反例的准备阶段还出现相同phase（job1/cp2/Provider1）。随后仅对未到达的“缺启动证明应拒绝”反例做一次有界诊断，使用已有只读rename观测，捕获4次原生EPERM后原重试策略成功；[诊断日志](KB02-SR01-R1-AUDIT-20261021-proof-diagnostic.log)。观测只记录并原样重抛，不增加重试。它证明当时有原生rename拒绝，不证明完整suite两次失败的系统根因，也不将单项通过抵消首败。下一步见 [最小诊断与复验卡](KB02-SR01-R1-AUDIT-20261021-repair.md)。

## 校准、清理与边界

首次创建本轮脚本在普通沙箱Access denied，首次完整执行在spawn时报EPERM，均按工具流程升级后执行；未更改ACL。独立spec首次审批超时未执行，同命令一次重试后执行。全部首败和本轮日志保留，原报告只读。临时副本保留；所有测试子进程close、HTTP finally关闭，未启动持续服务或停止用户服务。

本轮真实新增0；KB02仍62/74、剩12，Prompt15/24独立。未读取密钥正文或进行外部模型请求，未修改正式Raw/Wiki/Prompt。当前仅裁决SR01工程与受控恢复；Q02/KB02真实FAIL、S01既有关闭、PA01既有PASS保留。不自动施工、提交部署或推进其他批次。
