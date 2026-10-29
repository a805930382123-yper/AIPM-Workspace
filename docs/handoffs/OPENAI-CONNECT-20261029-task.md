# OPENAI-CONNECT：本机接入修复

基线：5f135a62689cc70e5529409c7c83fc1c3db51814。用户授权已有代理接入、gpt-6.1-terra temperature 兼容、定向测试、一次真实连接及独立验收。沿 agent-router 执行；评分需求0（目标明确）/耦合2（启动进程及Provider关键链）/风险2（Node版本兼容）/历史1（已实测连接及参数失败）=5，B模式。Astra规划及独立验收，Sol High施工。共享工作区不得回退其他修改；AGENTS.md和既有AGENT-ROUTER报告排除。

## 范围与接口

- 官方hostname严格为 api.openai.com 且模型严格为 gpt-6.1-terra 时不发送 temperature，覆盖knowledge、prompt及未传purpose。保留模型默认推理，不添加reasoning_effort或通用模型能力框架。其他模型、兼容端点和既有GLM请求不变。
- 增加明确的代理启动入口，使用已有环境变量或Windows已启用系统代理，环境配置优先，不硬编码本机端口、不修改系统代理、不提交本机配置。可采用PowerShell脚本启动子进程，并启用Node原生环境代理；普通dev入口及>=22.13兼容性保持。代理入口应检查实际支持的Node能力/最低版本，不让旧Node以不支持的flag启动。仅处理本机已证需要的代理形式；不扩PAC/SOCKS框架。
- 真实验证必须使用交付的代理入口和修改后的真实Provider路径，不能用手工删参数的裸fetch替代。仅主Agent执行一次、无自动重试，失败保留实际结果。既有诊断成功不算交付验证。
- 不修改schema、提示、Raw、草稿、Wiki、账户配置或既有质量判定；不重跑知识/Prompt矩阵，不增加真实业务生成。

## 文件所有权

Sol：services/llm/provider.ts、tests/provider-knowledge-reasoning.test.ts、package.json新增代理命令、scripts下单一代理启动脚本、必要README使用说明；可新增针对脚本的最小定向测试。施工报告docs/reports/OPENAI-CONNECT-20261029-builder.md。不更改锁文件依赖或Node普通运行最低版本。

Astra规划/验收：本任务卡、docs/reports/OPENAI-CONNECT-AUDIT-20261029.md。主Agent：真实连接记录、status/agent-control及统一提交同步。施工交接后停写再验收。

## 冻结验收

| ID | 必选证据 |
|---|---|
| C01 | 请求拦截定向测试：精确官方host/model三种purpose均无temperature；其他host/model及伪后缀host保持temperature0，GLM既有参数不变。 |
| C02 | 代理入口读已有配置、环境优先、无硬编码；支持版本正常启动，旧Node给明确可操作提示，普通dev仍不依赖新flag；脚本实际启动证据。 |
| C03 | 主Agent通过交付入口及Provider一次真实连接成功，记录命令、Node版本、退出结果和响应摘要，禁止输出密钥、Authorization或完整配置。失败不重试、不签PASS。 |
| C04 | 定向测试及必要类型检查通过；受测HEAD加变更文件SHA256；独立验收读实际diff及原始证据，可复用同版可信测试，不重复全矩阵。 |

交接列实际命令、耗时/退出码、文件指纹及未完成项，不仅写“测试通过”。真实调用由主Agent统一记账，与历史知识254/500、Prompt15/24区分；不重置既有预算。接入两缺陷结论与R16/R18、B09整批结论分开，局部接入通过不关闭既有O失败/Q未执行或批次阻塞。

全部必选通过后本轮交付；无新增授权不推进其他批次。施工者不运行真实请求、不提交、不推送。
