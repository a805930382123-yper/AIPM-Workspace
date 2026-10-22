# KB02 规划遗漏与区域错归返修施工交接（2026-10-22）

**施工完成并冻结停写，交 Astra 独立复审；不签 KB02 批次最终验收。** 主Agent已审定本轮窄方案与两项测试适配、历史probe精确构建排除。施工新增真实调用0，累计仍KB02 104/200，Prompt15/24；没有提交、部署、启动其它批次或改正式数据。

## 实际变更与自查映射

| 问题/要求 | 实际实现及受控验证 | 实际限制 |
|---|---|---|
| F-03：规划遗漏原问题/口径事实 | 每个输入ID/text/kind原样保留，新增sourceId和精确原文上下文；指令要求fact/question双栏分别完整覆盖，未知/否定/未来/ambiguous/待确认边界不得再次过滤。原seq100和104响应通过当前真实管线离线重放仍严格拒绝，无plan；补充双栏与显式仅规划恢复通过。 | 不证明模型内部遗漏唯一原因，也不证明真实Provider已遵守新指令。 |
| F-04：按chunk错归区域 | sourceContexts绑定精确atom全局[start,end)，同位置跨块ID关联而保留全部记录；同文本不同位置分开。指令禁止按chunk号分组，要求跨块同主题合并并保留主体/时间/口径。受控原81事实/25问题完整组装14区域，各原ID按人工fixture归属检查；全部记录不删不补。 | 14页是受控fixture输出，不是程序固定页数/业务关键词算法；真实主题质量待独立验收。 |
| 原文/声明边界 | 上下文是连续Raw切片，前256/后128单元，UTF16边界必要时扩1；原始位置及所有文本逐字可核。上下文周边文字只辅助归属，未选声明不进入facts/questions、摘要和业务草稿。原分类与更新双侧产品代码未改。 | 有界窗口可能不能包含一般资料的所有语义主体。 |
| 有界/秘密/恢复 | 完整payload含coverageFeedback在外发前扫描秘密并检查192KiB，超限/上下文含已知秘密时Provider/预算回调/检查点回调均零增量。严格schema/coverage代码未改。revision6→7，原v6失败cp HTTP409保三文件原字节；显式restart不复用旧块，旧完成草稿可读与复用。 | 上下文增加Token/字节；超过原预算明确失败，不截断、不自动重试。 |

产品修改：`services/llm/knowledge-extraction.ts`仅规划输入/指令/完整payload秘密扫描接线；`services/llm/rules.ts`仅revision6→7；新增`services/llm/knowledge-planning.ts`窄助手。不改Provider、预算公式、持久化schema、pipeline kb02-2、API/UI、存储队列、原文或更新双侧实现。最终rulesVersion为 `b04-b04-1-locator-v2-kb02-atoms-planning-7-8ea207ea2d37`。

## 所有既有测试与配置迁移

- `tests/kb02-classification-priority.test.ts`：revision断言6→7；原业务输出禁止声明断言保留，将planning部分限定facts/questions；新增sourceContexts逐字Raw切片及周边文本不能升级事实的指令断言。sourceNotes互斥、原文/预算等其它断言保留。
- `tests/kb02-extraction-contract.test.ts`：revision6→7；规划顶层键断言增加sourceContexts；声明禁止进入规划记录/业务草稿的断言保留，允许连续上下文包含原文附近非业务文字；新增Raw逐字及不新增事实指令断言；测试名称相应澄清。
- `tests/kb02-final-classification.test.ts`：仅显式restart新规则版本正则6→7。
- `tests/llm.test.ts`：仅当前规则指纹正则6→7。以上共5处revision断言迁移，无删除或skip旧测试。
- `tsconfig.json`：原格式保留，exclude仅追加精确路径 `tests/acceptance/KB02-FINAL-REPAIR-AUDIT-20261022-boundary.test.ts`。该上轮完整构建之后新增的只读历史独立probe有既有未用readFile导入；经Astra明确裁定沿已有旧POC排除约定处理。没有泛排除acceptance或默认tests，旧probe原字节保留且本轮实际运行2/2通过。

新增默认入口 `tests/kb02-planning-context.test.ts` 共13项，覆盖上表的真实管线数据流与门禁，不只测试纯helper。新增只读原始夹具 `tests/acceptance/KB02-PLAN-20261022-sol-failure-fixture.json` 保存seq100/104完整Raw/checkpoint/原失败response及来源SHA，来自虚构隔离验收资料。

## 实际工程结果

最终统一运行：`node tests/acceptance/KB02-PLAN-20261022-sol-run.mjs full`。原完整app/server/services/rules/scripts/tests目录复制，产品/defaulttests/配置/夹具/本轮脚本逐字节冻结相同；没有少复制历史探针来规避构建。最终冻结为100产品、73默认测试支持（48入口）、4夹具+1只读历史probe、11本轮脚本。

