# PDF01 revision 3 六页真实执行

沿用六页样本和原页映射 4、10、11、59、61、62，复用同一 Raw 及 R1。R2 使用 `gpt-6.1-terra` 和 `https://api.openai.com/v1`，一次安全配置加载。在新 TEMP 克隆中显式结束旧选择，归档 revision 2 检查点并执行 revision 3。克隆外的旧检查点、旧草稿及两份成果导出在执行前后通过 SHA-256 核对。[工程交接](PDF01-R2-CONSOLIDATION-20261110-builder.md)

| 累计请求 | 阶段 | 单元或标签 | 用户 JSON 字节 | HTTP 秒 | 输入 token | 输出 token |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 22 | 清理 | 48 | 6451 | 30.869 | 6569 | 2401 |
| 23 | 清理 | 48 | 6877 | 28.506 | 6754 | 2368 |
| 24 | 清理 | 48 | 7432 | 31.471 | 6862 | 2654 |
| 25 | 清理 | 23 | 3942 | 16.480 | 3582 | 1314 |
| 26 | 索引 | 16 | 6288 | 10.241 | 3152 | 775 |
| 27 | 索引 | 16 | 12594 | 8.823 | 4940 | 608 |
| 28 | 展示 | 47 | 8435 | 22.338 | 4059 | 1827 |
| 29 | 展示 | 45 | 9171 | 22.331 | 4280 | 1809 |
| 30 | 展示 | 31 | 5874 | 15.992 | 2910 | 1284 |

9 次均 HTTP 200 并通过生产校验。新增 43,108 输入和 15,040 输出 token，共 58,148。累计 30/50 次，102,316 输入和 41,857 输出 token，共 144,173，含第 11 次 `diagnostic_capture`。费用未知。

167 单元的清理处置为 136 保留、1 全同归并、30 略过。32 个中间主题生成 24 个候选，三批展示处理 123 个单元。5 个展示组共覆盖 23 个成员，另外 5 个组触发条件保护后按原样并列。草稿共保留 137 条页证据，ID `32c5d8d2-8119-415d-9369-10c4bea1c7e0`，状态待审核。实际运行正式 Wiki 写入 0。归并质量待独立评分。

## 执行证据

`./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real-consolidation-v3.mjs run <repo>`，回环 `NO_PROXY=127.0.0.1,localhost,::1`，退出 0。真实运行之前使用同版 `prepare` 和 `fake` 各一次，fake 在隔离账本模拟 4 清理、2 索引、4 展示，配置读取与真实请求均为 0。

TEMP 根 `pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。实际产物目录 `consolidation-v3-run-QySjme`，运行日志 `run-r2-consolidation-v3-command.txt`。实际模型内容留在 `response-evidence/`。旧 21 次账本字节在同一账本中作为前缀保留。

| 文件 | SHA-256 |
| --- | --- |
| `pdf-real-consolidation-v3.mjs` | `b461f14d7aea32bfebc631b3fb2a2ccd1031e6d7e63af9527fe74ebb91e98d3b` |
| `freeze-consolidation-v3.json` | `4eb1a54fe197ceb65e1f6b90684ec5ec3c8357fb7646f4ee99a46675de7015a8` |
| `consolidation-v3-release.json` | `b17610dcb18c300e821708974f3cd080627769b748f8927bb180ed8d7589567c` |
| `real-run/ledger.jsonl` | `7bdc6870f08e1fe8df5fdb897d65ddc94daf40be4971e3452cdf895c6d370c7d` |
| `real-run/r1.json` | `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48` |
| `r2-consolidation-v3.json` | `43c0a33f0d443f6ad3a6c778bcabd0b60e0b3e9d27341b4998871788cae94a63` |
| `draft-consolidation-v3.json` | `0f49a843918f255928f50385b18dcf00896b21f2d38d4bd174462b306a009009` |
| `consolidation-v3-summary.json` | `be9c3b7ecc3e07e04bbfeed099a5ac8dd30d8018c72e9d0924228ceB0833fa4b` |
