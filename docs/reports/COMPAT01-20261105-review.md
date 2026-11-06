# COMPAT01 独立验收（2026-11-06）

## 最终结论

**本轮兼容缺陷及验收返修关闭PASS；COMPAT01全仓工程门禁PASS。** 独立全量最终738/738，fail/skip/cancel/todo均0，完整tsc与空envDir构建通过，独立新TEMP真实Chrome维护/焦点/失败保留闭环通过。真实模型语义、真实Provider质量仍NOT_RUN；不改变任何历史质量账本或历史批次结论，不推进下一批。

规划/独验为Astra Medium `/root/compat_planner`，施工为Sol High `/root/compat_builder`及`/root/compat_ui`；本验收实例未修改产品或施工测试。评分0/2/2/1=5，B。HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b` 加当前未提交工作树，依据[冻结卡](../handoffs/COMPAT01-20261105-task.md)、[施工交接](COMPAT01-20261105-builder.md)、[UI交接](COMPAT01-20261105-ui-builder.md)。

## 版本与保护

施工冻结32份既存文件变化、4份新增源码/测试辅助，先核32/32 SHA匹配。独验发现异步等待缺陷后UI仅修改 `tests/kb02-human-ui.test.tsx`，最终SHA为 `8a5280e810eb6dca6cf2fb473b5e611bf854a3a83cc49b84c8c25292af404bbc`；其余产品/测试脚本保持施工SHA。最终再次核32份一致。独验[完整性记录](COMPAT01-20261105-review-evidence/integrity.json)是含返修的实际版本依据，原施工首冻指纹不覆盖改写。

独立重算5412份开工基线：5380不变、32变化均在授权范围、0移除；4新增与冻结一致。4114份既有报告/截图无变化，正式workspace/.env/凭据/依赖/git/build在枚举后读取前排除。没有以相对HEAD累计diff冒称本批差异；例如structured-note旧sourceBoundary字段沿用且本批SHA不变。

## 实测命令、结果与返修

| 独立执行 | 结果与证据 |
| --- | --- |
| 原样 `npm test` | 首次738项737通过1失败，exit1，32216.2458ms；[原始FAIL](COMPAT01-20261105-review-evidence/npm-test.txt)、[隔离运行记录](COMPAT01-20261105-review-evidence/npm-test.json)。 |
| 返修后原样 `npm test` | 738/738，exit0，32473.1314ms，0skip/cancel/todo；[最终日志](COMPAT01-20261105-review-evidence/npm-test-r1.txt)、[运行记录](COMPAT01-20261105-review-evidence/npm-test-r1.json)。 |
| `npx --offline tsc -b` | 全配置exit0、无诊断；[记录](COMPAT01-20261105-review-evidence/tsc.json)。 |
| `node docs/reports/COMPAT01-20261105-review-evidence/build.mjs` | 独立Vite Node API，configFile:false，新空TEMP envDir、TEMP outDir，226模块exit0；[日志](COMPAT01-20261105-review-evidence/build.txt)、[参数](COMPAT01-20261105-review-evidence/build.json)。既有bundle体积警告保留。 |
| `node docs/reports/COMPAT01-20261105-review-evidence/browser.mjs` | Chrome156真实完整App/API、本地fake、新TEMP，exit0；六张独立截图均实际查看，pageErrors为空、外部请求0；[结果](COMPAT01-20261105-review-evidence/browser-2026-11-05T16-25-42-461Z/result.json)。 |

独验F-COMPAT01-01：`kb02-human-ui.test.tsx:60`在只等待维护按钮出现后立即断言Raw预览，实际空串、预期完整正文。Raw读取与草稿显示独立异步完成，按钮出现不代表Raw已到。返修由UI施工者增加等待Raw预览非空，随后原完整相等与只读断言不变，无固定sleep、无删除断言或产品改动。最终完整738项关闭。首次FAIL日志完整保留，未把单次施工PASS替代独验。该变化仅测试就绪条件，独立tsc/build/Chrome所测产品及其入口SHA完全相同，复用其已通过证据，不冒称返修后又运行这三项。

## 归因与门禁审查

已读完整81条映射并逐条对照基线位置、施工最终通过行与独立最终通过名称，全部匹配，[独立核对](COMPAT01-20261105-review-evidence/mapping-check.json)。本次基线735/654/81涉及25文件；历史LW03734/652/82仅有报告级逐文件证据，质量迁移历史多1失败本轮未复现，旧逐条TEMP日志在前设备不可用。不能声称已在精确历史工作树逐条重跑82项。最终新增3项，包含最后1/2槽分支、维护非法JSON恢复、当前维护摘要/编辑清审；发现范围保持原107个文件及原npm命令。

检查实际测试/fake/审核helper和产品控制流：

- 规则19仍精确断言，fake按maintenance真实阶段返回，未知阶段拒绝；标准N+2/深度N+5计数明确。单块6上限未涨，剩两槽成功与剩一槽失败均保留checkpoint、调用数及零写入性质。
- 当前维护用真实逐项reviewChange接受、核对摘要和确认，HTTP仍验证未接受/未审批/旧摘要拒绝、编辑清审、仅确认项落盘。旧Source逐字节复用和人工合并仅显式legacy持久草稿且仍走旧审核；不宣称现行维护支持合并。现Source链接追加有精确选集、去重与原内容保护。
- 确认码修复位于已confirmed终态、无未处理维护项且有可比完成事务的拒绝分支；标准空集NO_SELECTION、未知ID、同key载荷差异仍优先。HTTP实际deferred重新审核后新key续批通过，终态不同payload拒绝，拒绝前后Wiki/日志/事务不增。QA/inspection提前独立分支未被此修复截断。
- 共享粗locator不同原句的真实丢失缺陷按内存identity加入exact prose修复，reason不作为identity；持久标记不变。原两组逐原句断言、既有同句合并/异位置异类别/重复执行稳定回归均在独立全量通过。旧形状仍可读，已缺原句旧检查点不会自动修改或自动外发。
- `offlineMaintenance`默认false，仅fakeCase启用；旧real命名工具仅fake(root)两行适配。真实run/prepare及30/20/15政策不改。未删测试、未新增skip/todo、未降低tsconfig或默认发现范围；Raw/来源权限、过期与恢复回归在独立全量通过。

## 实际浏览器

独验复用已审施工驱动的操作方式，仅复制到review路径并改输出目录，启动全新TEMP；不是复用施工截图。首页生成Raw草稿→接受核对→编辑保存清审批→重新核对→刷新从首页重开→显式201确认→正式主题与Source回读成功。查看[编辑清审](COMPAT01-20261105-review-evidence/browser-2026-11-05T16-25-42-461Z/01-edited-approval-cleared.png)、[正式回读](COMPAT01-20261105-review-evidence/browser-2026-11-05T16-25-42-461Z/02-formal-wiki-after-refresh.png)；回读截图左侧列表仍加载，右侧内容及后续API/持久化断言已核。

Raw导入从键盘触发后标题获得焦点，Shift+Tab首到末、Tab末到首，Escape沿旧行为，关闭恢复到导入按钮，重开/取消再恢复；亲看标题、末按钮、触发按钮焦点截图。SSR原三个测试文件字节未改且独立通过。

第二Raw入口生成更新维护草稿，审核后制造真实目标版本变更，确认409 WIKI_REVISION_CONFLICT，[实际失败界面](COMPAT01-20261105-review-evidence/browser-2026-11-05T16-25-42-461Z/06-confirmation-conflict-retained.png)保留草稿、提示目标已变化且不覆盖原文；拒绝前后正式Wiki SHA一致。两份TEMP Raw前后SHA一致，六次全为fake。唯一console error为该预期409，无pageerror。自有服务PID33584已退出，Chrome已关闭；TEMP与截图保留。

## 边界与交付

全量命令每次新TEMP数据根及空配置，清继承Provider/代理/NODE_OPTIONS，npm offline并禁更新提示；HTTP测试另显式隔离，配置单测只读取合成TEMP文件。真实Provider请求/费用0、真实配置/凭据读取0、正式workspace读写0。没有提交、推送、部署，没有更新真实调用预算；知识275/500、Prompt20/24历史账本不动。

本轮发现的产品兼容缺陷和独验测试时序缺陷已关闭；COMPAT01当前工程范围全部必选门禁有证据。后续建议由用户决定下一阶段或另授权真实模型质量验证；当前没有需用户裁决事项。

收尾协调记录：上述5412基线核验完成后，主线程获授权在docs/status.md与docs/agent-control.md追加本批结论；这两份协调记录不计入32份产品/测试变化，不改历史正文。主线程最终32+4共36份SHA与返修override全一致，见[最终复核](COMPAT01-20261105-review-evidence/main-final-integrity.json)。
