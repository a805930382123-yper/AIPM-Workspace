# PA01 2026-10-16 独立复验最小返修卡

整批 FAIL，详见 [验收](PA01-REVIEW-20261016-acceptance.md)。本卡不构成自动施工授权；延续 Sol High 施工、新窗口独立审查分工。

1. **R-01 / P2 / F-PA01-02，连带 F-04/F-05**：补全实际 Workflow 存储结构校验，至少覆盖 evidence 的可选但存在时数组类型和嵌套元素、按 kind 所需绑定及实际消费者依赖字段。使用健康产品记录派生反例，避免破坏合法旧记录。get/list/RecoveryRegistry 必须一致拒绝损坏；patch/confirm 不得先重写坏文件或落入 TypeError。正常邻居继续，错误明确 recovery、原文件保留。不要只在 confirm 捕获 TypeError，也不要扩改 KB02 算法。
2. **R-02 / P2 / F-PA01-04**：对 500 项摘要截断显式报告。可区分扫描 partial 和结果 truncated，并提供总数/overflow；同步 UI 的数量/截断提示。持续保留隐藏问题，重扫/修复后数量正确，不扩大为无界返回。加入 499/500/501 及更大数量的 API/组件反例，与原文件/字节/观察队列预算并存。

独立复现脚本：tests/acceptance/pa01-review-20261016-independent.mjs 与 independent-http.mjs（同前缀）。三个检查属于两个根因；第二脚本是实际观察补证，不应仅看进程 exitCode=0 当产品 PASS。禁止修改这两个审查原件或旧报告来过测。

复验需 R-01 get/list/scan/patch/confirm、健康邻居、修复后重扫、坏字节不变；R-02 摘要/计数与 UI；再做 Prompt 安全/恢复/确认/Meeting 关键回归。同冻结完整默认 suite + build 在字节相同可写副本执行，0 skip。产品/tests 停写后独立裁决。

工程全过后才按原 PA01-10 执行真实 Brief 编辑生成保存、弱/完整优化保存新项/版本、六模板及 custom 分列、实际浏览器恢复。Prompt 仍 0/24，全部阶段与失败计入预算；KB02 40/40 不重置。正式数据/实际配置/历史证据只读，不提交部署或推进下一批。
