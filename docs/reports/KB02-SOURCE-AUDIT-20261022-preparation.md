# KB02 同源分配独立验收准备（2026-10-22）

状态：仅准备，施工尚未冻结。审查者沿用实际最初派发的gpt-6-astra/medium实例；本轮未运行产品测试、服务、浏览器或真实调用。主Agent统一范围/放行/状态/Git，本审查者只拥有KB02-SOURCE-AUDIT-20261022前缀。

## 依据与门槛

已读status、agent-control、KB02-PLAN-AUDIT验收及same-source-split、当前knowledge-planning实现和正式KB02-SOURCE任务卡。seq121中s-45613-45652、f-c6-3/f-c7-1同位置同text同facts/kind=fact跨区域06/07页。只拒绝旧错分不构成真实质量通过。

独立审查重点：
1. v3 wire明确factUnitIds/questionUnitIds；unit成员请求前固定、全原ID保留。缺/未知/重复/错分栏unit及旧v2均拒绝，不能先展开去重修错。
2. 等价键按精确Raw位置+text+分栏+事实kind。反例覆盖同文异位、同位不同kind、同atom跨facts/questions、多业务完整atom。跨职责允许独立主题，不用sourceId强绑一切。
3. 持久plan保持旧原ID结构；新保存/重启恢复独立验证。篡改同unit跨页、缺成员/重复成员拒绝；不能在v3投影去重时隐藏坏plan。旧指纹409零外发零写入、显式restart及旧完成草稿兼容。
4. 全payload含unit/context/feedback秘密与192KiB门禁，S01/SR01、取消/恢复、HTTP/UI、安全、更新契约回归。
5. 同unit全分到错误区域仍然语义失败。真实结果逐页读取区域、时间、百分比及限定，不能只按全ID覆盖或unit无分裂签PASS。

## 执行顺序与预算

收到冻结通知后核对实际diff/文件范围/指纹，适配v3诊断及证据汇总，再独立运行同冻结完整默认、tsc/Vite、Node24.19原SR01/受影响、历史probe和必要独立边界反例。工程结果交主Agent；只有另行明确外发放行才启用真实门禁。

真实建议顺序：原seq121记录一次诊断（1），原全文14块+规划（15），短文（2），补充提取规划及浏览器更新（3），基本21次；24次阶段额度内其余3次不是自动重试许可。累计126/200起、最多到150，Prompt15/24独立。诊断与服务调用必须串行接续同一账本；不同时启动两个外发进程。原诊断只在内存构造当前规则输入，不改磁盘历史checkpoint。

实际浏览器使用cua_repl，逐步留候选→目标→预览→明确确认→刷新/回读、长文草稿证据。未复制上轮独立Playwright驱动；工具失败如实留证并由主Agent裁定，不以jsdom冒充。

## 已准备的资产

- integrity.mjs及baseline.json：当前100产品/73测试支持作为施工前差异参考；2863历史保护文件、6根配置、62正式workspace文件及config目录摘要。排除本轮builder与审查前缀；该基线不是施工冻结。
- run.mjs：默认关闭engineeringApproved，冻结路径暂定KB02-SOURCE-20261022-frozen.json，待交接核定及补本轮新增测试至旧Node相关列表。
- trace-hook/lab/real-http/browser-prepare：新前缀、126累计起点、24阶段硬上限，真实门禁默认false；外发前记账。
- quality/update-check/final-evidence：新前缀副本。final-evidence显式阻断等待v3适配，避免旧sourceContext跨职责聚合错误。update-check不再硬编码上轮模型输出文案；真实语义另逐条人工核验。
- authorization.json：engineeringApproved=false、realCallsApproved=false。只有主Agent明确放行后才变更。

历史脚本/报告未改。准备时一次PowerShell花括号路径解析失败发生在整条命令执行前，修正后基线生成成功；零产品测试/服务/真实外发，不标任何新PASS。
