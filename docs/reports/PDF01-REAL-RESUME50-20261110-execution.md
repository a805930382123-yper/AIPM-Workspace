# PDF01 累计 50 次授权下的续测执行

沿用六页样本、原页映射、Raw 和 R1。第 18 次的实际响应先在克隆中经生产校验原样回放。此次授权执行再次核对同一 wire、响应内容及第三批摘要，生产校验正常落盘后才发送第 19 次。回放新增真实请求及重复计费均为 0。前两批、旧四批与旧草稿保留。[此前执行与 Unicode 修复](PDF01-REAL-QUALITY-V2-20261110-execution.md)

| 累计请求 | 操作 | HTTP 耗时 | 输入 token | 输出 token |
| --- | --- | ---: | ---: | ---: |
| 19 | 末批清理，23 单元 | 19.882 秒 | 3,582 | 1,365 |
| 20 | 索引第一批，16 个中间主题 | 9.045 秒 | 1,285 | 601 |
| 21 | 索引第二批，7 个中间主题 | 5.110 秒 | 774 | 282 |

三次均 HTTP 200 并正常结束。本次新增 3 个请求，输入 5,641、输出 2,248 token。累计 21/50、输入 59,208、输出 26,817 token，共 86,025。费用未知。配置安全加载一次，模型和端点仍为 `gpt-6.1-terra` 与 `https://api.openai.com/v1`。

实际完成 4/4 批，167 项处置，136 保留、1 归并、30 略过。23 个中间主题生成 21 个草稿候选，TEMP 草稿 `48189d3f-83ae-4ee1-a766-621e11e23416`。没有确认入库，正式 Wiki 0。独立评估使用原冻结 gold。

## 运行与证据

- 现有代理命令 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real-replay18.mjs run <repo>`，回环 `NO_PROXY=127.0.0.1,localhost,::1`。实际退出 0。工具 SHA-256 `3c2436c160113b60b635ecfe4551413a85e82b1678aaf443c2ddf8a189ef0110`，冻结 `4107840fa30f73616d6ccb3d0a52d4b164da9e310953c82378d61729bef800f7`，release `6b42226f0d1810094602e8512a2cf42ecce4814a07e238f9559134b3c145c218`。
- 同版 `prepare` 与 `fake` 通过。副本 `replay18-fake-AFZTZZ` 同账从 18 经原样回放后仅新增 19–21 并生成草稿。施工及 fake 期间真实请求与用户配置读取 0。
- TEMP 根 `pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。实际产物在 `replay18-run-xKgby4`。原始响应只留 `response-evidence`。执行摘要为 `run-r2-replay18-command.txt`。
- `real-run/ledger.jsonl` SHA-256 `b3c4f7c1321c9c524585b083c66cc6758bc2bb088d74f6e672b867e1235a02d5`。前 18 次的 13,754 字节 SHA-256 仍是 `4ecd5501bdc3c2c747140af29eaddf326aa3bb4bb8e378d1dd85a3be1f158cf7`。第三批 SHA-256 为离线验证时的 `f10bc7a6b48b13a52f64bdc1755648407799dd4d06f931ef47854dce82dafac0`。
- `r2-replay18.json` SHA-256 `c504a1df210e9803fd585e7a0b71e6558d63fc02026f04acfb4ab241b91f6f35`，`draft-replay18.json` SHA-256 `0fcba73b78a7fc7459e5d3eb10dfe5755d3fa7b74ac7d5e50c324326b7b98242`。R1 SHA-256 仍为 `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48`。

本次仅新增 TEMP 执行工具和脱敏记录。产品代码、用户服务、配置文件及正式资料保持原样，未提交。
