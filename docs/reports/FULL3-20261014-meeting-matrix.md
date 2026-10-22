# FULL3 Meeting Hub MH01–MH48适用映射

48项本机阶段PASS沿用2026-10-12 M05证据；本轮独立确认会议模块/来源门禁字节不变，215测试和安全回归采用2026-10-14 CFG01同冻结证据。本轮只新测会议空库导航，不把48项称本轮重跑。实际Provider单例Audit已通过，不能替代MH36/37更广真实AI质量；新Meeting来源始终local_only，禁止AI/Wiki/Prompt背景。飞书登录/远程权限仍NOT_RUN；旧M05“S03/S04未修”是历史，SEC现CLOSED。

[独立适用性](FULL3-20261014-standards.md)、[本轮完整结论](FULL3-20261014-acceptance.md)。

| ID | 要求 | 本机范围结论 | 历史证据 | 限制 |
|---|---|---|---|---|
| MH01 | 新建会议 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH02 | 编辑会议 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH03 | 删除会议 | 本地PASS | scenario S07；component C03；browser删除确认；[记录](M05-20261012-scenario.json) | 删除只影响本地，不删除飞书/外部备份，不声称安全擦除 |
| MH04 | 删除二次确认 | 本地PASS | scenario S07；component C03；browser删除确认；[记录](M05-20261012-scenario.json) | 删除只影响本地，不删除飞书/外部备份，不声称安全擦除 |
| MH05 | 保存录音链接 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH06 | 保存纪要链接 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH07 | 点击打开飞书 | 本地能力PASS；外部权限未测 | browser HTTPS新标签属性；M02历史实际外链入口；[记录](M05-20261012-browser.json) | 只提供点击HTTPS链接，不保证飞书登录、权限或远端可用 |
| MH08 | 缺少链接正常 | 本地PASS（含历史复用） | browser基本筛选/缺链接；M02历史多维筛选/排序；同字节Meeting筛选逻辑只读复核；[记录](M02-browser-checks.json) | 不是把历史全部多组合过滤倒称M05当轮重跑；搜索只覆盖元数据 |
| MH09 | 刷新仍存在 | 本地PASS | scenario S04/S05；api-regression真实写故障；App AC03/AC09；deep恢复；[记录](M05-20261012-scenario.json) | 部分成功可保留受限Raw；明确状态、同ID恢复 |
| MH10 | 选择主类型 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH11 | 管理业务标签 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH12 | 多个标签 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH13 | 客户/项目字段 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH14 | 类型筛选 | 本地PASS（含历史复用） | browser基本筛选/缺链接；M02历史多维筛选/排序；同字节Meeting筛选逻辑只读复核；[记录](M02-browser-checks.json) | 不是把历史全部多组合过滤倒称M05当轮重跑；搜索只覆盖元数据 |
| MH15 | 标签筛选 | 本地PASS（含历史复用） | browser基本筛选/缺链接；M02历史多维筛选/排序；同字节Meeting筛选逻辑只读复核；[记录](M02-browser-checks.json) | 不是把历史全部多组合过滤倒称M05当轮重跑；搜索只覆盖元数据 |
| MH16 | 日期排序 | 本地PASS（含历史复用） | browser基本筛选/缺链接；M02历史多维筛选/排序；同字节Meeting筛选逻辑只读复核；[记录](M02-browser-checks.json) | 不是把历史全部多组合过滤倒称M05当轮重跑；搜索只覆盖元数据 |
| MH17 | 搜索会议 | 本地PASS（含历史复用） | browser基本筛选/缺链接；M02历史多维筛选/排序；同字节Meeting筛选逻辑只读复核；[记录](M02-browser-checks.json) | 不是把历史全部多组合过滤倒称M05当轮重跑；搜索只覆盖元数据 |
| MH18 | 云端模式不需文件 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH19 | Markdown 导入 | 本地PASS | scenario S03真实multipart/BOM/CRLF/副本/再导入；component；M03既有格式拒绝；[记录](M05-20261012-scenario.json) | 仅UTF-8 .md和粘贴，不签PDF/DOCX；原件不被工作副本覆盖 |
| MH20 | 粘贴纪要 | 本地PASS | scenario S03真实multipart/BOM/CRLF/副本/再导入；component；M03既有格式拒绝；[记录](M05-20261012-scenario.json) | 仅UTF-8 .md和粘贴，不签PDF/DOCX；原件不被工作副本覆盖 |
| MH21 | 阅读纪要 | 本地PASS | browser危险Markdown阅读；M03历史安全渲染；scenario原件精确；[记录](M05-20261012-browser.json) | HTML不执行、图片不自动加载、仅HTTPS外链；Raw原文只读 |
| MH22 | 编辑纪要 | 本地PASS | scenario S03真实multipart/BOM/CRLF/副本/再导入；component；M03既有格式拒绝；[记录](M05-20261012-scenario.json) | 仅UTF-8 .md和粘贴，不签PDF/DOCX；原件不被工作副本覆盖 |
| MH23 | 原始版本不覆盖 | 本地PASS | scenario S03真实multipart/BOM/CRLF/副本/再导入；component；M03既有格式拒绝；[记录](M05-20261012-scenario.json) | 仅UTF-8 .md和粘贴，不签PDF/DOCX；原件不被工作副本覆盖 |
| MH24 | 不支持文件报错 | 本地PASS | scenario S03真实multipart/BOM/CRLF/副本/再导入；component；M03既有格式拒绝；[记录](M05-20261012-scenario.json) | 仅UTF-8 .md和粘贴，不签PDF/DOCX；原件不被工作副本覆盖 |
| MH25 | 失败不破坏档案 | 本地PASS | scenario S04/S05；api-regression真实写故障；App AC03/AC09；deep恢复；[记录](M05-20261012-scenario.json) | 部分成功可保留受限Raw；明确状态、同ID恢复 |
| MH26 | 未分类默认敏感 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH27 | Sensitive 默认云索引 | 本地PASS | scenario S01；api-regression创建/字段/目录/默认策略；[记录](M05-20261012-scenario.json) | 2026-10-12 M05产品HTTP历史实测；Restricted仅最少元数据 |
| MH28 | Restricted 禁正文 | 本地PASS（按MVP收窄） | scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝；[记录](M05-20261012-deep.json) | Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输 |
| MH29 | Internal/Sensitive 本地授权 | 本地PASS（按MVP收窄） | scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝；[记录](M05-20261012-deep.json) | Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输 |
| MH30 | 未授权不入 Raw/LLM | 本地PASS（按MVP收窄） | scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝；[记录](M05-20261012-deep.json) | Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输 |
| MH31 | 不自动发送外部模型 | 本地PASS（按MVP收窄） | scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝；[记录](M05-20261012-deep.json) | Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输 |
| MH32 | API 不绕过页面权限 | 本地PASS（按MVP收窄） | scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝；[记录](M05-20261012-deep.json) | Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输 |
| MH33 | 放宽限制不隐式传输 | 本地PASS（按MVP收窄） | scenario S02/S06；api-regression策略；http/deep受限/缺失来源拒绝；[记录](M05-20261012-deep.json) | Sensitive/Restricted Raw与所有新会议AI均禁用；不提供降级绕过/自动传输 |
| MH34 | 日志不泄露正文 | 本地PASS | scenario S08；deep拒绝前无写入；browser lab roots及Provider计数；[记录](M05-20261012-scenario.json) | 显式Raw增加真实Raw计数；一般会议操作不改知识/Prompt/草稿 |
| MH35 | 删除不删飞书 | 本地PASS | scenario S07；component C03；browser删除确认；[记录](M05-20261012-scenario.json) | 删除只影响本地，不删除飞书/外部备份，不声称安全擦除 |
| MH36 | 旧 LLM/Wiki 正常 | 本地兼容PASS；旧安全FAIL/真实AI BLOCKED | 旧链与B05/B06实际fake回归；App真实任务轮询AJ01；FULL2历史遗留；[记录](M05-20261012-legacy-http.json) | S-03/S-04未修；fake不代表真实Provider输出质量 |
| MH37 | 旧 Prompt 正常 | 本地兼容PASS；旧安全FAIL/真实AI BLOCKED | 旧链手动Prompt与deep正常预览/受限确认；[记录](M05-20261012-legacy-http.json) | Library无Provider可用；真实生成/优化质量未签收 |
| MH38 | 不重建 Raw | 本地PASS（按MVP收窄） | scenario S03/S07；http21与deep11；App真实Raw定位；[记录](M05-20261012-http.json) | 复用既有Raw格式；只Public/Internal明确登记；不创建会议Wiki |
| MH39 | 获准纪要可关联 Raw | 本地PASS（按MVP收窄） | scenario S03/S07；http21与deep11；App真实Raw定位；[记录](M05-20261012-http.json) | 复用既有Raw格式；只Public/Internal明确登记；不创建会议Wiki |
| MH40 | 关联不自动建 Wiki | 本地PASS（按MVP收窄） | scenario S03/S07；http21与deep11；App真实Raw定位；[记录](M05-20261012-http.json) | 复用既有Raw格式；只Public/Internal明确登记；不创建会议Wiki |
| MH41 | 无关资料不入知识库/AI | 本地PASS | scenario S08；deep拒绝前无写入；browser lab roots及Provider计数；[记录](M05-20261012-scenario.json) | 显式Raw增加真实Raw计数；一般会议操作不改知识/Prompt/草稿 |
| MH42 | 模块数据不混用 | 本地PASS | scenario S08；deep拒绝前无写入；browser lab roots及Provider计数；[记录](M05-20261012-scenario.json) | 显式Raw增加真实Raw计数；一般会议操作不改知识/Prompt/草稿 |
| MH43 | 沿用旧 UI | 本地PASS | 实际browser桌面/基本窄屏；App AC01/02/04/05/07/08；两轴只读；[记录](M05-20261012-browser.json) | 没有播放器/会议AI假入口；未知目标不展示其它资料 |
| MH44 | 列表详情正常 | 本地PASS | 实际browser桌面/基本窄屏；App AC01/02/04/05/07/08；两轴只读；[记录](M05-20261012-browser.json) | 没有播放器/会议AI假入口；未知目标不展示其它资料 |
| MH45 | 不做假播放器 | 本地PASS | 实际browser桌面/基本窄屏；App AC01/02/04/05/07/08；两轴只读；[记录](M05-20261012-browser.json) | 没有播放器/会议AI假入口；未知目标不展示其它资料 |
| MH46 | 演示资料标注 | 本地PASS（不新增会议样例） | api-regression空会议目录；scenario S01；旧demo实际显式导入及isDemo保留；[记录](M05-20261012-legacy-http.json) | Meeting不自动灌入；旧演示功能需用户显式导入并标记，测试数据只在隔离目录 |
| MH47 | 无假按钮/假操作 | 本地PASS | 实际browser桌面/基本窄屏；App AC01/02/04/05/07/08；两轴只读；[记录](M05-20261012-browser.json) | 没有播放器/会议AI假入口；未知目标不展示其它资料 |
| MH48 | 桌面主要操作 | 本地PASS | 实际browser桌面/基本窄屏；App AC01/02/04/05/07/08；两轴只读；[记录](M05-20261012-browser.json) | 没有播放器/会议AI假入口；未知目标不展示其它资料 |
