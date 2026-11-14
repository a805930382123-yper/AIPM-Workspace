# PDF01 R2 归并返修施工交接

2026-11-12。基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加既有工作树。后端与测试停写，交 Astra 独立验收。

整理策略 revision 3 的主题索引携带完整小样作为归组依据。索引每批最多 16 个新标签，展示每批最多 48 个完整单元，两者的用户 JSON 都限制在 32 KiB。索引为相关既有标签预留样本空间，续跑从已保存标签数继续。只提交批内有同主题对照的单元做展示选择，较大的主题可能跨批保留重复。

展示映射只引用输入已有单元。模型提出的未知、缺失或重复 ID、自指、循环、链式和跨主题映射会使当前批失败。成员数量单位未被代表保留，或者可识别的地区、时间及样本条件不同，整组原样并列并记录原因。保留全部清理处置和页级证据。代表文字沿用原单元并汇集成员页引用，AI 代表保留页图 AI 解读标识。识别明确条件的检查属于工程约束，真实等义与归并质量仍待原六页 gold 评分。

## 验证

- `node --import tsx --test tests/pdf-cleanup-structured.test.ts`，16/16。覆盖强制错误的 `urban only` 双向映射、同数异年异区异单位、定性与定量、重复 JSON 键、索引缩批恢复、展示取消迟到和重启、旧 revision 2 原字节归档。
- `node --import tsx --test --test-concurrency=2 tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts tests/openai-structured.test.ts`，40/40。实际生产 HTTP 入口连接本机 fake。混合页草稿选择 AI 代表，正文只出现一份代表并链接两页，原文字和 AI 证据同时留存。62 页合成链为 62 次理解、16 次清理、1 次索引、7 次展示，共 86 次本机 fake，310 条单元及末页证据均落入隔离成果。表格和表注照常读回，推断和问题留在独立区。
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts`，退出 0，零诊断。
- 以 `node --input-type=module -e` 调用 Vite `build({configFile:false,plugins:[react()],envDir:空TEMP目录,build:{outDir:TEMP产物目录,emptyOutDir:false}})`，退出 0，233 模块。Vite 提示打包后的 JS 超过 500 kB。独立隔离 Chrome 证据来自最终后端防护改动前的相同读器，最终后端的双页正文与完整证据另由生产入口 HTTP 验证。见[浏览器施工报告](PDF01-R2-CONSOLIDATION-20261110-ui-builder.md)。

原始日志位于 `%TEMP%/pdf-consolidation-27980514a066413f9364c7b782150534/`，包括 `targeted.txt`、`combined-final.txt`、`tsc.txt` 和 `build.txt`。首轮 HTTP 的 3 个断言还使用旧的请求总数，调整为按新增展示阶段计算。新增索引缩批测试曾暴露当前样本占满请求、遗漏可用既有样本，修正预留后全部通过。范围外全仓测试未运行。

## 冻结 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `075df50817d9288867163e7c41f88a1c5561faefa5ceb300d7a9e984640cc100` |
| `services/wiki/render.ts` | `c70f219b55735c0447cbea98ad7070b9f78f89603f99cd0af321c0d97f4bd8d1` |
| `tests/pdf-cleanup-structured.test.ts` | `d2c217c54070af5956c869e31f97c04ba3e1b7dabcbea875ce12653233ce431c` |
| `tests/pdf02-http.test.ts` | `b0c193d248ea85ba013b5b8a11c191355eead3ec063127b0b1e13accf38f8de3` |

本轮工程验证真实 Provider 0 次，真实账本累计 21/50。真实六页新版 R2 尚未执行，旧版 25/30 的归并轴未通过结论仍有效。
