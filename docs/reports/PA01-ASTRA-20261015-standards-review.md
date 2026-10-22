# PA01 独立 Standards 定向审查：FAIL

2026-10-15。只读审查累计 PA01 返修实物；不将 git diff 当作 Sol 接手 7 文件差异。冻结一致性与完整默认 suite/既有 controlled 探针由主审独立检查，本报告不重复或代签。未修改产品、默认测试、历史证据或正式数据；本探针只在 OS 临时目录生成虚构资料，外部 Provider 调用 0。

依据：PA01-astra-review、PA01 任务卡、F-PA01-01–06 repair、PA01-interface、Sol builder-handoff。聚焦 F01 读盘凭证边界、F02 执行前存储门禁和 F04 持续有界告警；没有检查 UI 交互、真实 Provider 或签全批 PASS。

## 可复现问题

### S02 / P1：损坏的提交快照在校验摘要之前已写入正式 Wiki，且回执否认写入

- 定位：`services/storage/record-validators.ts:24` 只检验摘要是 64 位 hex 及键集合；`services/wiki/commits.ts:387–398` 的 `ensurePage` 在目标不存在时先 `writePageLocked`，才比较实际摘要；`:316–317` 在该方法成功返回后才记 writtenSoFar，`:363–378` 的失败回执又只计入摘要匹配的目标。
- 最小复现：准备完整 `prepared` 清单，包含 Source 和一个正常 page，所有结构/UUID/phase 均合法。Source digest 为“原始冻结正文”的真实 `pageContent` SHA256，但 Source body 改为“已损坏的正文”，其他结构与 page digest 保持有效。真实 `WikiCommitService.get/reconcile` 接受并执行。
- 结果：正式 Source Markdown 已写入；manifest 原字节改变；随后返回 `COMMIT_WRITE_VERIFY_FAILED`，却记录 `committed:false`、`writtenWikiIds:[]`。不是仅静态猜测，JSON 证据 S02 保存上述事实。
- 影响：本应零执行的损坏冻结快照污染正式文件，且部分提交状态不诚实，违反 F02/PA01-07、PA01-08。应在任何清单改写/正式文件写入前核验整个冻结记录与 digest 的一致性；失败事实必须涵盖实际已经落盘的文件。

### S01 / P2：Job 嵌套坏结构被读为健康，启动恢复改写坏文件且无告警

- 定位：`services/storage/record-validators.ts:18` 的 `isJob` 完全不校验可选 checkpoint/error 等实际结构；`services/storage/recovery.ts:13` 直接复用此结果；`services/llm/jobs.ts` 的 `ExtractionRunner.reconcile` 对这些被接受的 running jobs 执行 update。
- 最小复现：一个其余字段正常的 running job，将 `checkpoint.validatedChunks` 从数字改为 `{bad:true}`，保存到 `state/extraction-jobs/<id>.json`。先真实 jobs.get 和 RecoveryRegistry.scan，再真实 ExtractionRunner.reconcile。
- 结果：get 成功；registry items=[]；reconcile 把该 job 计入 interrupted、status 改成 failed；原字节改变。探针不提供 llm/provider，零调用。
- 影响：F02 所要求“同一实际结构校验、坏记录保留且不恢复”以及 F04 持续可见未成立。类似 isRawState 对 lastError/revertStatus、isWorkflow 对 evidence/baseWiki/inputDraft 的遗漏经静态阅读可见，但本报告不把这些未定向运行的例子另算已证实问题。

### S03 / P2：恢复清单 500 条截断未报告 overflow

- 定位：`services/storage/recovery.ts:26` 无条件 `items.slice(0,500)`，却未据截断设置 overflow；`app/components/RecoveryNotice.tsx:5` 以 items.length 显示数量，仅 overflow=true 才显示“以上”。
- 最小复现：隔离目录 `drafts/prompts` 写 501 个内容为 `{` 的坏 JSON，调用真实 RecoveryRegistry.scan。
- 结果：scanned=true、partial=false、overflow=false、items.length=500，scannedFiles=501。
- 影响：扫描本身有文件/字节预算，但摘要截断不诚实，用户看到完整“500 个”的假象；第 501 个没有完整清单或超限提示。F04 明确要求扫描/摘要有界且准确表达溢出。

## 已读路径与限制

读过 files/recovery/record-validators、真实 DraftStore、WikiCommitService、KnowledgeWorkflowStore、RawStateStore、ExtractionJobStore/Runner，以及 PromptAiService 的 validStoredDraft/get/list/rewrite/replay/confirm。结构门禁已真实接入这些 caller，浅层坏结构与健康邻居的旧回归由主审重跑；本报告不否认已通过的覆盖。

F01 静态检查见新 schemaVersion=2 的完整性摘要、严格顶层键、checks/improvements/target/requestIds 绑定，以及 get/list/replay/confirm 当前已知凭证扫描。未另发现已证实的凭证外泄，本分支未用真实 key，也不以静态阅读替代主审受控秘密探针。旧已完成草稿存在显式兼容分支，未单独重新签兼容测试。

命令：`node --import tsx tests/acceptance/pa01-astra-20261015-standards-probes.mjs`。默认受限环境在 tsx 启动时因 `uv_os_get_passwd ENOMEM` 未运行，随后按权限工具流程授权执行成功。S02 最初使用全零摘要，后校准为实际原正文 SHA256 + 健康邻页，最终仍复现；交付脚本及 JSON 为校准后结果。脚本 exit 0 表示取证脚本完成，JSON 中三项业务裁决均为 FAIL，不是测试 PASS。

证据：`tests/acceptance/pa01-astra-20261015-standards-probes.mjs`、`docs/reports/PA01-ASTRA-20261015-standards-probes.json`。最终 Standards FAIL，建议保留 F02/F04 OPEN，工程门禁未通过；返修由主审与用户另行决定，本分支不施工。
