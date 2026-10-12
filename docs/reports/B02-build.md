# B02 施工记录

日期：2026-10-04  
施工角色：GPT-6 Luna High

## 交付范围

B02 在既有 Raw 与首页统计基础上加入六类手动 Wiki 页面、服务端规则/模板、13 分类学习地图、五字段中文搜索、标题/别名 Wikilink 解析、来源 Raw 回跳、入链查看、Markdown 导出，以及 Wiki Index、Log 与真实统计。页面以 Markdown 文件为事实源；Index、Log 失败由 pending 操作记录支持恢复。来源卡显示来源发布日、导入时间与 URL。

快速新建会等待服务端 schema 加载后再生成表单，避免首页快捷入口创建空模板。Business Process 模板正文中的 AI 机会一节标为“分析建议”。产品不调用 LLM，不包含 Prompt、上传或自动知识整理。

## 验证

- `npm.cmd run build`：通过（`tsc -b` 与 Vite production build）。
- `npm.cmd test`：14/14 通过，覆盖 Raw 原文持久化、统计边界、六类 Wiki CRUD/导出、中文搜索、链接解析、并发版本、来源校验、回收、派生文件恢复。
- 独立 HTTP/磁盘验收：监控 Agent 于 2026-10-04 报告 12/12 PASS。此结果由独立验收记录维护，本文件不代替验收结论。
- 浏览器验收由主 Agent 使用隔离端口与数据目录执行；UI-01 快速新建模板非空、来源卡发布日期、UI-03 原生 Markdown 下载、UI-04 保存后关联刷新及切页保护均已实测通过。
- 最终 UI 源文件 `app/pages/WikiPage.tsx` SHA-256：`73bbbcfd0905c61845cc102cd5559acd5e8e675ab83bade895cf15cf78de4940`。此版本对应上列 `npm.cmd run build` 成功与 `npm.cmd test` 14/14 PASS；UI-03/04 只改该 UI 模块，后端未变。

## 数据与范围说明

默认数据根为项目 `workspace/`，可由 `FMCG_DATA_DIR` 覆盖。Wiki 页面保存在 `knowledge/wiki/`，pending 派生操作状态在 `state/wiki-operations/`，删除页进入 `knowledge/recycle/wiki/`，Log 在 `knowledge/logs/wiki.jsonl`。不对 Index、Log 与页面文件声称跨文件原子事务；操作日志记录已提交的页面 ID/revision，并允许后续恢复派生文件。

本批只实现手动 Wiki 能力。需要 LLM 的综合、Prompt、Lint/Audit、文件上传以及更完整的事务协调保留在后续批次。
