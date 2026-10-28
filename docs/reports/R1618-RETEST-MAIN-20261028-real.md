# R16/R18 revision14真实复验：主Agent执行记录

2026-10-28。用户对最多2次实际请求明确回复“同意”。执行基线99215280a04e81071a6d1abacf4108c250effde1；沿本轮已审B模式与QUALITY固定oracle，不改变资料、产品、入口或冻结任务卡。预算从知识246/500接续247抽取、248规划，最高248/500，Prompt15/24不变；失败计入、首失败停、无自动重试。

执行前逐项Get-FileHash核64项freeze.files均相等，核唯一真实会话无release/attempt/run-started后写release。会话为`.scratch-R1618-RETEST-20261028-iMU5d1`，session `1c6e1881-32c3-468a-8376-d69cd385d8f6`，release字节SHA256 `4018d696721e9dcc0626f628a2e19851f48ba4e743adc3ee5588af8bc7c0d914`。用户授权只放行此会话，无第二会话或额外请求。

实际命令（require_escalated用于Node运行及已批准网络请求）：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run 'E:\AI\Work\AIPM Workspace\.scratch-R1618-RETEST-20261028-iMU5d1' 'E:\AI\Work\AIPM Workspace\.scratch-R1618-RETEST-20261028-iMU5d1\release.json' '4018d696721e9dcc0626f628a2e19851f48ba4e743adc3ee5588af8bc7c0d914'
```

运行session82892，最终exit0，captured-awaiting-independent-quality-review。reserved=sent=realCalls=2、fakeCalls=0、configReads=1；知识248/500，Prompt15/24。原稿draft `197a29b8-92fc-4da9-9cae-0cb61b31154b`。成功出稿不是质量PASS；交未参与施工的Astra medium r1618_retest_plan独立验收。

公开导出12文件原样复制到[R1618-RETEST-20261028-real-evidence](R1618-RETEST-20261028-real-evidence)，包括session/freeze/release/run-started、两次attempt/request/response、result及candidate-original。未复制private响应或实际配置；request/response/candidate由既有入口完成已知秘密检查，输入仍为六句虚构资料。

未执行浏览器、审核或正式Wiki保存；没有修改模型原稿、人工补Concept、修改提示再次抽样、重跑smoke/tsc/全矩阵。最终质量裁定及具体内容依据见[独立报告](R1618-RETEST-AUDIT-20261028-real.md)。旧seq246失败证据保留，本轮输出单独归档。外部AGENTS及AGENT-ROUTER打包报告排除提交。