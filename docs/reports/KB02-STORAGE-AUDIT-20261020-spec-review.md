# SR01 独立 Spec 审查

结论：**FAIL**。发现 1 项 P1 和 1 项 P2。均为真实 runner/store 上的隔离 fake 反例；真实 Provider 新增 0。未修改产品、默认测试、旧证据或正式数据。

依据为 `docs/handoffs/KB02-STORAGE-20261020-task.md` 的 SR01-01/02/04/05、builder-handoff、builder-scope 和 builder-main-frozen。比较口径是 builder-baseline 至 builder-main-frozen；旧源码副本已不存在，不用 Git HEAD 冒充精确施工前文本。当前 jobs.ts SHA256 为 `90b0bd2d568b3a5d2c466eee346b36792d6eade7f70a33d56aa71a35b456c041`，与冻结一致。

## P1：已有任务的 Raw 启动状态部分提交后，存储恢复永久冲突

- 位置：`services/llm/jobs.ts:128`，关联启动部分提交捕获与 `reconcile():413`。
- 要求：SR01-02 解除故障后仅存储对账应完成；SR01-04/05 重启和主调用失败不能留下无法收尾的 running。
- 最小复现：先以 fake 得到普通 failed job；对同一 Raw 显式 `restart:true`，在新 job insert 成功后的 Raw `processing` 写入注入持续 rename 拒绝。真实原子 helper 拒绝 6 次后返回 start-state recovery，磁盘保留旧 Raw 状态及旧 jobId。解除故障，调用新 job 的 `reconcileStorage`。
- 实际：`STORAGE_RECONCILE_CONFLICT`，新 job 仍 running、execution=settled、persisted:false。Raw 旧状态逐字段未变。普通 start / restart / planningRetry 均被 `STORAGE_RECONCILE_REQUIRED` 阻断。新 runner `reconcile()` 跳过新 job，显式恢复仍相同 409；仅重启无法完成这个 job 的恢复。
- 原因：128 行把启动尚未成功写入的 Raw→新 job 绑定当作前提，误将合法的旧 jobId 视为外部冲突。恢复路径缺少“启动前状态仍与已记录快照一致”的部分提交处理。
- 期望：在保留真实冲突保护的前提下识别本次启动部分提交，以存储操作收尾新 job；不能简单删除绑定校验或覆盖其他任务的 Raw 状态。
- 证据：[结果](KB02-STORAGE-AUDIT-20261020-spec-start-state.json)、脚本 `tests/acceptance/kb02-storage-audit-20261020-spec-start-state.mjs`。解除故障、后续操作和新 runner 检查的 Provider 增量均 0。

## P2：kb02-2 检查点缺失时重启核验放行，普通继续可建立新账本

- 位置：`services/llm/jobs.ts:397–401`；必要检查以 `if(cp)` 为条件（130–139 行），普通 start 缺少 cp 时沿用新 jobId（244–255 行及新 checkpoint 创建处）。
- 要求：SR01-04 重启优先核验真实 cp/draft/job/raw 绑定和累计账本，对坏/被改动/不兼容记录失败关闭；不能把检查点缺失等同于只有未保存诊断丢失。
- 最小复现：fake 提取及规划 2 次后，在 failed-job 终态原子写入处故障，磁盘 job 仍 running、cp 已有成功块及覆盖失败诊断。解除故障，将该隔离 cp 暂移至同目录 `.isolated-test-hold`，新 runner 调用 `reconcile()`，随后显式普通 `start`（未传 restart）。
- 实际：重启将原 job 标为 failed/LLM_INTERRUPTED，未保留 recovery；普通 start 创建不同 jobId，重新提取和规划 2 次 fake。原 job 的 callCount 并未数值回退，但新任务绕过了应复用的原任务累计账本和成功块。
- 精确边界：`reconcile()` 自身 Provider 增量 **0**；只有之后的用户式显式普通 start 增加 **2 次 fake**。不存在本测试证明的自动外发或真实模型调用。此为本卡新增重启核验义务的遗漏，不宣称旧普通 start 分支由本批首次引入。
- 期望：对明确声明 kb02-2 且已有调用记录、却失去必要 checkpoint 的任务保留恢复/冲突状态和现存字节；不能默认为合法中断后放行普通继续另建账本。旧版无 checkpoint 任务的兼容需单独判定。
- 证据：[结果](KB02-STORAGE-AUDIT-20261020-spec-missing-cp.json)、脚本 `tests/acceptance/kb02-storage-audit-20261020-spec-missing-cp.mjs`。

## 执行与限制

两脚本通过 `node --import tsx <script>` 在 Node v25.2.1 执行。首次默认沙箱在 tsx 初始化因 `uv_os_get_passwd ENOMEM` 失败，尚未进入产品；随后同脚本获准沙箱外执行。start-state 初次复现后只针对同一反例补充后续 start 阻断和新 runner 行为，再运行；没有重跑全套刷绿。

审查读取 jobs/checkpoints/storage-recovery、相关 store、pipeline 验证及新增存储测试，关注持久化、取消、预算、重启和容量路径。完整默认 suite、构建和 HTTP/界面验收由父代理独立执行，本子审查不重复签署。针对上述两个反例未测试真实浏览器、真实 Provider 或断电事务，不将 fake 结论代签 Q02/KB02 真实质量。测试夹具根均由 fixture 新建，finally 清理；没有停用户服务。
