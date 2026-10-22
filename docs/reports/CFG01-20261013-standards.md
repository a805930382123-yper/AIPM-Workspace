# CFG01 独立 Standards 审查

日期：2026-10-13。结论：**FAIL，3 项 actionable findings（2 P1、1 P2）**。本报告仅判定 Standards 轴，不能替代主 Agent 的 Spec、完整测试、浏览器或真实 Provider 验收。

## 版本与范围

依据：项目 `AGENTS.md`、`docs/status.md` 当前 CFG01 授权段、`docs/batches/CFG01.md`、`docs/architecture.md`、`docs/coordination.md`；使用 `C:/Users/80593/.codex/skills/code-review/SKILL.md` 的独立 Standards 轴。

比较：`git diff HEAD -- .env.example app/api.ts app/b04.css app/pages/SettingsPage.tsx server/index.ts server/llm-api.ts services/llm/config.ts`；另全文审查新 `services/llm/config-manager.ts`、`server/llm-config-api.ts`、`tests/provider-config.test.ts`、`tests/provider-config-ui.test.tsx`。只评审这些 CFG01 目标，不把其他 HEAD 差异归入本批。为判断接口调用与异步隔离，按需读取既有 Provider、ExtractionRunner 和 Prompt/Audit/Knowledge 调用位置；这些读取不扩展产品修改范围。

上述 11 个目标 SHA-256 均匹配 `docs/reports/CFG01-20261013-initial-frozen.json`（冻结时间 `2026-10-13T15:42:22.118Z`）。未施工、未修改正式 workspace、实际 `.env.local`、旧测试/脚本/报告；唯一新增仓库文件为本报告。

## Actionable findings

### CFG01-S01 [P1] 配置读盘故障阻断无关手动 API，启动也无法完成

位置：`server/index.ts:152–155`，关联 `server/index.ts:69`、`:110` 与 `services/llm/config.ts:18–20`。

新全局中间件在包括 health、统计、Raw/Wiki/Prompt 等无 Provider 操作的所有后续请求之前执行 `providerFactory()`；配置读取的非 ENOENT 错误在 `loadConfig()` 处抛出，且位于 `providerFactory` 内部捕获范围之外。错误经 `.catch(next)` 进入统一 500 响应。启动处也直接等待同一 factory，没有隔离配置读取故障。

这违反 CFG01 固定行为第 9 条“没有有效配置时只拒绝 AI 操作，配置页/手动功能仍可使用”，并将 Provider 配置故障跨越架构中的 LLM/手动文件功能边界。读取错误应继续在配置管理/AI 入口明确报告，但不应使健康检查或手动数据读取失效。

小型独立**实际产品 HTTP**探针：以独立临时 data/config、随机本机端口启动 `server/index.ts`；无配置时 `/api/health` 为 200；随后把隔离配置路径创建为目录，触发真实 EISDIR 读取故障。实际 `/api/health` 为 **500**，`GET /api/prompts` 为 **500**，错误为 `CONFIG_READ_FAILED`。没有调用 Provider。子进程已关闭，隔离目录已清理。HTTP 探针命令执行耗时约 1.021 秒。启动读故障的影响由同一静态调用链确认，未另签启动实测。

最小修复方向：把读取错误限定到管理/AI 入口；请求上下文可携带不可用 Provider 及安全配置错误，手动路由继续执行。启动同样应允许手动功能可用。增加故障时手动 GET 和 AI/管理错误的对照验证。

### CFG01-S02 [P1] 环境覆盖使本机已知旧 Key 脱离摘要泄漏检查

位置：`services/llm/config.ts:64–68`，关联 `services/llm/config.ts:37–43`、`services/llm/config-manager.ts:23–24`。

摘要检查只使用合并后的有效 `config.apiKey`。任一环境覆盖依然允许其他字段取自本机文件，但本机文件中的非空 Key 一旦被环境 Key 覆盖，就不再参与 Base URL/model 的已知凭证检查。因此异常本机配置中的 model/Base URL 可以包含本机旧 Key，并由安全摘要原样返回给前端；`environmentLocked=true` 不能阻止这条只读泄漏路径。

