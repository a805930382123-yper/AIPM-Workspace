# KB02 B1 施工与自查交接

施工完成，产品与测试已停写，交回 Astra 独立复审。**本报告不宣布 F-KB02-REGION-SUPPLEMENT-01 修复验收通过，也不宣布 KB02 整批通过。** 真实模型语义质量和真实 Chrome 更新链尚未在本轮施工执行。

基线 HEAD `0e44ab5563e5de3f4cdd8ed663a51393fde53422`，产品基线 `17121be7ec20f73b367750d281a4e1dd2c742a76`。按主 Agent 放行后的施工卡及 Astra 已确认 B1 实施，未重规划、未改任务范围；未提交或推送，由主 Agent 统一处理。冻结样本 JSON 的 SHA256 为 `5cc5a6bdcb10738687e226bfca86e52a9a037ddad57d5eac492365c16745fbc5`，未修改。

## 实际变更与问题映射

| 问题/约束 | 实际施工 | 自查证据 |
|---|---|---|
| 结构合法但仅未来边界独立成机制页可进入草稿 | 在 v3 严格结构、unit/原 ID 完整覆盖及秘密校验后、有效 plan 第一次保存前，新增一次全部页语义审核；只在全部页 pass 时保存/组装 | `tests/kb02-semantic-review.test.ts` 原 seq202 全输入/原响应对照；reject/uncertain 均无 plan/草稿，保完整成功块；普通同 job 继续重规划+审核可完整生成 |
| 审核不得自动改写、搬页、删除或重试 | 新窄模块只返回 `Promise<void>`；冻结候选及完整输入，单调用闭包绑定，不输出替代 plan 或可复用批准令牌 | 候选原对象变化不影响已解析候选；实际候选深冻结；另一候选重新审核且可被拒绝；所有原 ID/原文保留 |
| 严格审核协议 | 新 schema 顶层 version1/pages；页六字段全部必填、两层禁止额外字段；窄校验实现全页唯一覆盖、已知/不重复 unit、decision/code 配对及 pass 引用本页 fact | 漏页/重复页/未知页与 unit/重复 unit/非法 code 配对/额外字段/版本/理由长度、已知 question 与邻页 fact 负例；全部 fail closed |
| 失败不可持久化模型 reason 或伪造 coverage | 固定语义错误码/可信消息；审核 schema 错误不带任意 enum/字段细节，非法 JSON 不带原文 preview；失败候选/审核结果不写入检查点 | runner 拒绝后固定错误、无 details/coverage diagnostic/模型理由；planningRetry 不可用，普通继续沿原入口 |
| 额外调用与恢复完整性 | 组合前预留两次；两次分别由原 beforeCall 持久记账，审核前后检查取消/deadline；192KiB 输入不截断、60s/600s、2MiB 等原上限保持 | 剩一零调用、最后两次成功、计账失败不调用审核、审核输入独立超限前不计审核账、实际60s虚拟时钟、取消/晚到、总deadline、崩溃保存前后恢复 |
| 旧版本兼容 | revision11→12；审核指令/schema 加入指纹；新有效 plan 下界 completedChunks+2；jobs 前置/settlement 同步。已存在且关联合法的旧完成 Draft 只读/settlement 校验使用原 revision 下界，原 cp revision/attempts 不改写 | 新 revision12 下界+1 拒绝；旧未完成409/零调用零写入；旧完成 revision11 chunks+1 重启回读、编辑、明确确认均零外发 |
| 不误拒合法独立 AI、不暗加强制 metric | 审核指令允许有独立定义/触发/流程的未来/未上线/单 unit AI；不加混合短文必须 metric 或百分数必为 metric | 冻结独立 AI 正例与单 unit 正例通过 fake 审核机制；原混合样本分类规则不变。fake pass 不证明模型语义正确 |

产品只涉及 `services/llm/{knowledge-extraction,rules,jobs}.ts`，新 `knowledge-semantic-review.ts` 和 `rules/kb02-semantic-review.schema.json`。v3、plan/Draft 持久结构、Provider wire、Raw/Wiki/UI/公共 stage、依赖/锁/配置/容量均未改。直接既有测试只适配新增审核 fake、成功调用次数与当前 revision；保留原 coverage/原文/ID/旧 revision 断言。`jobs.ts` 额外参数仅用于找到已完成 Draft 后的内部校验，`runKnowledgePipeline` 和普通未完成恢复没有可选跳过审核入口。

## 实际执行与结果

最终必要工程在 `.scratch-KB02-SEMANTIC-20261023` 隔离副本执行，不复制正式 `workspace/` 或 `.env.local`，依赖由已安装 node_modules junction 提供。准备时 898 条源文件逐 SHA 相同；后续只同步修正后的新语义测试和历史包装器，最终 899 条源文件与被测副本逐 SHA 一致。逐文件清单见 [frozen.json](KB02-SEMANTIC-20261023-frozen.json)，包含全部 app/server/services/rules/scripts/tests、默认 fixtures/support、根 package/lock/tsconfig/Vite/index 与 gitignore；排除 Astra 所有的新前缀文件。原始历史探针保持不变，仅在隔离副本生成新名称的追加审核 fake/count 适配文件，SHA/差异说明记录在 historical.json。

