# WORK04 B 独立验收

本轮实现及范围内缺陷关闭 **PASS**，W04-B1、W04-B1-edit、W04-B2 工程验收 **PASS**。结合已有 [A 工程验收](WORK04A-20261107-review.md)，WORK04 A+B 工程整体 **PASS**。真实模型请求 **0**。此前 A 的单次合成质量证据保留，真实客户数据与广泛复核质量尚未验证。WORK05 未启动。

按[冻结任务卡](../handoffs/WORK04-20261107-task.md)执行，评分 0/1/1/0＝2，A 标准。`/root/work04b_plan`（GPT-6 Astra Medium）规划，`/root/work04b_builder`（GPT-6.1 Terra High）施工，`/root/work04b_review`（GPT-6.1 Sol High）在施工停写后独立核查，未修改产品代码。

| 验收项 | 实际结果 |
|---|---|
| W04-B1 | 在 Chrome 1440/390px 保存发送、技术回复、失败复测，建议随已保存事件出现，状态在明确应用后依次成为等待、待复测、处理中。预览和取消不发 PUT。捕获实际提交验证空字段预填、用户填写日期、保留既有值和明确清空。倒置实际发送时间仍按追加顺序取最新事件。补充反馈、复现说明和反馈草稿未触发；通过复测未关闭，旧客户记录及历史刷新可读。 |
| W04-B1-edit | 预览前后编辑原表单，等待对象、下一步、跟进日期三字段被明确标为保留且不进入实际 PUT，客户与项目输入也保留。应用状态后再保存原表单，状态保持应用后的值。状态有未保存改动或另一分区保存时应用禁用。注入 503 后预览与原表单输入都保留，无成功提示。独立 HTTP 更新制造真实 409，旧预览保留并禁用，读取最新后按最新技术回复重算，保留原表单未保存内容，PUT 没有重放。人工关闭、重开及刷新均未重播旧发送事件。 |
| W04-B2 | Chrome 补关联新 Raw 后出现建议，点击聚焦原材料选择区，保留已有选集、本轮问题和承接成果。建议动作新增 PUT、分析 POST、复核 POST 和 fake 请求均为 0。实际运行中隐藏，失败后恢复，明确完成后消失。v1/v2 已用资料、取消关联、不可用及受限 Raw、关闭、无完成记录及读取失败的抑制均通过。原轮草稿与已保存复核仍可读，原轮文件 SHA 保持一致，WORK03P 短摘要和待核标签可用。首页保留到期规则与原 ID 跳转。 |

实际命令和证据

- `WORK04B_REVIEW_DIST` 指向施工隔离副本的同版 `node_modules/.cache/work04b-builder/dist`，执行 `node --import tsx tests/acceptance/work04b-review.mjs` 退出 0，8 组通过。真实 `server/index.ts`、Chrome `156.0.8078.80`，页面异常 0，截图目检无横向溢出。4 次本地 fake 来自建立旧分析和旧复核各一次、明确发起 v2 失败及完成各一次。默认沙箱出站回环返回 `EACCES`，获准隔离回环后完成。早期脚本的日期输入格式与已填文本的选择器已修正，未计为产品失败。
- 复用[施工交接](WORK04B-20261107-builder.md)的同 SHA 隔离类型检查、空 envDir 231 模块构建和首页/导航定向 2/2。独立对比隔离副本与工作树的两份变更源码指纹，实测前后相同。范围内 `git diff --check` 和 `node --check tests/acceptance/work04b-review.mjs` 退出 0。未重跑 A 的完整矩阵。
- [脚本](../../tests/acceptance/work04b-review.mjs)、[请求计数和实际 PUT](WORK04B-20261107-review-evidence/summary.json)、[客户桌面预览](WORK04B-20261107-review-evidence/customer-preview-1440.png)、[客户手机预览](WORK04B-20261107-review-evidence/customer-preview-390.png)、[产品手机建议](WORK04B-20261107-review-evidence/product-suggestion-390.png)。正式资料、用户模型配置和用户服务未用于验收。验收自有 API、Vite、Chrome 与 fake 均已关闭，三个自有监听端口已核实退出。

独验时 HEAD 为 `4749256e8b6e06883d472bba222ff89ced4a6ca5`，产品改动位于工作树，最终交付提交由主线程记录。

| 受验文件 | SHA-256 |
|---|---|
| `app/pages/WorkItemsPage.tsx` | `9AD1FE7026BECE4E3E2926E58C8E6E4D9E5908C3247F73EE80CF9EE3FFA7EE3B` |
| `app/pages/WorkAnalysisPanel.tsx` | `7B440D58957050E632FCD882AE372A25E22C091DCBED18977054F5D440E3E0BE` |

最终产品交付提交：bdd4f5e。主线程已核对实际差异和手机预览，仅提交本批文件；其他修改及本地资料保留。
