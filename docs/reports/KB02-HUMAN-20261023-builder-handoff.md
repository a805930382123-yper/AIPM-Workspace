# KB02 HUMAN 施工与自查交接

施工完成，产品及 tests 已停写，交 Astra 独立复审。以下为施工自查结果，不是独立验收或 KB02 结批结论。真实模型调用本轮 0，知识预算保持 219/500，Prompt 15/24；未提交或推送 Git。

## 版本与冻结

- 基线/当前 HEAD：`28b6d144a07d03d4e85fc8cc766027a763012c0e`，产品原基线 `bb0f814`。
- 冻结任务卡：`docs/handoffs/KB02-HUMAN-20261023-task.md`，SHA256 `aa56ee05e9b3248f85fa0903beceff8c6a4d47469c7a082ac5010be5a7f5e076`。按 Astra 的接口短审与旧 standalone update 兼容裁定施工，没有重新制定总体方案。
- 43 个施工产品/测试文件逐文件指纹：[freeze.json](KB02-HUMAN-20261023-freeze.json)，文件 SHA256 `94a375ddb4e46d0cc05be3c128f74a2b0283d2159aa660a615f2965b2416a1b7`；排序文件指纹集合 SHA256 `b6205b532fccfdb4c0e620182fc7ef11b22276c1a53a269ea39c98f4c47d777e`。
- 最终受测副本：`.scratch-KB02-HUMAN-20261023`，源码、规则、默认测试及支持/历史脚本等 932 文件源/副本 SHA 全同，0 mismatch，见 [frozen-copy.json](KB02-HUMAN-20261023-frozen-copy.json)。独立 HUMAN-AUDIT 资产不纳入施工者冻结。
- 保护基线到本次收尾实测约 58 分钟（基线创建 UTC 09:22:58，收尾读取 UTC 10:21:15）；不把等待时间估算为模型计费。子 Agent token 用量不可得。

## 实际修改与任务映射

1. **新提取候选发布边界（卡 §1）**：revision13 保留精简提取、完整规划、严格 schema/秘密/来源/覆盖/大小/取消检查，取消生产链的 B1 `reviewKnowledgePlan` 请求；只需 chunks+1，规划预留 1 次。revision12 的已完成历史账本仍校验 chunks+2，旧未完成指纹仍明确不兼容，不自动外发。原 204/205、207/208 响应离线返回后均只发 2 次 fake 请求；原坏 AI 主题保留为未审候选，未由程序删页或强塞邻页。
2. **不可变目录与可纠正归属（卡 §2–3）**：新增小型 `services/wiki/human-review.ts`，保存 `HumanReview.version:1`、单位目录/原 memberIds/records/原文位置/证据、唯一归属或 null、目录摘要及逐页确认摘要/时间。新 KB02 `reviewBasis` 从实际 planningInput/plan 传到 Draft。旧草稿 GET 不写盘；显式 start 严核已完成 cp 的 Raw/job/draft/原事实/页证据映射，匹配则保留真实原 ID；否则每条现存 fact/question 建独立 legacy 快照，不按同字句去重，也不为无定位问题造引文或模型 ID。
3. **编辑与失效（卡 §2–3）**：原事实、问题、证据在通用编辑中只读；人工说明/整理/推断仍可编辑。整 unit 可移动、进入未解决池、重新归属；合并保存所有原 unit，删除有 unit 的页面把其 unit 原子转未解决。不同位置同字句保留；legacy 碰撞 evidence ID 只对派生展示建立确定性别名，不改目录原 ID。标题、内容、页集合、归属、Source/document、选择和处理目标的实质修改清空所有页确认；审批操作不相互失效；内容相同的保存不清审。
4. **正式服务门禁（卡 §3–5）**：`WikiCommitService.confirm/execute/reconcile` 与 `KnowledgeWorkflowStore.createUpdate/confirm/execute/reconcile` 都校真实来源和对应审查绑定。全部当前页（含未选、defer 页）均需当前摘要确认，任何 unresolved 阻断整个候选正式写入；不能用模型 pass、选择或重复处理决策替代。摘要绑定身份、Raw SHA、不可变目录、完整可写内容及页集合。Draft/Workflow 按数据根共享串行队列；更新正式提交还持有输入 Draft 审查锁，避免跨实例编辑穿过正式写入窗口。准备期间版本变化保留 409，不伪装存储失败。
5. **更新与综合（卡 §4）**：update 外发前重载实际持久化输入，要求整份草稿已审，输出继承所选页来源 unit 并建立独立模型提议快照；输出再次逐页确认。最终重载完整输入 digest/revision/全页确认及目标版本。synthesis 从创建时 sections/evidence/Raw snapshots 建单输出页目录，原提议与人工纠正文案分别保存，改过的来源支持分节按“人工整理”渲染，不冒充原事实。两类预览均可留 unresolved、保存、刷新和继续。
6. **历史工作流兼容（Astra 窄审裁定）**：新工作流持久化 `reviewProtocolVersion:1`。原合法旧 update 完全无 inputDraft、无新协议标记时，显式 start 校实际 Raw SHA、证据位置、来源集合及目标 revision，再持久化 `legacyStandaloneInput` 快照和新目录；界面明确旧记录无输入草稿身份。不补造 draft/fact ID。新版删绑定不得降级；声称有但找不到 inputDraft 的记录不转 standalone。旧有真实 inputDraft 的预览按实际输入全审、原文与页证据严格匹配后重绑定。
7. **恢复（卡 §5）**：新事务冻结审查与目录摘要。旧零实际写入的 prepared/committing 清单返回待审状态，保留原冻结清单、幂等证据；重新逐页审查/显式确认生成新 operation，旧清单仅增加 supersededBy 关联，不删除或改快照。旧部分写入须实际磁盘内容逐项匹配原冻结记录才续作，并记录 `legacyRecovery:'verified_partial'`；伪 writtenIds 不算实际写入，任何冲突先停止。旧 completed 同 payload 幂等回读不要求追补审查。

