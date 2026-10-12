# 全项目审查返修：2026-10-10

用户授权按 `docs/reports/FULL-20261009-acceptance.md` 修复现有项目。本次不是 B10，不增功能，不补签真实 Provider。保留原 FAIL 报告和全部历史证据。

## 角色与文件所有权

- GPT-6 Luna High builder：产品修复 `services/audit/service.ts`、`services/raw/store.ts` 及必要的相关调用点；新增针对性单测。修改调用点前说明原因。不得修改当前/历史文档、历史验收脚本或报告、正式 workspace、Provider 配置和依赖。
- 主 Agent：冻结接口/范围，独立 HTTP、文件与回归验收；修正当前 `docs/acceptance.md`、`docs/delivery-matrix.md`、`docs/delivery.md`、`docs/status.md`；仅新增 `FULL-20261010-repair*` 验收脚本和报告。

## S-01：Audit 成功输出凭证回显（R41）

Provider 输出进入响应或草稿前，检查所有已知 `provider.secrets`；命中则返回明确、安全的失败，不包含凭证或可能含凭证的路径/片段。覆盖 replacement、rationale、evidence 及 JSON 转义等变体，避免只扫描原始 JSON 而漏掉解析后的转义值。任何失败不得写新草稿/修改已有 pending 草稿、Audit、Wiki、Raw；干净输出可重试成功。异常脱敏保持。

## S-02：Raw 正文摘要完整性

统一 Raw 读取边界验证正文的 UTF-8 SHA-256 与持久化 `bodySha256` 一致，缺失/非法摘要明确拒绝。保留正文换行、空格、emoji 原字节，不自动修正摘要、不重写 Raw。`get`、`list`、首次提取遇到损坏应明确失败（稳定完整性错误码和合理 HTTP 状态），不调用 Provider，不创建 job/draft，不滞留 processing。恢复原始文件后可正常读/提取。现有更新、综合、Audit 的 stale/完整性保护仍有效；不能把读取失败伪装不存在或成功。

## D-01/02：文档与证据

当前矩阵 B03 最终证据改为 `B03-recheck-acceptance.md`。验收方案当前授权/状态改为全项目审查返修，2026-10-04 记录标为历史。109 个 A/R 条目及原判据不改。最终当前矩阵反映新的实际证据，真实 Provider 的 36 个 BLOCKED 保留。

## 交接与验收

builder 交付变更文件、原理、针对性单测结果、未完成/风险后停止写入。主 Agent 独立冻结后运行 build、完整单测及 S-01/S-02 HTTP/磁盘复验，并回归 B05、B06、B08 相关流程。测试只用独立临时数据根和本地 fake，密钥仅虚构、不打印；不得覆盖旧证据。产品验收期间 SHA 不变，正式 workspace 和所有既有报告/架构/需求文件 SHA 不变。真 Provider/真实内容质量无配置则保持 BLOCKED；未实测浏览器不写 PASS。
