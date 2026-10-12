# 全产品 Standards 审查（2026-10-09）

审查轴：Standards。对照 `AGENTS.md`、`docs/architecture.md` 与当前产品实现，重点检查 Raw 完整性、草稿/正式写入隔离、凭证、持久化恢复、路径和本地运行边界。没有 Git 元数据，故本次比较基准为当前全产品与工程约定，不把既有验收状态视为当前结论。

## 发现

### S-01 · 高：Audit 成功输出能把 Provider 凭证写入持久化草稿

`services/audit/service.ts:98–115` 对 Provider 异常做了脱敏，但成功响应只做 JSON、结构、长度和引用校验，随后把 `replacement`、`rationale`、`evidence` 原文写入 `drafts/audit/<id>.json`；这条路径没有扫描 `provider.secrets`。因此 Provider 若回显服务端 API Key，凭证会进入用户数据，且后续可被人工确认写入正式 Wiki。与此形成对照，B04 提取路径在 `services/llm/jobs.ts:151–155` 扫描成功输出，Prompt AI 在 `services/prompt-ai/service.ts:94` 检查输出。

最小复现：

```powershell
node --import tsx docs/reports/fixtures/full-standards-20261009/audit-secret-echo.mjs
```

脚本在系统临时目录创建独立数据根，用 fake Provider（不联网），将 `fixture-secret-909` 放进合法 JSON 的 `replacement`。实测 `propose()` 返回 `draftStatus: pending`，replacement 和落盘草稿均含完整凭证。机器可读结果在 [audit-secret-echo.result.json](fixtures/full-standards-20261009/audit-secret-echo.result.json)，临时数据根结束后删除。建议 Audit 草稿保存前复用统一的成功输出凭证检测，并验证凭证命中时不创建草稿。

### S-02 · 中：Raw 读取和 B04 首次提取未核实持久化正文哈希

`services/raw/store.ts:36–43` 解析 frontmatter 后直接返回正文；`RawStore.get()` 位于 `services/raw/store.ts:96–101`，`list()` 位于 `84–93`，两者都不重新计算或比较 `bodySha256`。`services/llm/jobs.ts:94–96` 首次提取只确认 Raw 存在，随后 `135–158` 将读取到的正文交给提取服务，并把原 frontmatter 的哈希放进草稿。若磁盘上的 Raw 正文被外部改动而 frontmatter 保留原 SHA，页面仍读取修改后的内容，B04 首次 AI 提取也会消费它。更新/综合工作流在 `services/wiki/knowledge-workflows.ts:42,65,166,236,278` 有实际哈希校验，B04 首次提取路径缺少同等门禁。

最小复现：

```powershell
node --import tsx docs/reports/fixtures/full-standards-20261009/raw-integrity-extraction.mjs
```

脚本仅在系统临时目录创建 Raw，再替换正文而保留 frontmatter。实测 frontmatter SHA 为 `928ca6e3681ef1a420c43603d0f0566f7fd8283e37bb0483d18687c22b1e3f8e`，实际正文 SHA 为 `b33059ff3c3356fe45ff15b96ab767e9949964e1f3c5c64ffa564bf41d765505`；`RawStore.get()` 返回被改正文，且 `ExtractionRunner` 将其交给提取边界。fake 提取器在该边界立即抛错，未调用真实 Provider。结果见 [raw-integrity-extraction.result.json](fixtures/full-standards-20261009/raw-integrity-extraction.result.json)。建议统一在 Raw 读取路径验证 SHA，或至少在首次提取开始前强制验证实际正文 SHA 与 frontmatter 一致并返回明确完整性错误。

## 覆盖与限制

- 已只读检查架构/批次约定、本地服务监听与数据根配置、Raw/原件与 processing state、Wiki/确认提交与恢复、Audit、Prompt、LLM 配置/错误脱敏、演示数据和备份/恢复的关键路径。
- 两个发现均有独立临时数据根复现；未访问或修改正式 `workspace/`，未接触真实 Provider。
- 按委托未运行 `npm test`、未使用 CUA，也未施工；本报告不评价 Spec 轴、不重签 B01–B09验收。主 Agent浏览器本轮 NOT_RUN 是环境限制，不以旧验收代替本次 UI 结论。
- 当前静态检查没有额外确认到备份路径逃逸、密钥在 `.env.local`/API 配置摘要中明文返回、或者产品依赖 Agent/Obsidian运行的可复现缺陷。审查结论限定于本次检查的当前代码与上述复现范围。
