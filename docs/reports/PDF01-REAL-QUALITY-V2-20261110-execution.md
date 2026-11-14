# PDF01 语义提示与严格覆盖真实复验

原六页样本、Raw 和 R1 图文结果沿用。真实执行使用 `gpt-6.1-terra` 和 `https://api.openai.com/v1`。新提示在 TEMP 克隆全量清理，原 R1、旧四个清理批次和旧 15 项草稿保留，正式 Wiki 0。每个阶段各安全加载一次现配置，两次真实执行共两次。[语义提示施工](PDF01-REAL-QUALITY-V2-20261110-builder.md) · [此前真实执行](PDF01-REAL-RESUME20-20261110-execution.md)

| 请求 | 实际结果 | HTTP 耗时 | 输入 token | 输出 token |
| --- | --- | ---: | ---: | ---: |
| 15 | 提示 v2 第一批输入 48，只返回第一项，覆盖拒绝并停止 | 8.734 秒 | 2,425 | 294 |
| 16 | 动态严格必需键，第一批完整落盘 | 34.203 秒 | 6,569 | 2,422 |
| 17 | 动态严格必需键，第二批完整落盘 | 26.509 秒 | 6,754 | 2,145 |
| 18 | 48 个键全部齐，首项 topic 被 UTF-16 长度误拒，立即停止 | 33.591 秒 | 6,862 | 2,765 |

上述四次均 HTTP 200、Provider 正常结束。本轮新增 4，累计真实 18/20、输入 53,567、输出 24,569 token，共 78,136。费用未知。实际真续测保留 2/4 批，未生成新版草稿。没有第 19 次请求。

## 证据与修复

- 第 15 次返回 1 个已知 ID、遗漏 47 个，无重复、无未知 ID。原样离线回放确认旧严格 schema 接受该数组形状，生产业务拒绝覆盖。清理和索引现以输入 ID/主题为必需键，禁止额外键，再还原原有决策记录。第 15 次原响应在新严格 wire 的 `$.decisions` 被拒，旧数组兼容保留给未启用 strict 的 Provider。共享业务归并、证据和落盘合同沿用。
- 第 18 次实际首项为 keep，主题字符串恰 100 个 Unicode 码点、105 个 UTF-16 码元，另外三项同样。通用 schema 字符串长度从 UTF-16 码元改按 Unicode 码点，阈值保持原值。PDF 表名使用同一 schema 长度口径，保留单行与链接字符检查。第 10 次没有原响应，具体原因仍未知。
- 第 18 次原样经生产适配器和完整业务检查离线回放，48 个键完整，严格 wire 零诊断。克隆中第三批实际落盘，前两批和 R1 逐项保持。三批共有 18 个不同主题，原索引每批最多 16，故至少还需一批清理、两批索引。剩余 2 次无法完成。真实检查点未写入离线结果，真实质量未完成。

## 验证

- `node --import tsx --test --test-concurrency=2 tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts tests/openai-structured.test.ts` 通过 36/36，含 12 专项、7 PDF02、17 共享结构输出用例。日志 `unicode-final.txt`。同范围严格 TypeScript 检查退出 0，日志 `unicode-tsc-final.txt`。`git diff --check` 退出 0。
- 扩展尝试的 `tests/llm.test.ts` 因已有损坏的 `tests/support/compat01-maintenance-reply.ts` 在载入时中断。TypeScript 复现该文件 `TS1490` 和 `TS1128`。本轮保留既有文件，单列这一限制。
- 测试日志位于系统 TEMP 的 `pdf-cleanup-structured-ff2c8d17-58a8-4df5-be4f-fa383a457702`。实际运行均为 `./scripts/start_with_proxy.ps1 --import tsx <TEMP>/<工具> run <repo>`，回环 `NO_PROXY=127.0.0.1,localhost,::1`。工具 `pdf-real-quality-v2.mjs`、`pdf-real-quality-keyed.mjs` 均按首失败退出 1。工程复现与修复之后新增真实请求及用户配置读取 0。

| 最终工程文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `598146318e63231a6a5032d966427ce1a4bbbec7a5837255e3122f7a58496c40` |
| `services/llm/schema-validator.ts` | `673abf4190acc152ff9872df436ba348bedd9dafb504217daf6cc91fc4b0fd3f` |
| `tests/pdf-cleanup-structured.test.ts` | `a32dc6452d5a8433195976b6405c753c3e0be29b99e8696e6c94f54ef2009aac` |

原真实 TEMP 根为 `pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a`。最终 `real-run/ledger.jsonl` SHA-256 `4ecd5501bdc3c2c747140af29eaddf326aa3bb4bb8e378d1dd85a3be1f158cf7`。第 15 次和第 18 次模型内容分别留在 `quality-v2-run-LguEic/response-evidence/response-15.json`、`quality-keyed-run-1NyDS9/response-evidence/response-18.json`。原响应未入仓。最后离线回放 `quality-keyed-response18-unicode-replay.txt` SHA-256 `46099e59d55a0d244e390519b706cbad764e8d5b5068ea88c2b0ae31da337ab2`，新第三批摘要 `f10bc7a6b48b13a52f64bdc1755648407799dd4d06f931ef47854dce82dafac0`。原 R1 文件 SHA-256 仍为 `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48`。
