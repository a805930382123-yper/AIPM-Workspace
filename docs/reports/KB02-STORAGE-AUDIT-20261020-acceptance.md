# KB02 SR01 存储失败恢复：独立审查验收

日期：2026-10-20（北京时间）。结论：**SR01 FAIL，不能签收。** 默认测试和构建通过，但新增独立反例发现一个P1和一个P2。只审查，没有修改产品、默认测试或安排返修施工；Q02/KB02真实质量FAIL、S01关闭及PA01既有PASS保留。

## 审查依据与版本

依据[SR01-01–06任务卡](../handoffs/KB02-STORAGE-20261020-task.md)、[独立审查入口](../handoffs/KB02-STORAGE-astra-review-20261020.md)、工程架构与协作规范。审查当前builder-main-frozen的98产品、68默认测试/支持资产、2份既有夹具和10份施工脚本；接手实物与冻结hash全部一致。本轮独立保护2548个旧报告、脚本、正式数据及配置文件。

范围核验为7个既有产品文件修改、1个新增窄助手，1个原预算测试增强、3个新增测试入口及3个支持文件；规则/schema/Provider/预算公式未变。旧源码临时副本已不可用，不能宣称获得逐行旧源码对比；以记录的前后hash核对范围，审查当前完整实现、施工编辑脚本与实际行为，不用Git HEAD冒充SR01基线。[独立范围](KB02-STORAGE-AUDIT-20261020-main-scope.json)。

## 两个独立审查轴

- **Standards：FAIL。** 文件范围、原文保护、安全错误输出及现有测试保留符合要求；但F-SR01-02违反任务卡明确的重启核验、异常记录失败关闭与累计账本保护要求。不是仅凭风格提出建议。
- **Spec：FAIL。** F-SR01-01使启动部分写入后的仅存储恢复无法完成；F-SR01-02使检查点缺失的kb02-2任务绕过恢复核验。HTTP/UI静态审查与受控回归未发现另一项已确认的独立界面缺陷，但不能抵消底层恢复失败。

## F-SR01-01 / P1：重新生成部分提交后，合法旧Raw绑定被误判为冲突

位置：`services/llm/jobs.ts:128`；相关启动写入/捕获约277–289行与重启跳过逻辑413行。

复现：先使Raw存在一个失败任务，再显式restart。新job成功insert，但Raw processing状态的真实atomic rename持续拒绝6次。Raw磁盘正确保留旧jobId，新job留在running，execution=settled，recovery.phase=start-state。解除注入故障后调用reconcileStorage(newJob)。

期望：根据已记录的启动前状态，安全完成或回滚本次部分提交；不调用Provider、清除issue并允许后续操作，同时继续拒绝真正外部修改。

实际：validateSettlement直接要求Raw state.jobId等于新jobId，返回409 `STORAGE_RECONCILE_CONFLICT`。恢复issue仍在，普通start、restart、planningRetry均返回 `STORAGE_RECONCILE_REQUIRED`。新runner重启的reconcile跳过该新job；按ID显式对账仍409。故障解除也无法恢复，是本批核心路径阻塞。旧Raw状态保持，Provider增量0；不是数据被覆盖的报告。

[独立复现及原始结果](KB02-STORAGE-AUDIT-20261020-spec-start-state.json)。现有start-state回归使用首次处理Raw，没有覆盖已有旧jobId的Raw重新生成。

## F-SR01-02 / P2：kb02-2检查点缺失时，重启核验被跳过

位置：`services/llm/jobs.ts:130`–143、396–405；后续普通start的savedCheckpoint分支约238–269。

复现：真实runner在失败job写入故障后留下running任务、磁盘checkpoint attempts=2。仅在隔离fixture将该cp移到保留文件模拟缺失，重新创建runner并reconcile，再显式普通start（没有restart:true）。

