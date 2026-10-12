# B09 最终独立验收

2026-10-08。施工及两次产品返修均由实际 GPT-6 Luna / High 子 Agent完成，主 Agent独立检验、写任务卡和报告，没有修改产品代码。另有一轮文档返修。F09-01–04 全部 CLOSED，B09 确定性实现通过；**整批仍为 BLOCKED：真实产品 Provider 成功与质量未验证**。B04–06/B08 的同类阻塞保留，不发布部署或推进未授权工作。

## 判定与当前交付

首页六项实际统计、五快捷入口、准确最近记录/失效提示；显式导入 1 Raw / 5 Wiki / 4 Prompt / 1 任务的演示数据；只读且持久化的演示标识；可重复/并发/中断重试的清单；完整离线备份/空根恢复；启动、复用、许可、风险和109项最终矩阵均已交付。

[主 Agent独立109项矩阵](B09-delivery-matrix.md)与[项目最终交付矩阵](../delivery-matrix.md)已同步：DOC 109 PASS，RUN 73 PASS / 36 BLOCKED（A 46 PASS / 17 BLOCKED；R 27 PASS / 19 BLOCKED）。RUN 的真实AI行保留确定性通过的子条件，不以 fake、模板存在或代码静态检查补签真实成功/语义质量。历史独立证据只沿用已经 CLOSED/PASS 且未受修改影响的版本。

## 本批独立门禁

| 门禁 | 判定 | 运行证据 |
|---|---|---|
| E09-01 空根、六统计、五入口、最近ID | PASS | 空根两次启动均六零；五入口到实际表单/Generator/Lint；有效非首条准确定位，F09-04修复后两种失效历史不显示无关页，手动恢复/搜索/泛列表/重复新建可用。 |
| E09-02 明确演示、幂等/编辑/删除/重启 | PASS | 四并发导入新增10/0/0/0，稳定10 UUID；Raw/Wiki/Prompt列表、详情、正文、导出可辨识；编辑保持系统标识，删除不复活。实际Wiki下载与编辑后Prompt导出/历史已读回。 |
| E09-03 写盘错误和恢复 | PASS | 在真实 fs.rename 调用注入 EIO，Wiki提交失败及Raw已写入后manifest第二次提交失败均没有伪成功；移除故障后原manifest/UUID重试成功，Raw SHA不变。未模拟硬件坏盘。 |
| E09-04 完整归档及新根恢复 | PASS | 实际CLI 20文件/23,603字节，原件二进制、Raw/Wiki/Index/Log/Audit、Prompt当前/两版本/回收、草稿/状态及额外白名单文件逐字节恢复一致；新根启动计数/查询正确，源只读。 |
| E09-05 拒绝恶意/越界/覆盖/竞态 | PASS | 18类坏归档全部非0且不写目标；Windows路径别名/保留名/ADS、重复、hash/base64/size/格式/版本/数量上限等；junction、非空目标、包含关系、缺源拒绝。恢复提交前迟到用户文件保留并回滚；导出双读之间源变动明确失败且无归档。 |
| E09-06 无Key手动能力 | PASS | 实际设置未配置、Raw导入→手动Wiki→中文搜索→来源回跳；手动Prompt变量→真实按钮复制→普通目标粘贴逐字符一致→两版本/历史；公开Wiki/Prompt导出只读。AI整理和Generator缺配置明确失败，未造空正式资产。 |
| E09-07 四条实际浏览器链路 | 机械PASS；真实AI BLOCKED | 下表列实际资产ID与人工确认。使用独立本地fake，真实供应商成功、知识/修订/Prompt质量均未测。 |
| E09-08 统计和日志隔离 | PASS | pending1/Wiki0→确认后pending0/Wiki2；F09-03修复后Audit创建Home1、延期仍1、拒绝/接受后0；Prompt新增变计数、改版不当新对象，知识日志不含Prompt保存；最终版本再次回归创建/拒绝计数。 |
| E09-09 交互、恢复、重启与异步 | PASS（承诺的机械范围） | 非法JSON可见失败、任务保留且重试成功；三个隔离根同目录重启验证，前两根与repair1根knowledge/prompts/drafts/state集合和SHA完全一致；旧B07/B08异步修复公开HTTP与37项UI回归通过。长文资产/容量/不截断沿用B03/B04/B07/B08有效证据，本批没有另做极限规模压力或跨平台验证。 |
| E09-10 文档、许可与完整矩阵 | PASS | README启动/数据/配置/演示/CLI边界与代码核对；两个上游按实际本地落点、规则改编/思想参考/未复用划分，历史上游版本核验不冒称本批新联网核验；许可证原件不变；最终109原ID唯一、链接有效。 |

