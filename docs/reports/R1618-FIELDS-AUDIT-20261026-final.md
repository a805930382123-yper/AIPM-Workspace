# R1618-FIELDS 独立验收

2026-10-26；Astra medium。施工Sol High明确交接停写后，独立核当前任务卡、交接、8处产品实际差异、新服务测试及lab。基线 `439ae5257d7863cac70c6feb6db3e8dfd28cb889` 加本轮未提交差异；最终提交标识由主Agent统一补充。

**局部服务工程F01/F02/F03通过，F05定向检查通过；完整人工UI闭环F04 BLOCKED，本轮任务不能整体PASS。** R16自动逐字段质量仍缺证，R18历史自动流程失败保留，R16/R18整项及B09/全产品未通过。服务测试和HTTP模块200不替代实际浏览器。

## 实际独立证据

| 命令/检查 | 结果 |
|---|---|
| `git diff -- services/wiki/drafts.ts services/wiki/render.ts services/wiki/commits.ts services/wiki/knowledge-workflows.ts services/storage/record-validators.ts app/api.ts app/pages/DraftReviewPage.tsx`，并读取新增template-fields.ts | 8个产品落点符合授权，新增固定字段契约，无模型协议扩张 |
| `node --import tsx --test tests/r1618-field-editing.test.ts` | 独立7/7 PASS，0失败，632.1792ms |
| `node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --smoke` | 单次最终隔离envDir版：shell和browser入口模块200，随后DraftReviewPage模块请求TimeoutError；尚未到草稿GET；finally关闭，exit1 |
| `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue`，筛5176/57941 | 无监听；本次lab服务已关闭 |
| `git rev-parse HEAD` | 上述439ae525完整提交标识 |

独立逐项审过7项测试，覆盖Concept8/Process14字段、同证据复用、非法键/未知与外页引用拒绝；摘录逐字含未知/未来限定，人工说明及分析建议标签独立。保存新DraftStore回读、修改后审批失效/无变化保留、重审正式提交、新WikiStore正文与预览一致、Raw及原事实证据保真均通过。

移归破坏引用或同ID换引文原子拒绝，未引用unit仍可移动；合并/切型/旧Wiki更新带字段时明确拒绝并保留数据；直接篡改无效字段不能绕过确认。Concept新字段启用后空解释待确认、旧说明独立，全清空回退旧表现；无属性旧草稿读取不写盘、完成事务重试复用原正文。拒绝带字段合并是已批准能力边界，不称无损合并已实现。

施工同版本的上一轮模板3项、公共metric1项及tsc exit0复用交接证据，未独立重跑，也未运行宽回归。UI实际差异已静态核对字段选择、文本标签、快照、dirty门禁、已保存正文预览及限制提示，但未签实际交互通过。

## 两项阻塞及配置偏差

1. 主Agent报告CUA初始化及一次reset均因Windows sandbox setup refresh错误退出；实际Chrome未操作。因此F04编辑→刷新→审后再改→重审→正式页刷新闭环BLOCKED，无截图或真实UI落盘证据可验。
2. Sol初次lab曾走过草稿GET，第二次草稿GET超时；本次独立最终版在更早的DraftReviewPage模块请求超时。只读核草稿GET路由、Draft派生及lab接线未确认单一根因；不能将这些不同位置的超时判作已定位的产品存储缺陷，也不能把服务测试通过当lab全链通过。本轮不盲目修改或反复smoke。

本次lab自有隔离目录 `C:/Users/80593/AppData/Local/Temp/r1618-fields-lab-U3Oxb7`，draft `91b66643-bb7d-4cad-89bd-500c1f6c4f64`；API57941、Vite5176均已关闭，夹具保留。未进行人工正式提交。

最终代码的Vite envDir已明确指向该新建TEMP根，Provider恒undefined，不导入配置管理器。**Sol早期两轮Vite默认envDir可能读取项目.env.local，因此本轮“实际配置读取0”无法证明，不能签配置零读取边界满足。** 未主动查看、打印或外发配置内容；无真实Provider调用证据。lab元数据的configReads:0是硬编码声明，不是读取审计，不能用于覆盖这一偏差。

真实模型调用0，知识244/500、Prompt15/24保持；不得将配置读取未排除等同于已发生模型调用。验收仅写本文、执行隔离检查，无产品修改、正式workspace操作、旧证据覆盖或Git写操作。

建议交付当前服务工程证据，保留F04及lab可用性阻塞。后续先恢复浏览器能力并定点处理lab接线/模块超时，再补实际UI闭环；不需重跑已通过服务矩阵、自动模型抽样或新建冻结体系。
