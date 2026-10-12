# B08 首次独立验收（2026-10-08）

实现门禁 FAIL，真实 Provider 成功与内容质量另记 BLOCKED。GPT-6 Luna High 完成施工；当前主 Agent 独立验收，只写检查脚本、证据与文档，未修改产品代码。用户已授权完成本批，以下三项交回同一 Luna 返修。

- 独立构建 PASS；150/150 tests PASS。B07 公开 HTTP 回归 11/11、损坏记录四类与重启 PASS。
- B08 15 组 HTTP 初跑 13 PASS、1 产品 FAIL、1 INVALID_FIXTURE。后者是验收 fake 的优化预览未保留目标 Wiki IDs，被服务端正确拒绝；已修正独立 fixture，原始失败保留，不计产品缺陷。复验须用新报告后缀。
- 实际浏览器 20 项观察：18 PASS、2 FAIL。生成任务/七模板、编辑 Brief、勾选取消 Wiki、预览不自动保存、精确复制粘贴、全部字段显式保存、优化九维/零改进完整示例、原历史快照、优化追加新版本、补充后使用最新版本、迟到 Brief/429 隔离、限流重试与同目录重启已实测。fake 内容不能证明真实 AI 质量。
- F08-01：Provider 返回未知分类也生成成功预览和草稿，未完整执行 B07 输入约束。F08-02：优化保存后“原 Prompt”区域替换成优化新正文，检查项仍对应旧文；同一已确认草稿按钮误标为下一版。F08-03：confirm 已成功提交，回包前切模式，返回 Library 仍显示旧数量/缺新行，刷新页面才恢复。
- 独立隔离目录 Raw/Wiki/Index/Log 不变；重启 Prompt SHA 集合一致，甲三版、乙两版及生成/优化新项均可读。自有 API/UI/proxy/fake 和两个标签关闭。原剪贴板为空列表，接口不接受空列表写入，已恢复为空文本。
- [完整性证据](B08-acceptance-final-integrity.json)：68 产品文件在验收期间集合/SHA 不变，正式 workspace 两文件不变，457 份受保护历史证据不变。初次交付仅七产品路径新增/变化。

证据：[HTTP](B08-acceptance-http.json)、[浏览器](B08-acceptance-browser.json)、[浏览器运行及落盘](B08-acceptance-browser-runtime.json)、[B07 回归](B08-acceptance-b07-http.json)、[损坏记录](B08-acceptance-b07-damaged.json)、[返修卡](B08-fix-card.md)。初始证据不得覆写。

无真实产品 Provider 配置（只读取既有配置，未改密钥/供应商），A44–A56 中真实成功、生成质量、真实弱/完整 Prompt 质量不签 PASS；B04–B06 阻塞保留，B09 未授权。
