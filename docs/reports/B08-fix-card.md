# B08 首次返修卡

仅交给同一 GPT-6 Luna High 子 Agent。读 status、B08、B08-luna-task 与 B08-initial-acceptance。只改当前 B08 产品和必要自测，写 B08-repair1-build.md；不能修改独立验收脚本/证据或旧报告，不能推进 B09。完成后冻结写入，由主 Agent 复验。

## F08-01 / P2：Provider 预览校验不完整

services/prompt-ai/service.ts validatePreview 只验证文本类型等，未知 category 仍 generate201，草稿包含无效分类。见 B08-acceptance-http.json 的 provider-preview-and-check-validation。生成及优化必须在创建草稿之前完整检查 B07 metadata 值域/长度（分类、名称、场景、要求、示例、标签等）以及已有严格字段/Wiki/body 约束，失败明确 LLM_SCHEMA_MISMATCH/502、不产生成功预览或新草稿。复用合法校验规则，避免两套规则漂移；保留关联 Wiki 必须等于用户选择的约束。

## F08-02 / P2：优化原文快照和已确认保存控件混淆

选择甲 v2，优化并编辑预览后保存为 v3，原 Prompt 区域立即变成 v3 正文，检查/改进仍是 v2，违反保留原文。见 browser JSON 的 original-display-after-save 和 optimizer-after-save.png。保存后按钮又显示“保存为第4版”，但仍操作已确认的旧草稿，只会复用 v3 或切换模式报冲突。未绑定优化新建后也不能出现对同一草稿的无效版本保存。

将当前优化结果的原始正文/目标版本快照与下一轮优化输入区分。保存成功后本次原文比较保留，保存行为/版本标签必须诚实（关闭已确认草稿继续保存或明确同一内容重试等）；不能丢失稳定失败重试。补充后重新优化仍必须使用刚保存的最新目标/版本，不回退旧缓存。覆盖保存新项及保存新版本，两种路径均检查原文/按钮/再次优化。

## F08-03 / P2：迟到成功保存丢失 Library 刷新

主 Agent 在实际 confirm201 提交后通过本地 proxy 延迟回包，切 Generator 并输入新任务，释放旧回包，新任务保留但 Library 仍全部3，无已保存第4项；浏览器刷新恢复4，非文件丢失。见 browser JSON late-confirm-refresh-library、late-confirm-library.png 和 runtime http/events。

界面上下文保护与已提交资产列表刷新分别处理：旧响应不能修改新表单/通知/忙碌状态，但成功提交必须刷新 Library 和数量，在返回 Library 无需整页刷新即可见新项/新版本。当前 save 的 sequence return 在 onSaved 前，注意旧请求迟到/当前搜索 filter 的所有权，不引入 B07 旧搜索覆盖新条件等回归。错误不伪装成功；partial-commit 已提交但草稿对账失败的路径也保持明确。

## 交付要求

受影响测试、构建与当前完整测试通过；自测报告注明真实 Provider BLOCKED。产品写入完成后通知主 Agent 并停止修改。原测试证据中 stale optimization 的失败是验收 fixture 关联 Wiki 错误，已由主 Agent 修正，不能为迎合 fixture 放宽产品校验。
