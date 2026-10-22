# KB02 两项质量返修施工交接（2026-10-22）

施工者：本次获明确授权的 GPT-6.1 Sol High 子Agent。状态：**实际施工及受控工程验证完成，产品/tests已冻结停写，待独立Astra审查；不签KB02或真实质量PASS。** 真实Provider新增0，累计KB02 82/200、Prompt 15/24保持。未提交、部署或推进下一批。

## 范围与实现

仅3个既有产品文件变化，前后SHA见[精确范围](KB02-FINAL-REPAIR-20261022-builder-scope.json)。未改knowledge-atoms、schema/覆盖/互斥校验、Provider/配置/预算/超时/重试、存储队列、Raw、持久化sections/evidence、API/UI形状或synthesis契约。

| 缺陷 | 实际修改 | 验证与限度 |
|---|---|---|
| F-KB02-FINAL-01/P1 | `services/llm/knowledge-extraction.ts:102–110`：首句纠正为机械原文切片；明确非业务截断说明＋相邻标题，即使fragment=false也不构成业务歧义；增加非业务拼接与实际经营数值/否定/未来/未知的成对例子。没有响应后删除、改分类或补塞页面。`services/llm/rules.ts:33`：revision5→6。 | 新增6项默认回归验证请求、正确受控分类的提取→规划→组装、原seq75/77反例、旧14段HTTP409及零副作用/显式restart、旧完成草稿可读。仍需真实模型全文证明分类质量。 |
| F-KB02-FINAL-02/P2 | `services/wiki/knowledge-workflows.ts:52–64,123–126,155–165`及locator导入：agreement按逐断言最小共同命题，旧侧独有保留existing、新侧独有进入suggestedAdditions；加入同义100家、旧独有销量声明、20%/30%冲突、未知/未上线/未来边界例子。旧Wiki正文沿现有定位器建立连续只读目录；ID由`Wiki ID＋revision＋正文SHA`摘要及序号绑定。内部agreement严格要求text/evidenceId/existingLocatorId，分别校验选中建议的新证据目录及本次旧目录；外发前、返回后核对当前目标完整版本。 | 新增15项默认回归覆盖合法、缺侧/错侧/未知/额外字段、同正文错revision、跨目标、并发目标修订、原seq82、受控语义样本、确认/重启幂等和synthesis兼容。双侧定位只证明选中两侧原文，不能证明语义支持；真实agreement仍需人工逐条核对。 |

新提取规则指纹：`b04-b04-1-locator-v2-kb02-atoms-planning-6-0bbbb554767d`；原失败指纹`b04-b04-1-locator-v2-kb02-atoms-planning-5-5f295d663f5a`必须显式restart，生产不迁移或净化旧检查点。旧侧定位仅在本次生成请求/响应校验使用，保存结果继续为既有证据结构及baseWiki快照。

默认测试新增`tests/kb02-final-classification.test.ts`与`tests/kb02-final-agreement.test.ts`共21项；3处旧revision断言迁移位于classification-priority、extraction-contract和llm测试。另仅刷新`tests/kb02-r2.test.ts`在确认后准备的target至当前revision，保留原未知证据EVIDENCE_INVALID断言，不因新版本预检而跳过原断言。

## 失败样本与可追溯证据

新[完整失败夹具](../../tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-failure-fixture.json)保存原106400字符全文、14段失败checkpoint、seq75完整请求（包含完整atom目录）及响应、seq77完整规划请求及响应、seq82更新请求及原错误响应。来源原件路径与SHA在fixture.provenance中；原trace SHA为`8e75657ee70507642c2c031b10ed190e3e0a4c649a0a88c14e096e8a1e5e2267`，全文SHA仍为`a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`。生成脚本仅从旧证据读取，写入本轮新前缀。

seq75的c13-a0272目录已与现有未改切片器完整重建比对；原响应结构合法但误分类。离线显式重绑当前指纹的诊断测试仍因seq77遗漏f-c13-4而严格拒绝，证明没有净化或覆盖绕过；这是隔离测试，不是生产恢复策略。真正旧revision5的14段checkpoint经HTTP连续3次409、Provider增量0、cp/job/raw-state三文件原字节不变；显式restart新job从0旧块、attempts1开始，并在首个fake调用后取消，旧cp原件不变。旧已完成revision5草稿HTTP可读且普通start复用、零新外发。seq62及Q01四条原格式失败夹具继续由默认套件严格拒绝。

原seq82缺旧侧ID，在新内部契约下结构拒绝；没有补ID。这项只证明新身份约束，不把它当真实单边语义缺陷关闭。

## 实测命令与结果