## 实际 HTTP 与界面协议

- Draft GET 仍返回原完整预览，另有 `humanReview` 与 `reviewContentDigest`；GET 不迁移写盘。
- `POST /api/drafts/:id/review/start`：`{baseRevision}`。
- `POST /api/drafts/:id/review/move`：`{baseRevision,unitIds,pageId:string|null}`。
- `POST /api/drafts/:id/review/pages/:pageId`：`{baseRevision,reviewContentDigest,confirmed:boolean}`。
- Workflow 接口同后缀，前缀为 `/api/knowledge/workflows/:id`，唯一输出 pageId 为 workflow.id。所有请求严格解析，不接受客户端目录、已审 bool 或未知审批字段。
- `humanReview.units[]` 包含 id/kind/origin/text/memberIds/records/evidence 及可选来源位置/类型/分节标记；`assignments` 为 unitId 到 pageId/null 的完整映射，`approvals` 为 `{pageId,digest,at}`。详情响应给出的摘要直接带回，不从富预览 payload 在客户端重算。
- DraftReviewPage 显示完整原条目与证据、未解决池和各 unit 移归控件，每页分别确认/撤销；没有“全部确认”。未保存编辑明确提示并阻断审查及最终确认。原事实/问题永久 readOnly。WorkflowPage 展示完整原提议/来源/原目标比较与纠正文案，单页独立审查后才能正式确认。整份放弃仍可用。

## 实测命令与结果

所有测试均在隔离副本执行，fake/历史响应回放不外发。历史默认测试写报告的副作用只留在副本 docs/reports；真实 workspace、Provider 配置、依赖、锁文件未改。

| 实际命令 | 结果/证据 |
|---|---|
| `node tests/acceptance/KB02-HUMAN-20261023-isolated.mjs full full-final` | Node 24.20.0，**445/445，0 fail/cancel/skip，exit 0**，56.9 秒。[实际 argv/结果](KB02-HUMAN-20261023-full-final.json)、[完整日志](KB02-HUMAN-20261023-full-final.log) |
| `node tests/acceptance/KB02-HUMAN-20261023-isolated.mjs build frozen-final` | 同最终副本 `tsc -b --pretty false` 与 `vite build` 均 exit 0。[tsc](KB02-HUMAN-20261023-frozen-final-tsc.json)、[Vite](KB02-HUMAN-20261023-frozen-final-vite.json) |
| `node tests/acceptance/KB02-HUMAN-20261023-isolated.mjs targeted boundary-closure tests/kb02-human-review.test.ts tests/kb02-human-ui.test.tsx` | **21/21，0 skip，exit 0**；包含原 seq、原长文55 unit/101原 ID、全页门禁、旧/新事务恢复、revision12下界、legacy迁移和实际 React+HTTP两流程。[结果](KB02-HUMAN-20261023-boundary-closure.json) |
| `$env:KB02_HUMAN_TEST_NODE="$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"; node tests/acceptance/KB02-HUMAN-20261023-isolated.mjs targeted node2419-final tests/kb02-human-review.test.ts tests/kb02-job-file-access.test.ts tests/kb02-sr01-r1.test.ts tests/kb02-storage-recovery.test.ts tests/kb02-storage-http.test.ts tests/kb02-planning-budget.test.ts` | 实际该 runtime `--version` 为 **v24.19.0**；**58/58，0 skip，exit 0**，34.6 秒。[实际 runtime/argv](KB02-HUMAN-20261023-node2419-final.json) |
| `node tests/acceptance/KB02-HUMAN-20261023-isolated.mjs verify frozen-copy` | **932 文件同字节，0 mismatch，exit 0**。|
| `node tests/acceptance/KB02-HUMAN-20261023-close.mjs` | **3954 保护项**，0 非授权漂移；43 施工文件均匹配受测副本；43 份本轮报告已知实际密钥扫描0匹配。[收尾](KB02-HUMAN-20261023-closure.json) |
| `git diff --check` | 无空白错误；仅 Windows LF→CRLF 提示。|