## 实际浏览器四链路与资产

| 链路 | 实际操作与ID |
|---|---|
| Raw→整理→审核→Wiki→来源 | Raw `b437db9f-4706-4b31-905e-833506652067`，正文51字符；job实际轮询、审核默认不选，用户勾选明确确认操作 `11c70632-fdfc-4630-8574-dca821d4f450`；Source `edaf5b5f-25d7-4384-bc88-f2c7db41219f` 和流程Wiki `3baecf7a-28c9-4a55-a6f8-ad6f629d50d9`，来源回到原Raw。审核前Wiki0，确认后2。 |
| Wiki→Audit→修订→resolved | 上述流程页创建整页Audit、fake建议时正式rev1不变，用户在预览中人工补写 `B09_USER_AUDIT`，点击接受后rev2、resolved/accepted及知识日志正确；Raw正文SHA仍 `e913c40bed7043063a3ba2d2facf6be04cb1833771a41f6e1e14bf629c74e23b`。repair1另证延期/拒绝/接受与首页计数。 |
| 任务→Brief→选Wiki→预览→Library | 实际编辑目标 `B09_EDITED_GOAL`，明确只选流程Wiki，219/12000背景预算；预览未自动入Library。人工编辑37字符正文、真实复制/粘贴含首尾空格与换行一致，明确保存为Prompt `dea6e297-99e0-4d4d-947a-df9cd461ce07`，v1修改来源ai_generated。 |
| 旧Prompt→检查→优化→新版本 | 显式选择上述Prompt，补充输入，九维检查/八项缺失/具体改进无虚构总分；人工编辑69字符正文，明确保存原记录v2。v1原文仍可读取，v2修改来源ai_optimized，创建来源ai_generated不伪改。重启后两个快照正文逐字符保持。 |

主环境演示导入后实际Home为Raw2/Wiki7/本周9/pending0/Open0/Prompt5；无Key手动环境为1/1/本周2/0/0/1。演示任务入口标识明确，打开只预填可编辑任务，不自动调用或保存。Lint报告五个演示孤儿Wiki，未将教学样本伪标成完整已核实知识。

首版浏览器39观察：36 PASS，3 INVALID_EXPECTATION原件保留；无Key12/12；repair1 12/12；repair2 10/10。初始三条无效预期分别是Source英文标题、AX空格和猜测新Wiki文案，按实际页面更正后通过。**F09-03与F09-04是后来单独实际复现的产品FAIL，均有原件和返修闭环，不能归为无效预期。**

## 独立命令与证据

| 命令/场景 | 结果与证据 |
|---|---|
| 首版冻结 `npm run build` | PASS，45modules/1.03秒；[日志](B09-acceptance-build.log)。 |
| 首版冻结 `npm test` | 152/152 PASS，0失败/跳过/取消，17.369秒；[日志](B09-acceptance-test.log)。 |
| B09公开HTTP | 最终7/7 PASS；[修正fixture](B09-acceptance-http-fixture-corrected.json)。初始对演示Wiki自动标识header的严格正文预期无效，[原观察](B09-acceptance-http.json)保留。 |
| CLI完整备份与恢复 | 3组PASS、20文件/23,603字节、18坏归档；[最终证据](B09-acceptance-backup-fixture-corrected.json)、[迟到文件](B09-acceptance-backup-race.json)、[源变动](B09-acceptance-backup-change.json)。初始期待可直接读取已回收Prompt的versions API无效，实际404符合删除规则，[原观察](B09-acceptance-backup.json)保留，改为读真实回收记录/历史。 |
| B07/B08关键回归 | [B08 HTTP15/15](B09-regression-acceptance-http.json)、[B07 HTTP11/11](B09-regression-acceptance-b07-http.json)、[四类损坏记录+重启](B09-regression-acceptance-b07-damaged.json)，全部PASS。 |
| repair1独立构建/UI | build45modules/982ms PASS；37/37 UI、Raw审核及Prompt异步交互PASS，11.055秒；[构建](B09-repair1-acceptance-build.log)、[UI](B09-repair1-acceptance-ui.log)。 |
| repair2最终独立构建 | PASS，45modules/980ms；[日志](B09-repair2-acceptance-build.log)。最后仅Wiki选择保护修改，不重复无关完整152、37项UI、CLI和全部HTTP；以不变SHA及10项实际浏览器根因回归复用有效结果。 |
| 原文/版本/导出/UI/重启 | [主浏览器](B09-acceptance-browser.json)、[手动浏览器](B09-acceptance-browser-manual.json)、[repair1](B09-repair1-acceptance-browser.json)、[repair2](B09-repair2-acceptance-browser.json)、[导出](B09-acceptance-exports.json)；[主环境文件](B09-acceptance-browser-files.json)、[手动环境文件](B09-acceptance-browser-manual-files.json)、[repair1文件](B09-acceptance-browser-repair1-files.json)。 |

