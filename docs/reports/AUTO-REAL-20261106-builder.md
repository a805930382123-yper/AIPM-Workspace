# AUTO-REAL 验收工具施工交接

Sol High `/root/auto02_builder` 已完成工具施工和离线验证，交由 `/root/auto02_review` 独立核对和执行。产品基线 `5717c9589c9f7a93f7306cebd4b6f62cdba01a5e`。本次改动为 [验收工具](../../tests/acceptance/AUTO-REAL-20261106.mjs) 与此交接。工具 SHA-256 为 `da87120b2a8df667d713245419a5c2254ef425078ea1a5226f8c6e4101430b64`。

- `prepare` 只用 fake 在固定忽略目录生成 A、B、R、原 A 草稿与已完成检查点。写入工具、产品及合成资料文件 SHA，返回本次 manifest SHA。`run` 需要该已核对的 SHA 及明确的 `direct` 模式，先核对原数据及工具版本，再按安全摘要核验 Provider。
- 工具调用产品 `ExtractionRunner.prepareChange`，在发送前校验请求只含 R 的原主题、证据与 B 的快照，精确核对原句位置，并验证 A 及 `priorCandidate` 未进入请求。独占的 `ledger/attempt-01` 目录预留一次，进程中断时仍计额度。专项额度为 2，此工具的冻结执行计划仅第一样例 1 次，不提供同样例重复或自动重试。
- 保存不含密钥的配置摘要、请求、原响应或脱敏标记、原样候选和执行结果。实际候选保留目标和来源等结构校验，同时对照隔离知识目录和提交清单的字节指纹。候选就绪后由独立验收者逐项核语义，工具不宣告真实质量结论。

```powershell
node --check tests/acceptance/AUTO-REAL-20261106.mjs
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs offline
git diff --check
```

三条施工命令均退出 0。离线覆盖实际 Runner 与 Provider 适配器的合法候选、传输失败、无效 wire 和 JSON 转义凭据回显。每种只拦截一次合成请求，已预留、失败及无结果的挂起预留均拒绝再发。失败保留原草稿，成功与失败均保持隔离知识及提交集合指纹，回显响应只保存脱敏标记。施工配置读取 0，真实请求 0，固定实测目录尚未创建。历史账本、正式 workspace 及用户运行服务隔离。

独立复审命令如下。先核对工具指纹和 fake 结果，再将 `prepare` 返回的 manifest SHA 交主线程核准。真实 `run` 使用已确认的本机直连和单次网络许可。

```powershell
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs offline
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs prepare
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs run <manifestSha> direct
```
