# R16/R18 自动字段质量：独立准备验收

2026-10-27，Astra medium。基线 `130e440c3669b839ce433ddbd31d6f886a8637d9` 加本轮新增fixture及入口，施工已停写后审查。最终交付提交由主Agent关联Git历史；验收方未改产品/tests、未执行Git写操作。

## 分层结论

**Q01零调用准备：通过。** 固定六句资料、窄执行入口、两请求预占、原始Draft及渲染导出达到本轮准备标准。独立新增smoke一次通过，未发现必须返修项。

**Q02真实原稿质量、Q03真实outcome→Draft及渲染：阻塞待验证，尚未执行。** 本轮真实请求具体上限待用户确认；知识244/500、Prompt15/24不变。R16/R18整项、B09及全产品仍未通过，R18历史失败保留。fake通过不是自动语义质量通过；本轮没有浏览器或正式提交，既有F04仅作为历史功能证据复用。

## 实物审查

fixture只含资料元数据及六句原文，正文顺序和连接方式与既有工程夹具一致；oracle保存在独立[方案报告](R1618-QUALITY-AUDIT-20261027-plan.md)，不进入请求。fakeReply仅在fake模式执行，不用于真实回复或质量真值。

prepare创建专属隔离根、Raw及冻结，不调用Provider。run先核release准确SHA、批准字段、会话/mode/Raw/fixture/源码及245–246上限；独占run-started防同会话重派。每次complete仅接受knowledge用途及extracting→planning顺序，重新核冻结，独占写attempt并fsync后才进入实际Provider路径，第三次拒绝。错误终止且保留预占，不自动重试。是否签真实release仍由主Agent在用户确认具体预算后执行，工具中的布尔字段不是用户授权证据。

入口直接复用实际pipeline、checkpoint、DraftStore与渲染。成功Provider completion先存private原响应，经秘密扫描后导出响应；保存原始Draft、preview、outcome、checkpoint及Raw不变检查，不编辑、选中、审批或正式化。若Provider在返回completion前报HTTP/网络错误，只有预占及result错误码，没有完整HTTP响应正文；不得声称该情形已归档完整原响应。已有Provider本身无自动重试。

配置零读取依据为实际执行路径：smoke调用prepare('fake')，只有real分支才调用loadLlmConfig及创建真实Provider。读取config.ts源码可确认模块导入本身不读取实际配置；环境/本地文件读取位于loadLlmConfig函数调用内。独立未调用该函数、未查看实际环境配置值或.env.local。configReads:0与源码路径相符，不单凭元数据推断。

## 实际命令与证据

| 实际检查 | 结果 |
| --- | --- |
| `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke` | exit0，0.782秒；未放行零调用、两fake请求原稿出稿、已用会话拒绝重派三检查通过。fake2/real0/config0 |
| `Get-FileHash` 核fixture及入口 | 两项均与施工冻结一致，见下 |
| 读取真实准备会话freeze.json，对64项逐一 `Get-FileHash` 比较 | 64项、漂移0；聚合记录e46227d640f31cf3b78d25a7e331ace7da67008e298f292f4bfb8b3fdd7745e2 |
| `Get-ChildItem` 真实准备根 | 仅数据目录、freeze.json、session.json；无release、attempt或run-started |
| 读取入口/fixture/施工报告与相关产品导入及配置/Provider函数；`git diff --name-only`、`git status --short` | 无产品修改；外部AGENTS及AGENT-ROUTER报告未触碰，状态文件归主Agent |

独立fake证据根：`E:\AI\Work\AIPM Workspace\.scratch-R1618-QUALITY-20261027-56HYV6`，Draft `5a3b7738-c555-4081-8e23-3262438cca65`。candidate-original.json包含两类型AI字段及原fact引用、原5事实文本、Raw字节一致及分析建议渲染；只存在245/246两份fake attempt。它不是本轮真实账本消费。

| 冻结对象 | SHA256 |
| --- | --- |
| fixture.json | `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7` |
| run.mjs | `4b97dbf3e51c4b220a6d885e8c1f3aaab13f71190969c9895b71ba3cea0ed3da` |

未重跑tsc、历史矩阵或人工F04。未启动服务、真实Provider或浏览器。平台token计量不可得。

## 下一步边界

准备已可审阅，可请用户确认同一六句虚构资料、最多2次实际请求（245–246，失败亦计，首失败即停）、读取当前产品模型配置用于该受控请求。确认后主Agent核本会话冻结并签release，执行一次流程，独立按预先oracle判原稿；不得用SYN01余量、重建消费会话或人工改稿代替通过。若用户尚未确认，保持真实0并停止。