所有新测试均使用独立TEMP数据根、自己启动的本地API/UI/proxy/fake。施工沙盒Vite realpath EPERM及B04监听启动超时/runner中断属于已留存的环境限制，不当成完整测试PASS或产品缺陷；主 Agent在已批准的提升环境实际运行构建与测试通过。未添加运行时绕过或混用真实Key。

## 缺陷闭环

| ID | 原始问题 | 最终结果 |
|---|---|---|
| F09-01 | 复用表仍写B04待实现，混淆历史记录与现状 | CLOSED：同一Luna纠正，保留上游/许可核验边界。 |
| F09-02 | 交付CLI文件/字节数字与施工最终记录不一致 | CLOSED：纠正为实际2文件/22字节/267ms导出/193ms恢复；独立大夹具另为20文件/23,603字节，两者不混写。 |
| F09-03 | Audit已创建，API Open1而Home仍0 | CLOSED：Luna修App/Wiki成功通知与Home读取，加刷新latest-wins；独立create/defer/reject/accept/Prompt计数/重启12项通过，repair2再次回归create/reject通过。 |
| F09-04 | 点击已删除乙的历史入口却显示甲详情/导出 | CLOSED：Luna仅修WikiPage明确目标选择保护；两种历史入口不串页，明确选择有效页恢复，非首条/搜索/泛列表/重复入口及计数10项通过。 |

[首次FAIL报告](B09-initial-acceptance.md)、[首次产品返修FAIL报告](B09-repair1-acceptance.md)、各卡/施工报告/原始失败AX及截图保留。主 Agent最终仅收尾delivery及矩阵文档，没有代替Luna修产品。

## 完整性、运行方式和剩余限制

[最终核对](B09-final-checks.json)与[最终完整性](B09-acceptance-final-integrity-final-docs.json)：71产品代码/配置/规则/脚本在最终冻结验收期间集合/SHA不变；相对首版仅App.tsx和WikiPage.tsx两处经过授权产品返修，其余69保持。完整交付快照75个源/配置/规则/文档文件。正式workspace两文件和530受保护历史文件SHA不变；B04两份测试生成输出另存B09前缀后恢复原件。没有Git元数据，以冻结快照及逐文件SHA为证。

源码运行：`npm run dev`，默认UI `http://127.0.0.1:5173/`，API4317，数据`workspace/`，可通过`FMCG_DATA_DIR`/`FMCG_PORT`配置。Provider只由服务端读取三个FMCG_LLM配置；开发Agent凭证不属于产品。操作/备份/空根恢复命令见[README](../../README.md)及[交付说明](../delivery.md)。

[实际配置检查](B09-acceptance-config.json)：configured=false、source=none、model=null，缺BASE_URL/MODEL/API_KEY。真实Provider四链路成功、长文覆盖、知识/冲突/Audit修订/Prompt质量与背景关联质量全部BLOCKED；没有虚构实际调用。Provider/service后端SHA未变，60秒实际超时504/LLM_TIMEOUT沿用[B08最终实测](B08-final-timeout.json)（约60029ms），本批没有再跑一次声称新证据。

已实测Node v25.2.1/Windows；最低Node>=22.13声明和其他OS未实跑。PDF仅文字层、扫描件无OCR；复杂PDF/DOCX版式/异常样本覆盖有限。中文搜索为归一化文本匹配，未承诺语义搜索；去重为候选建议，不能证明未知语义等价。Wiki背景单页3000/总12000硬预算已回归，真实模型利用质量未测。备份64MiB单文件/256MiB总量/20000文件边界有明确拒绝，未做实际用户极限数据量压力；一致备份仍要求停止写入，双读检测不承诺在线事务快照。过期来源/人工判断仍需用户核查。

自有六组隔离浏览器验收服务全部退出，自有7标签6–12关闭，原剪贴板恢复。保留虚构TEMP夹具与证据供复核，不接触正式用户资产。平台未暴露施工子Agent token实数，记不可得。
