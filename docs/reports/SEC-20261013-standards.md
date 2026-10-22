# SEC-20261013 Standards 独立审查

结论：**PASS（Standards 静态审查轴）**。精确比较范围内未发现有证据、需返修的项目约定违规或新增安全/架构风险。此结论不替代 SEC01–SEC05 实测，也不单独关闭 S-03/S-04 或真实 AI 阻塞。

## 输入与版本

- 基线：`HEAD = 1c2c1561ce9a4452d9415adbd99910bf0ab881a1`。
- 比较：`git diff HEAD -- services/llm/provider.ts services/llm/service.ts services/llm/jobs.ts services/wiki/knowledge-workflows.ts services/prompt-ai/service.ts`，另完整阅读未跟踪的 `tests/security-output-sec.test.ts`。
- 依据：`AGENTS.md`、`docs/status.md` 当前授权、`docs/batches/SEC-20261013.md`、`docs/architecture.md` 的四层接口/持久化/LLM约定、`docs/coordination.md` 独立验收门禁、`C:/Users/80593/.codex/skills/code-review/SKILL.md`。
- 2026-10-13 对六个目标文件逐一运行 SHA-256 检查，全部与 `docs/reports/SEC-20261013-frozen.json` 一致。审查期间未修改产品、测试、旧报告、脚本或正式数据，仅新增本报告。

| 文件 | 冻结 SHA-256 |
|---|---|
| `services/llm/provider.ts` | `05ae88bca3ff2849546f9b2b90064ad37d3782d2f4c66cc58978073bfc1665b1` |
| `services/llm/service.ts` | `2ef21268fe0f2d0fae383652cbfa5ca9363e9870aa00124f110d9efc4f02d1d0` |
| `services/llm/jobs.ts` | `55ef0694b711dab83a497bf3b65503c71163f374d966db5ddc4b01f1f6eee75e` |
| `services/wiki/knowledge-workflows.ts` | `bd7711fe576809dc97927a3e05cac978e6dbc39900d67dda54cad944e89ca324` |
| `services/prompt-ai/service.ts` | `e3e68b20f73cf0d06096dfff717440e26ca74008b79dcbe944ad1d6630922065` |
| `tests/security-output-sec.test.ts` | `2fae6cedc60c1d8d3e9b793eeb402761008f98e63f3bde8c6cdd84b141bb7414` |

## 检查结果与位置

| 项目实际约定 | 静态证据 | 结果 |
|---|---|---|
| 服务端凭证不进入可见结果、草稿或正式资产；失败明确报告 | `provider.ts:29–44` 递归检查解析后字符串值、数组、嵌套对象及键；只筛非空已知凭证；抛出固定代码、固定消息、无路径/片段的 `LlmError` | 符合 |
| 在结构转换、舍弃字段、下次汇总或写草稿前检查不可信输出 | `service.ts:89–103,243–246,392–394`：每个分块及文档汇总解析后立即检查，先于 schema 校验/建页；`knowledge-workflows.ts:97–102` 先检查再限制字段；`prompt-ai/service.ts:85–95` 三项能力共用解析后检查 | 符合 |
| AI 只产生草稿；正式写入仍依赖用户确认 | 更新/综合在 `knowledge-workflows.ts:49–59,71–85` 的调用返回后才保存 pending 草稿；Prompt 在 `prompt-ai/service.ts:131–150` 的检查返回后才保存 pending；本次未修改正式确认接口与提交逻辑 | 符合 |
| Raw AI 只读，处理状态独立，失败不得伪装完成 | `jobs.ts:157–161` 二次检查整体结果后才建草稿；`jobs.ts:175–192` 错误脱敏后设 Raw 状态 failed/job failed；本次未改 Raw 正文写入接口 | 符合 |
| 错误消息和 details 不能持久化或返回凭证 | `provider.ts:50–84` 新增已知短值替换及键脱敏，保留长凭证片段和旧启发式；`provider.ts:88–96` 先脱敏再截断不合法 JSON 诊断；`jobs.ts:181–191` 脱敏 code/message/details；`knowledge-workflows.ts:91–95` 同样处理；`service.ts:237–239,389` 处理 Provider 的 LlmError；Prompt 调用错误先脱敏 code/message，不回传 details | 符合 |
| Audit、Raw 完整性与会议 local_only 来源门禁不被无关变更破坏 | 相关保护位置仍在 `knowledge-workflows.ts:42–45,68–69`、`jobs.ts:99–100`；Audit 已有 keys/values 检查仍保留，读取 `services/audit/service.ts` 验证共用 sanitizer 接口兼容；本次未改来源策略、Raw 存储、Audit/API/UI/schema | 静态符合，运行回归由主 Agent 验证 |
| 不引入产品运行对 Codex/协作 Agent 的依赖，限制文件所有权及批次范围 | 五处产品差异均属于本任务卡 Luna 文件；新增测试仅使用本机 fake/隔离临时目录；未增加依赖、配置、运行时 Agent 或正式数据修改 | 符合 |

**Actionable findings：0。** 不以风格偏好或一般性设计建议判 FAIL。

## 覆盖限制

- 本轴以精确差异和相邻实际调用路径的静态审查为主，未运行 build、完整测试、HTTP、浏览器或真实 Provider；这些项目没有在本报告标记实测 PASS。主 Agent 正在独立执行服务/HTTP/完整测试。
- 新测试文件的三个测试覆盖共用键/值/非空门禁、Prompt 三入口拒绝写入，以及 Raw 污染分块阻止后续波次；它本身没有完整覆盖更新/综合、实际 HTTP、job 状态、同根重试、旧草稿字节保护或汇总输出污染。最终关闭需要主 Agent 独立证据补齐，不能只引用新增测试。
- 同一已启动分块波次可能包含两个并发 Provider 请求；检查阻止污染结果进入后续波次/汇总，而不是撤销已启动的兄弟请求。该执行方式原已存在，未因本次改动增加调用或传播污染结果。
- 未检查排除范围的历史草稿清洗或真实 AI 质量，未部署或开启下一批。子 Agent token 计量不可得。