| 最终同冻结执行 | 结果 | 耗时 |
|---|---|---|
| 系统Node24.20完整默认测试 | 341/341，0fail、0skip | 35.94秒 |
| `tsc -b` | exit0 | 7.27秒 |
| Vite build | exit0 | 3.02秒 |
| 历史独立双侧边界probe实际执行 | 2/2，0skip | 0.48秒 |
| bundle Node24.19 SR01/恢复/预算/HTTP/UI | 51/51，0skip | 19.48秒 |
| bundle Node24.19规划/分类/双侧更新相关 | 62/62，0skip | 2.60秒 |

完整工程包括取消/恢复/原SR01读写存储/HTTP/React/六链安全与Meeting回归。最终副本 `copyMismatch=[]`、`afterCopyChanges=[]`。首次13项新测试12/13因测试误写既有秘密错误码，校准后通过；相关62首次60/62的旧输入断言按Astra批准适配。第一次完整默认341通过，但tsc报本轮诊断脚本map(JSON.parse)回调类型及上述历史probe未用导入；本轮脚本改箭头回调，历史脚本保留不改，精确排除由Astra批准。原失败日志全部保留；中间完整通过后仅恢复tsconfig原排版（代码核对JSON语义相同），再次从最终冻结完整复跑，结果以上表及最终run为准。

## 精确交接与可回滚入口

全部路径相对仓库根：

- 最终运行：`docs/reports/KB02-PLAN-20261022-sol-full-latest-run.json`，精确时间版本 `KB02-PLAN-20261022-sol-2026-10-22T08-07-01.737Z-run.json`，旁有各命令log；此前失败及中间run原样保留。
- 精确diff：`docs/reports/KB02-PLAN-20261022-sol-exact.diff`（9个产品/测试/配置文件）；范围：`...-scope.json`。
- 接手原字节备份共7份，均在 `docs/reports/KB02-PLAN-20261022-sol-before-` 前缀下，后缀依次为 `services_llm_knowledge-extraction.ts`、`services_llm_rules.ts`、`tests_kb02-classification-priority.test.ts`、`tests_kb02-extraction-contract.test.ts`、`tests_kb02-final-classification.test.ts`、`tests_llm.test.ts`、`tsconfig.json`。`...-self-check.json`逐个验证SHA等于接手baseline，可据此精确恢复既有文件。新增窄助手/默认测试列于scope，回滚仅需按授权恢复这些原字节及处理这两新增文件；施工未执行回滚或覆盖其它未提交内容。
- 冻结：`...-frozen.json`；接手：`...-baseline.json`；最终完整性：`...-builder-integrity.json`；施工自查/旧夹具来源验证：`...-self-check.json`。
- 诊断阶段报告：`...-diagnosis.md`；原始全记录映射：`...-analysis.json`；候选完整payload：`...-seq100-candidate-input.json`和`...-seq104-candidate-input.json`。诊断脚本18项检查是在revision6接手阶段执行，当前revision7原失败重放入口为新增默认测试；不应把原cp静默改成新版本使用。

完整性最终核对：产品/defaulttests/夹具/冻结脚本无漂移，7既有文件的修改集合精确等于批准scope；2806个历史报告/验收脚本/正式数据保护文件无变化、无新增，62正式workspace文件无变化，密钥配置及依赖lock不变。配置仅记录已批准tsconfig精确exclude项差异。主Agent拥有status/agent-control/coordination，本施工未写这些状态。

## 剩余风险与交回 Astra

本轮没有真实模型或实际浏览器调用。原106400字符14区域长文、真实补充提取→候选→预览→明确确认→刷新，以及单/双边支持、20%/30%、人工备注、双来源和最终幂等都需Astra独立复核。不能用fake的14区域计划、原失败响应仍拒绝或工程全通过关闭真实语义缺陷。原分类/双侧约束和历史FAIL继续保留，KB02整体裁决由Astra决定。

输入丢失/原文重叠和输出按chunk归组可证实；模型内部为何漏具体ID仍不可证实。保留全部重叠ID避免删记录遮掩，也保留既有重复事实显示风险。本轮不引入语义实体分类器、去重重写、Provider升级或自动补ID。规则更新让旧未完成检查点需要用户显式restart，禁止修改正式旧cp指纹复用。

最终工程及自查完成；产品、默认tests、配置和冻结脚本停止写入，独立复审由Astra进行。测试子进程已结束，临时HTTP数据根由测试finally清理，完整副本与日志保留；无常驻服务、无浏览器标签。本轮token计量不可得。
