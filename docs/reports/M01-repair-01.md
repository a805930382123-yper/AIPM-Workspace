# M01 首轮返修卡

2026-10-11。主 Agent 冻结产品后独立实跑，HTTP 21 PASS / 2 FAIL；专项边界 0 PASS / 11 FAIL。证据 M01-initial-http.json、M01-initial-privacy.json。所有失败均已由实际服务/磁盘复现，非模拟服务层推测。禁止修改独立验收脚本或历史证据。

| 问题 | 必须修复的行为 |
|---|---|
| F01 策略绕过 | 已 Restricted 不能通过 policy 申请 local_archive/本地或 Raw 授权；Internal/Sensitive 从 false 授予 local_storage_authorized 即使 cloud 也需独立确认；local_archive 不能保留 Internal/Sensitive 的 false 授权，撤销需同时显式改 cloud；回 cloud 清 Raw 授权；保留现有提高等级重新确认与清 Raw 门禁。 |
| F02 清除不完整 | 升 Restricted 的清空不能仅清当前字段，creation.input 仍残留客户/正文备注/链接。新记录只持久 requestId 与规范输入 SHA-256 摘要，用于幂等比较；不能以自动迁移覆盖损坏记录。M01尚未上线，不要求兼容此次临时失败夹具。 |
| F03 损坏记录 | 对持久化对象执行严格字段白名单、日期/时间/文本/HTTPS/UUID/数组上限/时间戳/幂等摘要与策略一致性检查。未知 imported_minutes 字段、javascript URL、Restricted 的客户/标签/本地策略等必须409，详情/列表/更新/删除均不回显、不覆写。目录结构也需严格白名单、名称规范/去重和稳定引用检查，不能只检查 JS 类型。 |
| F04 错误回显 | 未知字段键是用户输入，可能就是链接或私密片段；UNKNOWN_FIELD 消息/details 不回显任意未知键。仅返回固定白名单内已知字段名。 |
| F05 目录丢失 | records 已有数据时 catalog.json 丢失必须409并保留缺失现场，不能重新生成 UUID 使旧引用脱离；空全新或旧备份无 meetings 时仍正常初始化。 |
| F06 幂等历史引用 | 同一原始创建请求在类型停用后仍可200返回同一已创建对象；新创建选择停用类型仍422。同键同规范输入摘要先识别已有结果，再检查仅新创建需要的 active 条件。 |

同一 Luna 施工，文件所有权不变。维护必要的定向测试，运行 targeted tests/tsc；交接后冻结，主 Agent 重新独立 HTTP/专项/实际 CLI/旧链/构建与完整测试。M02未授权。删除流程过期注释也应清理，避免与实际 unlink 相冲突。
