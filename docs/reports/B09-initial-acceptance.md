# B09 首版独立验收（历史 FAIL）

2026-10-08。实际 GPT-6 Luna High 施工，主 Agent 独立检验；产品修复仍交同一 Luna。当前 F09-03 首页 Audit 统计刷新缺陷阻止确定性实现通过，真实 Provider 未配置另记 BLOCKED。

冻结首版实际 build PASS（1.03 秒），npm test 152/152 PASS（17.369 秒）；B09 HTTP 7/7、备份 20 文件/23,603 字节精确恢复、18 恶意归档及 junction/非空目标/恢复竞态/导出变动检测通过；B08 HTTP 15/15、B07 HTTP 11/11 与四类损坏+重启通过。四链路实际浏览器使用独立本地 fake，36 有效观察 PASS，3 原始无效预期保留并复验；无 Key 手动模式 12/12 PASS，两个 TEMP 根完整资产重启字节一致。以上不能替代真实 AI 成功/质量。

最后新增针对性计数探针：手动 Raw/Wiki 已落盘 → 浏览器提交整页 Audit → Wiki 正确显示待处理 1 → 返回首页始终 Open Audit 0。等待 5 秒仍无 Open Audit 1；公开 API 返回 1，排除请求未完成/服务器未提交。见[返修卡](B09-audit-count-fix-card.md)、[原始浏览器](B09-initial-audit-count-browser.json)、[独立 API](B09-initial-audit-count-api.json)。截图工具本次捕获失败，没有伪造截图。此项是真实产品 FAIL，不能归为无效预期。

此前 F09-01 复用表过期状态与 F09-02 CLI 数字不一致已由同一 Luna 修正，主 Agent核对 CLOSED。最终文档仍需跟随 F09-03 修复和复验更新。

71 个产品代码/配置/规则/脚本在首版冻结验收期间逐文件 SHA 不变；正式 workspace 两文件和 530 份受保护历史原件不变。全量测试生成的两份 B04 输出另存 B09 前缀，原件恢复。根因修复前的源码与文档 SHA 另存 B09-acceptance-frozen-initial-count-fail.json，首次失败不会被最终报告覆盖。主 Agent只写任务卡、独立 tests/acceptance 和报告，没有修改产品。

自有三个隔离环境和浏览器标签已关闭，原剪贴板恢复。产品只使用本机自身服务和配置；施工模型不进入运行时。没有授权后续批次或部署。
