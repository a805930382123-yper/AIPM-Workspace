# LLM-Wiki 3-2 检查点与草稿施工

基线 `d4c62e33d5fdafca5cfd66b71439d1da28161892`。标准与深度 Raw 整理、PDF 页理解、PDF 范围整理在切换模型后可继续使用通过验证的检查点。续跑请求带结构衔接指令，沿用已验证的结构、编号和来源坐标。网页翻译和 Prompt 维护是独立链路，本阶段的草稿续跑证据覆盖上述四项。

- Raw 检查点指纹涵盖来源字段、正文、处理与规则版本、图片输入和分段坐标。续跑继续依照已有的来源权限、证据定位与 Wiki 快照门禁。续跑时同步保存本轮任务的 Provider 摘要，使用同一个作业 ID 结算草稿。
- PDF 页理解继续校验原件、文字层、页坐标与版本。范围整理继续校验选页、页理解摘要、修订版与批次。沿用旧页范围的摘要算法，以便已存在的范围任务和草稿继续打开。
- 校验通过的输出和实际成功模型一起落盘。草稿中的 `model_switches` 按顺序记录形成切换的块与前后模型，保留 A→B→A；失败、无效响应及取消后到达的响应不计入。旧检查点经原有门禁通过后可以使用，缺少模型证据的旧块在审阅页注明。审阅页同时提供模型切换记录和核对原文提醒。草稿仍从待人工确认开始，正式知识写入沿用审阅门禁。

## 定向验证

Node v24.18.0。测试使用新建系统临时目录、缺失的模型配置文件及回环替身，清除了继承的 `FMCG_LLM_*` 和 `EMBEDDING_*` 配置。

| 实际命令 | 结果 |
|---|---|
| `npm.cmd run typecheck` | 退出 0 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=3 tests/kb03-deep.test.ts tests/kb03-boundaries.test.ts tests/kb02-semantic-review.test.ts tests/pdf01-http.test.ts tests/pdf02-http.test.ts tests/pdf-cleanup-structured.test.ts tests/fe03-draft-split.test.tsx` | 122 通过、0 失败、0 跳过。包括标准和深度 Raw 续跑、旧记录、失败的主端与实际备端、A→B→A、页理解、范围整理的重启和取消、历史 PDF 修订及 62 页完整链路。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb03-planning-context.test.ts` | 14 通过、0 失败、0 跳过。包括旧版标准及深度草稿的人审与显式写入。 |
| `npm.cmd exec -- prettier --check`，参数为本工作包修改过的代码和测试路径 | 全部匹配文件通过 |

生产 HTTP 与 Edge 的独立结果见[3-2 独立验收](3-2-review.md)。本记录是检查点工作包施工自查，整阶段裁决由主 Agent 汇总全仓门禁后签发。

| 源文件 | 施工交接 SHA-256 |
|---|---|
| `services/llm/checkpoint-models.ts` | `3f0669198a72edd7e6fc5e341702c757ef4b4c45fddd3482fd8a45a47f77c4e1` |
| `services/llm/jobs.ts` | `fbe7be789a927a263964a3f8c1677f54dece8798945b1843ca3723dc4742db0e` |
| `services/raw/pdf-pages.ts` | `6e8b095c0ef1e3a166c52d2f5efabca18d3a773a58d9b3e8a50ed97cd4e4d2f6` |
| `services/raw/pdf-cleanup.ts` | `301d6fbe4658c0e32da3261c1aed2b9597e67e748da98c66274e5f21ac238183` |
