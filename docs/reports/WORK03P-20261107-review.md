# WORK03P 独立验收

本轮两项优化 **PASS**，无待返修缺陷。WORK03P 冻结范围 **PASS**，P01–P05 均有证据；原 WORK03 工程 PASS 保留。真实模型质量与新提示遵从性 **NOT_RUN**，本轮真实产品模型请求 **0**。本机 fake 只证明流程、实际请求与展示行为。

按[冻结卡](../handoffs/WORK03P-20261107-task.md)评分 0/1/1/0＝2、A 标准。Astra Medium `/root/work03_polish_plan` 规划，Terra High `/root/work03_polish_builder` 施工，独立 Sol High `/root/work03_polish_review` 在施工明确停写后验收，未修改产品或用户资料。受验基线 HEAD `1f9ca7798df269bab84868a18d3ef8b28e3e94a2`，叠加下列两个未提交产品文件；最终交付提交由主线程关联。

| 文件 | 受验 SHA-256 |
|---|---|
| `app/pages/WorkAnalysisPanel.tsx` | `64da715f3e96ff271323a8d86f05fd3f642792f12e6f06729f7addfd6762d996` |
| `services/work-items/analysis-runs.ts` | `a99f07c24088c5ff0e2ac076ed747218af76c4f523f4ae8f660375aa2f0253d1` |

## 独立实测

使用基线 Git 归档建立 `node_modules/.cache/work03p-review/source-1f9ca77` 隔离源码，只叠加两个最终产品文件及[独验脚本](../../tests/acceptance/work03p-review.mjs)，不带 NEWS01。复用施工同 SHA 文件产出的空 envDir 构建目录，以独立隔离数据、空配置、本机 fake 和实际 API 运行 Chrome。归档时既有历史对象出现 inflate 错误，但本次运行涉及的源码成功展开；未运行归档中的历史测试，也未修复工作区历史对象。正式资料只用于 P05 的只读比对，未送入模型或隔离服务。

在隔离源码目录执行：

```powershell
$env:WORK03P_REVIEW_CACHE = 'E:/AI/Work/AIPM Workspace/node_modules/.cache/work03p-review'
$env:WORK03P_REVIEW_DIST = 'E:/AI/Work/AIPM Workspace/node_modules/.cache/work03-builder-source/node_modules/.cache/work03p-builder/check-WjZb0K/dist'
node --import tsx tests/acceptance/work03p-review.mjs
```

退出 0。Chrome `156.0.8078.80`，实际 1440/390px，本机 fake **3** 次（v1、正常 v2、长待核项与双冲突 v2），页面异常 0，窄屏无横向溢出。首次默认沙箱因本机回环无法就绪失败；其 API 已由 finally 关闭，获准本机回环后上述隔离运行成功。成功运行数据与日志留在 `node_modules/.cache/work03p-review/run-3l1Oxr`，自有 Chrome/API/UI/fake 均已关闭。

| 项目 | 实测结果 |
|---|---|
| P01 简短带入 | 实际点击带入，正常正文 **262 字**，完整保留 roundSummary，去重后前两条待核、剩余两条提示、单条冲突提醒及原分析说明；不含逐条观察、长原文、全局建议或旧标签。长项 fixture **595 字**，两条问题各截取 120 字后加省略号，首修订截取 160 字后加省略号，剩余三条与两处冲突明确提示。带入未保存事项。 |
| P02 证据边界 | 混合 Q07/Q14/Q18 与纯支持两个主题均显示“AI 标注：有支持材料（待核对）”及邻近案例范围提醒；Q18 原有证据不足结论和待核问题仍在。hypothesis/null 均保留待验证含义。实际点击支持与反例链接，定位观察并打开当轮完整原文。宽窄屏可读。 |
| P03 保存兼容 | 非空编辑使另一轮带入禁用并保留原文；清空后可带入。v1 仍复制观察、引文、建议和问题。v2 人工编辑后显式保存，仅追加一个带原 runId 的阶段成果；刷新回读，再点击“查看该轮分析”回原摘要。已确认结论、未解问题及其他事项字段、Raw、Wiki、全部原运行对象均相等。 |
| P04 提示与调用 | 从实际 fake 请求取得 system，逐项断言五条支持范围与摘要限制要求已发送；user 输入精确匹配原 schema。伪造 `stageContext` 请求被拒且 fake 次数不增加。审差异确认仅原 systemV2 文案改变，无 schema、调用次数或结构校验变更。 |
| P05 原事项更新 | 只读核对主线程 `WorkItemStore.update` 脚本、rev6/rev7/rev8 快照和当前磁盘事项。每一步及总差异均只有 `nextStep`、`revision`、`updatedAt`；history、analysis、rawIds 等相等。最终下一步明确第二轮完成、真实材料验证、Q18 请求条件/结果及版本/导出入口/任务与数据时间；未再次写事项或重跑已保存分析。原 Raw 与两轮运行在独验前后 SHA 相同。 |

P05 检查通过 `node --input-type=module` 只读脚本进行：解析本机 `node_modules/.cache/work03p-20261107/{item-before,item-before-followup,item-after}.json`，比较各字段及当前事项，断言 revision 6→7→8 与目标含义，并记录两份原 Raw、两轮原运行的 SHA。最终再次读取上述四份文件及两个产品文件，SHA 均无变化。[P05 结果](WORK03P-20261107-review-evidence/p05-result.json)

## 复用与证据

复用[施工报告](WORK03P-20261107-builder.md)同两个产品 SHA 的 `node ../../typescript/bin/tsc --noEmit` 退出 0、空 envDir Vite 构建 229 模块，以及导航回归 2/2。已独立比对施工隔离副本与工作树两产品文件 SHA 相同，读取施工 `builder-checks.json`；未重跑其 16 fake 完整链、类型检查或构建。七份受损历史测试只使用施工隔离副本此前基线正文，工作区文件未改。`git diff --check -- app/pages/WorkAnalysisPanel.tsx services/work-items/analysis-runs.ts tests/acceptance/work03p-review.mjs` 退出 0。

独立证据：[运行结果](WORK03P-20261107-review-evidence/result.json)、[实际系统提示](WORK03P-20261107-review-evidence/actual-system-v2.txt)、[正常草稿](WORK03P-20261107-review-evidence/normal-stage-draft.txt)、[长项草稿](WORK03P-20261107-review-evidence/edge-stage-draft.txt)。已逐张查看实际截图：[1440px 主题](WORK03P-20261107-review-evidence/themes-1440.png)、[390px 主题](WORK03P-20261107-review-evidence/themes-390.png)、[1440px 编辑框](WORK03P-20261107-review-evidence/stage-1440.png)、[390px 编辑框](WORK03P-20261107-review-evidence/stage-390.png)。编辑框截图为原五行高度，完整待核和冲突文字见草稿文本与浏览器 inputValue 断言。

本轮完成，可交主线程审差异、仅提交本批文件并核验推送。未启动 WORK04/05；NEWS01 和其他工作区改动保留。待用户决策：无。

交付产品提交：7440007（本报告所列两个产品文件及验收证据）；主线程精确暂存本批状态章节，未纳入 NEWS01 或其他并行修改。
