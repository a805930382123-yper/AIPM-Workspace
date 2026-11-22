# Agent 快速开始

1. 先读根目录 `AGENTS.md`、[当前状态摘要](status.md#当前状态摘要)及其指向的现行任务卡（`docs/handoffs/`）；按任务读取[工程方案](architecture.md)、[协作规则](coordination.md)和[验收规约](acceptance.md)。历史记录从对应归档索引按需读取。
2. 当前阶段、最近批次结论与待确认事项以 [status.md 当前状态摘要](status.md#当前状态摘要)为准；各批次须经用户逐批明确授权后启动，验收通过后汇报并停止，不自动推进下一批。
3. Raw 不由 AI 改写（人工正文修订边界见[工程方案](architecture.md#rawedit02-人工正文修订边界2026-11-14独立验收通过)）；AI 输出只存草稿，正式 Wiki/Prompt 写入须用户明确操作。事实、整理、推断和待确认分开存储。失败不得冒充成功。产品运行不依赖开发 Agent。
4. Node 22+ 执行 `npm run typecheck`、`npm run guard`、`npm test`、`npm run build`，或 `npm run check` 串行检查；工作区卫生只读核查运行 `npm run hygiene`。详见[测试与检查说明](testing.md)。测试必须使用 `os.tmpdir()` 下新建的 `FMCG_DATA_DIR` 和不存在的 `FMCG_LLM_CONFIG_FILE` 并清除继承 `FMCG_LLM_*` 凭据，禁止读取正式配置、调用真实 Provider 或占用用户服务端口。
5. 任务卡放 `docs/handoffs/`，施工及独立验收报告放 `docs/reports/`。证据分层、体积上限与仓外归档清单约定见[证据存放规范](evidence-policy.md)；报告注明实际命令、结果、版本/文件 SHA、边界及未完成项，严禁将本地数据、密钥、本机绝对路径或未经审查的第三方正文提交到仓库。