| 实际命令（仓库根执行，脚本记录完整底层命令/cwd） | 最终结果 | 实测耗时/证据 |
|---|---|---|
| `node tests/acceptance/KB02-SEMANTIC-20261023-isolated.mjs full full-final` | 默认 424/424，0 fail/skip/cancel | 66.432s；[full-final.json](KB02-SEMANTIC-20261023-full-final.json)、同名完整 log |
| `node tests/acceptance/KB02-SEMANTIC-20261023-isolated.mjs build` | `tsc -b`、Vite build exit0 | 19.075s / 12.504s；tsc.json/log、vite.json/log。既有 bundle>500kB 提示保留 |
| `node tests/acceptance/KB02-SEMANTIC-20261023-isolated.mjs node24-related node24-related` | Node v24.19.0，受影响 223/223，0 skip | 49.584s；[node24-related.json](KB02-SEMANTIC-20261023-node24-related.json)、同名 log |
| `node tests/acceptance/KB02-SEMANTIC-20261023-isolated.mjs node24-sr01 node24-sr01` | Node v24.19.0，SR01 51/51，0 skip | 54.179s；[node24-sr01.json](KB02-SEMANTIC-20261023-node24-sr01.json)、同名 log |
| `node tests/acceptance/KB02-SEMANTIC-20261023-historical.mjs` | FINAL/SOURCE/EDGE/FIELDS/REGION 历史边界 18/18，0 skip | 0.766s，Node24.19；[historical.json](KB02-SEMANTIC-20261023-historical.json)、同名 log |
| `node tests/acceptance/KB02-SEMANTIC-20261023-isolated.mjs verify frozen` | 899文件，源/被测副本差异0 | [frozen.json](KB02-SEMANTIC-20261023-frozen.json) |
| `git diff --check` | exit0 | 实际工具输出保留；无产品/default 测试空白错误 |

新增语义 31 项已经包含在最终默认及 Node24 受影响测试中，无需再重复运行其单测。默认执行含六链既有安全回归；共享 Provider 未改。测试均用本地 fake/localhost，新增真实 Provider **0**，累计 KB02 **203/500**、Prompt **15/24** 不变。实际主 Node v24.20.0，兼容 Node v24.19.0；子 Agent token 计量不可得。

## 首失败、偏差及保护

首轮相关回归/默认失败和局部夹具修正保留于 related-first、related-second、semantic-first、semantic-second、semantic-capacity、full-first 的完整 log/json。失败详情见 [attempts.md](KB02-SEMANTIC-20261023-attempts.md)。未删除或弱化原断言来掩盖失败。首轮 TypeScript unused helper 导入、计数迁移脚本锚点错误、新正例分号导致多 atom/冻结对象测试引用 Provider 序列化前对象，以及容量夹具未达到上限，均为本轮直接夹具/接线问题，已局部修正并由最终默认/build完整验证。

**执行偏差如实记录：** 第一次 full 默认在共享源目录运行，未提前识别 `llm-http.test.ts` 会写 `docs/reports/B04-http-evidence.json`。已先保留生成内容和失败日志，再证明 HEAD 原字节 SHA 与施工前 baseline 同为 `147b45a9051ea0478eee6ffaff1bf7d5ed1d3c43d068ba131f71929208f23720`，仅精确写回这一文件；未用 reset/restore 或覆盖其它修改。[sideeffect-restoration.json](KB02-SEMANTIC-20261023-sideeffect-restoration.json) 含前/后 SHA，生成内容另存 sideeffect-generated.json。该次无配置 HTTP 断言也受源目录现有配置影响（keyConfigured true）；保留原断言，在不含 `.env.local` 的隔离副本完整通过。

施工前 baseline 5479 条，其中第一次新增的窄模块和审核 schema 已创建，之后才成功保存 baseline；二者为 Git 未跟踪新文件，没有冒称拥有其创建前原始 SHA。最终按明确所有权比较，**5448 个保护文件无变化**，授权施工与 Astra 并行变化单列，正式 workspace/配置/Raw/历史资产保持字节相同，详见 [closure.json（见 ENG03 证据清单）](ENG03-20261122-evidence-manifest.json)。副本仅为本轮本地证据，没有真实 Provider 服务/浏览器；测试自有 localhost 服务均由 fixture 关闭。保留隔离副本供审查，未做递归清理。

## 冻结与剩余风险

完整冻结清单 SHA256：`1cdc22d855c3a4e2175cfe22899799a49471f14ff355d6cf99669ed90220d421`。五产品文件 SHA 分别列在 closure.json 与 frozen.json。Git 当前仍基线 HEAD，待主 Agent 提交关联；不自行提交或推送。

审核通过仍可能是模型相关误判，正常主题也可能误拒；本地 fake 只证明门禁、保全、预算和恢复机制，不关闭真实语义质量缺陷。尚需 Astra 独立工程复审及主 Agent 分阶段放行的真实补充/独立 AI 正例、短长文/通用更新、固定 metric/实际 Chrome 链。未放行不外发，未验收不推进批次。审核失败或有效 plan 保存前崩溃后，普通显式继续会重新消耗规划+审核两次；已存有效 plan 则沿原恢复不再次审核。非签名 integrity/hash 不能证明不可伪造语义认证。

本轮施工自查范围无剩余已知测试失败；原搜索竞态旁支与混合短文历史 metric 未达保持。交接后停止产品/tests 写入，等待 Astra 独立裁决。
