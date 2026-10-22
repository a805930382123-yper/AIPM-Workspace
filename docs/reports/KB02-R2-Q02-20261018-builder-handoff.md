# KB02-R2 Q02 施工交接（2026-10-18）

Q02最小返修已实现并完成受控自测，待用户新窗口Astra中独立审查。**不签Q02真实质量或KB02批次PASS；KB02整体FAIL保留，S01已关闭、Q01工程/短文/补充更新既有通过与PA01既有PASS保留。** 本轮真实外发0，未提交或部署。

## 实际范围与取舍

相对接手基线只改2产品文件：knowledge-extraction.ts先判业务/非业务，再对选中业务事实判fragment/歧义，说明非业务标题/排版fragment可sourceNotes或不选、不能转进facts/questions；增加相邻正反例，覆盖标题fragment=true/false、截断排版、业务fragment、业务未来边界及未知。rules.ts将prompt revision4升5进入原rulesVersion指纹。schema/wire、ID/互斥校验、Raw、预算/超时/Provider、S01、PA01、UI均未改。

没有新增确定性分类助手或广义关键词过滤。真实发现是提示中无条件`fragment必须ambiguous`与非业务声明规则冲突；fragment只描述切片完整性，不能客观确定其业务含义。标题、编号、“虚构/说明/未来”等也可能包含合法业务边界，额外关键词删除会引入业务丢失。此轮修正明确的指令优先级及相邻示例，继续让模型选择分类，服务端严格保留互斥与证据约束；**不能因此宣称所有未来真实语义误分已被确定性阻止。** 没有返回后净化、偷偷改分类、修补坏JSON或隐式重试。

默认新增kb02-classification-priority.test.ts六项；仅迁移kb02-extraction-contract.test.ts和llm.test.ts两行当前revision断言，原旧revision3拒绝与原四错误响应断言保留，新增原revision4六块拒绝。精确文件/前后SHA256见[scope](KB02-R2-Q02-20261018-builder-scope.json)。本轮接受脚本是旧脚本的新前缀副本，增加Q02机制验证，原报告/脚本未编辑。

## 验证证据及证明范围

| 检查 | 实测结果 | 证明范围 |
|---|---|---|
| 最终冻结同字节副本默认suite | 265/265，0skip，19.206秒 | 产品97文件、默认tests/support62文件；包含所有旧断言和新增6项 |
| 最终冻结同副本构建 | tsc通过3.347秒、Vite通过1.706秒 | 无复制hash差异 |
| 定向 | 27/27、0skip | 正确受控分类时，fragment真/假标题及截断排版独立存sourceNotes或可不选，不进入业务事实/问题/摘要/规划；业务fragment仍ambiguous且提示待确认，否定/未知/未上线/未来边界原文保留 |
| seq62完整原响应离线 | 严格拒绝、仅一次调用、保留旧六块、不生成计划 | 原106400字符Raw与第7块atom目录逐值一致，原response未净化；特意在隔离探针将旧六块绑定当前版本以到达第7块拒绝，**不代表生产允许旧检查点迁移** |
| Q01原seq41/44/45/49 | 4份均严格拒绝 | 原脱敏response逐值复制、SHA溯源，不改原证据 |
| 实际隔离HTTP | 5/5 | 显式重规划/重启/重复继续、秘密/旧规则、旧覆盖诊断、已完成旧草稿/更新确认，以及R05旧revision4真实形态六块/11非业务facts |
| R05旧六块 | 连续3次409、Provider增量0、checkpoint/job/raw-state三文件字节不变 | 显式restart创建新job，首次调用前成功块0、attempts1、新指纹；主动取消新job，旧检查点字节保留；不以此取消probe签新长文质量 |
| S01与取消实际HTTP | 2/2 | 自然累计6次后连续3次409、Provider增量0、原三文件与missing f-c1-2诊断不变；取消后迟到规划不保存 |
| 安全与Meeting | 28/28 | 提取/规划/更新的ID、长短秘密及嵌套/转义门禁，受限Meeting零Provider |
| 真实长文/新短文/补充更新/实际浏览器 | NOT_RUN | 本轮fake、离线回放与断言不能证明真实模型会遵循新优先级；须独立真实门禁 |

来源原文与source_evidence继续精确对应Raw切片，locator可能同时涵盖业务与非业务文本；本轮不擅自切改引文以“去掉声明”。非业务内容隔离断言针对facts/questions、规划、摘要和业务栏，不能误读成整份草稿证据字段完全不出现原文声明。

证据：[全suite](KB02-R2-Q02-20261018-builder-tests-writable-copy.json)、[构建](KB02-R2-Q02-20261018-builder-build.json)、[HTTP](KB02-R2-Q02-20261018-builder-http-initial.json)、[S01/取消](KB02-R2-Q02-20261018-builder-standards-probes.json)、[安全](KB02-R2-Q02-20261018-builder-security.json)、[夹具溯源](KB02-R2-Q02-20261018-builder-fixture-provenance.json)。全部首败/校准见[calibration](KB02-R2-Q02-20261018-builder-calibration.md)，包括初始夹具25/27和tsc类型错误，不混作最终结果。

## 冻结、完整性与停止

接手2026-10-18T13:41:21.726Z，97产品/61默认测试与2244历史报告脚本/正式文件保护基线已建立。最终2026-10-18T13:48:46.209Z（北京时间21:48:46）冻结97产品/62默认测试、2份夹具和10份本轮验收脚本，[frozen](KB02-R2-Q02-20261018-builder-main-frozen.json)；之后明确停止全部产品/tests写入，仅整理本轮报告及执行只读验证。全套在同冻结逐字节临时副本运行，源树B04旧报告未被全套覆盖，自有HTTP/fake服务全部关闭。

完整性检查产品/tests/夹具/脚本均无漂移，正式workspace无新增、实际.env.local不变。**保护文件1项异常**：`docs/reports/PA01-R1-20261015-baseline.json`相对接手基线hash变化，原因未知，未恢复归因；不能声称2244保护文件全部不变，也不追溯消除历史PA01异常。[完整性](KB02-R2-Q02-20261018-builder-main-integrity.json)、[单列前后hash/当前字节](KB02-R2-Q02-20261018-builder-historical-drift.json)。其余保护文件无变化，依赖/lock/config未改。

## 独立真实验证与有限预算建议

当前KB02累计62/74，剩12；Prompt15/24独立保留，账本未改。新指纹禁止复用旧revision4六段，完整长文须从头：14提取＋至少1规划＝15次；短文2＋补充提取/规划/更新3，基本共20次，现至少缺8。可供用户审阅的有限建议为**追加13次**，使可用25次覆盖基本20＋失败余量5；这是建议，**没有调用、请求或预设新增授权**，不沿用上轮10次追加扩额，不借Prompt预算。独立审查先过工程门禁，再由用户明确授权具体额度与次序；原长文14区/业务边界/整篇覆盖/浏览器草稿核对及短文更新需如实取得新规则真实证据。
