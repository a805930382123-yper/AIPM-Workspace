# 全项目第二轮 Standards 复核（2026-10-10）

## 结论

**Standards 轴 FAIL。** S-01 Audit 路径与 S-02 Raw 正文完整性修复在当前冻结版本中成立；但相邻成功输出仍有两类服务端凭证泄漏：B05 Wiki 知识工作流没有输出扫描，Prompt Brief 与 B04 提取路径会忽略短于 6 字符的凭证。monitor 已用实际产品 HTTP、OpenAI 兼容适配器和本地 fake 独立复现三种成功泄漏；该结论不依赖本报告的服务级夹具。

本轮为只读代码审查。未修改产品代码、正式 workspace 或历史证据；未运行 `npm test`、未使用 CUA、未调用真实 Provider。当前工作区无可用 git 历史，按返修冻结清单核对相关文件 SHA。

## 基线与关闭项复核

返修验收记录为 [FULL-20261010-repair-acceptance.md](FULL-20261010-repair-acceptance.md)，其冻结清单为 [FULL-20261010-repair-frozen.json](FULL-20261010-repair-frozen.json)。本轮涉及的三个返修文件与冻结 SHA 一致：

| 文件 | 冻结 SHA-256 | Standards 复核 |
|---|---|---|
| `services/audit/service.ts` | `19ae26c7a23171efe394dcbb7819298e5aaed8b300cd7ce9a55705005f9b4f55` | S-01 在 Audit 成功 JSON 路径中，解析后、验证及保存前递归扫描凭证键和值（32–39、107–112 行）；本轮未发现该路径回归。 |
| `services/raw/store.ts` | `6ca603af375f7f8b5cc81bd4b5a6c1a9739951d58304ce0f2f159af0628cbe24` | S-02 的 `get/list/delete` 在读取或删除前核验 UTF-8 正文摘要（47–59、99–130 行）；相关提取/恢复流程也有返修报告中的独立实测。 |
| `services/wiki/knowledge-workflows.ts` | `93b3fe3e96884445cbc2c695bfb7d83993488eb54f0100849cc857fa9cc401e5` | 冻结版本仍存在下述 S-03。 |

S-02 的保证范围是发现“正文与 frontmatter 记录摘要不一致”，不是在正文和摘要被一并改写时提供密码学防篡改证明。返修报告的 Raw 损坏、恢复、重启和恢复原文件证据可直接参见其“关闭项与实际行为”部分；本轮没有把该完整性缺口误判为 AI 改写 Raw。

## 新发现

### S-03 / 高：B05 知识工作流未检查成功 Provider 输出中的服务凭证

`services/wiki/knowledge-workflows.ts:84–102` 的 `call()` 调用 Provider、解析并校验 JSON 后直接返回结果，没有扫描 `provider.secrets`。`createUpdate()` 和 `createSynthesis()` 会把这些结果形成知识草稿，分别见该文件 40–56、59–81 行。因此输出中的 API key 可由成功响应返回并写入 `drafts/knowledge-workflows`；后续用户确认还可能将内容写入正式 Wiki。Audit 的 S-01 防护不覆盖此工作流。

最小服务级复现为 [knowledge-workflow-secret-echo.mjs](fixtures/FULL2-20261010-standards/knowledge-workflow-secret-echo.mjs)，结果为 [knowledge-workflow-secret-echo.result.json](fixtures/FULL2-20261010-standards/knowledge-workflow-secret-echo.result.json)：真实 `RawStore`、`WikiStore`、`KnowledgeWorkflowStore` 配合 fake Provider，长 dummy key 出现在返回草稿和持久化草稿；没有 Provider HTTP 调用，临时数据根已清理。这是隔离服务边界复现，不冒充 HTTP 测试。

monitor 的独立实际 HTTP 结果 [FULL2-20261010-spec-secret-http.json](FULL2-20261010-spec-secret-http.json) 对 `S03-synthesis-known-credential` 记录 HTTP 201，响应和草稿落盘均含已知长 key，Provider 调用与鉴权均匹配；Raw 保持不变，服务已关闭。

### S-04 / 高：Prompt Brief 与 B04 提取忽略短于 6 字符的已配置凭证

Prompt 路径在 `services/prompt-ai/service.ts:93–94` 只扫描长度至少 6 的凭证；命中检查之后，`brief()` 在 97–104 行保存并返回草稿。B04 提取路径的 `findSecretHits()` 在 `services/llm/jobs.ts:27–31` 同样过滤短值，完成时在 152 行才使用该扫描结果。配置读取只要求 key 非空，`services/llm/config.ts:52–64、71` 未设最小长度。因此合法的短配置 key 可通过成功模型输出进入响应及草稿/提取记录。此处风险是“不扫描短凭证”，并非短 key 一定能通过真实 Provider 鉴权；本轮 HTTP fake 已明确验证鉴权值与配置匹配。

服务级最小复现为 [prompt-short-secret-echo.mjs](fixtures/FULL2-20261010-standards/prompt-short-secret-echo.mjs)，结果为 [prompt-short-secret-echo.result.json](fixtures/FULL2-20261010-standards/prompt-short-secret-echo.result.json)：5 字符 dummy key 经 Prompt Brief fake 输出后进入已返回并落盘的草稿，提取检测器对同一 key 的命中数为 0；无 Provider HTTP 调用。

monitor 的实际 HTTP 证据同样记录 `S04-brief-short-known-credential` 返回 HTTP 201，及 `S04-extraction-short-known-credential` 任务完成；两者短 key 均出现在响应和持久化草稿，Provider 调用/鉴权匹配。提取路径复现时 Raw 正文未变，服务已关闭。详细布尔证据见上述 HTTP JSON。

## 覆盖边界

- 本轮只核对 Standards 相关源码与修复冻结 SHA，并运行两份新建、隔离临时数据根的服务级最小复现；fixture 内 Provider 为 fake，不访问网络。
- 三条 HTTP 泄漏由 monitor 独立实际运行产品 HTTP 与 OpenAI 兼容适配器确认；本报告引用该结果，不重复发请求。
- 未运行完整测试或构建，未使用真实 Provider，未检查新的桌面浏览器行为。不得把本轮称为全产品重新验收或真实模型质量验收。
- S-03/S-04 的修复与后续复测由主 Agent 决定；本报告不修改产品或既有验收结论。
