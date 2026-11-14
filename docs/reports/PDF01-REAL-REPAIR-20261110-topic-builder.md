# PDF01 清理主题名称返修施工交接

针对真实第 9 次请求在 `$.decisions[0].topic` 触发的业务校验，仅调整 PDF 清理的中间标签与最终标题边界。具体失败值未保留。[续测执行证据](PDF01-REAL-REPAIR-20261110-execution.md)

- 中间 `Decision.topic` 和索引回传 `topic` 保留括号与角符。只去首尾空白，内部内容原样保留。空白标签和换行分别拒绝。清理落盘、索引查找和检查点校验使用同一规则。
- 最终 `assignment.title` 仍要求单行，拒绝首尾空白和影响链接或显示的 ASCII 括号或角符。脱敏原因区分空白、换行、首尾空白及不安全字符。原表名、来源、归属、严格 schema 和索引约束沿用。
- 本机 HTTP fake 复现旧检查点尝试 3 次、完成 1/4 批、保存首批 48 项。服务重启 GET 发出 0 次请求。显式继续只发后三批与索引，首批决策逐项一致。另实测包含 `[]<>` 的标签落盘、跨重启继续索引并生成安全标题。

## 验证及冻结

- `node --import tsx --test tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` 通过 13/13，耗时 28.18 秒。
- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` 退出 0。`git diff --check` 退出 0。此次仅后端边界改动，复用上一次空 envDir 构建。[前次构建记录](PDF01-REAL-REPAIR-20261110-builder.md)
- 原日志 `topic-final.txt` 与 `topic-tsc.txt` 位于 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf-cleanup-structured-ff2c8d17-58a8-4df5-be4f-fa383a457702`。

| 文件 | 最终 SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `8a417f4bded1ea31b850fad33ee1f4070f85ec757dc7ae3641d95f8686ab2630` |
| `tests/pdf-cleanup-structured.test.ts` | `3588a1e36d7cfec59343665c6897199ab032bf1d978d1940db1388f8d6e813dc` |

真实账本、R1 与原真实工具冻结文件已重算，SHA 均与续测执行记录一致。此次真实请求与用户配置读取均为 0。真实 R2 仍停在 9/12，剩余 3 次小于完成所需的至少 4 次，内容质量未完成评估。未操作正式资料或提交。
