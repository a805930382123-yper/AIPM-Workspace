# SYN01 真实入口独立工程验收

2026-10-25，Astra medium独立审查。**R01/R02新增工程 PASS；SYN01真实闭环 BLOCKED，R03/R04 NOT_RUN；全产品/B09仍未通过。** 本轮未发现产品缺陷。Chrome工具不可用，主Agent未签实际release或消耗242；知识241/500、Prompt15/24保持。

按新卡与用户明确的Stop That Shit范围，只核新增4个源码文件及一次最小smoke；已通过SP01–06、H09、445/build继续复用，未重复旧套件。Sol停写、主Agent放行后才执行正式独立验证。验收仅新增本前缀文件，不修改产品、旧证据、配置或正式workspace。

## 版本与命令

HEAD `9bd732c0f7355447b067a471571819f732aa2844`，产品 `60f83adba102d887fcd925df13a8021ff7669de1`。实查产品范围Git差异为空。Sol最终smoke SHA `d514139d15df59cdbc5cade261a26b87c4c626b085361c59b1f498c13b29debc`匹配交接；107项源码/fixture/卡/依赖冻结 `f6455c07eb2150260f15165ea9c22be2901dcd76a6620007e02087ec9f249df0`，独立运行前后相同。

实际执行（经自动审批允许本机HTTP；只fake）：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-REAL-AUDIT-20261025-run.mjs
git diff --name-only 60f83adba102d887fcd925df13a8021ff7669de1 -- app services server rules package.json package-lock.json
```

第一条exit0，约19.5秒；新smoke三个顺序断言组通过，仅1次内存fake，真实0、实际配置读取0。另补原卡R01的pending/failed状态存在账本拒二次，共两条微断言，新增fake0；使用同一隔离会话临时改变result状态，finally恢复completed原文件，不改不可变attempt。不是再跑旧门禁矩阵。

| 独立证据 | SHA256 |
|---|---|
| [最小App/Vite/预算smoke](SYN01-REAL-AUDIT-20261025-smoke-1792935897703.json) | `7c0b90d718dd55b1707e817a350839c5bf7aafd868266ae3dad68cdc16796116` |
| [pending/failed零调用核验](SYN01-REAL-AUDIT-20261025-reservation-1792935917241.json) | `55cf76b672357d9fc24bb57f41e7348d1a6fc345adf20ff90b5b3ceddc12a5b4` |

## 必要标准裁决

| ID | 裁决及证据 |
|---|---|
| R01 | PASS。未arm的实际公开POST拒绝，attempt不存在、配置0。源码核固定双Raw、session/源码/卡/输入绑定、release精确SHA及唯一arm；其他模型入口被allowlist拒绝，注册知识路由的Provider后备也拒绝。complete先用wx+fsync落不可变attempt，再读配置/派发，最多1次且无重试。completed后公开再请求及重启provider拒绝；pending/failed额外实测也ATTEMPT_LIMIT，sent/configReads均0。 |
| R02 | PASS（工程）。真实Vite入口提供现有app/main/App，configFile/envFile均false；实际React App经Vite proxy从首页/Raw选择两来源→生成→工作流审查/保存/明确确认→Wiki。3页落盘，Wiki/schema/Raw references/export路由实际读通，双Raw哈希不变。新export秘密扫描的嵌套JSON/编码负例拒绝。 |
| R03 | BLOCKED / NOT_RUN。主Agent报告CUA及备用工具初始化均失败：`failed to write kernel assets`，路径不存在；一次reset后仍失败。没有触发真实242，没有真实响应/原稿可作质量裁决。浏览器工具错误是主Agent实查信息，独立者未重复诊断。 |
| R04 | BLOCKED / NOT_RUN。真实Chrome审查、正式确认和刷新回读未执行。React/jsdom与fake工程证据不能替代此项。 |
| R05 | 本子Agent服务收尾完成，最终Git/范围/远端核对由主Agent执行。独立隔离根`.scratch-SYN01-REAL-20261025-Rgeie1`的Vite/API均关闭、server.lock事后不存在；无本轮真实账本消耗。 |

静态核验真实Provider只在获release且持久占用attempt后沿既有loadLlmConfig与OpenAiCompatibleProvider路径创建；此次fake分支没有调用它。私有响应/原始合法候选单独保存，export按已加载秘密扫描；重启丢失真实秘密扫描上下文时拒绝导出response。没有为本轮工程读取实际.env.local。未来真机网络、配置可用性及模型质量仍需实际执行才有结论。

独立命令输出有WikiPage/AuditPanel迟到更新的React `act(...)`提示，与施工报告相同；断言全部通过，未据此声称Chrome视觉验证。施工第二次新smoke是CLI control文件重启替换与导出扫描修改后的复验，两次成功记录保留，不混计测试数。

本轮新增装配没有待修复问题。真实执行受浏览器工具阻塞，因此保留完整任务未完成状态，不关闭A18/R20/R07真实综合缺证，也不消耗调用来绕过Chrome门槛。工具恢复后按已授权同卡、同固定输入与至多1次242继续，不重开旧工程矩阵；首真实失败停止。独立验收交接后停写，主Agent统一提交与同步。token计量不可得。
