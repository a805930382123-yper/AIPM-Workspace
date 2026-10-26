# SYN01-SEM 提示明确性改善施工交接

2026-10-26，Sol High。按Astra冻结任务卡（SHA256 `64aa6526e9dd8791b6d83f76d9a885f7a2314776dd6d26d59362a8f1482164bd`）完成最小施工与自查，**提示明确性改善工程自查通过，现冻结停写，待Astra独立验收**。不自签批次最终通过。

基线/当前HEAD `9622d9b98172b04eba9b52b2c833b958a4f757ef`。真实0、实际配置读取0、额外LLM评审0、服务启动0；知识243/500、Prompt15/24不变。

## 实际变更与范围

产品仅 `services/wiki/knowledge-workflows.ts:180` 的createSynthesis system字面量，git numstat为1行删除/1行增加。保留原提示并追加四组要求：所有来源的核心事实及重要限定必须进入section语义正文；未来/未知保留限定并明确分栏；单Raw最小断言的通用正反例；生成前逐条自检。例子用来源甲/乙、周/月口径，没有清禾/AI审批/100/20%/30%特判。

v1八字段、自由概括、user和超时/字节/用途参数、call解析/机械校验、locator、持久化证据、人审及update代码均未改。没有实现诊断候选A逐字v2，也没有新增coverage、多证据或语义判断框架。新增 `tests/acceptance/SYN01-SEM-20261026-check.mjs`；未修改旧helper/默认测试/旧原稿/报告、主状态或Astra卡，未提交推送，外部AGENTS/.agents/AGENT-ROUTER改动保留。

## SM01–SM05 实际自查

| ID | 实际结果 |
|---|---|
| SM01 | 原243 response.text原样经生产createSynthesis内存回放1次，仍机械接受；9条证据/12个人审unit、approvals0，原section文本完全一致。save截获不落盘。旧原稿仍遗漏未来内容且保留三条单Raw复合断言，质量FAIL不变。 |
| SM02 | 实际捕获请求system有新增四组规则，user与旧请求逐字相同，其他参数深比较完全一致；仍v1及13分类/原文/目录。提示存在不证明模型理解或执行自检。 |
| SM03 | 两份明确标SYNTHETIC的人工响应经生产路径接受：固定双来源保留限定、单方分别引证并用忠实同义概括；另一份森岚检修试用/夜班条件、拟议排程和周/月口径的小样本也允许概括。sections/evidence按原结构保存至内存，人审均未确认。不是实际模型输出，也不是泛化质量验证。 |
| SM04 | 卡指定现成synthesis存储形状及update请求对照2/2通过；HTTP/UI/人审机制代码未变，复用前轮有效证据，没有重跑旧HTTP/Chrome/13/33/3矩阵。 |
| SM05 | 新检查、指定两项测试、tsc及diff检查均完成。实测版本/指纹如下。 |

实际命令及耗时（Node v24.20.0，Windows PowerShell）：

```text
node --import tsx tests/acceptance/SYN01-SEM-20261026-check.mjs
node --import tsx --test --test-name-pattern 'FINAL-02 synthesis|FINAL-02 request' tests/kb02-final-agreement.test.ts
npx tsc -b
git diff --check
```

- 新检查最终exit0，内部21ms、工具墙钟0.845秒；输出SM01/SM02/SM03-fixed/SM03-other四条技术记录，3次内存响应回放，磁盘候选写入0、真实0、配置0。它们与两个默认test不合并成业务场景总数。
- 两个指定test exit0、2/2，runner 3209.324ms、工具墙钟4.170秒；没有skip或失败。
- tsc exit0，无类型错误。工具10.015秒返回session51185，随后poll确认exit0；独立总编译墙钟未采集，不估造。
- diff --check exit0，仅外部文件有既有LF/CRLF提示；已读取实际产品diff，确实只有该system字符串一行。

新增检查首跑受沙箱阻止tsx/esbuild子进程，spawn EPERM，未执行到断言；在已授权范围内用执行权限重跑同命令exit0，无代码修补、无模型重试，没有自动审批拒绝或剩余执行阻塞。未执行全量、旧入口/Vite构建或可选守卫。

## 受测冻结与原证据

| 文件 | SHA256 |
|---|---|
| services/wiki/knowledge-workflows.ts | eab0d663fb83835474f65fbaecd26df1a503d773dd26f2a7138c8dc7635a2032 |
| tests/acceptance/SYN01-SEM-20261026-check.mjs | 909b91d1bdfb67a186149bb4a1d401bf94384818c8f34e1c843167893b29100a |
| docs/reports/SYN01-RECHECK-20261026-export-1792985404518.json | 2c7bd005e904ac31c23000cb4b609b7642f1584079c42cd328ceecde5bfbe573 |

原243导出前后SHA一致，未改旧response或候选；本轮所有save均内存截获，不写正式workspace或隔离原会话。不存在人工补写版/新真实产出可替代旧失败。

## 结论边界与交接

本次只证明请求更明确、协议兼容且未误改其他分支。**两个真实语义质量缺陷仍未证明修复，不能标CLOSED；seq243质量FAIL、R04真实NOT_RUN、SYN01及全产品未通过保持。** 服务器仍不判断自由自然语言的语义完整性/蕴含关系；新提示也可能不被模型遵从。合成作者可以写出合规响应，不代表真实模型必然能做到。

无新增真实额度或自动下一步。必要检查满足即停止，产品/tests已冻结交Astra独立核实际diff/新检查，由主Agent统一状态与Git。后续真实方向由用户决定，本报告不解除账本或重开242/243。