这违反 CFG01 第 7 条“异常配置文件/环境摘要不得泄漏已知凭证”及架构的 Key 不进入完整 UI 约定。

独立模块探针：本机文件有有效地址、包含 `Klocal` 的模型字段和 Key `Klocal`，环境仅以不同 `Kenv` 覆盖 `FMCG_LLM_API_KEY`。实际 `manager.get()` 输出 `environmentLocked=true`，对摘要 JSON 检查 `containsInactiveKnownKey=true`。两个 Key 都是本次临时合成值；工具输出仅为布尔结果，没有输出其内容。未调用 Provider。

最小修复方向：读取/摘要阶段保留所有已知非空环境及本机 Key，独立于字段优先级，对可读字段统一检查；不返回这些秘密本身。覆盖 Base URL/model 两个字段及长短 Key 的异常环境/本机组合。

### CFG01-S03 [P2] 合法单行 Key 保存时未按读取语法编码，回读会静默改变凭证

位置：`services/llm/config-manager.ts:39`、`:43`，关联 `services/llm/config.ts:27`、`:59–61`。

保存验证允许含首尾单引号或双引号的非空单行 Key。写入直接生成 `FMCG_LLM_API_KEY=<value>`，但读盘规则会删除配对的首尾引号。提交的 Key 因而被静默改为另一串字符，仍返回已配置且 HTTP 可报告保存成功；下一次 Provider 鉴权使用的是改变后的凭证。省略 Key 的后续保存也会保持改变后的值。

这是 `.env.local` 持久化和 Provider 接口间的不一致，违反任务卡“保留或替换 Key”及保存/重启后有效生效的契约。该问题来自新增 writer 与既有 reader 的组合，不是修改旧算法的要求。

独立模块探针：提交首尾单引号包围的临时合成 Key，实际 `savedConfigured=true`，随后 `loadLlmConfig()` 检查 `keyUnchanged=false`。探针未输出 Key 内容、未调用 Provider。

最小修复方向：新增 writer 的编码与 reader 解码必须保证允许值回读一致；或在保存前明确拒绝当前无法无损存储的值，保持原文件。覆盖首尾单/双引号及正常 Key 的保存、保留、同文件回读。

## 已审查的符合项与限制

静态符合：产品改变限于任务卡所有权范围；未加入依赖/多 Provider/Agent 运行时；单一 OpenAI-compatible 协议保持。配置目标由服务端环境决定，HTTP body 不支持文件路径。写入在窄模块内串行，并用同目录随机临时文件及 rename；读取非 ENOENT 明确失败；revision 是每进程随机 HMAC，非裸文件摘要；Key 掩码固定。Host/Origin/token/JSON 门禁装配、显式固定连接探针、清除确认、前端空 password 输入及保存后清空均存在。AsyncLocalStorage 给新请求建立 Provider 快照，ExtractionRunner 将获取到的 Provider 参数传入旧任务，不用全局 Provider 交换实现并发隔离。

这些“静态符合”不表示 C01–C07 RUN PASS：本 reviewer 未运行完整 tests/build、未测试浏览器、未注入 rename/unlink 并发故障、未测全部门禁/热配置异步交叉链路，也未签临时文件清理在所有 OS 故障下可靠。主 Agent 有独立运行验收职责。

首次 `node --import tsx` 小探针在受限环境因 `uv_os_get_passwd ENOMEM` 未运行，标记 INVALID 环境执行记录；改用本机 Node v25.2.1 原生 `--experimental-transform-types` 后成功完成上述两个模块探针（约 0.509 秒）和实际产品 HTTP 探针。最低 Node 和其他 OS 未测。实际 Provider/36 项真实 AI 成功与质量仍 BLOCKED，本报告不代签。

本轴 FAIL，不能以本报告批准本批 PASS 或推进下一批；三项应交回授权施工者返修，并由主 Agent 在新冻结版本独立复验。子 Agent token 实数不可得。
