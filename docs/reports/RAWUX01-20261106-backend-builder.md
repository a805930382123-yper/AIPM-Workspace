# RAWUX01 后端施工交接（2026-11-06）

Sol High `/root/kb03_r1_builder`，B 模式。基线 HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b` 加开工时未提交工作树。15 个施工文件及 14 个开工 SHA 在 `RAWUX01-20261106-backend-fingerprints.json`。UI 与浏览器由 UI 施工实例交接，批次结论由 Astra 独立裁决。

Raw 草稿响应新增 `outcomeDigest`，包括编辑后响应。现有 `POST /api/drafts/:id/confirm` 以 `{baseRevision, selectedPageIds, idempotencyKey, outcomeDigest}` 表示这一次成果确认。事务清单冻结版本、内容摘要、所选页面、实际写入快照及一份 `outcomeReview`。草稿编辑锁内重新验证，重启恢复使用同一份冻结快照。同请求并发和丢失响应重试复用同一操作，改选或改内容不会复用旧确认。旧无字段调用继续走原逐项审核合同，问答和知识检查草稿拒绝 Raw 成果确认字段。

旧标准和旧深度可直接确认本次选项，旧深度保留显式零卡写 Source。旧深度正式文本按实际行为标注已进行成果审核，模型报告及确定性提醒不写作人工逐项确认。新维护草稿以请求选集决定本次写入，依赖必须已提交或在本次选中。未选项保留为下一批，Source 按实际提交累积有效链接。人工 Source 文本保留，未选且没有正式页的已知候选链接显示为普通文字。同名已有正式页的链接保留。新路径不生成 page/change/note 审批，已有审批历史原样保存。原文实际 SHA、选中证据原句、实际笔记引用、来源限制及维护目标版本仍在正式写入前校验。

标准、深度、维护阶段去掉产品请求次数上限，包括请求前、检查点语义验证、恢复入口和终态对账。保留发送前持久化计数、累计下限、模式/规则/Provider 身份、取消、超时及显式继续。测试和验收工具独立预算保持。超过旧上限的已失败 deep job 在原 checkpoint 累计 11，写入历史 `LLM_ATTEMPT_LIMIT` 状态后，由新 Runner 初始化产生 0 请求，用户显式续同一 job 第 12 次仅跑维护，生成草稿。标准在累计 5 和 7 后同一 job 分别以 7、9 次完成，已验证块未重提取。

最终后端定向 69/69，0 失败、跳过、取消、todo。覆盖旧深度 32 单元/选 10/仅 2 历史页审批/无笔记审批、旧深度 Source-only、旧标准无历史目录及历史暂缓重选、现代维护两批/依赖/目标版本、GET 不改历史、编辑后摘要、旧 revision 和旧摘要、并发幂等、已选坏引用拒绝及未选坏引用隔离、QA/检查隔离、实盘 Source 已写后 fresh Node 恢复同一操作与日志。此前复验发现两项旧测试前提或夹具问题，旧深度次数断言改为拒绝持久计数倒退，旧标准/QA 合成夹具修正独立 Source 标题及可检索 Wiki 证据。最后一次定向前，Source 同名现存页反例使用合法人工 Wiki 状态，复用 HTTP helper 的类型保留旧调用端传入额外字段的能力。

```powershell
node --import tsx --test tests/rawux01-http.test.ts tests/kb02-planning-budget.test.ts tests/kb03-deep.test.ts tests/kb03-confirm.test.ts tests/lw01-maintenance.test.ts tests/lw01-recovery.test.ts tests/lw02-main.test.ts tests/lw03-http.test.ts
npx tsc -b
```

当前类型检查 exit 0。`git diff --check` 按后端文件检查通过（Git 的 LF/CRLF 提示为既有 Windows 配置）。原始日志根 `C:\Users\David.chen\AppData\Local\Temp\rawux01-backend-a30ca09e-5f12-48d3-9597-236759813dd3`，最终定向 `targeted-final.txt`，前一次夹具失败 `targeted.txt`，类型检查 `tsc-first.txt`。真实 Provider 0，真实配置读取 0，正式 workspace 读写 0。所有服务测试只用 TEMP 合成资料、本机 HTTP 与 fake。未提交推送。

冻结 UI 合并版本的首次 `npm test` 为 746 项中 744 通过、2 失败，原始 `npm-test.txt`。一项为旧 storage UI 就绪定位，UI 施工改为当前成果页和选择控件。另一项为 R8 历史路径位于另一个 Windows 用户的 TEMP，CLI 先执行当前 TEMP 边界。只改迁移测试按路径匹配明确的第一道安全拒绝，保留直接 R8 守卫和隔离账本零写入断言。最终 `npm test` exit 0，746/746，0 失败/跳过/取消/todo，62.263 秒，日志 `npm-test-final.txt`。最终 `npx tsc -b` exit 0，日志 `tsc-final.txt`。后端与测试已停写。