默认完整回归包含六链安全、Meeting、Prompt、来源保护、事务、取消和存储回归。实际 React+HTTP 新建链已测：选中→保存→unit未解决→回归原页→各页独立确认→标题编辑全部失效→保存重审→组件卸载/刷新回读→明确最终确认与 Raw 不变。综合链已测：原提议可见→未解决阻断→归回→单页确认→正式提交。更新服务链已测输入全审前零 fake 调用、输出独立重审、非本页输入撤销阻断、目标版本保护和旧正文/双来源/数值保留。施工没有用浏览器截图代替门禁；Astra 的独立浏览器/HTTP复审仍待执行。

## 首失败与测试迁移披露

- 初次保护基线普通 Node 写新报告遇 EPERM，未写入；仅对已授权的新报告保存申请执行权限后成功。首次 tsc 暴露路由参数联合类型与页映射类型，第二轮修正通过；中间加入边界后又发现可选字段类型和未用导入，均局部修正，原中间 tsc 失败日志保留。
- 新定向首轮 **5/6**：HTTP测试错误地把富预览对象交给服务摘要函数；改为使用响应的服务端摘要。第二轮 **11/12**：历史回放测试在 find 回调内递增序号，改为查找前递增一次。两轮原日志保留。
- 完整默认首轮 **355/436**，81失败主要为旧 B1 第三请求/revision12预期和缺人审前置的旧确认/简化update fixture。没有删除原安全断言：[显式计数/规则迁移表](KB02-HUMAN-20261023-test-migration.json)、[实际持久化及逐页动作前置说明](KB02-HUMAN-20261023-compat-migration.json)。预算用例仍实跑至6次耗尽及最后1次可规划；不全局降低旧revision12账本下界。
- 保留的 B1 拒绝、严格schema、秘密、取消、超时、输入大小与不可复用审核断言移至测试内明确的历史 direct-function harness；生产 runner 另断言 revision13 不调用 B1，原历史响应不改。旧“合并同字句去重”和“手改来源事实/证据”断言按已批准新要求改为保留不同原记录与拒绝改原条目，同时保留原来源定位/不丢失/事务断言。
- 核心兼容第二轮 **114/115**，剩最终更新用例漏输出人审前置，补齐后通过。实际UI首轮 **16/17**，剩保存busy尚未落定即点审查的等待问题，修等待后通过。追加边界首轮 **19/20**，仅 Source no-op 测试 fixture categories 漏 other，补合法枚举后通过。上述原日志均保留，未覆盖成通过。
- 辅助 Sol 只修改 `tests/ui-b04.test.tsx` 并交接停写，最终单文件 **10/10**、SHA256 `5f20bb06e0d8e9023efafb7e43dbcacfa8476544a1153406504b962ec6355327`，已纳入445完整回归。其沙箱 spawn EPERM 后获准运行，基线5/10、适配首轮9/10及最终10/10均已向主Agent交接。原字段永久readOnly后，提交锁断言保留为 disabled 或 input/textarea readOnly，另显式核验原始字段只读。日志仍有既有 controlled→uncontrolled React warning，没有将其称为已修复。

## 保护、范围与剩余风险

- 未修改 Raw、原 fact/member ID、真实 workspace、Provider wire/配置、依赖或历史失败资产；没有触发正式用户数据写入、真实模型调用或 Git 提交。隔离 fake 测试中的正式写入仅在临时数据根。
- 并行外部 **AGENTS.md 与新增 .agents/** 均保留、排除本轮施工/提交范围，不归因主Agent。closure.parallelExternal 的原/现 SHA 已正确列 AGENTS；compact externalStatus 因 collector trim 首行漏了该显示项，实际 `git status`与[补充说明](KB02-HUMAN-20261023-closure-note.json)保留完整两项。保护计算没有漏 AGENTS，也没有把漂移冒称0。
- 人工审查保证对应内容版本的明确动作与覆盖，不验证用户陈述的语义真值，不是原模型自动语义缺陷修复。若旧数据声称存在输入草稿但实际缺失，或来源/目标已损坏不一致，保持明确阻断/重新从真实输入生成；不补造身份。
- 历史自动模型质量 FAIL 保留。原长文/metric/更新质量哪些门槛在修订需求下足够，由 Astra 按原验收和本卡分别裁定；本轮未新增真实长文/metric/模型质量证据，不据此宣布 KB02 通过。
- 可回滚施工文件均在 freeze.json 列出；新增目录/协议元数据不修改旧Raw，旧未确认草稿缺人审默认未审。回滚代码前需主Agent评估新审查元数据/新事务的兼容，不能删除现存事务或真实用户数据来回滚。

交 Astra 依据冻结实物独立裁定“本轮人审门禁施工范围是否完成”和“KB02修订需求下整体是否达标”。施工者不签最终验收，不进入下一批。
