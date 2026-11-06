# WORK03 施工与自查

施工实例 `/root/work03_builder`（GPT-6.1 Sol / high）已完成[冻结任务卡](../handoffs/WORK03-20261107-task.md)范围内的产品实现及施工自查。开工 Git 基线 `ab45c5e85f7e1693eb3a76645369b43e769db0d6`；交接时工作树 HEAD `f16054ebccc913eab2c86687e17bec74d6e16d7c`，下列 WORK03 文件尚未提交。同期 Meeting 和状态变更未纳入施工。施工范围自查通过，批次结论由独立验收裁决。

- 分析发起前可选填本轮问题、勾选本轮 Raw 并指定一条已保存的阶段成果。预览展示将发送的已保存字段、承接正文和本轮完整原文；未保存编辑不进入请求。过期版本重新读取后要求重选，保留未保存编辑。
- v2 按事项版本和历史位置读取承接正文。本机保留并复查源 Raw ID，传给模型的承接数据只有正文和来源类型。旧请求仍使用 v1；新旧轮次留在原备份目录。
- 待确认草稿先展示摘要和主题，按支持、反例、假设、待核、下一步及已确认结论冲突分列，观察可定位当轮原文。带入后仍须用户编辑和显式保存阶段成果；已确认字段和正式资料不自动更新。

| 项目 | 施工实测 |
|---|---|
| W03-01 | 实际 Chrome 1440 / 390 px 从首页到期项进入事项，查看 v1，保存人工和 AI 后编辑两条成果；只选后一条续轮。预览和 fake 实收逐字段相符，没有未保存文本、旧输出、旧或未选 Raw。 |
| W03-02 | 真实 HTTP 拒绝无效下标、非成果条目、空白及过长正文、伪造上下文、过期版本、已知密钥、直接受限来源，以及二次承接继承链上的删除或受限来源。这些尝试未增加 fake 请求。分析期间另存口径未被覆盖；停服记录重启读取为中断，未重发。 |
| W03-03 | 有支持、反例、假设、待验证和结论冲突的主题可读，点击反例跳到观察，再打开当轮原文。十个无效结果均无草稿；人工编辑后的带入只添加一条成果，原确认字段、Raw、处理状态和 Wiki 保持一致。 |
| W03-04 | v1 原接口与旧结果仍可读，真实备份恢复后 v1/v2 运行、阶段成果引用及原文快照与恢复前一致。缺 `kind` 的旧客户记录从实际页面可读，定向回归四项通过。 |

实际命令在 `node_modules/.cache/work03-builder-source` 隔离源码运行：

1. `node --import tsx tests/acceptance/work03-builder.mjs`：退出 0。真实本机 HTTP、Chrome 156.0.8078.80，页面异常 0；16 次本机 fake 请求。命令内以空 `envDir` 构建 229 个模块，保留既有 Vite 大包体积提示。施工截图与 JSON 留在该副本的 `node_modules/.cache/work03-builder/check-q6lDsl/evidence`。浏览器和自有服务已关闭。
2. `node ../../typescript/bin/tsc --noEmit`：退出 0。沿用 WORK02 的七份既有受损测试处理方式，仅在隔离副本从开工 HEAD 恢复测试正文，源文件未改。
3. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/work01-http.test.ts tests/app-navigation.test.tsx tests/lifeos-l3-home-ui.test.tsx`：4/4。该证据先于最后一处分析区域的提示和选项标签调整；实际 WORK03 Chrome 和类型检查使用最终文件。
4. `impeccable.cmd detect --json app/pages/WorkAnalysisPanel.tsx app/pages/WorkItemsPage.tsx app/styles.css`：仅有 `app/styles.css:62` 未改区域的既有边线提示。已检查宽窄屏截图，修正版本重选提示在成功发起后仍显示的问题，并用最终构建复验。交互沿项目现有紫白工作台设计与冻结任务卡。

已核对交付文件与自查副本一致。`git diff --check` 无空白错误。交付文件如下。

- `app/api.ts`
- `app/pages/WorkAnalysisPanel.tsx`
- `app/pages/WorkItemsPage.tsx`
- `app/styles.css`
- `services/work-items/analysis-runs.ts`
- `services/work-items/types.ts`
- `tests/acceptance/work03-builder.mjs`

默认沙箱限制本机回环连接，独立最小探针为 `EACCES`；上述实际 HTTP 和 Chrome 以获准的本机回环运行验证。验证未读取 `.env.local`，未接触正式资料、配置或用户服务。真实模型请求 0，真实分析质量 **NOT_RUN**。施工停写，提交、同步及独立验收由相应实例处理。
