# PA01 最小返修独立验收续结 — 2026-10-16

**PA01 本批 PASS：Standards PASS、受控 Spec PASS、真实质量 PASS（本批样本）、实际浏览器 PASS（恢复与保存闭环）。** R-01/R-02及原六项返修在本批范围关闭；SP-F01、Prompt范围BL-F01、ST-F01关闭。KB02/FULL3原FAIL保留，不代表全项目通过，不推进下一批。

## 交付版本与证据续接

依据 docs/handoffs/PA01-astra-review-20261016.md、当前任务卡、接口PA01-01–10及acceptance审查。96产品/58默认测试的当前SHA与Sol最终冻结及PA01-RECHECK独立冻结一致；本次未改产品或默认测试。

本轮发现上一次独立复验已留下完整工程结果与13次真实调用，但尚无最终报告，status仍写0/24。续接复核原证据并补测，不冒称本轮重跑全部既有测试。产品字节未变，依coordination复用同冻结有效结果。原始FAIL行、历史审查脚本/报告均保留。当前模型以用户窗口实际设置为准，不以文档宣称切换。

- [独立冻结](PA01-RECHECK-20261016-main-frozen.json)、[基线](PA01-RECHECK-20261016-baseline.json)、[本轮最终完整性](PA01-CONTINUE-20261016-main-integrity.json)。1915既有保护文件不变，正式workspace无新增，实际配置哈希不变。
- [完整默认suite](PA01-RECHECK-20261016-main-tests-writable-copy.json)：241/241、0skip、45.473秒，96/58逐字节可写副本复制零差异；不是原目录运行声明。
- [tsc/Vite](PA01-RECHECK-20261016-build.json)：PASS，8.208/4.625秒；与完整suite相同副本，copyMismatches为空。

## R-01/R-02与关键回归

| 检查 | 结论与证据 |
|---|---|
| R-01 深层Workflow拒坏 | PASS；evidence数组/元素、嵌套结构、kind绑定及消费者字段，经实际get/list/scan/patch/confirm验证；坏字节保持，健康邻居继续，同id恢复后复扫清除；兼容合法旧记录。见[HTTP+组件7项](PA01-RECHECK-20261016-r01-r02-http-component.json)及[原独立反例3项](PA01-RECHECK-20261016-independent.json) |
| R-02 有界摘要诚实计数 | PASS；499/500/501/1201，总数、hiddenIssues、truncated；隐藏项修复/移除及partial下限与摘要截断分开，沿用文件/字节预算。上述7项全部PASS |
| 服务26/26、HTTP8/8 | [服务](PA01-RECHECK-20261016-preflight3-probes.json)、[HTTP](PA01-RECHECK-20261016-preflight3-http.json) |
| React+HTTP 15/15及扩展5/5 | [组件](PA01-RECHECK-20261016-preflight3-component.json)、[扩展](PA01-RECHECK-20261016-component-extended.json)；这是jsdom证据 |
| 边界35/35、真实存储执行器3/3 | [边界](PA01-RECHECK-20261016-preflight-edges.json)、[存储](PA01-RECHECK-20261016-preflight-storage-supplement.json) |
| 六链秘密及Meeting62/62 | [安全回归](PA01-RECHECK-20261016-security.json)，本地fake，非真实模型质量 |
| 本轮新增实际Windows读取失败2/2 | [文件独占锁](PA01-CONTINUE-20261016-read-lock.json)：readJsonRecord明确STORAGE_READ_FAILED/recovery；扫描保留健康邻居并报read；解除锁后原字节不变、复扫0问题。没有修改ACL，不冒称ACL拒绝访问矩阵已测 |

上述检查按各自套件计数，不合并冒充产品功能数量。代码复核确认Workflow实际读盘与扫描共享完整校验；RecoveryNotice用totalIssues，partial显示“至少”，摘要截断另列隐藏项。未扩改KB02算法。

## 真实质量与原失败校准

真实配置只读，实际Provider open.bigmodel.cn / GLM-5.3-Flash，仅隔离虚构资料。先前工程门禁完成后执行13次，本轮补2次，总计**15/24**，剩余9；7 Brief + 2 generate + 3 check + 3 rewrite，无自动重试。KB02仍40/40，KB01历史27另列。见[累计账本](PA01-CONTINUE-20261016-budget.json)、[逐次请求](PA01-CONTINUE-20261016-main-provider-attempts.jsonl)、[响应元信息](PA01-CONTINUE-20261016-main-provider-trace.jsonl)。前13条从原RECHECK账本逐字节继承，本轮只追加14/15。

[原真实HTTP结果](PA01-RECHECK-20261016-main-real-http.json)保留13PASS/2FAIL的原始记录。两条REAL03失败发生在确认成功之后：GET /api/prompts/:id返回{prompt,wikiLinks}，原脚本错误断言saved.body。不是产品保存失败。新[只读校准](PA01-CONTINUE-20261016-calibration.json)通过原draft确认回执回读原Prompt，逐字核对生成正文+人工审核追加文本、source=ai_generated、关联Wiki和版本1；没有重新生成或重复确认，新增Provider调用0。校准后原15项业务检查均有通过证据，原FAIL不覆盖。

