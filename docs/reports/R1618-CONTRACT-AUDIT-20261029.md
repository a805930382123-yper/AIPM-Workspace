# R16/R18 结构化输出契约独立审查

2026-10-29；独立 Agent `contract_review`。仅写本报告；未参与诊断报告编写，不修改产品、状态、原证据或他人文件，不提交。

**本轮契约检查 PASS；未找到明确契约配置遗漏，停止自动修复。产品修复未实施，不能签缺陷已修复。O仍失败、Q未执行，R16/R18、B09及全产品整体未通过。** 知识254/500、Prompt15/24保持。

## 判断依据

独立阅读诊断报告、status、B09、agent-router、相关PRD/acceptance条目、架构段落及实际provider/planning源码和定向测试。PRD要求优先返回结构化JSON；架构明确JSON模式不保证业务字段。源码仅在knowledge/prompt、精确官方host、glm-5.3-flash组合发送json_object，规划system包含完整schema，返回后先parse再严格schema验证，之后才组装。没有现成strict schema参数被遗漏的证据。架构历史knowledge-only措辞滞后不改变本次knowledge判断。

历史request-254是应用请求记录，不是HTTP抓包；不能据它确定254实际host/model、response_format或服务商是否执行JSON模式。当前代码路径与fake HTTP body断言只证明adapter行为。本轮未读取真实配置，未核验外部Provider当前strict schema能力；诊断报告明确保留这些限制，未越界推断。

原254合法JSON但pages为object/string/string，严格拒绝符合领域协议。复用上一轮已独立验收的真实pipeline离线重放及最小validator验证，不把局部合法页当完整成功，不过滤字符串或放宽schema。

## 版本及验证证据

实查HEAD `f496ef7c1f11f69f5d3b1d4f53321380db510287`。本轮实际执行只读Get-Content、rg、Get-FileHash及 `git -c safe.directory='E:/AI/Work/AIPM Workspace' rev-parse HEAD`；普通git首次因所有权校验失败，随后命令级safe.directory成功，未改全局配置。

独立核SHA与诊断报告一致：provider `7f80cb0b7758de5b4c74112ab831f01409896d49c4a2afe7c3e2b04fa05ca945`；knowledge-extraction `e38ea70c3945553b76c6d02645e674b79658f36993c008f724d1e3711a8df59c`；planning schema `ba5f6ffcbb4523cdc2f235062cd1c6a72ef5d3dd3dda14afb57bfd835fe3e974`；provider测试 `0ce951cdee0da79355117c667d4a25f333da327f26d93e11891daf5fead13861`。

复用Sol本轮命令 `node --import tsx --test --test-name-pattern='GLM-5.3-Flash|no reasoning hint' tests/provider-knowledge-reasoning.test.ts`：记录exit0、2/2通过。独立阅读测试确认它拦截实际adapter构造body，覆盖正向两个purpose/官方host及反向host/model/purpose条件，没有真实网络。未重复运行。

复用历史命令 `node --import tsx .scratch-R1618-OQ-DIAG-20261029/replay.mjs`：既有独立报告接受exit0、精确拒绝pages[1]/[2]及无plan/outcome。此次核脚本SHA `b615eb10d7a82afdb6925fd307b645a48e2977891ac0389838c72dc0a25bfb3c`、结果SHA `b9bc009142fb93ac03557cb36bdd8f0c25d75316bb4a82c673523149d685cdc8`均一致，结果记录66项冻结无漂移。基于关键代码同版与原独立证据复用，不重跑完整矩阵。本轮独立审查新增测试0、真实调用0、配置读取0、网络0；文档提交由主Agent关联。

## 评分与停止条件

本批0/1/0/1=2：目标明确、provider与schema少量边界、仅可逆文档、一次相关有效结构失败。复用主线程安排的Sol诊断与独立审查，不将整个B09风险套用为本轮评分，不追改历史角色。

当前没有明确遗漏可进入最小返修。停止自动修复与重复诊断，不追加抽样或异常特例。下一步需要用户业务选择：保留当前Provider及失败状态，或选择更换已支持Provider，或明确另行评估外部strict schema能力的目标。后两者应另定实际范围，任何真实验证需明确预算且沿O先通过才放行Q；剩余预算不是重试授权。本轮检查通过不解决O完整输出缺证或Q未执行，也不推进R22/四链。
