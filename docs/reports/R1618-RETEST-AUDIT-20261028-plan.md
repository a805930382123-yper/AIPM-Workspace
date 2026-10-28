# R16/R18 修复后复验：最小准备计划

2026-10-28，Astra medium `r1618_retest_plan`，未参与入口施工。基线 `eb93a30c4559800dd143e13a055834727100facd`。依据[本轮卡](../handoffs/R1618-RETEST-20261028-task.md)及既有 QUALITY oracle；当前只授权零调用准备，真实请求预算尚待确认。

方案可实施。评分需求0（已有固定原文与逐字段标准）、耦合2（抽取→规划→Draft/来源链）、风险2（真实外发、账本及证据完整性）、历史1（seq246真实失败，revision14尚未真实复验）=5，B模式。Sol High施工；本实例随后独立验收。真实0、实际配置读取0，知识246/500、Prompt15/24保持。

## 最少施工与所有权

Sol仅修改既有 `tests/acceptance/R1618-QUALITY-20261027-run.mjs` 和本轮builder报告，不复制入口：

- CARD绑定本轮RETEST卡，PREFIX使用 `.scratch-R1618-RETEST-20261028-`，SEQUENCES改247/248。
- session创建/校验的knowledgeBefore，以及成功/失败result的累计基数244改246。
- smoke未放行attempt检查及最终attempt文件列表改247/248；可以增加本轮账本值的直接断言，不扩测试框架。

无需修改其他执行逻辑。独占写入、冻结、release绑定、两次请求上限、首失败停止和已用会话拒绝沿用既有实现。新前缀及mkdtemp隔离新证据；旧245/246目录与报告原样保留，不尝试复用旧会话。fixture、产品、fakeReply、schema、Provider、超时、重试及质量oracle均不改。

主Agent拥有任务卡、status、agent-control、acceptance及最终提交；Astra只拥有本plan/final报告。共享工作区不覆盖他人；外部AGENTS及AGENT-ROUTER打包报告排除。

## 必选验收与最少验证

P01：独立审实际diff，核247/248、246起账、最多2请求及Prompt15一致；确认旧证据无修改、fixture仍为原六句，SHA256 `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7`。不以fake内容作为真实质量真值。

P02：只执行一轮 `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke`，由独立验收者运行；Sol先静态自查交接即可，避免重复。验证未release零调用、两fake请求原稿出稿、已用会话拒绝三检查，核attempt只有247/248、真实/config均0。源码路径确认prepare与fake不调用loadLlmConfig；不单凭计数声称零读取。

P03：完成入口及任务卡后，执行一次 `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare real` 创建新未放行会话；仅准备，不执行real run。核freeze各文件SHA与当前文件一致，含产品revision14、同fixture、入口与本卡；核session只有新序号与246账本，无release、attempt、run-started。记录root、聚合SHA、入口SHA、实际命令/结果和后续最短run命令。冻结后不得改被冻结卡/入口而继续宣称会话有效。

复用FIX独立报告的revision14工程PASS及现有F04/自动字段证据，不重跑产品测试、tsc、旧矩阵、浏览器或正式提交。准备通过仅关闭本轮P01–03；seq246 Q02 FAIL、Q03 NOT_RUN、两类型覆盖缺证及R16/R18/B09整体未通过保持。

## 后续真实提案，尚未放行

唯一完整流程最多2次实际请求：247抽取、248规划，累计最高248/500；使用现有产品配置。失败、超时及未知结果计入，首失败停，不重试、不挪用旧余量。用户明确确认预算后主Agent才签本会话release并执行一次。独立沿用 [QUALITY原始oracle](R1618-QUALITY-AUDIT-20261027-plan.md)，逐字段核来源与限定、两类型自然覆盖，以及真实outcome→Draft/渲染；不得人工补稿签自动质量通过。缺负例等历史证据仍单独保留。

本方案实际只做Get-Content/rg阅读、git rev-parse HEAD、git status --short及fixture Get-FileHash；未运行测试、服务、Provider、真实配置读取或Git写操作。读取文件搜索一次rg未命中exit1属路径搜索无结果，后续已直接完整读取入口；不是测试失败。真实复验与准备验收均尚未执行。
