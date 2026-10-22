# KB02 SR01 施工首败与校准

旧报告/旧脚本只读。以下均为本轮新前缀证据；失败结果保留，不被后续通过替换。

1. **默认沙箱启动失败**：原预算测试在进入产品前，tsx调用os.userInfo出现 `uv_os_get_passwd ENOMEM`。原始日志见 [budget-first](KB02-STORAGE-20261020-builder-budget-first.log)。随后同一窄本地fake命令获得require_escalated执行，预算2/2通过；未改ACL。最终副本门禁也使用已获允许的窄脚本。不是产品逻辑失败，也不是历史故障归因。
2. **首次直接类型构建**：旧 POC `.mts` 只供副本使用，其相对引用 `poc-fixture.ts`、`../services/llm/jobs.ts`、`../services/llm/checkpoints.ts` 在正式树不存在，触发TS2307，附带一项TS7006。此首次输出保留在工具会话；主协调授权tsconfig只exclude这一文件，未改旧POC。正式和副本使用同一修正后的tsconfig，不能只在副本排除。
3. **本轮新类型失败**：[tsc-first](KB02-STORAGE-20261020-builder-tsc-first.log)记录递归persistSettlement缺显式Promise<void>返回类型TS7023；补类型后继续。随后[tsc-second](KB02-STORAGE-20261020-builder-tsc-second.log)记录新fixture未使用的JobError导入TS6133；只删除未用导入。最终tsc/Vite均exit0，没有降低strict/noUnused检查。
4. **扩展集成首轮18/20**：[integration-first](KB02-STORAGE-20261020-builder-integration-first.log)。真实反例A：持久化cp引用不存在draft时被当作无draft中断，可能覆盖原状态；增加cp.draftId必须存在的校验。真实反例B：Raw已failed时App只查processing候选，execution仍running的恢复按钮缺后续轮询；新增显式recoveryJobId候选，并保留真实磁盘jobId。随后[integration-second](KB02-STORAGE-20261020-builder-integration-second.log)20/20通过。没有放松断言。
5. **同job继续的补充风险**：已结束轮询在同job显式仅重规划时需要新poll世代；App新增jobPollGeneration。新React+真实HTTP用例覆盖覆盖失败存储恢复→等旧poll结束→同job显式仅重规划→打开实际draft审核；[ui-final](KB02-STORAGE-20261020-builder-ui-final.log)4/4。另含恢复响应迟到且已切换Raw，callback保持0。
6. **首轮全套288/289、0skip**：[首轮run](KB02-STORAGE-20261020-builder-2026-10-19T16-57-33-508Z-run.json)、[首轮日志](KB02-STORAGE-20261020-builder-2026-10-19T16-57-33-508Z-fullsuite.log)。E04-08发现reconcile.statesFixed返回内部`completed`而原契约是`pending_confirmation`，实际Raw文件已正确写成待审核。修复返回映射并保留interrupted仅列原running任务的语义，未改原测试。随后新冻结完整289/289、0skip。不是无依据重跑至绿。
7. **首版冻结工具计数校准**：第一轮工具只登记ts/tsx/mjs，漏列15个B03非TS夹具，显示53测试条目；这些文件实际已完整复制，未删除也未修改。修正登记为tests/下除acceptance的全部文件，最终68条目、43个默认test文件，旧62接手条目全部保留。第一轮带时间戳frozen/run仍保留为工具错误证据；最终scope没有任何删除项。
8. **最终有效证据**：[16:59:02 UTC冻结run](KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-run.json)：Node25默认并行289/289、0skip，tsc/Vite通过，Node24.19定向26/26；Node24.20 NOT_RUN。修改只由明确失败或新边界证据驱动；最终必要门禁后停止产品/tests写入。

所有调用均为受控fake。历史两项预算失败、旧Q02真实FAIL、旧PA01漂移记录不因本轮工程通过而被改写或归因。
