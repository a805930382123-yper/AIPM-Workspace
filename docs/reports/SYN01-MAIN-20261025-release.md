# SYN01零调用工程准备：主Agent收尾

2026-10-25用户明确批准本轮B模式工程准备，禁止真实调用。当前卡SYN01-PREP-20261025-task.md SHA e6d03c8fc1253e61832e4d0860c1af47628b884a1b84c5f7f2536c35ff3d17d1。原NEXT-PREP双Raw/质量oracle保持；准备HEAD ba2d8541d061f06cca27ff7dc729d984472b0854，产品60f83adba102d887fcd925df13a8021ff7669de1。

实际派发syn01_prep_sol（sol_repair/GPT-6.1 Sol High）施工，syn01_prep_audit（GPT-6 Astra medium）独立验收；主Agent负责范围、文件保护、入口和Git。B模式评分0/2/2/1=5沿用批准方案。主Agent未冒称通过文档切换自身模型。无产品修改授权，发现产品缺陷只形成最小复现/影响，不擅自返修。

## 保护和预算

施工前4297项已跟踪文件及已知外部文件记录基线SHA，C213冻结本机核验零漂移。正式workspace及.env.local只读取文件系统元数据（路径/长度/mtime），聚合后只保存63项数量及摘要，不读取正文或配置值；元数据不等于内容字节核验。施工/审查仅使用本轮.scratch-SYN01-PREP-*隔离目录，真实Provider与配置加载禁止。

真实新增0，知识241/500、Prompt15/24保持。未来1次synthesis只为建议，未生成武装release或运行真实调用。工程准备通过也不等于SYN01真实质量、实际Chrome或全产品通过。A18/R20/R07真实综合缺证、R12/模板/等级/四链集成不在本次结批范围。

外部AGENTS.md、.agents/、AGENT-ROUTER-20261023-packaging.md原样保留且不提交。主Agent只更新status/agent-control/acceptance必要入口，旧批次证据和提议卡不可变。

## 执行证据

本机读取并核对原标准、当前卡、H09历史React/HTTP及源码合同；这些只读预审不是新的产品行为PASS。一次rg使用旧不存在路径和Windows通配形式返回错误，后续沿实际路径由独立验收核对，不归为产品失败。完整445/64/build为历史同冻结证据，未冒称本轮重跑。

独立最终SP01–06 PASS，报告SYN01-AUDIT-20261025-acceptance.md SHA e42a6f420e3706006d69e8a30b456d4902dfcece3fe58e419f9dd29ea502790b。实际命令：node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-AUDIT-20261025-run.mjs，exit0约2.65秒；11组工程复跑与自有6组核验通过（层级重叠），6次内存fake、0真实、全部自有服务关闭。运行前后102项冻结aggregate 141c302d43fe0b2a7b0ff81b7df73f23c08dfad348f7caa7b0ee8eed70ef1985不变。施工守卫/环境EACCES/201断言首失败保留，最终版本独立通过，不是产品失败。主Agent阅读实际交接与独立报告，不以施工自查签收。SYN01真实质量/Chrome仍NOT_RUN，全产品未通过。未来受控真实/Chrome入口尚未构建，必须后续新卡和明确放行，不自动调用。

正式workspace/.env.local共63项元数据最终同规范化摘要一致。中间after检查未像before做JSON往返，PowerShell ISO日期自动转换导致假差异；原after记录保留，final使用相同规范化后匹配。该检查不读取内容，不冒称内容SHA校验。最终保护与同步结果下方补记。

最终保护PASS：4297项基线仅三个入口授权变更；C213无漂移；21个新交付文件凭证模式扫描0命中（未读取实际密钥值）；正式数据/配置元数据一致。见SYN01-MAIN-20261025-protection.json。下一步仅建议B模式受控真实入口和最多1次真实验收；当前授权0。

交付提交 eeec75973db0c4f3214a66383637f2b39f5c410b；post-commit推送成功，实时git ls-remote origin refs/heads/main与本地HEAD一致。25个本轮文件暂存字节逐项与工作区相同，严格diff --cached --check通过；原外部三项仍留工作区未提交。本关联补记不改独立验收/产品冻结。
