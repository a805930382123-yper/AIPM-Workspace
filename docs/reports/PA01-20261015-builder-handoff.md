# PA01 施工交接（2026-10-15）

施工按冻结接口 PA01-01–09 的工程范围完成；不含真实 Provider 验收 PA01-10。产品/tests 写入现已停止，交主 Agent 冻结审查。未签 PASS。

## 变更

- `services/prompt-ai/contract.ts` 提供 Brief、provider-only 内容和九维检查的共同协议描述与样例。Brief Prompt 引用同一契约，Brief 仍严格校验九个字符串字段及字符预算。
- `services/prompt-ai/service.ts` 生成和重写现在接收 `{version,name,category,scenario,sections,inputRequirements,outputRequirements,examples,tags}`；服务端按分节顺序渲染正文，并把 Wiki 关联与收藏状态设为受控字段。Brief、generate、check、rewrite 都用 60 秒/512 KiB；严格拒绝未知字段，不修 JSON。
- 优化新增 `checked → rewriting → ready/failed` 流程。检查结果原子保存；重写从持久化快照读取并校验输入摘要、规则版本、Provider 身份、目标版本和来源策略。单草稿最多三次 Provider 尝试；失败保留原文/检查/改进点，失败 requestId 不能重用，同草稿并发被拒绝；启动时将遗留 `rewriting` 标成可恢复失败。成功状态重放不再外发。旧 `/optimize` 保留两段协调响应兼容。
- `server/prompt-ai-api.ts` 增加 `/optimize/check`、`/drafts/:id/rewrite`、摘要 `/drafts`；旧 get/confirm 保留。客户端断连和 UI 编辑/卸载可取消 Provider 请求。
- `services/llm/provider.ts` 新增 `purpose: 'prompt'`，只有既有精确 host + `glm-5.3-flash` 守卫发送 low reasoning 与 JSON object；连接测试和其它 Provider wire 不变。既有 provider reasoning 测试迁移并增加 Prompt 场景。
- 新增 `services/storage/recovery.ts`、`server/recovery-api.ts` 和 `app/components/RecoveryNotice.tsx`。启动与全局只读 API 扫描指定 JSON 存储目录，区分目录/读取/解析/基本结构问题，以文件名哈希作为安全标识；不删/修复原文件，提示可重新检查。`scanJsonRecords` 保留健康邻居并收集坏项，原 `listJsonRecords` 健康 array 返回不变；损坏的 Prompt 草稿读取返回 `STORAGE_CORRUPT`，不会伪装成 404。
- `app/pages/PromptAiWorkbench.tsx` 使用分阶段检查与重写，支持列表恢复 checked/ready 草稿，并增加人工 Brief 入口。全局恢复样式放在 `app/prompt.css`。

## API 与存储

Prompt provider 内容协议 `pa01-1`；Brief 沿用原 API 字段。新增 API：`POST /api/prompt-ai/optimize/check`、`POST /api/prompt-ai/drafts/:id/rewrite`、`GET /api/prompt-ai/drafts`、`GET /api/recovery-issues`。optimizer 草稿保留原字段并新增 stage、输入 SHA-256、规则版本、非敏感 Provider 身份、attempts、supplement、lastError、lastRequestId/requestIds。旧有已完成草稿仍按 `preview` 可读/确认。

## 测试和断言迁移

- `tests/prompt-ai.test.ts` 将生成夹具从旧 `{preview}` wire 改为 provider-only 分节协议；优化从单个 `{checks,improvements,preview}` 改为检查与重写两次输出；原正文断言更新为确定性标题渲染。新增检查落盘、非法重写失败后恢复用例。
- `tests/provider-knowledge-reasoning.test.ts` 增加 `purpose:'prompt'` 的精确 host/model 正例及伪造 host/其它模型负例。无安全/来源/版本/事务断言删除。
- 新增 `tests/pa01-recovery.test.ts`，验证损坏字节不变、健康邻居返回、清单不含路径/文件名/正文。
- 定点：`pa01-recovery`、`prompt-ai`、`provider-knowledge-reasoning` 共 12/12 PASS，0 skip。
- 完整默认测试：在隔离副本 `C:\Users\David.chen\AppData\Local\Temp\pa01-validation-20261015-144618` 执行，233/233 PASS，0 skip。副本施工文件与工作区逐文件 SHA-256 一致；正式 workspace、`.env.local`、依赖锁与 ACL 未纳入写入。
- 构建：隔离副本 `node_modules/typescript/bin/tsc -b` PASS；`node_modules/vite/bin/vite.js build` PASS。Vite 提示单个 JS chunk 超过 500 KiB；没有阻断构建。
- 初始编译：TypeScript `tsc --noEmit` PASS。无真实 Provider 调用。

## 断言/环境异常及风险

一次完整 suite 启动命令中 PowerShell `Push-Location` 误解析 `$copy` 路径，测试在原工作区短暂启动并随后终止；非隔离运行中观察到 2 个失败，主因为 Raw navigation fixture 和未配置 Provider HTTP 场景。它更新时间靠近本次执行的 `docs/reports/B04-http-evidence.json` 与 `docs/reports/KB02-R1-20261015-builder-merge.json`；两者未在本批编辑，且未从猜测的备份恢复。主 Agent需按其冻结的 1669 项保护清单核对字节并决定是否恢复。该失败运行不作验收证据；最终 233/233 来自哈希核对后的隔离副本。

恢复扫描只覆盖代码明确列出的 JSON 状态目录，并验证通用身份字段及 Prompt/job/raw-state/commit 的基础 shape；其它目录和更深的业务 schema 仍需验收探针确认。真实 Provider 的 Brief/六模板/真实桌面恢复尚未测，PA01-10 未完成；不得将 fake/selftest 结果当真实质量结论。未部署、未提交。
