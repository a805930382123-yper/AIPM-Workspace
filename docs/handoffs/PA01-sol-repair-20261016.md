# PA01 2026-10-16 最小返修施工范围

用户在当前聊天明确授权按 docs/reports/PA01-REVIEW-20261016-repair.md 返修，并核对昨天更新的分工。沿用 docs/coordination.md：gpt-6.1-sol / high 施工子 Agent；本聊天负责范围、保护和交接，用户另开窗口指定 Astra 中独立审查，不自动发起审查。

## 范围和保护

R-01：Workflow 完整实际读盘结构校验，覆盖 evidence 数组与元素、kind 必需绑定和消费者字段；get/list/scan 一致拒坏，patch/confirm 执行前拒绝并明确恢复错误，健康邻居及合法旧记录兼容，坏文件原字节不改。

R-02：恢复摘要保持 500 条上限，分别披露扫描 partial 和摘要 truncated，提供总数/overflow；页面同步数量及截断提示。隐藏问题持续保留，修复后复扫数量正确，原文件/字节/观察队列预算保持。

不扩改 KB02，不改正式数据、实际配置、历史证据、依赖/锁、ACL、全局 Git，不提交部署或推进下一批。施工真实外发为零，Prompt 0/24、KB02 40/40 不重置。

## 所有权与交付

产品/默认测试权限沿用 PA01 卡，仅修改两个根因涉及的校验/恢复/UI 接线和必要测试。施工证据仅新增 docs/reports/PA01-SOL-20261016-builder-*、tests/acceptance/pa01-sol-20261016-builder-*；本聊天拥有 status、当前任务卡/交接入口和本轮 integrity 脚本。既有审查原件不改，不降低断言。

修改前基线：PA01-SOL-20261016-builder-baseline.json，96 产品/57 默认测试/1836 受保护文件，配置仅存哈希。默认权限拒绝后经 require_escalated 完成基线，未改 ACL。

自测覆盖 R-01 get/list/scan/patch/confirm、健康邻居、修复复扫、坏字节保持；R-02 499/500/501/更大数量 API/组件，及 Prompt 安全/恢复/确认/Meeting 关键回归。逐项检查业务结果，不以 exitCode=0 代替产品通过。

产品/tests 停写后冻结，在字节一致可写副本执行完整默认 suite（0 skip）及 tsc/Vite build，避免旧 B04 测试覆盖历史报告。保留首轮失败/校准，交接变更、命令结果、冻结和保护核对。结束状态为施工完成、待独立审查，原 FAIL 保留，真实质量/实际浏览器留给新窗口独立阶段。
