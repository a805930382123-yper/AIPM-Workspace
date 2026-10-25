# SYN01受控真实入口：主Agent执行记录

2026-10-25。用户批准上一完整计划：B模式新增受控真实/Chrome入口，工程放行后最多1次真实综合（序号242），原双Raw固定，失败即停、无重试，完成浏览器审查/确认/回读与独立裁决。基线9bd732c0f7355447b067a471571819f732aa2844，产品60f83ad。实际沿用Sol High施工syn01_prep_sol、Astra medium独立syn01_prep_audit。

遵用户Stop That Shit：只验证新增一次持久预算与实际App路由，不复跑旧11+6、H09/445/build或其他批次。旧有效冻结证据复用，不把历史测试称本轮实测。主Agent保护基线4319文件，外部AGENTS/.agents/AGENT-ROUTER保留；产品/配置/正式workspace/旧证据不可改。

## Chrome工具阻塞

主Agent在真实触发前检查已安装浏览器控制工具：mcp__cua_repl.js调用cua.getState失败，错误为failed to write kernel assets、系统找不到指定的路径（os error 3）；备用mcp__node_repl__js按Computer Use技能初始化@oai/sky同样失败。随后一次cua js_reset成功，但重建getState仍同样失败。没有任何浏览器动作执行，不把初始化失败当产品失败；未用脚本或HTTP冒充Chrome。

因此先完成不依赖浏览器的新增工程，真实生成/质量/Chrome闭环暂不启动，唯一242额度没有消耗。用户真实授权持续存在，但执行前还需工具可用及工程release门禁，不要求重新批准同一范围。没有读取实际配置、创建真实release或触发Provider。

## 结果

独立报告SYN01-REAL-AUDIT-20261025-acceptance.md SHA d52e9165c76a943a128ea2709fe847d1e1f32710570a430f8c32431cff7386b3：R01/R02 PASS；仅新增smoke3个顺序组与pending/failed零调用微断言，exit0约19.5秒、fake1/config0/real0，服务关闭。107项冻结f6455c07eb2150260f15165ea9c22be2901dcd76a6620007e02087ec9f249df0不变，产品60f83ad无变化。准确命令见独立报告。未重复旧11+6或445/build。施工首smoke后发现CLI重启控制文件wx冲突并修正、补已有秘密编码拒导出断言，因此只为具体变更复跑一次，并非为冻结重跑。受控入口可续接；完整真实验收仍被浏览器工具阻塞。真实新增0，知识241/500、Prompt15/24保持；R03/R04为受工具阻塞而NOT_RUN，不宣称完整SYN01或全产品通过。

最终保护：4319既有文件仅status/agent-control/acceptance授权入口变更，其他无差异；14个新交付凭证模式扫描0命中（未读实际配置，非已知密钥值扫描）。旧证据/产品及外部改动保留。当前不创建真实会话、不arm、不启动服务，避免增加无助于浏览器阻塞的动作。恢复工具后同范围授权继续有效。
