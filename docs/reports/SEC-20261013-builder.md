# SEC-20261013 施工记录

状态：施工完成，等待主 Agent 独立验收。本记录不签 S-03/S-04 或全项目 PASS。

## 修改

- `services/llm/provider.ts` 新增递归凭证门禁：只匹配当前 Provider 持有的非空 secret，不设最小长度；检查 JSON 字符串值和对象键、数组及嵌套对象。命中统一抛出 `LLM_OUTPUT_CONTAINS_SECRET`，不返回路径、键名或片段。
- `services/llm/service.ts` 在 Raw 提取每次响应的 JSON 解析后、Schema 校验和字段转换前执行门禁；相同解析入口覆盖分块汇总响应，因此含凭证结果不会进入后续汇总请求或最终草稿。Provider 错误码、消息和 details 在提取错误传播时脱敏。
- `services/wiki/knowledge-workflows.ts` 在更新/综合输出解析后、Schema 转换前检查；Provider 错误码、消息、details 一并脱敏。
- `services/prompt-ai/service.ts` 在 Brief、生成、优化共享解析入口检查输出；错误码和消息脱敏。
- `services/llm/jobs.ts` 保留最终结果防御检查，失败仍将提取 job 标为 `failed`、Raw 状态退出 `processing`，错误码/消息/details 脱敏。错误命中不再返回可能泄漏键名的 JSON 路径。
- `sanitizeProviderText` 对所有非空已知凭证进行完整值脱敏；既有长凭证片段规则保留。`sanitizeDeep` 同时处理凭证键。非法 JSON 诊断先脱敏整段文本再截取前缀，避免截断后的凭证残片。
- 新增 `tests/security-output-sec.test.ts`，覆盖多枚长短 secret、空 secret、嵌套值/键、JSON 解析后的转义内容、Prompt 三入口拒绝且不落草稿，以及 Raw 提取 tainted chunk 不进入后续 wave。

## 施工检查

| 命令 | 结果 |
|---|---|
| `npm run build` | PASS；TypeScript 与 Vite 构建通过。Vite 保留既有单 bundle 超 500 kB 提示。 |
| 定向 `tests/security-output-sec.test.ts` | PASS，3/3。 |
| 完整 `npm test` | 按任务卡未运行，避免覆盖历史 B04 证据。 |

本机 Node 的 `os.userInfo()` 因 `uv_os_get_passwd returned ENOMEM` 失败，直接运行 `node --import tsx --test ...` 无法启动测试。定向测试通过一个只在该 Node 进程中替代 `os.userInfo` 的 preload 执行；未更改项目配置或测试运行时文件。命令：

```powershell
node --import "data:text/javascript,import%20os%20from%20%22node:os%22%3Bos.userInfo%3D()%3D%3E({username:%22test%22,uid:-1,gid:-1,shell:null,homedir:process.env.USERPROFILE})" --import tsx --test tests/security-output-sec.test.ts
```

未连接真实 Provider、未运行完整历史测试、未执行会议 AI，也未改 Raw、Wiki、Prompt Library、密钥配置或依赖。HTTP、多凭证服务、完整测试、历史/正式资产指纹及 Standards/Spec 独立检查由主 Agent 按任务卡验收。
