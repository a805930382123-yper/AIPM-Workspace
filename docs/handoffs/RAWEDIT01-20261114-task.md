# RAWEDIT01 Raw 整理后知识草稿编辑收尾（2026-11-14）

## 目标、授权与角色

用户明确继续完成的是 Raw 整理后的知识草稿编辑，包括 PDF 主题与普通 standard/deep 成果；不是修改 Raw 正文或元数据，不迁移 Karpathy。沿现有成果审核完成标题/内容编辑、保存持久、取消、失败保输入、编辑后重新确认、显式入库。保留全部原始资料、证据目录和来源关系。

评分：需求0（已明确），耦合2（React→API→草稿版本→正式确认），风险2（审核版本和来源完整性），历史0（无本任务重复失败证据）；合计4，涉及关键数据完整性直接B。Astra规划/最终独验，root派独立Sol High施工；实际调用身份由root记录。本卡作者不改产品。适用 agent-router 已读，状态以 docs/status.md 顶部PDF01-GLOBAL交付为前提，不重开PDF模型质量验收。

禁止付费或真实Provider调用、真实配置操作、正式workspace读写、提交推送、部署；不得停用用户5151/5173。所有验证使用TEMP合成数据和本地fake，隔离端口。62页38主题正式草稿待用户确认，不读取或改写它来做测试。保留所有已有修改及七个已删除旧证据，不恢复。无需新的业务决策或开工确认。

## 已核现状与实际缺口

- RawOutcomeReview已有标题/文本/保存/取消。maintenance（含PDF）走 changes/review，再读 draftView；普通旧page走 PATCH ai_organized+one_line_definition。后端已有revision拒绝、审核digest失效、不可变原事实/证据和显式confirm。测试pdf02-http已有编辑后旧digest拒绝及入库正文检查；不重复创造存储或编辑器。
- 保存成功未清本地selection或旧request。用户此前选中的成果在内容改变后仍保持已选，需要清理受影响选择并提示重新查看/选择。来源/深度笔记编辑影响整体时清空当前选择；不增加逐条强制多重审批。
- 页面顶部返回/查看原始资料只禁busy；主题来源及既有Wiki导航亦可在编辑中离开，输入会丢失。针对本组件实际导航以禁用+明确保存/取消提示或简洁离开确认解决；不扩展全站导航框架。其他主题按钮已有 !edit 限制，不把它报告成缺陷。
- StructuredNoteEditor有编辑/阅读和保存，没有取消编辑。需取消恢复当前已保存内容且解除dirty；“阅读笔记”不能被当作取消。保存失败应保留输入，保存期间互斥。
- 普通非maintenance主题编辑的是整理内容和说明，原事实/证据仍只读。准确说明这个编辑范围，不能把renderedBody整体塞入ai_organized造成重复或伪造原文。PDF/maintenance完整候选正文可直接编辑，保留段落/Markdown；不造富文本编辑器。
- 尚未实测的链路不假定失效。施工先做定点复现并补必要测试，已有正确逻辑保持。POST成功后GET失败的部分成功应如实提示并提供读回/恢复，不将已持久化谎报为未保存、也不覆盖用户输入；仅在复现后做最小修复。

## 文件所有权与接口

Sol产品所有权：app/pages/RawOutcomeReview.tsx、app/components/StructuredNoteEditor.tsx；必要受影响契约可最小修改 app/api.ts。services/wiki/drafts.ts、server/knowledge-api.ts、server/llm-api.ts、services/wiki/commits.ts 默认只读；若真实复现证明需后端修复，先把缺口报root再纳入，不重写事务。

Sol测试所有权：新增 tests/rawedit01-ui.test.tsx、tests/rawedit01-http.test.ts（按实际必要性选择），可更新 tests/lw01-raw-ui.test.tsx、tests/pdf02-ui.test.tsx 的受影响断言。自有隔离 fixtures/browser脚本使用 rawedit01 前缀，施工报告 docs/reports/RAWEDIT01-20261114-builder.md。保留既有改动，不恢复文件。规划/独验拥有本卡、baseline、review报告及独验证据；status/control由root最终统一更新。

基线HEAD 8264aba50b58be6c415be0124499a8977f3197fb；白名单实物副本 docs/handoffs/RAWEDIT01-20261114-baseline/ 与 SHA/status清单 RAWEDIT01-20261114-baseline.json。只复制18个必要源码、测试及package/tsconfig；排除workspace、env、凭据、依赖和.git内容。基线采集后的状态包含基线自身新增路径，差异比较按白名单SHA，不把全工作区旧改动算入本轮。

## 冻结验收

- RE01：实际Chrome完整App/API/local fake分别打开PDF、standard、deep待审成果。标题和相应可编辑正文保存后立即展示更新；刷新/重开仍一致。PDF多段/Markdown保持；普通只读原文/事实/来源不被混写。既有编辑入口可发现，无新多重审核。
- RE02：修改后取消恢复保存值且不写盘；再编辑仍可保存。深度笔记同样可取消，dirty解除。编辑中确认禁用；本组件离开入口不会无提示丢输入；保存中不允许重入/互相覆盖。
- RE03：校验失败、HTTP失败、409 stale revision各至少有适当UI或API定点证据：错误可见，输入保留，不伪成功、不写正式库；恢复/重试使用正确版本。若保留POST→GET，注入GET失败核实已保存但未刷新状态可恢复；不得依赖真实模型。
- RE04：实际改变内容后旧审批/digest不能复用；UI受影响选择清除并提示重新选择，cancel不需清除选择。保存仅草稿写入，重新显式选择并确认后才产生正式Wiki，正文/标题等于最后保存值。旧版本/旧digest请求明确拒绝。已提交/丢弃成果不能编辑。
- RE05：所有上述操作前后，隔离Raw正文、原件、证据目录/定位/来源关系保持不变；引用仍可打开正确原文/PDF页。编辑不会触发模型调用，正式数据完全未操作。
- RE06：新增定点测试、受影响既有lw01/pdf02必要回归、范围严格类型检查、空envDir生产构建通过。记录已知全仓旧坏测试限制，不扩修、不宣称全仓绿。实际Chrome使用完整App，不以组件演示冒充整链；本地fake证明工程行为，不声称模型内容质量。

建议基础命令：node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawedit01-ui.test.tsx tests/rawedit01-http.test.ts（以实际文件为准）；既有 tests/lw01-raw-ui.test.tsx、tests/lw01-maintenance.test.ts、tests/pdf02-ui.test.tsx、tests/pdf02-http.test.ts 按改动风险跑必要集合。记录精确类型/构建命令及筛掉旧fixture的依据，不能过滤新错误。浏览器覆盖保存、取消、失败恢复、刷新、选择清除、显式确认读回，保留截图/日志与最终SHA。

## 交接和结束

Sol交接变更列表、最小缺陷复现、实际命令/结果、浏览器证据、最终文件SHA、自有服务PID与清理状态后停写。Astra按同一版本独立检查代码和关键反例，可复用可信同版测试但必须独立确认核心UI/HTTP行为。验收分别记录本轮缺陷关闭与RAWEDIT01整体结论；不替代全项目或PDF历史批次结论。缺必选实测不得PASS，观察到失败不能用BLOCKED掩盖。范围内返修继续同卡；无新增业务决策，不把普通实现选择交回用户。
