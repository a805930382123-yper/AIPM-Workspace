# B05 返修施工记录（2026-10-07）

本报告记录 F05-01–F05-05、返修卡要求的提示文案及针对性回归。施工 Agent 未签独立验收 PASS；冻结后的 HTTP/浏览器验收由主 Agent 执行。

## 修复内容

- F05-01：Synthesis Provider 返回必须包含非空、长度不超过 300 且不含换行的标题，并使用 Wiki Schema 中的有效分类。非法值在草稿落盘前以 `LLM_SCHEMA_INVALID` 拒绝。草稿编辑、确认时继续检查标题、分类、列表和证据结构；确认不再把非法分类替换成默认项。
- F05-02：Raw 页面提供“待审核知识草稿”持久化入口，列出待确认与冲突 workflow；保存后刷新或同目录重启仍可按标题进入原 ID 草稿，无需再次请求 Provider。
- F05-03：更新确认使用已保存的编辑标题，保留原标题为 alias，并保留目标页面既有元数据、来源和正文，revision 递增。目标标题发生冲突时拒绝写入。
- F05-04：重启恢复只执行 `prepared`/`committing` manifest。恢复完成后将 workflow 收敛为 `confirmed`，记录 operationId、Wiki ID 和 revision；冲突记录为 `conflict` 并可读。已完成 manifest 的同 payload 重试（幂等键可不同）直接返回原 operation，不重放正式写入，因此不会覆盖完成后用户对正式页所做编辑。
- F05-05：更新草稿/综合生成前、确认前和 manifest 恢复前，都对实际 Raw 正文计算 SHA-256 并与 frontmatter 和快照比对。确认阶段还重新检查每条证据的原文区间和 quote；正文外部变更会阻断流程且不产生新的正式页面。
- 修正 B04 审核页同名提示，改为当前可选的更新、显式新建或暂不处理说明。相应施工 UI 断言改为验证新提示。

## 改动文件

- `services/wiki/knowledge-workflows.ts`
- `app/pages/KnowledgeWorkflowPage.tsx`
- `app/pages/RawPage.tsx`
- `app/pages/DraftReviewPage.tsx`
- `services/wiki/commits.ts`
- `tests/b05.test.ts`
- `tests/ui-b04.test.tsx`

构建期间发现 `KnowledgeWorkflowPage.tsx` 原有条件 JSX 片段未闭合，已修正后重跑检查。

## 验证

- `npm run build`：通过（`tsc -b` 与 Vite production build；40 modules transformed）。
- `npm test`：通过，107/107；首跑有一条旧 B04 UI 断言仍期待已移除的旧提示，改为检查新提示后全量重跑通过。
- 新增/扩展 B05 自测覆盖：非法分类无 workflow/正式写入；Raw Markdown 正文追加但保留旧 frontmatter hash 时确认拒绝且零 Wiki 写入；Index 故障重启恢复后 workflow 状态及 manifest 完成；completed operation 的不同幂等 key 重试不覆盖恢复后人工编辑。
- 自测只使用 `mkdtemp` 隔离目录和 fake Provider；没有启动服务或浏览器进程。正式 `workspace` 未操作。
- 主 Agent 已确认三项产品 Provider 配置及 `.env.local` 均不存在。没有尝试联网配置；真实 Provider 调用及生成质量仍 BLOCKED，fake 测试不能替代。
- 模型平台 token 用量不可读取，本记录不提供估算值。

## 交接边界

产品返修已冻结，等待主 Agent 对返修冻结版本运行独立 HTTP、故障注入与真实浏览器验收。本报告不判定 F05 关闭、不签 B05 PASS，也不开始 B06。
