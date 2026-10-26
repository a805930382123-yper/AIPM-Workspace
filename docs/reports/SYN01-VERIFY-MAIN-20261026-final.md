# SYN01-VERIFY 主Agent真实执行记录（2026-10-26）

B模式0/2/2/1=5；Sol High适配受控入口并自查、Astra独立工程及原稿验收、主Agent执行Chrome及收尾。产品与基线提交fcd0e23953e872d3f2bf733ef6d71617b7c98045，产品SHA eab0d663fb83835474f65fbaecd26df1a503d773dd26f2a7138c8dc7635a2032。仅新增验证工具/证据，无产品修改。108冻结0abd0b2cf140a3a0f0c8e44daa23346ae420373a18cc5e83a387822f5bf51a3f。

用户最多3次授权，本轮仅安排并执行244一次，245/246保留未用。入口仍max1，首成功闭环即止，不为用完额度重复验证。

## 真实调用及审批记录

唯一会话5963ce8a-b3fc-4e3d-98b7-94137373e489，隔离根.scratch-SYN01-VERIFY-20261026-vlShr1。固定双Raw：A 9d3ecc3c-ee95-4539-9e22-2143a23f5325，B 6afa32dd-36a7-42b0-9e86-99b509f3485e；正文与原fixture一致，非实际业务数据。

主Agent核对工程报告与当前bindings，prepare/serve无外发，arm前status知识243/attempt=null/config0。Chrome861044528进入5174固定双Raw；签唯一release：SYN01-VERIFY-MAIN-20261026-release-244.json，SHA127488df9470dca88d0ed15fa91a41b2b5e2eae258c8daee7e75ebc2977d0473。

第一次生成点击被自动审批拦截，理由为外发敏感内容与目标授权不具体；未执行点击，随后status确认attempt=null/config0/real0。只读核fixture的simulationOnly:true及两份全文均为虚构演示，无个人/真实业务数据；据此在相同Chrome控件再次提交同操作，审批允许。没有换接口绕过拒绝，没有额外模型调用。最终账本真实仅1，预占时间2026-10-26T08:35:07.365Z，request SHA89d1374abcf6bea32c5851409a86c5f372c081d49cbae1bc6ccd2458a7015ba1；Provider安全摘要open.bigmodel.cn/GLM-5.3-Flash。

原稿workflow2fa6839d-52b9-4236-b98d-b05b0fa9b805，rev1/pending_confirmation/approvals0/Wiki0。先保存未经编辑export-1793003796373.json（SHA372a0dd0fd9e43252a254d97b79dec0ac57e1888d70e9c02db540e1f2333f4aa）及original.png，交Astra按原oracle独立通过V03后才继续。原稿与历史242/243失败均保留。

## 实际Chrome闭环

逐条读取候选12个人审单元及原文定位，Astra核8个事实条目支持有效。主Agent未改标题/正文/分栏/归属内容，明确点击“确认本页主题与完整归属”，界面rev2/本页已审查/未解决0；点击“保存草稿”（无内容改变，版本仍2）；随后“确认写入”，完成后返回Raw。

主动reload刷新：首页Wiki3、待审核0、最近3条新建记录。重开综合页abbeaf73-2077-4e1e-870d-1cec2944558a、来源A bc1d444b-5c8b-4b34-8e42-1602eb598818、来源B 29b7001b-0877-4627-8d2f-9a6425254a72，均第1版，正文及Raw关联可见。通过来源B的打开Raw按钮回读B，再选择A，全文及SHA与原输入一致。截图saved.png及synthesis/sourceA/sourceB/rawA/rawB.txt为实际Chrome状态；文本可能是前后AX差异，需与上下文共同阅读。

Wiki页面“人工审核 未审核”原样记录，不以界面此标签代替workflow审查状态，也不擅自修订元数据。持久workflow为confirmed/revision3、approval1，其含义与卡要求是否相符交Astra独立核。三条create日志同operationId adf760d1-cc9c-4d0f-ad23-4345d221bbe1。对应字段、日志与原稿/最终Wiki比较见最终独立报告。没有人工改写版本，没有为保存追加模型调用。

## 实际命令及结果

仓库根PowerShell，统一入口：

```text
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs prepare
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs serve <manifest>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs bindings <control>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs status <control>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs arm <control> <release绝对路径> <releaseSHA>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs export <control>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs stop <control>
```

manifest为docs/reports/SYN01-VERIFY-20261026-session-5963ce8a-b3fc-4e3d-98b7-94137373e489.json；control为同目录SYN01-VERIFY-20261026-lab-5963ce8a-b3fc-4e3d-98b7-94137373e489.json。status在放行前、审批拦截后、生成后、正式确认后执行；export在原稿及正式确认后各一次。上述命令均exit0；serve86553最终exit0，API51799/UI5174关闭，自有Chrome关闭，原5173服务未动。

最终export-1793004448646.json保留3Wiki和原稿；persisted.json记录实际已确认workflow及三创建日志。正式用户workspace未写，持久化均在本轮隔离根。实际config1/real1/fake0，知识244/500、Prompt15/24。Sol和Astra工程smoke各fake1/config0，实际命令与各自耗时见交接/工程报告；未重跑全量、旧矩阵或tsc。

局部与批次最终裁定以SYN01-VERIFY-AUDIT-20261026-final.md为准。单样本成功不代表通用模型遵从保证。主Agent同步仅本轮指定文件和既有状态入口，排除AGENTS/.agents/AGENT-ROUTER及隔离配置数据；最终交付SHA和实时远端核验在用户汇报记录。本轮结束，不自动启动下一批。