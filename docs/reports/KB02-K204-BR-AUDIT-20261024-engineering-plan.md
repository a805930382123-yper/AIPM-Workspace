# BR独立检查准备

依据BR卡SHA `a5116f4081abaf1ba927b59d10b4111cf684a6276c29784b1e60128ada4a4bbe`；本文件非PASS或放行。当前Sol施工，独立验收只准备，不运行未冻结代码。新增模型0，知识226/500；原真实root工程前只读。

冻结后只做以下必要检查，不复跑提取链/445/build：

1. **真实前端依赖优先。** 从现行DraftReviewPage和对应client调用定位duplicates初载、保存重查、确认前重查、create/defer decision、审查与confirm；核最终BR路由逐项存在且真实执行生产查询。独立验证没有候选时200、有相似记录时实际候选；不能只直接调用confirm通过。
2. **实际前端链。** 在脱离原root的副本上运行实际DraftReviewPage组件或浏览器必要流程，缺duplicates应显式失败；修后加载→保存→查询→全页人审→确认→刷新回读。实际产品方法/HTTP请求日志应证明前端确实触发duplicates，而不是测试直接写同名结果。由主Agent后续真实Chrome验证原session最终流程。
3. **彻底无模型。** 核所有imports/初始化没有loadLlmConfig、OpenAiCompatibleProvider、ExtractionRunner；注册整knowledge模块时provider固定不可用、全部模型入口在handler前拒绝。以运行spy/拒绝网络守卫校所有实际模型路径及旧release/flag/env，0配置/0Provider构造/0send；本机允许端口可用，wrapper不是全进程网络监测。
4. **边界与版本。** 精确原session/root、原Raw/candidate/attempts/旧freeze绑定；错误root/draft、重复服务拒绝。初始v1校验与后续合法人审版本分开，启动GET不写业务内容、不重置原v1。原历史模型结果不可变；新draft审批和正式提交按原生产校验。
5. **独立原root保护。** 工程前后直接核卡给出的文件SHA及原root业务文件清单；施工自查只能副本。确认fake过程unit/member/evidence全对象保全，重复确认无额外变更。真实阶段再单独记录允许业务写与不可变证据。

最终检查优先复用Sol最终同字节自查定位必要覆盖，独立重跑本轮最小链并补未覆盖分支。发现失败即保留精确证据/最小复现，不自行修产品或扩测；必要副本准备错误单独说明，不混称产品失败。输出BR工程JSON/报告时明确“接线缺陷关闭证据”和“原阶段B真实全过程仍待Chrome”，二者不可混为PASS。
