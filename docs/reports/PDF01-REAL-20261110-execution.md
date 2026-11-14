# PDF01 六页真实质量验收执行记录

原 PDF 共 62 页。使用 TEMP 样页 1–6 对应原页 4、10、11、59、61、62。每页的产品 PNG、渲染像素及文字层均与原页核对一致。原件 SHA-256 为 `6751b15e5ccaf5a126363571d4ea9fcb2c5a237e53fbb97026449f2864bcdbb7`，子集为 `f76c5efdda32e957e2e1d281e0f87c79fb69df09281c2854d19ee02877ce9d3d`。取样映射与预览留在 TEMP。[冻结任务卡](../handoffs/PDF01-REAL-20261110-task.md)

真实阶段使用当前已配置的 `https://api.openai.com/v1` 和 `gpt-6.1-terra`。用现代理启动，回环直连。预检及两个执行阶段各安全加载一次配置，共三次。请求发送前记账并 fsync，禁重定向，两个阶段使用同一 Raw 和累计上限 12 的账本。生产导入、PDF 路由、R1/R2 服务和 Provider adapter 均实际执行。正式 Wiki 写入 0。

## 执行结果

| 阶段 | 请求 | HTTP 耗时合计 | Provider prompt tokens | Provider completion tokens | 持久结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| R1 图文理解 | 6 | 52.088 秒 | 14,557 | 2,140 | 6 页全部保存，独立抽样评分 19/20 |
| R2 清理 | 1 | 19.124 秒 | 2,164 | 1,498 | 第一批失败，完成 0/4，无草稿 |
| 合计 | 7/12 | 71.212 秒 | 16,721 | 3,638 | 全部 HTTP 200，未重试 |

费用未知，未取得可信账单。R1 正常退出并停在 6 次，按实际结果估算 167 单元、4 个清理批次和至少 1 个索引批次。收到独立 R1 评分和阶段放行后才执行 R2。R2 请求 7 带 48 个单元，涉及原 4、10 页。Provider 返回 `finishReason=stop`，生产结构校验拒绝结果，退出 1。此轮无法评 R2 内容质量。

工具轮询末次曾收到 `PDF_CLEANUP_INTERRUPTED`。退出后用生产服务只读回查，真实持久结果为 `failed / PDF_CLEANUP_SCHEMA`，完成 0 批，草稿 0，正式 Wiki 0。现 GET 在读取任务快照与检查进程 active 状态之间仍需等待来源读取，读到旧运行快照时可能短暂误报中断。请求 7 已通过响应 JSON 解析，失败发生在决策数组形状或任一决策字段校验，早于覆盖和归并语义校验。本次 R2 没有传 Provider 结构化 schema。原始失败响应正文未保留，具体拒绝字段未知。

## 可复查证据

TEMP 根 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。

- 工具 `pdf-real.mjs` SHA-256 `f3512c3a89b0d6696c72592c23b8cda0dfcdd6bf27912380e7694551df84d9a9`，`freeze-v2.json` SHA-256 `ed4258aa9c86be16f83b609967ae41dc1ad631894ee09233153a70f9dc3883e7`。
- `release.json` SHA-256 `d453fa492d3b9e2bc2387ad693f23aba6dda887cf068d2920dcda747a9c8541f`。R1 独立通过后签发的 `r2-release.json` SHA-256 `24c75e1b8552a9830a69fe37b2c1cfde738022e9a1096ffd605da868879ed15e`。
- `real-run/r1.json` SHA-256 `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48`。最终 `real-run/ledger.jsonl` SHA-256 `a2b51fd1cc4db0af621e63ab893aace1f843705242e4bbb7a0140e2db3981bd2`。失败的清理检查点 SHA-256 `5023709b1803b44c3281df15b11ff07dd2017b79f53f2e428f8299befee4749d`。
- `node --check <TEMP>/pdf-real.mjs` 与 `node --import tsx <TEMP>/pdf-real.mjs prepare <repo>` 通过。最终版 `fake <repo> r1` 只发送 6 次，独立新进程 `fake <repo> r2` 同账本累计 11 次并生成隔离草稿，0 正式 Wiki。预算不足的 `fake <repo> budget` 于 6 次后停且没有清理请求，故障的 `fake <repo> failure` 于第二次 HTTP 503 后停。
- 真实命令分别为 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real.mjs run <repo> r1`（退出 0）与同命令末参数 `r2`（退出 1）。均用 `NO_PROXY=127.0.0.1,localhost,::1`。原始执行摘要为 `run-r1-command.txt`、`run-r2-command.txt`。

本轮保留原件、已完成的 R1 结果及失败检查点。首个失败后保持账本在 7 次。本轮产品代码、用户服务和正式资料保持原状，未提交。