| 真实模板/流程 | 样本结论 |
|---|---|
| industry_learning | PASS，库存周转定义/应用/待确认口径；编辑目标后仅学习定义和口径、不计算缺失数据；生成并人工改文保存 |
| business_process | PASS，订货/人工审批/配送/回款；未知角色明确待确认 |
| customer_interview | PASS，缺货审批与回款；编辑目标明确负责人/频率、不讨论销量增长；所选Wiki进入背景，生成并人工改文保存 |
| requirements | PASS，虚构门店缺货反馈，人数/收益未知，不编造数值 |
| ai_solution | PASS，AI未上线、收益待验证，不当已实现事实 |
| meeting_notes | PASS，仅授权提供虚构文本，未知负责人待补充，不自动外发来源 |
| custom | PASS，事实、分析推断、待确认问题分列 |
| 弱Prompt优化 | PASS，九维检查提出实际缺项；rewrite完成，显式保存原条目第2版，第1版原文保留。题量/时长是生成的设计约束，非已知客户经营事实；模板仍需用户审核 |
| 完整Prompt优化 | PASS，九维均present、improvements为空，没有为优化捏造缺项；重写保留输入约束和事实/推断边界，显式保存新条目 |

两种生成均确认前不写正式Prompt；Raw正文原样；关联Wiki受控。模型输出已人工阅读，上述是本批选定样本质量通过，不是长期成功率或所有输入无幻觉保证。真实样本没有发生超时/鉴权等故障，对应失败恢复由受控矩阵检验，不声称真实故障全部触发。

## 实际浏览器补验

实际IAB访问重新启动的隔离服务，复用原虚构数据。UI输入弱Prompt及补充要求→点击检查→显示“九维检查已保存”→刷新页面→进入Optimizer→显式选择checked草稿，原文、补充要求、九维和改进点恢复。刷新与读取后账本仍14次。

点击“继续生成优化版”只新增第15次rewrite，没有再check；原文快照及检查可见，预览保留两项限定议题/未知信息。人工改名后点击“保存为新Prompt”，显示第1版回执；Library实际出现新项，API回读source=optimized/version=1。见[实际浏览器记录及回读](PA01-CONTINUE-20261016-browser-verification.json)、[界面状态](PA01-CONTINUE-20261016-PA01-browser-states.json)、[截图](PA01-CONTINUE-20261016-PA01-browser-saved.png)。本轮实际浏览器验证成功恢复闭环；故障/竞态全矩阵是独立jsdom/HTTP证据，未混同。

## PA01门禁与缺陷关闭

| ID | 裁决 |
|---|---|
| PA01-01 | PASS，同源契约负例及六模板+custom真实Brief，两类编辑影响生成 |
| PA01-02 | PASS，能力guard、阶段预算、取消/错误诊断受控覆盖；真实调用保持low/JSON及无重试 |
| PA01-03 | PASS，确定性正文、变量/长度、受控关联及上下文边界；真实生成保存 |
| PA01-04 | PASS，持久化/恢复/续阶段/并发重放/三次上限；实际浏览器checked恢复 |
| PA01-05 | PASS，目标/版本/Provider/规则绑定、编辑迟到隔离、旧草稿/API与Library版本兼容 |
| PA01-06 | PASS，安全分类诊断及输入保留；R-01恢复错误连带症状关闭 |
| PA01-07 | PASS，坏记录/读取失败/目录与预算可见，健康邻居、坏字节和修复复扫；R-01/R-02关闭 |
| PA01-08 | PASS，六链秘密/Meeting/确认原子及恢复关键回归，Workflow实际caller拒坏 |
| PA01-09 | PASS，同冻结241/241、0skip与tsc/Vite |
| PA01-10 | PASS，本批真实样本、编辑生成保存、弱/完整优化新项/新版本、实际页面恢复 |

F-PA01-01/03/06既有有效关闭证据保留；F-02/04/05本次相关残留关闭。PA01的SP-F01、Prompt范围BL-F01及ST-F01关闭。KB02剩余真实语义/规划/更新缺陷和FULL3其它未过项不变。

## 校准、保护与结束

- 新增独占锁夹具首跑将isRawState直接作为扫描回调，第二参数收到完整路径而被误当id，健康邻居断言失败。保留[首跑说明](PA01-CONTINUE-20261016-read-lock-initial.json)和原脚本；新calibrated脚本仅包裹v=>isRawState(v)，通过2项。finally均释放锁，不归为产品缺陷。
- 工作区写入最初EPERM，随后正常require_escalated审批执行；未改ACL。初次尝试旧隔离端口已关闭，浏览器连接失败；启动同隔离根新端口后验证成功，不归为产品网络失败。
- [最终完整性](PA01-CONTINUE-20261016-main-integrity.json)通过：96/58冻结不变、1915保护文件不变、正式workspace无新增、实际配置不变。仅新增验收脚本/证据及更新索引。
- [自有服务清理](PA01-CONTINUE-20261016-main-lab-final.json)确认API/UI关闭；活跃验收标签已关闭，文件锁子进程退出，隔离fixtures保留供追溯。未停止用户服务。

本轮仅完成PA01审查签收，不施工、提交、部署或推进下一批。无新增阻断性产品缺陷，因此不另开返修卡。
