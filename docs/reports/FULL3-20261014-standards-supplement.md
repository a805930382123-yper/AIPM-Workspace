# FULL3 Standards 补充结论：恢复错误可见性（2026-10-14）

**Standards轴最终结论更新为FAIL：ST-F01 / P2，损坏提交清单被静默排除，启动恢复无法报告该操作失败。** 本补充根据主Agent新增实测证据复核，不覆盖先前静态报告或原始证据。原报告OBS-ST01的RUN=NOT_RUN现改为已复现FAIL；原84产品/52测试冻结与证据适用性检查保持成立。

证据：主Agent [corrupt-recovery实际结果](FULL3-20261014-corrupt-recovery.json)，脚本 tests/acceptance/full3-20261014-corrupt-recovery.mjs；本Agent独立阅读脚本、结果及实际消费者，未重复运行或修改产品。

## 最短复现与判定

1. 隔离data根初始化真实 WikiCommitService（与产品启动相同reconcile入口）。
2. 在 state/wiki-commits/<UUID>.json 写入截断JSON，内容以operationId和status=committing开始；无需Provider或业务正文。
3. 真实 listJsonRecords 返回0条；真实 WikiCommitService.reconcile 返回 `{resumed:[],conflicts:[]}`；明确get该operationId才抛读盘错误。
4. 原损坏清单仍在，字节不变。

预期：存在的提交清单不能解析时，恢复应明确报告不可读取/人工处理状态，并保留文件；不应把恢复结果呈现为无待处理操作。

实际：services/storage/files.ts:50–60 在单条read/JSON解析异常时continue（目录读取异常也返回空列表）；services/wiki/commits.ts:68–70将它当作正式清单列表；:411–433启动恢复只对已读入manifest记录conflicts。因此文件在进入冲突/错误报告前被移除。server/index.ts的启动流程仅在commitRepair.conflicts.length非零时报告需要人工处理，本情况没有恢复错误可见性。

严重度P2：用户已确认操作的持久化清单一旦外部损坏/不可读，会被恢复扫描静默忽略，用户不能从启动恢复报告知道该操作需要处理，需知道operationId后主动读取才见错误。该行为违背AGENTS.md“失败不得伪装成功”和B04可恢复提交/诚实报告约定。

影响边界：**已实测范围仅为损坏Wiki提交清单的发现与报告。未证明原正式Wiki数据丢失、被覆盖、自动错误提交或重复提交；bytesUnchanged=true明确证明测试文件未变。** 测试使用真实恢复/文件读取代码，但因清单在解析前就被忽略，wikiStore/drafts/rawStates等后续施工依赖未被调用；不能把此记录称作完整真实HTTP/浏览器/重启闭环。相同helper用于Draft/RawState/Workflow列表是潜在相邻范围，尚未本轮逐一实测，不增加FAIL数量。

最小修复/复验建议（本轮不施工）：列表扫描明确返回或抛出不可读记录的安全标识；恢复展示/记录这类冲突，保留原文件，不尝试猜测重建或执行损坏payload。复验本场景及正常/部分提交恢复回归；不需要降低来源门禁或改正式数据。旧正常恢复PASS不能抵消这个新增错误可见性FAIL。

本审查Agent未读取实际配置/密钥或正式workspace，未调用Provider；只新增专属报告。宿主模型未知，仓库声明无法切换/证明宿主模型。
