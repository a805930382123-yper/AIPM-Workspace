# WORK02 施工与自查记录

施工实例 `/root/work02_builder` 为 Sol High。冻结卡对应 Git 基线 `a3a2e4296c6623ede329488d005751c2c9b8596f`。工程修改在 `node_modules/.cache/work02-build-source` 施工和自查，按文件清单合回后停写。独立验收由 `/root/work02_review` 执行。[冻结任务卡](../handoffs/WORK02-20261107-task.md)

- 工作事项支持产品分析和原客户问题。两类事项复用版本保存、资料、截图、状态历史和首页提醒。旧客户记录缺少 `kind` 时可直接读取。详情提示各区独立保存，客户处理区按钮为“保存处理记录”。
- 产品分析事项可保留目标、数据范围与口径、已确认结论及未解问题。每轮通过已有模型配置发送显式选择的 Raw 原文及已保存分析内容，落盘记录实际输入和结果。原文依据按选中材料核对，阶段成果经用户编辑和保存，保留对应执行引用。
- 每事项可同时进行一轮分析。等待模型时可保存当前事项。服务重启后未结束的执行显示中断。可通过既有备份归档恢复事项和执行。

## 实际自查

下列命令在隔离源码目录执行。Chrome 156.0.8078.80 使用 1440px 和 390px 视口。Vite 生产构建使用空 envDir，转换 229 个模块，保留既有的大包体积提示。

| 命令 | 结果 |
|---|---|
| `node ../../typescript/bin/tsc --noEmit` | 退出 0。隔离副本中七个受损的既有测试文件使用基线原文，工作区原文件保留。 |
| `node --import tsx tests/acceptance/work02-builder.mjs` | 退出 0。真实 HTTP 接本机模拟模型。Chrome 同一事项完成两轮，保存手工成果、引用 AI 执行的人工修订成果，经首页回原事项并补充 Raw。仅指定资料发给模拟模型，原 Raw、处理状态与 Wiki 读取结果保持一致。前置缺配置、过期版本、未关联、已删除及 Meeting 限制均未发请求。无效原文依据失败且无草稿。验证并发启动拒绝、分析期间保存、停服中断、备份恢复与重启读取。模拟模型累计收到 5 次请求，页面错误 0。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/work01-http.test.ts tests/app-navigation.test.tsx tests/lifeos-l3-home-ui.test.tsx` | 4 项通过，包含旧客户问题处理、并发版本、截图、恢复以及首页导航。 |
| `node --import tsx tests/acceptance/work01-builder-browser.mjs` | 退出 0，旧客户流程和首页提醒在 Chrome 复测通过。 |
| `impeccable.cmd detect --json app` | 报出 6 处既有边线提示，位置均在本轮未改代码中。已查看两种视口的实际画面。同一分钟的两轮使用轮次编号区分。 |

正式数据目录和用户配置未作为测试输入。真实模型请求为 0，模拟结果仅用于工程验证。[桌面两轮分析](WORK02-20261107-builder-evidence/product-analysis-desktop.png) · [窄屏保存](WORK02-20261107-builder-evidence/product-analysis-mobile.png) · [自查结果](WORK02-20261107-builder-evidence/builder-checks.json)
