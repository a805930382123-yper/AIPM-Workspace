# B08 修复施工报告（repair1）

日期：2026-10-08。施工模型：GPT-6 Luna High。此报告只记录施工与自测，不代替主 Agent 的独立验收，也不推进 B09。

## 修复内容

- F08-01：Provider 生成/优化的 preview 先校验关联 Wiki 与用户选择完全一致，再复用 B07 `normalizePromptInput` 与 Prompt 分类 ID、字段白名单、长度和元数据规则。任何校验异常返回 `LLM_SCHEMA_MISMATCH`/502，且在草稿写入之前失败。
- F08-02：Optimizer 保留每轮检查时的 `originalBody` 展示快照，另将最新已保存 Prompt 正文用于下一轮输入，并同步目标版本。保存成功后锁定本轮预览并显示已保存版本，不继续展示会重用已确认草稿的保存按钮。部分提交时保留错误提示和同请求重试行为。
- F08-03：confirm 成功回包后先独立触发 Library 刷新，再检查界面 sequence；旧上下文不会被响应修改。带 `committed: true` 的对账错误也触发刷新，同时保留当前上下文错误提示。若当前 Library 仍选中该 Prompt 且没有编辑表单，列表更新后额外重读详情与版本历史；若用户已选别的记录或开始编辑，则只刷新列表与统计。
- F08-04：Wiki 多段片段预算将 `\n\n` 分隔符计入每页与总字符预算，并在剩余空间不足以容纳分隔符时停止追加。

## 验证

- `npx tsx --test tests/prompt-ai.test.ts`：6/6 PASS，包含非法 Provider 分类、名称换行、场景/要求/示例/标签超限均在草稿前失败，以及多 Wiki 多段片段的每页 3000 / 总计 12000 字符边界。
- `npm test`：152/152 PASS（在最后的 Library 详情/历史刷新补充前运行）。运行前由主 Agent对两份受保护 B04 自测输出完成备份；测试生成的新输出由主 Agent另存并恢复旧原件。主 Agent将对最终冻结文件再跑全量测试。
- 最后补充后的 `npx tsx --import ./tests/support/css-stub.mjs --test tests/prompt-ui.test.tsx`：15/15 PASS，覆盖既有 B07/B08 UI 入口和 B07 竞态回归；`npm run build`：PASS（TypeScript 与 Vite，45 modules）。无权限提升时 Vite 曾被 sandbox 的 `realpath app/main.tsx` EPERM 阻止；在授权执行环境重跑通过。
- 真实 Provider 配置仍为未配置；真实模型成功与生成质量保持 BLOCKED。本轮使用确定性自测，不代表真实 Provider 内容质量。

## 交接状态

施工文件和本报告已冻结，等待主 Agent独立复验。没有修改 `tests/acceptance/**`、B08 初始报告/哈希、任务卡、交接、状态、正式数据或密钥。独立验收若发现新问题，请另开修复报告和哈希，不覆盖本报告。
