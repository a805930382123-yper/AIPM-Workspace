# KB01 R4 独立 Standards 审查

2026-10-14。**最终冻结 Standards PASS，当前 actionable findings 为空。** 首冻结有一项 P2 安全缺陷，本轮由 Luna 修复并由本审查方独立关闭。此结论不签真实 LLM 质量、K05 或全项目 PASS。

## 对比与版本

按 AGENTS、status、KB01/R4任务卡、architecture、coordination 及 `C:/Users/80593/.codex/skills/code-review/SKILL.md` 审查 Standards 轴。Spec 由独立审查方与主 Agent 负责。没有 Git；对比依据是 baseline 与实际 frozen 文件集合/SHA256，不虚构 git diff。

最终冻结：`KB01-R4-20261014-frozen.json`，时间 `2026-10-14T15:05:57.605Z`，文件 SHA256 `ecbd663364f47886c4929a6bc1f5a4a068488b894b577900c88d4f39e564f01a`。独立核对 **85 产品 / 53 测试全部匹配，0 mismatch**。相对 baseline 五个产品文件（DraftReviewPage、llm/service、rules、新增 locators、provider）及五个测试文件（llm-flow、llm、fake-llm、ui-b04、provider-knowledge-reasoning）变化。上一版14:50冻结的PASS报告已按字节保留为 `KB01-R4-20261014-review-standards-prior-pre-json.md/json`，两份原件/副本的SHA分别一致；不以新版覆掉旧验收结论。

## 历史缺陷与关闭

**KB01-R4-ST01 / P2 / CLOSED：locator 派生后凭证漏扫。** 首冻结 `services/llm/service.ts:255` 从 Raw locator 派生 quote 后直接进入原 schema / page 转换。解析前检查无法看到新引入的 Raw 字符串，违反 `docs/batches/SEC-20261013.md` SEC03 的“分块/汇总不得把含凭证结果传到后续请求或草稿”及 KB01 K05 安全门禁。

最小复现：仅内存 Provider 持有虚构凭证；Raw 锚点含该文本；Provider 返回合法 v2 JSON，证据仅 `id/locatorId`，输出 JSON 本身不含凭证。首冻结的单块服务调用成功返回含凭证的规范化 quote；多块服务执行 **3 chunk + 1 merge**，merge 的实际输入也含凭证。首冻结实跑 **2/2 FAIL**，源码 SHA `2cf41c9d030527c627f084a157df747ab5218243d4a794d35ea9f99ebd23f8db`。复现使用主 Agent 保留的精确临时副本，未改产品。`jobs.ts:157` 最终防御仍阻止落草稿，因此本报告不声称正式磁盘泄漏。

最终 `services/llm/service.ts:257` 对完整 normalized result 再次 `assertNoKnownSecret`。同一独立脚本最新冻结实跑 **2/2 PASS**：单块返回安全 `LLM_OUTPUT_CONTAINS_SECRET`；长文仅首 wave 两次调用，无后续 wave、无 merge、无返回污染结果。最终源码 SHA `d5126be2a583749d316d45882325772d54a4ed25ab545e704598fe382c2c77e0`。

证据：[首冻结复现](KB01-R4-20261014-review-standards-locator-secret-pre-fix.json)、[前版复验](KB01-R4-20261014-review-standards-locator-secret-final.json)、[最新复验](KB01-R4-20261014-review-standards-locator-secret-post-json.json)、[汇总](KB01-R4-20261014-review-standards.json)。

## 本次追加复核

`services/llm/service.ts:295–309` 在生成后缀前预留既有聚合及当前page的全部ID；循环试探未占用后缀后立即加入预留集合，再同步事实引用。独立内存碰撞探针 **1/1 PASS**：两块同主题，首块预占 `e-c2/e-c2-2`，第二块 `e` 冲突后生成 `e-c2-3`；五条事实、五个唯一证据均保留，引文对应精确Raw范围；真实document merge调用的每块快照仍为原ID，没有受聚合重命名污染。[实测](KB01-R4-20261014-review-standards-id-collision.json)。

`services/llm/provider.ts:170–185` 仅在已有 knowledge purpose、精确 `open.bigmodel.cn/api.z.ai` host 和大小写规范化后的精确 `glm-5.3-flash` 分支追加 `response_format: {type:'json_object'}`。分支外不增加参数，配置/请求隔离、timeout/输出上限/取消与响应截断拒绝均未改。purpose在实际代码只由知识提取/merge/更新/综合提供；Audit、Prompt和连接测试不带该标记。主Agent批准的最小范围见 `KB01-R4-20261014-provider-decision.md`。官方一手文档确认该参数及客户端schema继续校验；模型页列出结构化输出支持：[Structured Output](https://docs.z.ai/guides/capabilities/struct-output)、[GLM-5.3-Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)。本审查只核验授权/官方依据/精确代码条件，不把主Agent的单变量诊断当成长文稳定性保证。实际wire分支矩阵、六链安全及真实长文/更新由主Agent单独实测。

## 其余规范覆盖

- v2 provider schema 复制原 schema 后仅替换 provider 证据结构；顶层版本必须为2，证据只准 `id/locatorId`。Raw ID、quote、start/end 由当前块目录派生，后续原 schema 和页内引用/原文定位继续执行。未知/跨块定位、混合格式不清洗成成功。legacy 仍走原严格 schema，歧义不取首匹配。
- locator 有长度/数量上限、连续全覆盖、精确 Raw 切片和代理对边界检查；Raw 读取、会议来源门禁与正式写入职责未移入 LLM 层。AI 输出仍为建议草稿。
- 原冻结预算、60秒单次/600秒总期限、两并发、响应大小、页面数及 Raw 上限保持；每波任一失败退出，不能把部分块称作完成，无新增重试或预算提升。
- rulesVersion 明示并哈希 `locator-v2`。专用 prompt 只对两条精确原规则命名覆盖，原安全指令保留；规则漂移会明确报错。document merge 使用独立 document-only schema/提示，输入使用规范化全局 Raw 证据，不透传 locator。聚合与每块快照深拷贝分离；本次重叠去重按完整来源身份处理，不依赖对象引用。
- UI 自动/手动/提交前候选成功会清除过期错误；失败仍阻断。候选≥0.35且未显式 create 的已选条目不得正式创建；字段变化使本地决策失效。异步审核期间可变字段和批量选择禁用，所见选择与 PATCH/confirm 快照保持一致。未因修复夹具移除原选中项、冲突和部分成功断言。

## 命令与限制

最终命令：`node --import tsx tests/acceptance/kb01-r4-20261014-review-standards-locator-secret.mjs . post-json`，退出0，约0.5秒；`node --import tsx tests/acceptance/kb01-r4-20261014-review-standards-id-collision.mjs`，退出0，约0.5秒。受限 shell 的第一次运行在 tsx 初始化前因 `uv_os_get_passwd ENOMEM` 退出，未形成产品结果；获准宿主执行后完成取证。名字含 `locator-secret-initial.json` 的早期记录实际捕获已修复的 `a72eaf14...`，只作修复中校准，未当成首冻结失败，原件保留。

本审查方只做源码/标准/指纹审查、三条独立内存探针和官方文档核验，未重跑完整套件、HTTP、浏览器、六链安全或真实 Provider；这些由主 Agent 负责。未读 `.env.local`、正式 workspace，未调用外部 Provider。只新增自己的 review-standards 脚本/证据及保留后更新自己的主报告，未修改产品或历史证据。平台未提供子 Agent token 计量，记不可得。最终批次/真实质量裁决仍由主 Agent 汇总，不进入下一批。
