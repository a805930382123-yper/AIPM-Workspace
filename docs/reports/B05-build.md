# B05 施工交接（2026-10-07）

施工 Agent：GPT-6 Luna High。范围限于B05产品实现与必要施工自测；不裁决整批PASS。真实产品 Provider 未配置，真实调用与真实输出质量保持 **BLOCKED**。主 Agent 独立验收尚未开始。

## 改动

- 新增 `services/search/duplicates.ts`：NFKC/中文大小写归一化的标题、别名、分类、标签、正文相似候选，逐维返回匹配理由与分数。分类单独命中权重很低；正文相似度低于40%不计入总分；启发式结果只作人工建议。
- 扩展 B04 草稿页保存处理决策 `update/create/defer` 与目标 Wiki ID。新建确认检查已保存决策和当前候选；显式 `create` 可生成独立稳定 ID，`update/defer` 不能通过选中页 ID 冒充新建。更新预览入口在草稿页面；Raw页新增多来源综合入口，可选择 Raw 与既有 Source 混合来源。
- 新增 `services/wiki/knowledge-workflows.ts`、`server/knowledge-api.ts`：提供候选读取/决策、更新预览、多来源综合、工作流读取/编辑/放弃/确认、提交状态读取。Source 选择会映射唯一真实 Raw 并按 Raw ID 去重。
- Provider 结果要求 `suggestedAdditions/conflicts/agreement` 使用 `{text,rawId,quote,start,end}` 引用结构；保存前逐条验证指定 Raw 的准确 UTF-16 切片。推断与待确认问题独立存储。缺少产品 Provider 时返回 `LLM_NOT_CONFIGURED`，没有离线模板回退。
- 确认前保存 prepared manifest，包含冻结记录、Raw哈希和目标baseRevision；事务包含需创建的Source、Wiki、Index、Log。幂等复用按草稿与payload digest查找，同payload不同key复用同一operation；旧目标revision或恢复时检测到人工新版本会停止，不覆盖新编辑。更新正文以当前旧页内容为底稿追加，保留旧公式、新来源引用、冲突、推断和问题；用户编辑后的草稿文本与证据引用一起进入正文。
- 新增浏览器草稿页面及 Raw/Source 多来源选择入口。候选在确认前强制检查；保存建议编辑后重新读取候选。更新预览、综合草稿均支持编辑、保存、放弃、确认。
- 新增 `tests/b05.test.ts`：五维候选/低权重分类、综合事务与Source创建/Raw去重/幂等、更新双公式与引用/Source保留、旧revision冲突保护。

## API与数据契约

- `GET /api/knowledge/drafts/:draftId/pages/:pageId/duplicates`：候选。可查询当前本地编辑值 `title/category/content`，只用于预览；正式确认服务端仍重新读取已保存草稿和当前Wiki。
- `PATCH /api/knowledge/drafts/:draftId/pages/:pageId/decision`：`{baseRevision, decision, targetWikiId?}`。
- `POST /api/knowledge/updates`：`{draftId,pageId,targetWikiId,baseRevision}`；`baseRevision` 是提取草稿revision，目标Wiki revision由服务端快照为workflow `baseRevision`。
- `POST /api/knowledge/syntheses`：`{rawIds,sourceIds}`；Source必须唯一映射真实Raw，合并后至少两个不同Raw。
- `GET/PATCH/DELETE /api/knowledge/workflows/:workflowId`，确认 `POST .../confirm` `{baseRevision,idempotencyKey}`；`GET /api/knowledge/commits/:operationId` 查询持久化提交manifest。
- Workflow含 `kind/status/revision/title/provider/rawSnapshots/targetWikiId/baseRevision/sections/evidence/sources`。五栏事实类预览有可核原文证据，推断/问题分开。Source快照、目标旧文快照不可由编辑请求改写。

## 检查

- `npm run build`：PASS（TypeScript与Vite构建成功）。
- `npm test`：PASS，104/104。全套运行之前由主 Agent归档了会被测试脚本重写的两份B04施工证据；未修改历史独立验收报告或验收脚本。
- 最终候选GET契约调整后，定点运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/ui-b04.test.tsx tests/b05.test.ts`：PASS，11/11。
- 未启动应用进程或浏览器；没有操作正式 `workspace` 数据目录。隔离用例使用测试自动创建并清理的临时目录，没有留存服务进程。
- 当前产品配置检查由主Agent完成：环境变量与 `.env.local` 均缺失。因此没有真实Provider请求；fake只用于测试，不作为真实成功/质量证据。
- 平台未提供本子Agent token计量，无法报告消耗量。

## 尚待验收与风险

- 浏览器真实操作、HTTP故障注入、恢复同ID/人工新编辑保护、Source/Index/Log一致性、混合Source+Raw入口由主Agent独立验收。本报告不替代这些验证，也不把实现静态存在视为实测PASS。
- 候选分数是启发式排序，不是事实判断；门禁对分数至少0.35的候选要求显式处理，低分仍会展示但不强制决策。主Agent可基于独立样本评估误报/漏报。
- 当前Source列表是对Raw的可读摘要；首次综合确认会在同一prepared manifest内为缺失Source补建页面。人工编辑的综合句子保留该条原有证据引用，但文字修改本身仍需用户审阅。
