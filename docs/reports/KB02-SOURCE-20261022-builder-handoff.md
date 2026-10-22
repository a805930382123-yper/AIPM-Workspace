# KB02 同源分配返修施工交接

施工完成，产品和默认 tests 已冻结停写，待 Astra 独立验收。**本报告不签 KB02 PASS，不关闭真实质量门槛。** 真实调用新增0，累计仍126/200，Prompt15/24；不启动下一批，不提交Git。

本次接手保留前施工者已有改动与日志，没有回滚共享工作区。依据任务卡完成实现核对、必要测试契约补齐和最终离线门禁；主Agent独立管理 status、agent-control 与 AUDIT 资产。接手检查发现此前只有定向/边界及tsc预检日志，无完整运行和交接，不将其说成已完成工程门禁。

## 冻结及范围

- [最终冻结](KB02-SOURCE-20261022-frozen.json)：100产品资产、74默认测试/支持资产、6夹具、10施工脚本；以文件内UTC时间和SHA256为准。
- [精确变更范围](KB02-SOURCE-20261022-scope.json)：4产品文件、11测试/支持文件适配、新增1默认测试入口。原任务卡10适配文件之外，主Agent明确批准 `tests/kb02-storage-recovery.test.ts` 仅迁移精确missing-unit诊断断言，全部存储恢复、调用计数与证据断言保留。
- 4产品文件仅为 `knowledge-planning.ts`、`knowledge-extraction.ts`、`rules.ts` 和 `kb02-planning.schema.json`。无Provider传输、存储实现、UI、依赖/锁文件或配置变更。
- [完整性](KB02-SOURCE-20261022-integrity.json)：2925个非AUDIT接手保护文件无变化、无新增；正式workspace/config无变更/新增；产品、tests、夹具和施工脚本与冻结一致；精确范围核对通过。
- 初次完整性把并行AUDIT准备脚本误计入保护变化，原结果保存为 [initial-coordination-integrity](KB02-SOURCE-20261022-initial-coordination-integrity.json)。主Agent确认其为Astra合法所有权后，校验脚本单列 `coordinatedAuditBaselineChanges`，不将AUDIT纳入施工冻结或要求其停写；旧历史证据仍受保护。

## 实现与任务映射

| 要求 | 实现及施工证据 |
|---|---|
| 同源重复记录不可独立拆页 | 外发前按精确Raw区间、精确text、facts/questions分栏和fact kind固定unit成员；确定性位置ID，保留全部原ID和记录。seq121的f-c6-3/f-c7-1固定属于同一fu-45613-45652-fact。 |
| v3严格契约 | wire仅接受version3、factUnitIds/questionUnitIds；v2无回退。先schema、ID语法、未知/重复/遗漏unit及标题校验，全部通过后才展开预先固定成员，再核原ID覆盖。未对坏结果补塞ID。 |
| wire与持久结构分离 | 持久plan继续保存原factIds/questionIds和程序生成summary。恢复先验证原结构、原ID全覆盖与summary，再核同unit所有成员恰好属于同页，并无损投影v3验证页面元数据；不能以去重消除拆页。 |
| 恢复兼容 | revision升级为kb02-atoms-planning-8。原revision7未完成checkpoint在Provider/写入前409，原字节保留；已有HTTP回归覆盖旧规则409、显式restart不复用旧chunks及旧已完成草稿读取/零Provider增量。 |
| 语义边界 | 同文异位置独立；同span不同kind、fact/question独立；重复完整多业务atom保持整体，不能虚构不同projection；伪造不同text在外发前拒绝。 |
| 请求安全与预算 | 完整unit/context/feedback仍共同经过秘密扫描及192KiB限制；精确192KiB可发、+1byte不发，未改自动重试/调用预算/取消或持久化模块。 |

新增 `tests/kb02-source-assignment.test.ts` 15项：原seq121逐字v2拒绝/提取不变；受控正确14区域、104原ID保存恢复；5类坏unit拒绝、无自动补发和显式重试；当前规则同unit分裂及元数据篡改；位置/kind/分栏/多业务atom边界；伪text、旧revision7拒绝、192KiB边界。

旧seq100/104各自保留**原v2逐字schema拒绝**，并另以schema有效的v3计划准确遗漏对应原记录所属unit，独立证明覆盖拒绝、无plan和提取不变。seq100原错归页面直接逐页投影会先产生空fact页，所以v3遗漏用例只重现原missing集合，不拿空页schema拒绝冒充coverage门禁；原响应及旧诊断断言仍保留。

## 实测命令及结果

统一离线入口：`node tests/acceptance/KB02-SOURCE-20261022-run.mjs`。该脚本创建临时副本，仅拷产品、测试及规则等工程资产，通过SHA校验后运行；不拷实际workspace或.env.local。独立验收应读取任务卡、实际diff及冻结实物，不仅采信本表。

