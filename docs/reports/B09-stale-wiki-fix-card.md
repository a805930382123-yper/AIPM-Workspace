# B09 F09-04 最近失效 Wiki 最小返修卡

2026-10-08；F09-03 12/12 独立浏览器已 CLOSED，新增 F09-04 / P2 阻止最终确定性 PASS。

复现：独立 TEMP 创建来源 Raw、有效甲 Wiki、乙 Wiki → 软删除乙 → 首页最近知识变更点击“乙 删除 Wiki” → 出现“没有找到这条 Wiki”，同时右侧详情、正文、导出链接却全部指向甲。这是错误对象选择，不是有效列表里显示甲的问题。任务卡明确要求“删除后失效关联明确提示，不能串到任意第一条”。

证据：[AX 原始 FAIL](B09-initial-stale-wiki-browser.json)、[真实截图](B09-initial-stale-wiki.png)、[原子 ID](B09-acceptance-stale-fixture.json)、[HTTP追踪](B09-acceptance-browser-stale-runtime.json)。被请求乙 404，甲有效；与 Provider 无关。

根因线索：WikiPage.initialOpenId 选择乙后，80ms 的 refreshList 发现 requestedId 不在列表便自动 selectId(first)，因此错误入口被无关第一页覆盖。失败详情与 initialOpenHandled/请求代次也需按实际状态核对。

同一 GPT-6 Luna High 仅修改 app/pages/WikiPage.tsx 必要选择/失败接线；保留正常泛列表首选、过滤搜索、手动选择有效页、有效最近非首条 ID；不改产品后端、存储协议、Raw/Prompt、主Agent tests/acceptance、旧报告或正式数据。不得以禁止历史入口/隐藏删除日志规避。

独立复验：乙“删除”及乙旧“新建”历史入口都明确错误且无甲详情/导出；用户再明确点击甲列表可读甲；有效非首条最近 ID 正确，首次列表迟到不得覆盖指定目标；首页五快捷入口可重复，正常泛列表仍能读首条。F09-03 计数核心保持。构建/已有UI按两次最小界面改动执行；不用重复无关备份/全HTTP。新施工报告 B09-builder-repair2.md，交付文档暂记此缺陷待复验，最终真Provider仍BLOCKED。
