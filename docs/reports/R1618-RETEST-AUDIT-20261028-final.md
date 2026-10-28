# R16/R18 修复后复验准备：独立验收

2026-10-28，Astra medium `r1618_retest_plan`。Sol High `r1618_retest_build`交接停写后，独立依据[本轮卡](../handoffs/R1618-RETEST-20261028-task.md)及[冻结计划](R1618-RETEST-AUDIT-20261028-plan.md)审实际差异与运行证据。基线 `eb93a30c4559800dd143e13a055834727100facd` 加入口差异；最终交付提交由主Agent关联Git历史。评分0/2/2/1=5，B模式，验收实例未施工入口。

## 分层结论

**本轮P01–03零调用准备PASS。** 入口仅9行绑定调整，新会话固定247/248、246起账及最多2请求；六句原文、oracle、revision14产品与既有机制保持。唯一fake smoke三检查通过，无必须返修项。

**真实修复与整项未通过保持。** 本轮无真实调用，不能关闭seq246 Q02 FAIL；真实Q03仍NOT_RUN、Concept覆盖缺证，R16/R18及B09/全产品仍未通过。知识246/500、Prompt15/24保持，247/248尚未消费。

## 独立实查

工作目录为 `E:\AI\Work\AIPM Workspace`。

| 实际命令/检查 | 结果 |
| --- | --- |
| `git diff -- tests/acceptance/R1618-QUALITY-20261027-run.mjs` | 仅CARD、PREFIX、SEQUENCES、session创建/校验起账、成功/失败累计基数及smoke两处序号，共9行；无产品、框架、超时、重试改动 |
| `Get-FileHash` 入口、fixture、planning、rules及原定向测试 | 与施工及FIX独立报告一致，见下 |
| `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke` | 独立唯一一次，require_escalated执行，exit0，墙钟1.176秒；未放行零调用、两fake请求原稿出稿、已用会话拒绝三检查通过 |
| PowerShell读取freeze.files逐项`Get-FileHash`比较 | 64项漂移0；session.freezeSha256与freeze.sha256相同。聚合计算复用施工同版实测，本轮未重复计算 |
| `Get-Content`真实session、`Get-ChildItem -Name`真实/fake根 | 真实会话246起账、247/248、maxCalls2、Prompt15；根仅drafts/knowledge/prompts/freeze.json/session.json，无release、attempt、run-started、result；fake根只有247/248两attempt |
| 阅读入口/config.ts源码、`git diff --name-only`、`git diff --check -- tests/acceptance/R1618-QUALITY-20261027-run.mjs` | prepare/fake不进入loadLlmConfig或真实Provider；diff检查exit0，仅换行提示。跟踪修改仅入口及外部AGENTS，旧fixture/oracle/归档与产品无差异 |
| `git rev-parse HEAD` | 上述完整基线 |

fake根 `E:\AI\Work\AIPM Workspace\.scratch-R1618-RETEST-20261028-3IVSee`，Draft `91670814-3d04-4c45-afe3-bd7baa6ad2db`；fakeCalls2、realCalls0、configReads0、knowledgeUsed246、promptUsed15。smoke实际检查两类型原稿、字段fact引用、分析建议渲染、五原事实及Raw不变；合成内容不是质量oracle，不计真实账本。

真实准备根 `E:\AI\Work\AIPM Workspace\.scratch-R1618-RETEST-20261028-iMU5d1`，session `1c6e1881-32c3-468a-8376-d69cd385d8f6`；验收未再次prepare、未签真实release。Sol首次沙箱prepare EPERM且未建会话、随后提权成功一次的过程保留在builder报告，不是Provider重试。

| 冻结对象 | SHA256 |
| --- | --- |
| 64项聚合 | `04605166c39856458c169667f33d17fff0b14bdc5f66a033d5bd4db23dd22f4c` |
| run.mjs | `df369f3e7cc25cbe9a9f3c53f6916ccd286f0e9b49afc8ce9b8cbc6075cff9c4` |
| fixture | `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7` |
| knowledge-planning.ts | `ed7e3e9b3cbdd0aa6e8f8ad56e4364b39d6787017853e73458f3c3150a072a0d` |
| rules.ts（revision14） | `59b4b29ef044c50269e03a7e66b2b5d6344aabfe620e1b96499d78d7705b6dd6` |
| r1618-auto-fields.test.ts | `1741bd557894cd2bf6330364941436433724e0209c892c6d989d7b19ae343cb9` |

FIX工程PASS及既有F04/自动保存证据为历史同版复用；未重跑旧矩阵、tsc、浏览器、正式提交或服务。零实际配置读取依据实际分支与源码，不只依据计数；未查看.env.local或环境配置值。外部AGENTS/AGENT-ROUTER未触碰，平台token计量不可得。报告首次Set-Content被文件访问权限拒绝、未写入，随后使用apply_patch写入；不是验收测试失败。

## 下一步门禁

准备可交付。唯一待确认事项为真实预算及现有配置使用：同六句资料、唯一完整流程最多2实际请求（247抽取、248规划；累计最高248/500），失败/超时/未知计入、首失败停、不重试。原QUALITY oracle、逐字段来源/限定及两类型自然覆盖标准保持，真实outcome→Draft/渲染待该次成功后检查，不人工补稿签自动通过，历史负例缺证不自动关闭。

主Agent获确认并重新核冻结后才可签release，执行builder所列run命令。准备PASS不是调用授权；本轮未改代码/任务卡或进行Git写操作。