最终冻结时间UTC **2026-10-22T04:31:54.325Z**（北京时间12:31:54）；[冻结清单](KB02-FINAL-REPAIR-20261022-builder-frozen.json)含99产品、72测试支持资产（47默认入口）、3夹具、3本轮脚本。最终[完整运行原始记录](KB02-FINAL-REPAIR-20261022-builder-2026-10-22T04-31-55.546Z-run.json)与[最新运行](KB02-FINAL-REPAIR-20261022-builder-full-latest-run.json)指向同一结果。

执行入口：

```powershell
node tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-integrity.mjs baseline
node tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-fixtures.mjs
node tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-integrity.mjs freeze
node tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-run.mjs targeted
node tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-run.mjs full
node tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-integrity.mjs verify
```

baseline是接手时一次性记录，复审不要重新baseline覆盖原记录。run脚本复制同字节产品/tests/夹具/本轮脚本至临时隔离根并核对SHA，通过junction只复用node_modules；不复制正式workspace或Provider配置，不调用会重写旧报告的npm/历史验收脚本。完整底层命令数组、临时根、各项耗时和日志见run.json。

| 最终检查 | 实测 |
|---|---|
| 系统Node v24.20.0 默认完整`node --import tsx --import ./tests/support/css-stub.mjs --test <全部47入口>` | **328/328、0fail、0cancel、0skip**，39.75秒；全套包含S01原预算两项、SR01恢复/读写、取消重启、HTTP/React组件、六链秘密/来源安全及更新兼容。 |
| `node node_modules/typescript/bin/tsc -b` | exit0，7.11秒。 |
| `node node_modules/vite/bin/vite.js build` | exit0，3.81秒。 |
| 本机旧Node v24.19.0 原SR01范围8入口 | **51/51、0skip**，23.50秒；范围与上一SR01 R2相同。 |
| 旧Node v24.19.0 本轮定向6入口 | **49/49、0skip**，2.61秒。 |
| 最终隔离副本执行后SHA | `afterCopyChanges=[]`，各命令exit0。 |

保留校准失败：[初次定向35项记录](KB02-FINAL-REPAIR-20261022-builder-initial-targeted.json)为33通过/2失败，新增测试错误调用WikiStore.update签名，修正准备参数后通过；[第一次49项原始日志](KB02-FINAL-REPAIR-20261022-builder-2026-10-22T04-27-16.539Z-targeted.log)为48/49，旧测试确认后使用过期target先触发版本拒绝，刷新测试target后保持未知证据断言并通过；[首轮完整原始日志](KB02-FINAL-REPAIR-20261022-builder-2026-10-22T04-28-15.504Z-fullsuite.log)为327/328，唯一失败是遗漏迁移的revision5正则。该轮tsc/Vite、旧Node51/51和49/49已通过。迁移断言并消除首句“语义边界”与机械切片规则冲突后，重新冻结并跑出上表最终完整结果。旧失败日志未覆盖或删除。

## 完整性与验收边界

[接手基线](KB02-FINAL-REPAIR-20261022-builder-baseline.json)保护2731个既有报告、脚本及正式workspace文件；`.env.local`仅存存在性与SHA，config目录核对无新增。主Agent拥有的status/agent-control/coordination列为可变状态文件。本轮未回滚共享工作区任何既有改动；git所有权提示仅用单命令safe.directory做只读检查，未改全局配置。首次报告写入受沙箱EPERM拒绝后按工具规则升级执行获准，没有把失败记作成功。

[最终完整性](KB02-FINAL-REPAIR-20261022-builder-integrity.json)：冻结产品/tests/夹具/脚本变化均空、2731保护文件变化空、workspace/config新增空、配置SHA相同。相对接手基线仅3产品文件、4旧测试文件和2新增默认测试变化，完整前后SHA见scope；历史PA01异常结论不追溯更改。

| 原标准 | 本轮施工证据 | 仍需独立完成 |
|---|---|---|
| K2-01 | 请求规则、原反例、证据ID/版本身份与严格拒绝受控覆盖 | 原失败块及真实单边/双边语义，未知/未来/否定逐断言核验。 |
| K2-02 | 正确fake分类可完整规划组装；旧错误事实仍严格阻断 | 原106400字符14区域全文成功、数值日期/业务事实/主题覆盖、业务栏无排版声明。 |
| K2-03 | 同冻结默认S01/SR01、取消重启、旧14段拒绝/显式restart/旧完成草稿兼容 | 沿既有独立标准复核，不由施工者重签原批次。 |
| K2-04 | 同冻结工程、实际localhost HTTP及React组件回归 | 真实短文＋更新、实际浏览器候选→明确选目标→预览→确认→刷新回读与长文最终草稿。 |

真实模型与实际浏览器本轮**NOT_RUN**。fake正确标签证明机制；双侧合法引用也可能承载语义错误，不能据工程全绿关闭F-01/F-02。独立Astra应读取实际差异及原方案/验收标准，按累计82/200、阶段最多30次控制真实复验，Prompt15/24独立。产品/tests现在停止写入；任何真实必选项未过，KB02整体FAIL保持。
