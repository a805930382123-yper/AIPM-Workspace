# B09 首次产品返修独立复验（历史 FAIL）

2026-10-08。F09-03 CLOSED；新增 F09-04 / P2 仍需返修，整批确定性实现尚不能 PASS，真实 Provider 成功/质量另记 BLOCKED。

Luna 仅改 App.tsx、WikiPage.tsx。主 Agent独立冻结后构建 PASS（45 模块/982ms）；UI交互、Raw审核、Prompt异步回归37/37 PASS（11.055秒）；[实际浏览器12/12](B09-repair1-acceptance-browser.json) PASS：创建 Audit 后Home Open1，延期仍1，拒绝归0；第二条Audit fake提议未改正式rev1，用户编辑并接受后rev2/正文/日志正确且Home0；Prompt新建Home1、Wiki仍1；同目录API重启+reload仍保持。知识/Prompt/草稿/状态文件集合及SHA完全相同，见[B09持久化](B09-acceptance-browser-repair1-files.json)。未重跑无关完整152测试、备份或全部HTTP；首版后端/协议/CLI均未变，沿用有效证据。

继续按任务卡检查失效最近入口：有效甲与被删乙并存，点击“乙 删除Wiki”却打开甲详情和甲导出链接；虽然有“没有找到”错误，仍违反不能串到任意第一条。见[F09-04返修卡](B09-stale-wiki-fix-card.md)、[AX](B09-initial-stale-wiki-browser.json)、[截图](B09-initial-stale-wiki.png)。这是产品 FAIL，首次统计 FAIL 与无效 fixture 原观察均未覆盖。

自有复验/失效探针服务与标签关闭，原剪贴板已恢复。正式workspace两文件和530历史原件不变。后续仅同一 Luna 继续修 F09-04，主 Agent独立复验；不发布或补签真实AI。
