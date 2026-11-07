# WORK04 A 真实模型复核操作记录

2026-11-07 仅复核已确认的合成分析第二轮。产品代码提交为 `be41f5a`，运行时工作树 HEAD 为 `5b2e7a8dec8e70754d5187208dcee83431fe890b`。本轮单独授权上限 1 次，实际产品模型请求 1 次。操作实例为 `/root/work04a_real_operator`，本记录是操作证据，独立质量结论由验收实例给出。

## 操作与结果

- 目标事项 `217cbc7d-03db-4cbb-9c5e-8eca55831922`，目标 v2 轮次 `35f5e8a2-e3b1-4d59-81f8-b21d5266727c`。送审范围为该轮保存的目标、口径、人工结论、未解问题、轮次问题、1 份包含 12 条虚构记录的补料 Raw、所选首轮成果的承接摘要及原草稿。首轮 Raw 保留原有关联，第二轮快照的 `sources` 只有补料 Raw。
- 确认 `127.0.0.1:4317` 和 `:5173` 的进程归属后，以 `node --import tsx server/index.ts` 重启工作台 API（18256 → 24988），UI 进程为 36612。两个端口的 `GET /api/health` 均返回 `{"ok":true}`。读取 `GET /api/work-items/<itemId>/analysis-runs` 确认目标完成且无复核记录，读取 `GET /api/llm/config` 确认现有模型配置有效。
- 写入独立预算凭证后执行一次 `curl.exe --noproxy '*' --retry 0 --max-time 135 --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:4317/api/work-items/<itemId>/analysis-runs/<runId>/basis-review`，HTTP 200，curl 退出 0，耗时 39.052 秒。持久化记录为 `e1377ba0-aea0-49d1-a137-6f9d90abe3a8`，`attempt: 1`、`status: completed`，现用 Provider `openai-compatible`、模型 `gpt-6.1-terra`。产品记录区间为 `09:20:57.015Z` 至 `09:21:35.873Z`。单一持久化记录与 HTTP JSON 一致。模型计费和 token 用量未由产品复核接口返回。
- 原事项文件前后 SHA-256 均为 `D33631799551EE7C867A1913E6FBE7FA73628BEF75107BF822C5E7FC69EC0647`，原分析文件前后均为 `FBBA050C963F2B9C4892E6B7B3F27458AD55E9A2A1C16BCFD6E99F7D45389C96`。复核记录 SHA-256 为 `0F0EC646A7618DAE9969F8FBBEFAEDF23F28451B7D8F6DB139E105FA88725011`。原始文件副本、尝试记录、HTTP 响应和持久化副本留在本机忽略目录 `node_modules/.cache/work04a-real-20261107/`。

## 对照摘要

模型对 12 条观察、轮次摘要、4 条主题结论和范围检查共 18 项均返回 `supported`，共 28 条引文逐字匹配本轮原文。报告主题区分 E001 接口有章节但页面未见入口和 E031 空章节，理由识别了同版本及另一版本的成功对照，也指出 E001 没有在新版本复测。范围项保留了事件去重、原会话版本未知和合成非随机样本的限制。Q18 只有用户补述，模型支持的是草稿中「证据不足」的描述。合成记录仅可检验这组材料上的模型判断，不能据此评估真实客户资料上的表现。该轮草稿已保留反例和待核表述，因此本次只观察到 `supported` 决策。
