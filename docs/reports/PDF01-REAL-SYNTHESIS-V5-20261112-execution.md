# PDF01 revision 5 写作真实执行

以冻结六页样本和同一 Raw 在 TEMP 克隆启动一次。R1、四批清理、102 个索引键和 74 个片段复用。首次失败立即停止，正式 Wiki 写入 0，配置安全读取 1。模型 `gpt-6.1-terra`，端点 `https://api.openai.com/v1`。[工程交接](PDF01-R2-SYNTHESIS-20261112-builder.md)

| 累计请求 | 主题及输入 | HTTP 秒 | 输入 token | 输出 token | 结果 |
| --- | --- | ---: | ---: | ---: | --- |
| 42 | 4 题、47 项 | 22.280 | 5159 | 1570 | HTTP 200，首批持久化 |
| 43 | 4 题、21 项 | 12.306 | 2696 | 935 | HTTP 200，数字比较拒绝，停止 |

累计 43/50，新增 7,855 输入和 2,505 输出 token，共 10,360。累计 148,920 输入和 55,217 输出 token，共 204,137，含第 11 次诊断。费用未知。完成 1/7 批，尚无新版草稿或质量分。

离线按实际请求和生产函数复算，第 43 次仅 `$.topics.t5.blocks[0]` 缺 `quantity:1.1`，没有额外 token。两个输入中的 `1.1` 分别是原文小节标题编号和图解中对应的章节引用。输出保留大盘韧性和渠道增长等实质内容。原响应保留，真实请求在 43 停止。

