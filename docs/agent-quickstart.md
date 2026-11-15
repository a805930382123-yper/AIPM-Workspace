# Agent 快速开始

1. 先读根目录 `AGENTS.md`、[当前状态](status.md)及其中的当前任务卡；按任务读取[工程方案](architecture.md)、[协作规则](coordination.md)和[验收规约](acceptance.md)。历史记录从对应归档索引按需读取。
2. ENG01、RUN01、EVAL01已完成，当前停止等待用户确认；[自动化路线图](batches/AUTO-ROADMAP-20261114.md)的后续批次须逐批明确授权，验收通过后汇报并停止。
3. Raw 不由 AI 改写；AI 输出只存草稿，正式 Wiki/Prompt 写入须用户明确操作。事实、整理、推断和待确认分开存储。失败不得冒充成功。产品运行不依赖开发 Agent。
4. Node 22+ 执行 `npm run typecheck`、`npm test`、`npm run build`，或 `npm run check` 串行检查。详见[测试说明](testing.md)。测试使用临时 `FMCG_DATA_DIR` 和 `FMCG_LLM_CONFIG_FILE`，禁止读取正式配置、调用真实 Provider 或占用用户服务端口。
5. 任务卡放 `docs/handoffs/`，施工及独立验收报告放 `docs/reports/`。报告注明实际命令、结果、版本/文件 SHA、边界及未完成项；不要将本地数据、密钥或未经审查的第三方正文提交到公开仓库。
