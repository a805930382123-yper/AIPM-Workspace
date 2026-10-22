# FIELDS独立验收准备

Sol已审计划通过，本轮作为独立审查者，不写产品/default tests。准备基线HEAD ea36a52、产品420e123；100产品/76测试支持/3236历史保护及正式workspace/config已指纹化。工程和真实授权门禁初始均false；本文件不代表验收执行或通过。

已准备本前缀工程runner及7项独立字段probe（含新增system秘密/规则错误的零调用零计数、FMCG标签/描述与规则指纹绑定检查）、历史probe独立执行、受测副本SHA核对、范围/保护完整性；工程必须等待Luna冻结并由主Agent放行。

真实工具沿用已读取的实际脚本后复制至本前缀，未改旧证据：

- lab/trace-hook使用累计起点163、阶段24/最多187，总200和Prompt15/24不重置；逐尝试外发前记账，主Agent开门后才启动新隔离root/端口。
- real-http仅显式SHORT/LONG阶段，一次启动标记防重复；LONG要求浏览器已明确创建短文目标并保存KB02_HUMAN备注。
- browser-prepare仅在已有目标/备注后生成补充，不建替代目标；真实Chrome按review→confirm→human-note→long→supplement→preview→semantic review→confirm→readback/reclick分步运行。浏览器仅允许localhost请求。
- 更新预览只触发一次并保留确认前Wiki；人工逐条核对冲突/共同观点及双侧原文证据后，由独立审查者保存workflow/sections SHA一致的semantic-review记录，确认动作才可运行。该文件是验收语义证据，不是自动判断或用户额外审批。
- update-check核明确确认/旧正文与人工备注/20%及30%/双Raw来源、重复确认幂等和磁盘重开；quality/final-evidence记录14区域和全部unit/原ID归属。秘密扫描与服务/Chrome收尾另记。

实际准备命令：`node tests/acceptance/KB02-FIELDS-AUDIT-20261022-prepare.mjs` exit0，仅生成脚本；逐文件`node --check` exit0，仅语法检查，没有执行工程测试、服务、浏览器或Provider。独立probe的原seq148数据为原short-failure.json逐字拷贝，受测副本另绑定其SHA；原件不改。

准备期间只读发现施工草稿新增system扫描在beforeCall后，已向主Agent报告：本轮新增system构造/秘密/规则错误应在规划写入和attempt累加之前拒绝；192KiB仍沿用planningPayload JSON，不因新增system悄悄改变预算定义。冻结后独立验证最终实物，不把中间草稿问题当最终裁决。

另发现新Prompt依赖FMCG标签/描述而旧指纹不含fmcgText；主Agent已批准在既有rules.ts纳入该文本并增加临时规则副本回归。独立probe仅改变标签/描述、枚举/schema保持不变，要求指纹改变且旧cp在调用/写入前409。不新增存储机制，未提前运行此probe。

后续报告分别写本轮类型缺陷修复结论与KB02整体结论，附实际命令、结果及代码提交/冻结关联。Prompt改动不保证模型根治；同核心真实复发停止盲试，剩余额度不自动重试，搜索乱序旁支保持未修。
