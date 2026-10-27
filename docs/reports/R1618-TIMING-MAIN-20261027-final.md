# R1618 F04无上限首次加载与实际操作

基线b70a2f170be37c5e59b157b227fabb1c0c6b2862。用户明确要求避免过度测试，首次编译不设准备上限，直接记录完成时间；覆盖旧8秒smoke门槛。沿B模式，Sol High f04_timing最小改lab，Astra medium f04_timing_audit独立核验，主Agent实际Chrome。未重跑旧服务测试矩阵。

入口以node --import tsx启动，--measure-startup使用node:http完整响应end计时，不设请求期限，结束后留同一服务。首次实际运行遇Windows fs-event原生断言崩溃，增加仅lab polling监听后成功。成功运行shell6617.66ms、browser TSX28779.94ms、DraftReviewPage1317.21ms、WikiPage618.28ms；四请求均200。测量墙钟44.923秒含请求间间隙，不等同所有依赖编译或浏览器就绪。原始数据见R1618-TIMING-20261027-startup.json，完整边界见施工报告。

实际Chrome同一隔离夹具draft028e1066-717a-4db6-a613-25eacd8ccaf0。导航工具曾返回等待超时，但后续同标签页正常显示，无重新启动/重发编译矩阵。API/UI加载较慢，操作按完成状态继续，没有将工具等待期限当产品验收门槛。

操作证据：

- v1初始→v2：Concept一句话选concept-e1并填独立人工说明；Process触发条件选business_process-e1并填说明，AI机会选e2并填分析建议。两页全选保存并刷新，字段保留。
- 开始审查v3，逐页确认到v5，已审2/2；修改上述两类型人工说明并保存v6，已审0/2、正式写入禁用。
- 重新逐页确认到v8，已审2/2，展开两页完整正文预览，再明确点击确认写入Wiki（2）。
- 操作2cdb0351-266f-436e-8fc2-dc186be207c4返回已完成，source/pages/index/log/state均done。Source68a81c36-ec1b-4482-9434-e5b9f0772455，Concept859efa59-c411-4ba6-a884-79caf8b67089，Processa649ae49-e2ab-4ebe-9bb4-b545040eb26c。

六阶段export为R1618-TIMING-20261027-01至06 JSON；真实AX操作存R1618-TIMING-20261027-ui/。事实保真、审批摘要和正式正文由独立审查一次核对。没有真实模型调用，知识244/500与Prompt15/24不变。当前envDir为TEMP、provider禁用；旧配置读取历史偏差与硬编码计数限制不抹除。

正式回读已完成：打开真实WikiPage查看Concept；reload后再次点击查看正式Wiki，分别打开Concept与Process。f04-18-concept-refreshed.txt及f04-19-process-refreshed.txt显示修订人工说明、来源逐字摘录及Process分析建议均保留，两张截图同目录。辅助Audit区显示请求失败，交独立审查核入口路由范围，不据此宣称完整App通过。

主Agent关闭自有Chrome tab。施工者关闭session95707，提升权限只读确认5176/53098无监听、无本lab进程（详见builder报告），TEMP证据保留。主Agent `git diff --check` 通过；后续最终提交关联本轮报告，不包含外部修改。

仅隔离lab与测试实物，不代表完整App四链集成或自动内容质量通过。最终双层裁定见R1618-TIMING-AUDIT-20261027-final.md。外部AGENTS/.agents/AGENT-ROUTER修改保留排除提交。
