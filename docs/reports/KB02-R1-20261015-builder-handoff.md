# KB02 R1 builder handoff — 2026-10-15

施工范围按 `docs/batches/KB02-R1.md` 执行。主 Agent 负责独立验收；本文与本轮 builder 日志只记录自测，不构成验收签字。

## 改动

- `services/llm/checkpoints.ts`：严格校验检查点的顶层与嵌套结构、chunk/fact/question/locator/page 引用；限制文件读取和序列化大小，采用文件句柄分段读取到 EOF 或 MAX+1，拒绝损坏/超限记录并 fail closed。保存前也执行结构和大小校验。
- `services/llm/knowledge-extraction.ts`：恢复前校验 Raw 摘要、pipeline/rules 版本、chunk 描述、事实和问题的唯一且分块绑定 ID、locator 与事实/问题引用；已保存证据 ID 必须与预期定位集合一一相等。含秘密或不兼容的恢复以 409 拒绝。存在 plan 时必须覆盖全部 chunks，所有 facts/questions 各分配一次。精简和整篇规划提示限制为业务事实、原文明示未知，并禁止为排版/说明创建独立页。解析错误使用脱敏诊断形状；响应截断仍拒绝。
- `services/llm/jobs.ts`：恢复预检先于 job/Raw 状态变更和 Provider 调用；job `completed` 不读取历史检查点，避免旧 rulesVersion 阻断已完成 Raw 的新提取。未完成 job 读取其 checkpoint：非 `done` checkpoint 经过累计调用预算、版本、Raw、秘密、证据和完整性校验后续跑；恢复拒绝不写状态。无活动草稿时，`done` checkpoint 开新 job。活动草稿仍优先对账，以覆盖发布/草稿落盘之间崩溃后的恢复，避免重新发布。
- `services/llm/rules.ts`：将新提示修订号加入 rules/cache identity，旧草稿仍可读取，旧中间结果不会与新提示混用。
- 产品文件共 4 个：`services/llm/checkpoints.ts`、`services/llm/knowledge-extraction.ts`、`services/llm/jobs.ts`、`services/llm/rules.ts`。测试迁移文件为 `tests/kb02-pipeline.test.ts`、`tests/llm-flow.test.ts`、`tests/llm-http.test.ts`、`tests/llm-repair.test.ts`、`tests/llm-repair2.test.ts`、`tests/llm-repair3.test.ts`、`tests/llm.test.ts`、`tests/ui-b04.test.tsx` 与 `tests/support/fake-llm.ts`。fake 的标题/问题元数据按 Raw run 和 chunk 隔离，规划载荷按全量事实/问题匹配；相同事实跨 chunk 不会覆盖页元数据。

## 断言迁移

- 新提取草稿明确断言 `ai_organized` / `ai_inferences` 为空。F04-07 随后通过正常 `drafts.patch` 为两侧写入不同的人工整理和推断，合并检查两侧值均保留、事实仍只在来源事实中，并在已确认 Wiki 正文检查两侧推断实际落盘。未删除原合并/确认/证据语义。
- 长文断言从旧的 chunk-summary merge wire 转为真实 planner 输入覆盖全部 fact/question ID、事实恰一次组装、最终 locator 引文可按 Raw 全局范围核验、末尾 chunk 覆盖；不要求旧 merge 不再生成的摘要字段。
- locator 断言改为服务端稳定的 `cN-lNNN` ID；UI processing 进度断言改为当前“提取精简事实 / 已验证 X/Y 段”文案。旧 Direct LLMService 契约仍单独保留。

## 实测

- `tsc -b`：临时字节副本退出码 0。
- `node tests/acceptance/kb02-r1-20261015-builder-tests.mjs`：脚本将产品、测试和规则复制到独立临时目录，并用 `process.execPath` 执行 `tsc -b`、Vite build 和 `node:test`。Build PASS；33 个测试文件、231/231 PASS，0 fail、0 skip。
- 最终日志/汇总：`KB02-R1-20261015-builder-build.log`、`KB02-R1-20261015-builder-tests.log`、`KB02-R1-20261015-builder-verification.json`。此前 8 个文件定点运行 66/66 PASS；全套是包含其后的 checkpoint stage/status 调整及 F04-07 落盘断言的最终版本验证。

## 未验证和交接边界

未发送真实 Provider 请求；短文/补充/长文的实际输出质量、真实 Provider 截断/兼容及真实更新主线仍由主 Agent按21次剩余预算执行。自测不代表真实质量 PASS。临时 harness 未启动正式产品服务，未读写实际 `.env.local` 或正式 workspace，也未改依赖/锁/ACL/全局 Git 配置。原有报告与 acceptance 脚本未修改。

施工 Agent 现在停止所有产品和产品测试文件写入，交由主 Agent冻结并独立验收；后续返修以新的明确指令为准。