# KB01 R4 独立 Standards 审查

2026-10-14。**最终冻结 Standards PASS，当前 actionable findings 为空。** 首冻结有一项 P2 安全缺陷，本轮由 Luna 修复并由本审查方独立关闭。此结论不签真实 LLM 质量、K05 或全项目 PASS。

## 对比与版本

按 AGENTS、status、KB01/R4任务卡、architecture、coordination 及 `C:/Users/80593/.codex/skills/code-review/SKILL.md` 审查 Standards 轴。Spec 由独立审查方与主 Agent 负责。没有 Git；对比依据是 baseline 与实际 frozen 文件集合/SHA256，不虚构 git diff。

最终冻结：`KB01-R4-20261014-frozen.json`，时间 `2026-10-14T14:50:21.409Z`，文件 SHA256 `449ce67f69f7936fe54cfc1a2b7fd6a095a7e4d26dd9a82597b7dc2fa6ac67ee`。独立核对 **85 产品 / 53 测试全部匹配，0 mismatch**。相对 baseline 仅四个产品文件（DraftReviewPage、llm/service、rules、新增 locators）及四个测试文件（llm-flow、llm、fake-llm、ui-b04）变化。

## 历史缺陷与关闭

**KB01-R4-ST01 / P2 / CLOSED：locator 派生后凭证漏扫。** 首冻结 `services/llm/service.ts:255` 从 Raw locator 派生 quote 后直接进入原 schema / page 转换。解析前检查无法看到新引入的 Raw 字符串，违反 `docs/batches/SEC-20261013.md` SEC03 的“分块/汇总不得把含凭证结果传到后续请求或草稿”及 KB01 K05 安全门禁。

最小复现：仅内存 Provider 持有虚构凭证；Raw 锚点含该文本；Provider 返回合法 v2 JSON，证据仅 `id/locatorId`，输出 JSON 本身不含凭证。首冻结的单块服务调用成功返回含凭证的规范化 quote；多块服务执行 **3 chunk + 1 merge**，merge 的实际输入也含凭证。首冻结实跑 **2/2 FAIL**，源码 SHA `2cf41c9d030527c627f084a157df747ab5218243d4a794d35ea9f99ebd23f8db`。复现使用主 Agent 保留的精确临时副本，未改产品。`jobs.ts:157` 最终防御仍阻止落草稿，因此本报告不声称正式磁盘泄漏。

最终 `services/llm/service.ts:257` 对完整 normalized result 再次 `assertNoKnownSecret`。同一独立脚本最终冻结实跑 **2/2 PASS**：单块返回安全 `LLM_OUTPUT_CONTAINS_SECRET`；长文仅首 wave 两次调用，无后续 wave、无 merge、无返回污染结果。最终源码 SHA `23a44a9a4da715e84f3a0ad2ef71be9c1d7c45b9d883ccf9bddf7fe1daecd2fb`。

证据：[首冻结复现](KB01-R4-20261014-review-standards-locator-secret-pre-fix.json)、[最终复验](KB01-R4-20261014-review-standards-locator-secret-final.json)、[汇总](KB01-R4-20261014-review-standards.json)。

## 其余规范覆盖

- v2 provider schema 复制原 schema 后仅替换 provider 证据结构；顶层版本必须为2，证据只准 `id/locatorId`。Raw ID、quote、start/end 由当前块目录派生，后续原 schema 和页内引用/原文定位继续执行。未知/跨块定位、混合格式不清洗成成功。legacy 仍走原严格 schema，歧义不取首匹配。
- locator 有长度/数量上限、连续全覆盖、精确 Raw 切片和代理对边界检查；Raw 读取、会议来源门禁与正式写入职责未移入 LLM 层。AI 输出仍为建议草稿。
- 原冻结预算、60秒单次/600秒总期限、两并发、响应大小、页面数及 Raw 上限保持；每波任一失败退出，不能把部分块称作完成，无新增重试或预算提升。
- rulesVersion 明示并哈希 `locator-v2`。专用 prompt 只对两条精确原规则命名覆盖，原安全指令保留；规则漂移会明确报错。document merge 使用独立 document-only schema/提示，输入使用规范化全局 Raw 证据，不透传 locator。聚合与每块快照深拷贝分离；本次重叠去重按完整来源身份处理，不依赖对象引用。
- UI 自动/手动/提交前候选成功会清除过期错误；失败仍阻断。候选≥0.35且未显式 create 的已选条目不得正式创建；字段变化使本地决策失效。异步审核期间可变字段和批量选择禁用，所见选择与 PATCH/confirm 快照保持一致。未因修复夹具移除原选中项、冲突和部分成功断言。

## 命令与限制

最终命令：`node --import tsx tests/acceptance/kb01-r4-20261014-review-standards-locator-secret.mjs . final`，退出0，约0.9秒。受限 shell 的第一次运行在 tsx 初始化前因 `uv_os_get_passwd ENOMEM` 退出，未形成产品结果；获准宿主执行后完成取证。名字含 `locator-secret-initial.json` 的早期记录实际捕获已修复的 `a72eaf14...`，只作修复中校准，未当成首冻结失败，原件保留。

本审查方只做源码/标准/指纹审查和两条独立内存安全探针，未重跑完整套件、HTTP、浏览器、六链安全或真实 Provider；这些由主 Agent 负责。未读 `.env.local`、正式 workspace，未调用外部 Provider。只新增自己的 review-standards 脚本和报告，未修改产品或历史证据。平台未提供子 Agent token 计量，记不可得。最终批次/真实质量裁决仍由主 Agent 汇总，不进入下一批。
