# B08 首次返修独立复验

2026-10-08：F08-01–04 CLOSED，新增 F08-05，确定性实现仍 FAIL；真实 Provider 单列 BLOCKED。Luna 冻结交付后主 Agent 独立操作，未改产品。

- 最终版本独立 build PASS（45 modules，0.915秒）、152/152 tests PASS（16.493秒）。
- [B08 HTTP](B08-acceptance-http-repair1.json) 15/15 PASS：新增12类无效预览在生成与优化两路径均502、无新增草稿；旧 fixture 关联问题已修正，stale version409保护正常；真实 rename EIO、partial commit、同请求/重启对账通过。保留初跑 FAIL。
- [多段 Wiki](B08-repair1-context-boundary-final.json) PASS，used3000/3000/3000/3000/0、总12000，知识不变。
- [实际浏览器](B08-repair1-acceptance-browser.json) 16项有效观察15PASS/1FAIL；另1项验收时机跨代理租期 INVALID_EXPECTATION 后在同一调用内重测PASS。原文快照、已确认按钮、最新目标再次优化、原版本不变、当前Library详情历史自动刷新、优化新项/下一轮、复制→普通目标粘贴、迟到成功保存刷新且新任务不变、编辑Brief/Wiki背景、真实EIO部分提交错误与同内容200重试、重叠Brief忙碌/最新回包、迟到429隔离、同目录重启通过。
- 两项根验收断言初写读取包裹JSON顶层以及只匹配带?列表URL，已按实际结构/录制时间线修正，initialObservation保留在JSON，未归咎产品。fake弱/完整内容不签真实质量。
- F08-05/P2：生成记录首版changeSource为ai_generated，但app/api.ts的PromptVersion union和promptChangeSourceLabels缺此值。历史行及详情修改来源实际空白，服务端实物正确。见 [截图](B08-repair1-acceptance-browser-generated-history-source.png)、[第二次返修卡](B08-repair2-fix-card.md)。
- B07后端与存储本轮未改，复用初次独立11/11 HTTP、4类损坏/重启证据；UI变更已通过完整单测和当前相关实际浏览器。没有重复宣称整套B07浏览器。
- [完整性](B08-repair1-acceptance-final-integrity.json)：68产品文件验收期间不变；workspace两文件、457旧历史、25份初始B08保护原件不变。返修仅改三个产品路径，B04测试新输出另存后恢复。知识目录不变、自有服务/标签关闭、空剪贴板恢复。

只做F08-05最小补齐并复验，B09未授权。所有真实AI成功与质量继续BLOCKED。
