# B09 F09-03 最小返修卡

2026-10-08。主 Agent 独立真实浏览器发现；首版产品冻结验收尚不能 PASS。

F09-03 / P2：实际提交整页 Audit 后，Wiki 显示 1 条待处理；GET /api/stats 返回 openAuditCount=1；返回首页并等待 5 秒仍显示 Open Audit 0。无 Key、仅独立 TEMP，确认不是 Provider 或网络问题。

复现：干净根手动创建 Raw 和 Wiki → 详情反馈“B09计数测试：需要人工确认。” → 提交整页 Audit → 返回首页。正式 Wiki/Raw 未修改，Audit 真正创建。证据：[原始浏览器 FAIL](B09-initial-audit-count-browser.json)、[公开 API](B09-initial-audit-count-api.json)、[夹具ID](B09-acceptance-browser-counts-fixture.json)、[自有服务原始追踪](B09-acceptance-browser-manual-counts-runtime.json)。截图捕获工具失败，保留 AX 与真实 HTTP，不冒称截图成功。

根因线索：App.refresh 管理全局 stats；AuditPanel.create 成功时没有通知 onChanged，导航回首页也不主动拉取 stats。由 Luna 判断最小可靠接线，确保创建/接受/拒绝/延期及已有记录变化之后首页统计真实；保留 Audit 选择代次、请求所有权、Raw 不变量和不自动写 Wiki。不要凭固定计数或强制全页 reload 修复。

仅同一 GPT-6 Luna High 修改 app/App.tsx / app/pages/WikiPage.tsx 的必要刷新接线及相关交付文档，新报告 B09-builder-repair1.md。先检查文件。不得改后端/存储协议、独立 tests/acceptance、历史报告、正式 workspace 或密钥。先前最终文档可继续补齐，但不能把本缺陷未修即签 PASS。

施工完成冻结并报告 SHA。主 Agent 独立复验：实际创建 Audit → Home Open1；延期仍1；拒绝/接受后0；页面刷新/同目录重启数据一致；其他五统计及最近真实 ID、Prompt 计数/知识日志隔离不回归。按实际变更运行构建和针对性 UI 契约验证；不重复与该修复无关的 CLI/备份/所有 HTTP。真实 Provider 继续 BLOCKED。
