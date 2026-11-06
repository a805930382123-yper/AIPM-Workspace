# AUTO-REAL 独立验收

2026-11-06。产品基线 `5717c9589c9f7a93f7306cebd4b6f62cdba01a5e`。GPT-6.1 Sol High `/root/auto02_review` 冻结并独验，另一 Sol High 实例 `/root/auto02_builder` 施工工具。验收核对施工报告和工具 SHA，工具 SHA-256 为 `da87120b2a8df667d713245419a5c2254ef425078ea1a5226f8c6e4101430b64`。本次产品目录与基线一致。[冻结卡](../handoffs/AUTO-REAL-20261106-task.md) · [施工交接](AUTO-REAL-20261106-builder.md)

## 两层结论

- **工具及执行门禁 PASS。** 独立离线四条路径通过。合法候选可读回，传输和结构失败保留草稿，凭据回显响应仅保留脱敏标记，已有预留或中断挂起时拒绝再发。生产 Provider 发送前核对冻结文件和合成数据、预留一次账本。实际工具配置加载 1 次，计入主线程先前摘要检查共 2 次。历史 LW-REAL 10/12 记录保留，本机未读写其原账本。
- **真实目标切换样例 PASS。** 实际 `ExtractionRunner.prepareChange` 通过现 `reprepareMaintenance` 发送一次合成请求，响应通过产品结构校验，候选满足全部冻结语义判据。本次独立额度 **1/2**。第二次无必要，已停止。结论限于这份合成样例。

## 真实候选核对

| 判据 | 结果与证据 |
|---|---|
| 目标、覆盖与证据 | 仅一项 `update`，`pageIndexes=[0,1]`，目标为 B，baseRevision=1。候选来源精确为 B 的旧 Raw 加本次 R。实际输入的 3 条证据位置均按 R 原文字符核对。正文引 `c1-l001`（0–61）的一段含 2026 年数量、负责人、上线及收益状态，全部能在同一证据找到。待核段引 `c1-l002`（61–82），准确指向是否纳入演示店。原 A 的目标、来源、东岸 33 家及培训说明未进入请求或候选，请求无 `priorCandidate`。 |
| 旧内容和分年口径 | 2025 直营城区样本 100/80 与 2026 直营试点样本 120/90 在候选正文分段。原人工要求按各年范围并列、不跨年相加、开业须经首单验收均保留。未生成同比、总量或替代分母。 |
| 否定、未知与待核 | 回访负责人未指定、AI 工具未上线、试点收益未核验，三个状态均原义保留。演示店是否纳入仍单列待核。未出现额外人物、指标或结果。候选的结构化 questions 有同一待核问题的两种表述，正文只列一次，含义不冲突，未触及冻结判据。 |
| 隔离与正式写入 | 7 个隔离 knowledge 文件（含 A/B Wiki、Raw 及索引）与冻结数据 SHA 一致。正式事务集合 0→0，结果保存于原待审草稿。正式 workspace、真实配置文件和用户服务均未修改。 |

## 实际命令与证据

Node v25.2.1。仅 TCP 验证直连 `api.openai.com:443` 成功，无 HTTP 或模型请求。正式执行在已核验主机上直连，代理模式关闭，拒绝跳转。安全配置摘要显示 local-file、`api.openai.com`、`gpt-6.1-terra`，与冻结身份一致。该次响应 8,895 ms、1,399 bytes、finishReason=stop，实际应用结构化输出。

```powershell
node --check tests/acceptance/AUTO-REAL-20261106.mjs
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs offline
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs prepare
node --import tsx tests/acceptance/AUTO-REAL-20261106.mjs run feb18e1e49701ef7182fc6c0a3705ce8790242b46b7355215ffeef8f18bb3df7 direct
git diff --quiet -- app server services
```

以上命令均退出 0。离线拦截四次合成调用，真实 0 次。prepare 以 3 次 fake 建立两主题原草稿，实际冻结 12 个工具和相关代码文件、11 个合成数据文件，真实 0 次。run 返回 candidate-ready，实际账本仅 `attempt-01`。独立逐句判定后才标样例 PASS。

完整账本保留在本机忽略目录 `node_modules/.cache/auto-real-20261106`。报告附上同 SHA 的三份合成材料，均经过工具凭据检查。[实际请求](AUTO-REAL-20261106-evidence/request.json) · [真实响应](AUTO-REAL-20261106-evidence/response.json) · [最终候选](AUTO-REAL-20261106-evidence/candidate.json)

下表 SHA-256 对应实际文件。

| 文件 | SHA-256 |
|---|---|
| `manifest.json` | `feb18e1e49701ef7182fc6c0a3705ce8790242b46b7355215ffeef8f18bb3df7` |
| `config-read.json` | `67da87c50d7b12d922a81edd84743547a32febf7c23207fc4679d8d8011f4e97` |
| `ledger/attempt-01/reservation.json` | `4040613af96be5ecb4de34159038509f2777ea7662d7d765804ddfd58371339f` |
| `ledger/attempt-01/request.json` | `9d43bc5f9a24b6033991eac0aaea45bfaa58c61dca478a387994b56c9bdf8b02` |
| `ledger/attempt-01/response.json` | `13940a6d7d652878ef1f0c08d47b90393bbb4247757ce51a74dca37b654971c2` |
| `ledger/attempt-01/candidate.json` | `0e1504d8096ba2cd4b27482b6a3ec082525e653432226fd8b6d50dda592ed4bd` |
| `ledger/attempt-01/outcome.json` | `8a9d7831d68f88f4310987f7017073b583eb1c0e3b84a36331cc12c271fddd32` |

验收停写。完整真实提取、规划、deep/长文和正式入库不在这次质量验收范围。
