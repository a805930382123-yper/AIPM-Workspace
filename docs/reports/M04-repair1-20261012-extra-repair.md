# M04 第一轮返修追加复验

最终状态：2026-10-12，下列4项与相关Raw/Minutes重复key补修均已由Luna完成，主Agent独立复验CLOSED。见[最终验收](M04-repair1-20261012-acceptance.md)。下文IN_PROGRESS描述保留为追加返修时的记录。

当前主要8项复验改善，但阶段仍IN_PROGRESS，不能签PASS。这些是F04-01/05/07的必要失败/恢复组合，属于用户已授权M04闭环，不进入M05。旧失败和本轮pre-extra证据保留。

1. **F04-01追加，P1：partial Raw删除后会议损坏。** 实际隔离Raw写入成功、最后linked会议rename EIO，保留pending+真实Raw。DELETE Raw返回200；markRawDeleted把pending变raw_deleted却没有registered_at，之后GET Meeting409 CORRUPT_MEETING。证据edges E01。修复状态/时间字段语义，不能捏造已完成登记时间，也不能放宽为任意损坏记录可读；明确删除后记录/列表/重启继续可用，Raw删除不可复活。检查failed但Raw已写的同类状态。
2. **F04-07追加，P2：linked重放跳过真实Raw校验。** actual Raw已登记后，将隔离恢复夹具的同ID Raw.origin.meeting_id改为另一合法UUID（正文/SHA不变）；重放原请求仍200 reused。证据edges E02。linked不能直接信任收据，应核对真实Raw存在、来源/文本摘要等一致；缺失、来源/正文不一致须可读冲突，不覆盖、不重新创造已删Raw、不伪造成功。与原件被清空后的安全重放语义兼容：历史linked真实Raw可核查，但不得借重试复活原件/已删除Raw。
3. **F04-05追加，P2：popstate迟到响应串会。** 真实HTTP组件：B→A历史，A登记实际提交后挂起响应，history.back加载B，再释放A回包；当前标题变回A。证据component C07。旧render闭包比较meeting.id总相等；以最新id ref/epoch或父组件key确保切会卸载隔离。覆盖登记/重载/解除、popstate/普通选择，保存新会状态不能被旧回复影响。

产品修复所有权仍在原M04任务卡内；Luna补修定向测试/build后停写，主Agent重新冻结并运行上述实际边界和关键回归。不改旧报告/acceptance/正式数据。不通过删除断言或改真实复现预期蒙混。

4. **F04-07追加，P2：旧收据在高修订号无法恢复。** 隔离恢复夹具保存合法旧算法收据，原 baseRevision=10001，实际 Raw 写入失败后当前 revision=10002；以最新修订号重试同一 requestId/import_id 返回409 IDEMPOTENCY_CONFLICT。证据edges E05。实现通过枚举1到10000的哈希兼容旧收据，但持久化修订号没有这个上限。需有界、明确的兼容策略，不能枚举全部安全整数或跳过收据/原件/当前授权/真实Raw核查；保留不同业务输入冲突。另须避免现代收据每次重放也进行10000次哈希。
