# PDF01 revision 4 原文子段真实执行

沿用同一六页样本、原页映射 4、10、11、59、61、62、Raw 和 R1。revision 4 在新 TEMP 克隆中复用四批成功清理及 167 条处置。每次真实调用前核对四批摘要 `812e9dafe936d35366ffd150f1568c6e836bf18abea613aed21300c3347d3f87`。旧账的 30 次请求原样保留，旧草稿和两个成果导出的摘要在执行前后核对。[工程交接](PDF01-R2-FRAGMENTS-20261112-builder.md)

| 累计请求 | 阶段 | 键或单元数 | 用户 JSON 字节 | HTTP 秒 | 输入 token | 输出 token |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 31 | 索引 | 16 | 4393 | 7.146 | 2054 | 378 |
| 32 | 索引 | 16 | 6020 | 9.633 | 2833 | 734 |
| 33 | 索引 | 16 | 8095 | 7.623 | 3160 | 591 |
| 34 | 索引 | 16 | 9411 | 6.573 | 3633 | 401 |
| 35 | 索引 | 16 | 10518 | 7.736 | 3838 | 521 |
| 36 | 索引 | 16 | 10449 | 6.768 | 3769 | 487 |
| 37 | 索引 | 6 | 7147 | 3.415 | 2466 | 158 |
| 38 | 展示 | 47 | 8719 | 21.943 | 4299 | 1770 |
| 39 | 展示 | 48 | 9463 | 25.202 | 4691 | 2114 |
| 40 | 展示 | 39 | 8549 | 21.991 | 3994 | 1824 |
| 41 | 展示 | 40 | 8162 | 22.601 | 4012 | 1877 |

11 次均 HTTP 200 并通过生产校验。新增 38,749 输入和 10,855 输出 token，共 49,604。累计 41/50 次，141,065 输入和 52,712 输出 token，共 193,777，含第 11 次 `diagnostic_capture`。费用未知。

74 个精确子段，102 个索引键，26 项待审核候选。21 个展示组覆盖 45 个成员，16 组触发条件保护后并列。候选共引用 150 条证据，按父单元去重为 137 条。草稿 `bf843811-4ed0-4161-864c-09ac7557c65d`。正式 Wiki 写入 0，R1 和清理模型调用 0。质量待独立评分。

## 执行证据

`./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real-fragments-v4.mjs run <repo>`，回环 `NO_PROXY=127.0.0.1,localhost,::1`，退出 0。真实运行安全加载配置一次，端点 `https://api.openai.com/v1`，模型 `gpt-6.1-terra`。同版 `prepare` 和 `fake` 各一次退出 0，fake 只连接本机 Provider，模拟 7 索引、4 展示，真实配置读取 0。

TEMP 根 `pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。实际产物目录 `fragments-v4-run-YCHzVn`，运行日志 `run-r2-fragments-v4-command.txt`，响应位于 `response-evidence/`。[上一版执行](PDF01-REAL-CONSOLIDATION-V3-20261112-execution.md)

| 文件 | SHA-256 |
| --- | --- |
| `pdf-real-fragments-v4.mjs` | `e1604c170721e64033789ab7a6e84edca6ec23a2083baf360f5ebf2a51464c97` |
| `freeze-fragments-v4.json` | `3de37522f76ca45e8316feb7a83759b25c9fc48ff3cc6ee1c444eba675dfa47c` |
| `fragments-v4-release.json` | `ae9c419c6bdeabb2d2025a557d13a028f4658a8fce8ce8c82310baca55b02b59` |
| `real-run/ledger.jsonl` | `94ad8b32923aac9fdeac6b73185f029e509647ef053b9e99d43a90c231962a2c` |
| `r2-fragments-v4.json` | `43162e0a5005feb18b5f977186a24a7d4e4eb90ea309505d85227ae430a4560e` |
| `draft-fragments-v4.json` | `e0f025dd39c86303fadda01b0f4ee054055afa1a79c7e01fb861a1ecf532c2b5` |
| `fragments-v4-summary.json` | `2719340af34f9255b1ac25e0db021f9d9c6c60e6502b2c268c8d5c6e51477ac4` |