实际：cp为空绕过身份、规则、原文与账本核验；reconcile把旧job写成failed/LLM_INTERRUPTED且清除恢复问题。随后普通start建立不同jobId、新账本并发出2次fake调用。原job记录的2次仍在，但无法按原检查点继续；用户没有明确选择重新生成。应区分旧版本无cp与本应存在cp的kb02-2任务，缺失记录须失败关闭并保留原job/raw字节。

边界：reconcile本身Provider增量0；2次fake调用仅发生在后续显式普通start。没有真实外发，没有声称恢复自动调用模型，也没有声称全局真实额度账本被改写。[独立复现结果](KB02-STORAGE-AUDIT-20261020-spec-missing-cp.json)。

## SR01逐项裁决

| ID | 裁决 | 已测与限制 |
|---|---|---|
| SR01-01 | PASS（受控范围） | failed job/done cp/coverage cp持续与短暂拒绝，mkdir/write/rename分类，磁盘job与execution分离，错误可见且安全；默认测试实测通过 |
| SR01-02 | FAIL | 三类终态故障解除后的零调用对账、诊断/块/次数保留和幂等通过；已有旧job的start-state恢复被F-SR01-01阻断 |
| SR01-03 | PASS（HTTP/React受控范围） | 实际HTTP接真实runner、非法请求拒绝，React保存/刷新/选择世代与原导航通过；真实浏览器NOT_RUN；端到端完整签收受F-SR01-01影响 |
| SR01-04 | FAIL | 已有合法draft、坏JSON/规则/ledger/绑定draft缺失和容量溢出受控回归通过；缺失cp失败关闭不成立，另有新旧job部分提交重启遗漏 |
| SR01-05 | PASS（受控范围） | 迟到Provider取消、终态Raw写入时取消、取消落盘失败恢复通过；不扩大为断电事务保证 |
| SR01-06 | PASS | 原预算两项断言保留，单调等待、安全快照、预检和finally收尾；完整suite及Node24受影响对照通过 |

PASS仅指表中明示范围，不能据此签SR01批次PASS。实际浏览器与真实模型未运行；任务卡要求真实外发0，本轮遵守。

## 独立执行结果

在逐字节冻结、无正式workspace/config的可写临时副本运行，默认并行，未在源树执行会覆盖旧证据的全套：

| 检查 | 结果 |
|---|---|
| Node v25.2.1 完整默认43入口 | 289/289，0fail、0skip；19.918秒 |
| TypeScript tsc -b | exit0，3.369秒 |
| Vite build | exit0，1.699秒 |
| 本机Node v24.19.0受影响对照 | 26/26，0fail、0skip；17.228秒 |
| 原Node v24.20.0 | NOT_RUN，未安装/下载；不以相邻版本代签 |
| 新增边界反例 | F-SR01-01、02均实证复现；这两项不在原289项中 |

[完整命令和结果](KB02-STORAGE-AUDIT-20261020-main-2026-10-20T13-44-59.648Z-run.json)。首次沙箱运行在tsx加载时报uv_os_get_passwd ENOMEM，Vite读临时路径AccessDenied，原失败[记录](KB02-STORAGE-AUDIT-20261020-main-2026-10-20T13-44-32.898Z-run.json)及日志保留；获准后同冻结副本执行通过，不归为产品首跑通过，不改ACL、不隐藏失败。

## 完整性与交付

[最终完整性](KB02-STORAGE-AUDIT-20261020-main-integrity.json)：冻结产品/默认tests/夹具/施工脚本变化=[]，2548接手保护文件变化=[]，正式workspace/config无新增。历史PA01漂移只保留既有结论，不追溯证明历史完整。

真实调用新增0，KB02仍62/74、剩12；Prompt仍15/24。本轮所有fake使用隔离虚构数据，不证明Q02真实质量。没有提交、部署、停用户服务或推进其他批次。修复边界见[最小返修卡](KB02-STORAGE-AUDIT-20261020-repair.md)；本报告不构成自动施工安排。
