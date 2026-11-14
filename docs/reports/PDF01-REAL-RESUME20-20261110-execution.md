# PDF01 上限 20 的真实续测执行记录

同一六页样本、同一 Raw、同一 R1 结果和同一累计账本。初始 9 次请求与第一批 48 项均保留。本次工具仅在隔离 TEMP 中运行，使用 `gpt-6.1-terra` 和 `https://api.openai.com/v1`，正式 Wiki 写入 0。原件页映射仍为 4、10、11、59、61、62。[前次续测](PDF01-REAL-REPAIR-20261110-execution.md)

## 实际执行

| 累计请求 | 操作 | HTTP 耗时 | 输入 token | 输出 token |
| --- | --- | ---: | ---: | ---: |
| 10 | 严格结构输出返回，第二批首项 topic 长度校验失败，立即停 | 31.289 秒 | 2,496 | 2,507 |
| 11 | 同一请求体，仅捕获一次模型内容后停 | 30.141 秒 | 2,496 | 2,320 |
| 12 | 第三批清理，48 单元 | 28.009 秒 | 2,607 | 2,200 |
| 13 | 第四批清理，23 单元 | 13.622 秒 | 1,525 | 987 |
| 14 | 主题索引，15 个中间标题 | 7.935 秒 | 340 | 394 |

五次 HTTP 均为 200。累计真实 14/20，输入 30,957、输出 16,943 token，共 47,900。R2 持久尝试为 8，含本轮之前失败。费用未知。三次授权执行各安全加载一次 Provider 配置，模型、端点与配置文件保持原样。

第 10 次只保留了错误字段和长度分类，具体值未知。第 11 次实际 wire 与第 10 次逐字节同 SHA，结构为 strict、topic 可为字符串或 null、字符串长度 1–100。实际适配器返回 `structuredOutputApplied=true`。原样响应含 48 项，44 个保留项的 topic 为 8–15 个 UTF-16 单位，4 个略过项的 topic 为 null。全量经本机生产适配器和清理业务校验通过，同输入克隆实际落盘第二批。随后在获准的真实运行根以同一适配器原样回放，新增真实请求及重复计费均为 0。第二批摘要与离线通过的结果相同，才发第 12 次。

本机对照验证 `skip + topic:null` 通过，可选空值未误验。空字符串与超长值在 strict wire 校验即失败。普通空白进入独立业务错误，100 个非 BMP 代码点若含 200 个 UTF-16 单位会被现长度校验拒绝。这些对照可复现同类错误，仍不能还原第 10 次的原响应。

最终 4/4 批、167 项处置，132 保留、2 归并、33 略过。15 个主题生成 15 个候选，草稿 `6f2fe3cf-339b-41d7-a62b-13aad45fb2d4`。真实执行完成已交独立质量评分。

## 命令及证据

TEMP 根 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。

- 三次使用 `NO_PROXY=127.0.0.1,localhost,::1`，执行 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/<工具> run <repo>`。工具依次为 `pdf-real-resume20.mjs`（退出 1）、`pdf-real-diag11.mjs`（捕获后退出 0）、`pdf-real-replay11.mjs`（草稿完成后退出 0）。
- 三个冻结 `freeze-resume20.json`、`freeze-diag11.json`、`freeze-replay11.json` 的 SHA-256 分别为 `0622c1be588148a92faec538ef3f46c82e8ad280999a1cc00bcc63b4e3110451`、`dd7afc6d5751627b1002a766e493037f860d7206f2398abddcf72e106d85c119`、`53b9ab21767a29b028a63d54f488ade8fbbc908dc13f893954c9594006d324a1`。各阶段先通过本机 prepare/fake 和独立核对，再签发阶段 release。
- 本机长度对照在 `length-diagnosis-local.txt`。第 11 次内容仅留 TEMP 的 `diag11-run-pLl7Gx/provider-content.json`，SHA-256 `299480b544ded81a53033318864c45af4acc7e3d6e5eee49e162664b7638ecf7`。原样回放摘要为 `diag11-offline-replay-final.txt`。
- 最终 `real-run/ledger.jsonl` SHA-256 `47ece6013c86517cd44f744cf18dd741db146c490ac54eed51bddbe9ac5bda7b`，原 11 次的 7,690 字节前缀仍为 `e984a0c9b00bb9c6ca3ca4481cd00d0b5cfa8d4e0363969d46663e66b77e6e5c`。首批和原样回放第二批的持久 SHA-256 分别为 `346ad1d435d9fb74cc6c54abfe775a502a8ebf98e03cc9ca3a3b32993de0b6c3` 和 `1643b39b5906af814c33d0dfdb8ca9654ccf5f0822c40a6a9125147d40450424`。
- `real-run/r2-replay11.json` SHA-256 `51421b0c3996bd3dbd0568373bb6c8eb06016b6cd1885fa6734984b616f70e20`。`real-run/draft-replay11.json` SHA-256 `9ae8582128b916e90c1a10655e822c29db050bf2b42ace09bdc94d166d9f2676`。新响应正文只留在 TEMP 的 `real-run/replay11-response-evidence`。
- `real-run/r1.json` SHA-256 仍为 `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48`。本轮仅新增隔离工具和执行证据，产品及正式资料保持原状，未提交。
