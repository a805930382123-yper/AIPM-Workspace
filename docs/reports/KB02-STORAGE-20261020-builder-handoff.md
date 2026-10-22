# KB02 SR01 施工交接（2026-10-20）

施工完成，产品和默认 tests 已冻结停写，待用户新窗口 Astra 中独立审查。本报告是 Sol High 的受控施工自测，不签 KB02/Q02 或真实质量 PASS。原 Q02/KB02 真实质量 FAIL、S01 关闭和 PA01 既有 PASS 保留。

## 冻结与范围

- 产品/tests 冻结：2026-10-19T16:59:02.090Z，即北京时间 2026-10-20 00:59:02；此后无产品或默认 tests 写入。
- 最终 [main-frozen](KB02-STORAGE-20261020-builder-main-frozen.json)：98 产品文件、68 默认测试/支持/夹具条目（其中43个默认 test 文件）、2份既有响应夹具、10份自有施工脚本。产品/测试的 SHA256 与最终副本一致。后补 integrity 脚本只更新 acceptanceScripts 清单和时间。
- [精确 scope](KB02-STORAGE-20261020-builder-scope.json)：7个既有产品文件修改，新增1个窄助手；修改原预算测试，新增3个默认测试文件和3个窄测试支持文件。未改其他产品或旧测试。
- 产品修改：services/llm/jobs.ts、checkpoints.ts、新增 storage-recovery.ts；server/llm-api.ts；app/api.ts、App.tsx、pages/RawPage.tsx；tsconfig.json。
- tsconfig 只排除旧 POC 的 `tests/acceptance/kb02-storage-poc-20261020-case.mts` 一项。该只用于隔离副本的文件引用副本路径，原先误纳入正式构建；旧文件内容保留。正式源树与冻结副本使用同一 tsconfig。
- 公共 services/storage/files.ts 没有修改。窄 LLM 助手只分类受支持 OS 错误为安全错误，其他调用者的公共原子助手及重试策略不变。
- rules/提示、Q02/schema/wire、知识调用预算、Provider 实现、依赖/lock、正式 Raw/Wiki/Prompt、运行时用户配置和 ACL 均未改。

## SR01 交付映射

| ID | 实现与证据 |
|---|---|
| SR01-01 | `jobs.get` 始终读取真实磁盘；runner `readJob` 单独返回 execution=`running/settled` 与 recovery。安全 issue 包含 code/message/phase/persisted:false/action，仅白名单 errno/operation，无系统路径、原 OS 文本或正文。后台任务 Promise 有收尾入口，progress writes 在终态前 drain；不再空 catch 吞掉存储收尾失败。实际 mkdir/temp-write/rename 均经真实调用链受控注入验证。 |
| SR01-02 | `reconcileStorage` 与 start/终态/取消共用 startQueue，HTTP 同时取得既有 Wiki 资源锁。只保存 checkpoint→Raw 状态→job，成功后才删 issue；持续失败仍明确报错并保留 issue。原期望文件指纹在重试前比较，冲突不覆盖；已成功的部分写入更新基线以便后续恢复。Provider 增量0、attempts不回退、成功块及覆盖诊断保留、draft不重复、重复恢复文件hash不变。所有 start 选项在恢复前阻断。 |
| SR01-03 | GET extraction-jobs 加 execution/recovery；POST `/api/extraction-jobs/:jobId/reconcile-storage` 仅接收空对象，错误字段/类型400，无副作用，找不到任务404。GET raw-processing 只额外给出 recoveryJobId，不伪造磁盘 jobId；启动Raw状态写失败后可在刷新找到恢复任务。Raw 界面显示“任务已停止，状态保存失败”和“重试保存状态”，明确不重新调用模型，阻断生成/重规划/取消/审核冲突入口。App 以 execution 判断收尾，并以 poll generation 支持同job保存后显式继续。React+真实HTTP验证恢复、刷新、持续故障、Raw选择世代与迟到响应隔离；原导航测试也在完整默认套件中通过。 |
| SR01-04 | 重启先核验原文实际hash、任务/Raw/草稿绑定、cp完整性/内容和ledger；已有完整合法draft按原id恢复，不依赖当前Provider已配置。未完成模型继续仍用原当前rules/provider严格预检。已完成旧草稿兼容原合法读取；中断无draft且未持久化诊断时明确 `LLM_INTERRUPTED` / “未保存的诊断无法恢复”，不编造诊断、不外发。坏JSON、绑定draft缺失、规则身份和ledger冲突均保原字节失败关闭。8个槽包含运行中任务与未恢复issue，不静默淘汰；超过容量的重启任务可通过磁盘视图提供按job恢复，容量释放后POST懒加载核验。 |
| SR01-05 | cancel 同步写入内存取消意图并 abort，串行收尾在关键 await 后重检；迟到Provider不建立可审核draft，完成收尾中取消会放弃刚创建的draft，并以取消终态结束。取消终态原子写失败保留issue，只落盘恢复。新job insert失败且磁盘确无job时移除未启动的内存slot，保留cp，不返回不存在的jobId，下次显式启动可正常执行；Raw状态写失败且已有job则保留可达恢复入口。 |
| SR01-06 | 原预算两项保留原completed/累计六次/同job/成功块/耗尽409/三文件hash/Provider零增量等断言。增加单调10秒截止、安全job/cp/raw/fake计数/Node快照，初次及每次planningRetry覆盖失败预检。业务断言失败也先输出安全快照再抛原错误；finally先取消/收尾后台再清理，清理错误不盖原首败，正常路径清理失败仍使测试失败。没有skip、放大超时或刷绿重试。 |