[最终结构化运行](KB02-SOURCE-20261022-2026-10-22T13-01-58.427Z-run.json)；完整命令参数、临时目录、退出码和耗时均在其中，各行原始日志同时间戳。`full-latest-run.json`是同一最终结果的便捷入口。

| 实际运行项 | 运行时及结果 |
|---|---|
| 全部49默认入口，`--import tsx --import ./tests/support/css-stub.mjs --test tests/*.test.ts tests/*.test.tsx`对应显式枚举 | 本机系统Node **25.2.1**，358/358，0fail、0skip、0cancel；21.68秒 |
| `node node_modules/typescript/bin/tsc -b` | exit0；3.95秒 |
| `node node_modules/vite/bin/vite.js build` | exit0；2.34秒 |
| 原历史 `KB02-FINAL-REPAIR-AUDIT-20261022-boundary.test.ts`单独运行 | 2/2、0skip；原脚本只读保留 |
| bundled旧Node版本实测 | `C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`，**24.19.0** |
| 旧Node SR01、预算、取消、HTTP/React恢复相关8入口 | 51/51、0skip；18.28秒 |
| 旧Node source/规划/分类/更新语义/提取/R2/B05相关8入口 | 79/79、0skip；1.46秒 |
| `node tests/acceptance/KB02-SOURCE-20261022-freeze.mjs verify` | 精确范围及最终完整性通过 |
| `git diff --check` | exit0；无行末空格问题 |

本机系统Node已与历史报告的24.20不同；本轮实际是25.2.1，不声称重测24.20。旧Node24.19是独立实测，不以相邻版本代签。

[测试副本与最终冻结比较](KB02-SOURCE-20261022-tested-copy-comparison.json)：最终被测试副本的产品、tests和夹具均与最终冻结逐字一致；唯一脚本差别是运行后对freeze脚本的AUDIT合法所有权排除与带时间戳完整性归档调整，未改测试执行器。该脚本调整后的verify已实际通过。[被测试副本指纹](KB02-SOURCE-20261022-final-tested-copy-frozen.json)与[首败副本指纹](KB02-SOURCE-20261022-first-attempt-frozen.json)保留，两个临时目录均未清理。

## 失败记录及校准

1. [首跑环境失败](KB02-SOURCE-20261022-environment-failure.md)：沙箱建立node_modules junction时EPERM、exit1，未开始测试或Provider。同命令经工具批准提权后运行。不能归为产品存储rename故障。
2. [首套完整运行](KB02-SOURCE-20261022-2026-10-22T13-00-13.495Z-run.json)：默认353/358、5fail、0skip；旧Node SR01 47/51、4fail，相关78/79、1fail。原日志全部保留，未覆盖成通过。
3. 五项全部有局部测试契约根因：预算两项与storage恢复两项仍期望旧原记录missing `f-c1-2`，v3实际诊断是固定unit `fu-13-26-fact`；新增seq100 v3逐页投影先触发空fact页schema失败。仅迁移3处精确诊断断言，并重建有效schema下的v3遗漏反例。没有放宽断言、skip、预算或覆盖要求；未修改存储产品逻辑。
4. 原始首败与最终运行的产品字节相同，测试差异仅上述三个文件；修正后完整重跑和两个旧Node套件通过。接手前遗留的定向日志仍保留，仅按实际内容引用，不补造未找到的失败记录。

## 风险、未验证门槛与交接限制

unit契约解决的是等价重复原记录**不可拆分**。完整unit仍可能被模型整体放入错误业务页：结构校验无法通用判定标题、主体和日期/数值归属。source用例中使用完整unit构造的单主题/甲乙页可被结构接受，证明结构通过不等于14区域真实质量通过；受控正确14区也只是预定fake输出，不声称真实模型已学会正确归属。

本轮真实Provider、实际浏览器长文、短文和补充更新全链均 **NOT_RUN**。待Astra在工程通过且主Agent另行放行真实外发后，按预算先seq121提取记录诊断，再原106400字符14区域全文、短文/补充更新、实际浏览器审核/明确确认/刷新回读；逐页主体、日期、数值及原ID覆盖，双来源、冲突、人工备注和Raw不可变必须独立核对。fake、结构拒绝或已有工程通过均不替代这些门槛。同核心真实缺陷再失败按任务卡停止试修，交主Agent裁定，不自行重试消耗预算。

正式workspace、实际配置/密钥、历史证据未改；本轮仅隔离fake，无真实外发。自查已完成且产品/tests停写，交主Agent安排独立验收与统一状态/提交同步。本施工者不维护验收结论，不自签KB02 PASS。