执行命令 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real-synthesis-v5.mjs run <repo>`，回环 `NO_PROXY=127.0.0.1,localhost,::1`，退出 1。`prepare`、隔离 `fake` 均退出 0，fake 七批无真实调用。TEMP 根 `pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`，产物 `synthesis-v5-run-oeTK9m`，日志 `run-r2-synthesis-v5-command.txt`，原响应在 `response-evidence/`。

| 文件 | SHA-256 |
| --- | --- |
| `pdf-real-synthesis-v5.mjs` | `97a724f5f5c02f08ee9b5f76eac7e957a15394a0e9a1bdbef99cebbfc06da1ff` |
| `freeze-synthesis-v5.json` | `63f77a6ac56c4ec4090c984283ae5afabaee9acf9a1c49da817c852387322d24` |
| `synthesis-v5-release.json` | `97004d47ec21c8de388f4b71bde934ddc70f530f8579239b0d3c8d19f0322a12` |
| `real-run/ledger.jsonl` | `f96617e3614a349c631e4e485d7f079656eb34516ab9b331ec1e6e95d45e5f36` |
| `response-42.json` | `8f9e8f8de9584250fa9294ae898ae443f660a1dc683ee7039cf38c9fe98e0a17` |
| `response-43.json` | `163a14c9cafe4b20f73d10087da07ff193e15c9c795ddbd04f26376236e83caa` |
| `synthesis-v5-summary.json` | `8eb30f014261e7ec2fa16db5b131165e17b981a74bca52bc90161cb0597e992c` |

## 首次续测到第 44 次

独立核验后，`pdf-real-synthesis-replay43.mjs` 在同账原样回放第 43 次。该回放新增真实请求和 token 均为 0，第 42 次保存结果 SHA 保持。第 44 次发送第三批 4 题、17 项，用户 JSON 3,265 字节。HTTP 200，12.888 秒，输入 2,424、输出 904 token，生产校验拒绝后立即停止。累计 44/50，输入 151,344、输出 56,121，共 207,465 token。两批已持久，尚无新版草稿。

实际 TEMP 根 `synthesis-replay43-run-vqL91k`。第 44 次响应 SHA `d49e15f6ad47d7cf290a4a7abae7a3984743d0e7c3a940fb42a7d1323471074b`，冻结失败检查点 SHA `9decec74ccb88be2f692c1b608319253a0937e1c5bf7dad6bb76197cfb919982`，当时账本 SHA `fc806358dc8b23ae7e1be359b29e70933d4beb870e13732b928030f33118d4fd`。工程复盘定位同页章节标题编号及连续段时代关系，原样离线回放已通过。[后续修复](PDF01-R2-SYNTHESIS-20261112-builder.md)

## 续测到第 46 次

第 44 次原样复用后，第 45 次向模型发送 4 题、18 项，用户 JSON 2,894 字节。HTTP 200，13.290 秒，2,319 输入、801 输出 token。结果省略五个题头，被元数据边界拒绝。诊断确认待审内容保留跨页覆盖规模、年度商户、日订单峰值、活跃用户和主体自述。

修复后第 45 次原样复用。第 46 次为 4 题、36 项，用户 JSON 6,441 字节。HTTP 200，23.825 秒，4,335 输入、1,418 输出 token。唯一差异是原文解析将同页页码粘到指标释义末尾。模型保留释义，校验因该数字中止。累计 46/50、157,998 输入、58,340 输出，共 216,338 token，4/7 批已持久，正式 Wiki 0。原样离线复验第 42–46 次全部通过。[后续修复](PDF01-R2-SYNTHESIS-20261112-builder.md)

第 45 次响应在 `synthesis-replay44-run-SAoqQH`，SHA `0ec538cb956ddd7768badd2ee5d382f4dbf3f29574b9e02415bc486473217442`。第 46 次响应在 `synthesis-replay45-run-2JiQVw`，SHA `fc80690cab7abe63430b1b0cd1dafba815ca03dc9946eabae1cd8f752c34a7e3`。第 46 次停止后的账本 SHA `5e2b4a6ce278592b084f916d2a7946e218727591d6387e76e37d5f5b06797c99`，检查点 SHA `ac80399ece51cda1ccce6a87edc05bd0f7c111f2c49aee9dad2fed5a0844c218`。

## 七批完成

第 46 次原样复用后，第 47 次发送 4 题、41 项，用户 JSON 6,509 字节。HTTP 200，19.101 秒，4,618 输入、1,509 输出 token。格式边界拒绝了独立表头和版面描述，离线复盘还确认同一线级区间、人员样本量和断开的美元单位属于等价写法。原样回放修正后通过。待独立评分的条件措辞差异保留在原响应中。[工程交接](PDF01-R2-SYNTHESIS-20261112-builder.md)

第 47 次原样复用后，第 48 次发送最后 1 题、1 项，用户 JSON 321 字节。HTTP 200，8.027 秒，489 输入、83 输出 token。七批均已持久并形成草稿 `7783e9d3-f2f2-45fa-85d4-5e13c7704081`，23 项候选，147 条证据引用，按原父单元去重为 136 条。25 个写作主题共 181 项覆盖归属，131 项写入、35 项重复归入有依据的段落、15 项元数据留台账。表格、原推断和问题仍使用本地路径。正式 Wiki 写入 0。

revision 5 合计 7 次真实写作，22,040 输入和 7,220 输出 token，共 29,260。累计 **48/50**，163,105 输入和 59,932 输出 token，共 **223,037**，含第 11 次诊断。费用未知。6 个实际启动阶段各安全加载配置一次。第 43–47 次原样回放的新增真实请求与 token 均为 0。真实质量交独立验收。

最终真实命令 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/pdf-real-synthesis-replay47.mjs run <repo>`，退出 0。实际 TEMP 产物 `synthesis-replay47-run-tjjRsm`，运行日志 `run-r2-synthesis-replay47-command.txt`。原始响应只在各阶段的 `response-evidence/` 中保留。原第 47 次响应在 `synthesis-replay46-run-vZNg8b/response-evidence/response-47.json`。

| 文件 | SHA-256 |
| --- | --- |
| `pdf-real-synthesis-replay47.mjs` | `adfd52c4a88664451a1b13fa4faf0c619e7adc09fdb10ce72e1716cb726ecf65` |
| `freeze-synthesis-replay47.json` | `e73b4fded247128088e297d38583c8a7e7bdb098cf0f49c42eaac56ad64dd20f` |
| `synthesis-replay47-release.json` | `60a43b5b148ed3fc0650e7bdac13906de8f868402a10f66ad14f39b1e5718244` |
| `real-run/ledger.jsonl` | `8017f12c344cb239466d29fe3478231b00395c8abbbab3ad8402db3b168db4f5` |
| `r2-synthesis-replay47.json` | `e53534ec3b0032ef34a4fad6e8e13594cc961dfbbc1cb4ce2f372e688340ee27` |
| `draft-synthesis-replay47.json` | `56329962e0b00d8f87fb2db2cb711d8193f746a4e3405d0c4e0167f7ad04acd8` |
| `synthesis-replay47-summary.json` | `290555affa0429f2e253c22860c0ba913a5fb92b877be54cd31d0eefd0af3039` |
| `response-48.json` | `499fcbbf52a2d10767d0b36a924473149d5f82be3cf860561ede3fabf8284fe7` |
