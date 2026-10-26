# SYN01-RECHECK 新入口独立工程验收

2026-10-26，Astra medium。**新增入口工程通过，允许主Agent按已授权任务卡准备新会话并签唯一243 release；新真实原稿及Chrome闭环尚NOT_RUN，SYN01整体未通过，全产品未通过。** 本次真实0、配置读取0，知识242/500、Prompt15/24保持。未签真实release或读取私有响应。

HEAD `1944a3053df9b966f9cd39b273deec76b4e60f63`，产品提交 `d0553163a09f3ac5f4681430e398e7ef2b2d934a`，knowledge-workflows.ts SHA `b3269a215ed042b6822a2b77320d3cd2be60d0c40797b7cce50794e8047efbc9`。Sol交接 `SYN01-RECHECK-20261026-handoff.md` SHA `f81c976538e74c9124328dff0743977a59f5709938f1c3f3b06946fe851c7cc0`。新工具尚为未提交文件，以108项实物冻结为准。

独立读本轮卡、四工具源码/相对旧REAL差异及交接，确认只新增RECHECK前缀；新根和控制路径与旧242分离，session固定243/max1/起242/Prompt15。Provider只接受固定双Raw的v1完整请求并核SHA；匹配release/源码冻结后，以独占wx+sync持久预记账，再读取既有配置并外发。pending/completed/failed均不得重派；其它模型路由拒绝。存储和UI产品未改。复制适配入口是工程实现，不把旧版本测试当本轮实测。

实际执行一次新增smoke：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --input-type=module -e "const {smoke}=await import('./tests/acceptance/SYN01-RECHECK-20261026-smoke.mjs'); await smoke({reportPrefix:'SYN01-RECHECK-AUDIT-20261026-'});"
```

Node v24.20.0，执行权限允许本机Vite/API/子进程。session78714最终exit0，报告内耗时27455ms，fake1/config0/real0。4个顺序组通过：

- 实际Vite main/App及代理、未arm零调用、匹配release绑定。
- 实际App在jsdom从Raw选择→v1综合→明确审查/保存/确认→Wiki；公开读路由/安全导出、两Raw文件未变、第二次生成拒绝。
- 完成后重建服务，attempt243仍占位，零重新派发/配置读取。
- 另一个明确合成的pending/failed持久状态，重建Engine拒绝派发，fake/config均0。

[独立JSON](SYN01-RECHECK-AUDIT-20261026-smoke-1792984648729.json) SHA `67cb7080a39ae47816942f3d9c09672dfda86920b64a7638ff9f7177a7f81888`。末尾另执行只读freeze()及报告SHA核验exit0：108项冻结 **`5c5d46175823a03b1be133a1a15889e2518360c827d53a029d6b4e925a335724`** 与施工、自查及当前实物一致。无冻结漂移。未重复旧13/33/3/tsc、445、Vite全构建或其它矩阵。

既有5173占用，新Vite自行选5174，未触碰旧服务。WikiPage/AuditPanel有React act异步提示，断言通过；不把该jsdom结果冒称Chrome。自有API/Vite/DOM均正常关闭，隔离fake数据按入口设计保留为证据。无产品返修项，必要工程检查满足即停止追加测试。

## 主Agent续接

使用交接中的CLI顺序：`prepare` → `serve <新manifest>` → `bindings/status <新control>` → 主Agent以实际bindings、mode=real、sequence=243、maxCalls=1、当前session写唯一release → `arm <control> <release> <文件SHA>`。命令入口统一 `node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs`，路径取实际输出，不能用fake根。

arm前必须同108冻结、attempt=null、knowledgeUsed242/configReads0；Chrome工具可用后再放行。实际Chrome只触发一次，立即export保留原稿，先独立核原输出结构/来源/共同100/20%与30%冲突/未知与未来语义。失败立即stop，不补字段或重开会话绕过预算；成功才明确人工审查保存确认和刷新回读，人工更正单列。结束export/status/stop并关自有标签。

本轮新增接线工程通过；旧seq242失败证据仍保留，新243真实是否通过尚未知。512字符locator仅证明位置，不证明语义。后续以实际原稿与Chrome/落盘证据另作最终裁定；本报告不签SYN01整体或全产品通过。
