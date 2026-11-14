# PDF01 真实清理返修续测执行记录

同一六页 TEMP 样本、同一 Raw 及既有 R1 结果。工程和工具独立验收后，按阶段释放从第 8 次开始，只续 R2，累计上限 12。[工程施工证据](PDF01-REAL-REPAIR-20261110-builder.md)

`NO_PROXY=127.0.0.1,localhost,::1`，执行 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real-repair.mjs run <repo>`。使用 `https://api.openai.com/v1` 和 `gpt-6.1-terra`，本次安全加载配置一次。底层真实发送前持久记账，禁重定向。命令退出 1。

| 请求 | 样本所涉原页 | 结果 | HTTP 耗时 | 输入 token | 输出 token |
| --- | --- | --- | ---: | ---: | ---: |
| 8 | 4、10 | HTTP 200，第一批通过并落盘 | 35.837 秒 | 2,295 | 2,634 |
| 9 | 10、11、59 | HTTP 200，第二批首条主题名称校验拒绝 | 27.088 秒 | 2,477 | 2,263 |
| 续测合计 |  | 2 次，失败后停止 | 62.925 秒 | 4,772 | 4,897 |

实际持久状态为 `failed`，R2 本地尝试 3 次含原第 7 次，完成 1/4 批。首批保存 48 条归属，42 保留、6 略过，两主题。第 9 次经 strict 解码与 schema 后，在 `$.decisions[0].topic` 得到 `invalid_title`，保留原 `PDF_CLEANUP_SCHEMA` 错误码。本次诊断没有回显模型文本，具体坏值未知。读回显示实际失败原因。

累计真实请求 9/12，Provider usage 为输入 21,493、输出 8,535 token，费用未知。余 3 次，完成仍至少需要 3 次清理加 1 次主题索引。草稿 0，正式 Wiki 0，R2 真实内容质量未完成评估。保留原 R1 独立结论。

## 证据

TEMP 根 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。

- `repair-release.json` SHA-256 `fcb36762661345ba82e142c2e1d9a64578c98caab6e71c468e4a0779017ba006`。`run-r2-repair-command.txt` 为执行摘要。
- `real-run/ledger.jsonl` SHA-256 `d4b6d921b95db483512f6f8e0b794174c658abf29cf85c107d78d3a6ad441598`。原 7 次的 4,521 字节前缀 SHA-256 仍为 `a2b51fd1cc4db0af621e63ab893aace1f843705242e4bbb7a0140e2db3981bd2`。
- `real-run/repair-summary.json` SHA-256 `84ee8e6bc6fcdea47a0a4294a67283e2623e5a539c7bae5748a44580d24d377`。当前清理检查点 SHA-256 `498b60ef973083700b5b0bd7c7909b5a25739837d56424513f0d6d5df5021f00`。
- `r2-initial-failure-preserved.json` SHA-256 `5023709b1803b44c3281df15b11ff07dd2017b79f53f2e428f8299befee4749d`。`real-run/r1.json` SHA-256 仍为 `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48`。
