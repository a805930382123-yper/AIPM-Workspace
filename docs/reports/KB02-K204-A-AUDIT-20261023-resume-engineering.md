# 阶段A独立工程签收（恢复后）

结论：本轮阶段A适配器工程通过；真实A1/A2/A3未运行，KB02整体仍BLOCKED。没有关闭历史模型质量缺陷，没有创建release、读取真实配置或发送真实请求。真实累计219/500、Prompt15/24保持。主Agent可以签发A1，不能一次放行三段。

受测基线提交 `41ee7862305f71ae9a35c26b84a8db58dcc747c3`；产品 `60f83ad`；四个适配器及188既有文件的freeze SHA256为 `a6ba495b97cb271da732cbed32c0243ab4508a675333e3e1b440093d48d00aaa`。本次再次逐项核验工作区及前实例隔离副本192文件，同冻结，探针后零漂移。施工尚未提交，以此冻结精确标识受测增量；主Agent提交后关联提交号。

## 独立证据与命令

前实例已独立在同字节副本执行 `node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-A-20261023-cli.mjs selftest`，Node25.2.1、exit0、16组通过。已核其 engineering-execution.json、完整 engineering-selftest-2026-10-23T13-00-17-432Z.json、执行脚本及实际四模块；不重复全量测试，也不把施工者自查当独立证据。

本次补充实际命令：`node --import tsx tests/acceptance/KB02-K204-A-AUDIT-20261023-resume-probes.mjs`。首次沙箱localhost fetch失败，原 `resume-probes.json` 保留为未完成记录；随后仅本机fake访问获自动审批后exit0，见 `resume-probes-1792817124135.json`。没有重试真实请求。两次测试不改冻结源码；脚本仅改为新增时间戳输出以保留首失败。

| 项 | 独立观察 |
|---|---|
| E01 | 缺release、错SHA/session/stage、released:false、超额模板及B/C/all拒绝；本次增加KB02_REAL变量与逐字session不变断言，loader/send/账本全0。 |
| E02 | 完整独立selftest真实产品提取路径2fake，pending先于send，重复点击仅一个202/另一个409，第二实例拒绝，无自动A2。 |
| E03 | HTTP200但提取schema/来源/规划/A2/A3失败均永久stop；后续arm拒绝；原错误和占额保留。 |
| E04 | 账本写失败0send、崩溃pending不重发、正常五序号唯一；本次独立在result-220.json制造目录，合法响应后落盘EEXIST，恰1fake/1attempt，A1 failed且重新arm拒绝，私有响应保留。 |
| E05 | A3已release后非选中页撤审/编辑、目标变化均在loader/send之前拒绝；正常新预览未审、正式更新需显式审查与确认。 |
| E06 | 完整自查的重定向、URL options及custom transport拒绝、未登记sink0；本次额外直接fetch/http.get未登记sink均拒绝且实际hits0；假秘密回显仅hash/withheld可导出并stop。 |
| E07 | 同冻结独立完整HTTP 2+2+1fake链，metric创建/备注、A2审查、更新预览审查与确认/幂等、双来源20/30和备注回读通过。实际Chrome由主Agent另记：A1查看、逐页审查、创建metric并回读完成；备注未保存，A2/A3 Chrome尚未做，不能冒称完整浏览器或真实质量验收。 |

源码复核：core的release/arm/begin/send四处校验及dispatch锁、server生产stores与路由窄接线、产品settlement失败持久stop、CLI不自动启动提取、生产Provider透传身份与参数、最终wire/body比对、真实配置延迟加载均符合卡。Provider网络仅精确端点且redirect:error；本机白名单与受限http签名无已发现旁路。此结论是调用链检查加实际sink证据，不宣称全进程网络遥测。真实配置可用性未探测。

## 主Agent release接口

工程证据使用 `docs/reports/KB02-K204-A-AUDIT-20261023-resume-engineering.json`，精确SHA用 `Get-FileHash -Algorithm SHA256` 读取；其中stage为engineering、pass为true。A1 release的previousEvidence.path必须指此文件，sha256必须为文件原字节hash。不要使用旧计划文件或只改模板true绕过独立证据。

依次运行已交接CLI `prepare`、`serve`（均不发送），再 `bindings A1` 获取实际rawId/rawSha256；主Agent将输出原样放入bindings。release字段：sessionId、stage:A1、released:true、issuedAt:ISO时间、allowedSequences:[220,221]、maxCalls:2、cardSha256:`cf647671ee3ebd01fddd38f13ca83789fdde775bed7fa69be4df57ddf2b5658f`、adapterFreezeSha256:上述freeze、previousEvidence:{path,sha256}、bindings。然后 `arm A1 <release绝对路径> <精确SHA256>`；arm零请求，实际固定Raw“生成草稿”才开始。准确命令前缀为 `node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs`。

API/UI URL由serve生成 `docs/reports/KB02-K204-A-20261023-lab.json`；本次不创建真实session或猜端口。账本为隔离root/attempts.jsonl，status读取安全状态，export仅在具备本进程秘密扫描上下文后使用，stop关闭自有服务。A1真实质量与实际Chrome确认/备注回读通过后，独立A1报告才能作A2前序；A2独立通过后才签A3。后续bindings A2/A3准确参数见施工交接，禁止手填猜测revision/digest。

没有新产品缺陷需返修。剩余阻塞是尚未实测的真实质量、每阶段实际Chrome人工确认及最终回读；B/C未授权、NOT_RUN。完成或首失败后停止，不自动追加诊断/重试。