## 最终实测

[完整命令、耗时和退出码](KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-run.json)，[最终汇总](KB02-STORAGE-20261020-builder-latest-run.json)。运行只在逐字节冻结副本 `C:\Users\80593\AppData\Local\Temp\kb02-storage-builder-frozen-4Nnmgx`，未复制 workspace/.env.local 或运行时配置。默认并行 test runner，无 concurrency 降级。

| 验证 | 实测 |
|---|---|
| Node v25.2.1 完整默认套件 | **289/289，0 fail/0 skip**，19.798秒；[日志](KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-fullsuite.log) |
| 同冻结 TypeScript `tsc -b` | exit0，3.292秒；[日志](KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-tsc.log) |
| 同冻结 Vite build | exit0，1.638秒；[日志](KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-vite.log) |
| 本机 bundled Node v24.19.0 受影响对照 | **26/26，0 fail/0 skip**，17.989秒；原预算2、存储18、HTTP2、React4；[日志](KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-node24-targeted.log) |
| 原机器 Node24.20.0 | **NOT_RUN**；当前已知可用运行时是25.2.1及24.19.0，未下载运行时，不以相邻版本代签。 |

新增24项（存储18、HTTP2、React4）均进入默认suite。三处 failed-job/done-checkpoint/coverage-checkpoint 分别使用 EPERM/EACCES/EBUSY，两次短暂拒绝经真实helper恢复；持续拒绝及显式再次保存各有六次真实 rename 拒绝。日志中的受控诊断保留失败前SHA256、12次拒绝、调用前后计数、attempts、draft集合和幂等三文件hash。mkdir ENOSPC、temp-write EIO 同样走真实atomic helper入口验证。测试 seam 限定一个虚构临时根，不接真实服务。

完整suite同时覆盖原KB02恢复/坏cp/旧规则/累计耗尽/取消、原Raw/Meeting门禁、输出安全和导航；未另声称旧独立安全脚本28项在本轮再跑。

## 完整性、边界及下一步

[接手baseline](KB02-STORAGE-20261020-builder-baseline.json)、[完整性](KB02-STORAGE-20261020-builder-integrity.json)：2507接手保护文件无变化，源冻结变化[]、最终副本变化[]、正式workspace增删[]，.env.local和.env.example指纹相同。此前PA01历史漂移只记录，不恢复、不归因；本轮与接手比较，不能追溯证明历史完整。

[首败与校准](KB02-STORAGE-20261020-builder-calibration.md) 保留默认沙箱 ENOMEM、类型构建及两项新集成首败、首轮完整288/289和修复原因。没有隐去原失败或修改旧证据。

这仍是受控fake/临时存储/jsdom证据：真实 Provider 新增0；KB02仍62/74剩12，Prompt仍15/24；真实模型质量与实际浏览器未验，不以这些结果代签。未提交、部署、改ACL、停用户服务或启动独立审查。所有本轮服务仅测试进程所有，监听在finally关闭，临时fixture收尾后清理；最终源码副本保留用于复核。序列化checkpoint每份仍16MiB上限、8个槽最多128MiB序列化payload，未声称JS实际堆占用等同该值或具备跨进程事务/断电耐久保证。

主协调可按最终frozen与scope核对后生成新窗口独立审查入口。此后施工者不再写产品/defaulttests。
