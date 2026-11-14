# PDF01-LONG 施工交接

基线 `d6a93bd2936f32b31324032b3aa9fce81c708a32` 加共享工作区已有 PDF 改动。长报告以 1,000 个生产单元为门槛，启用整理版本 6。短报告和不满足升级条件的旧任务按原版本继续。

显式继续同一长报告时，服务核对 Raw、原件、页理解和 Provider，再归档尚在清理阶段的旧检查点。已完成清理批与累计尝试数一并保留。长报告索引以已清理的主题标签为键。写作把同原主题、同页、同来源和同类型的连续完整材料合包，表格、推断与待核事项保留既有路径。一个包可覆盖多个事实段落。校验以原成员核对事实和保留条件，段落引用展开回原成员。

## 检查

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test --test-concurrency=2 tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` | 37/37，含真实入口本机 fake、来源门禁、取消和事务恢复 |
| `node --import tsx --test --test-name-pattern='long PDF' tests/pdf-cleanup-structured.test.ts` | 最终 2/2。组合测试后只补了保留表格和推断的分包边界、4 KiB 明确拒绝和长任务计数核验 |
| `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` | 最终退出 0 |
| Vite `build({configFile:false,plugins:[react()],envDir:空TEMP,build:{outDir:独立TEMP,emptyOutDir:false}})` | 退出 0，233 模块，有大 JS chunk 提示 |

实机 Chrome 合成件有 1,042 个原单元。两个标签归为一个议题，同包的预测和实际分段呈现，第 2、4 页原件可点击，确认前 Wiki 无变化。见 [浏览器记录](PDF01-LONG-20261112-ui-builder.md)。

日志位于系统 TEMP 的 `pdf-formal-62-e98d957a6b9e45c1be7e938d470154c0`，文件为 `long6-final-tests.txt`、`long6-key-final.txt`、`long6-build.txt` 和 `long6-capacity-final.json`。范围类型检查退出 0，未输出诊断。

## 实际资料的隔离测算

原 35 批在 TEMP 复制后按生产入口升级，保存内容与累计尝试 40 保持一致，原版归档字节相同。其余 19 批走本机响应替代，只收到剩余 898 个原单元。首个清理 JSON SHA-256 与实际第 101 次请求一致。真实工作区的原检查点和 101 条账本前缀不变。

35 批已有 110 个清理标签、1,191 个可写原单元，后者进入 195 个连续证据包。全量容量模拟保留所有后续可写材料，以各页占位题模拟未知主题，得到 135 个索引键、9 次索引和 270 个包。2,058 个可写原单元均入包。索引完整 HTTP JSON 最大 28,419 字节。

| 模拟最终主题数 | 写作批次 | 最大写作 user JSON | 最大写作完整 HTTP JSON | 含 19 清理和 9 索引的余调用 |
| --- | ---: | ---: | ---: | ---: |
| 24 | 10 | 21,474 B | 41,393 B | 38 |
| 36 | 11 | 24,184 B | 38,974 B | 39 |
| 50 | 14 | 23,528 B | 36,333 B | 42 |

容量情景使用模拟主题映射。实际剩余标签和归并结果待清理与索引后确认。当前真实账 101/150，工程验证真实请求为 0。第 101 次原请求精确重建为 39,128 字节，其中结构 schema 28,740 字节、用户数据 7,950 字节、系统提示 1,436 字节。此请求在 120.002 秒未收到 HTTP 响应头，现有记录无法判定上游还是代理因素。清理协议和各阶段超时保持原值。

| 最终文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `f86bf5be40b187a69c7f1d2701fd639b82ea41fb508b5359198211a1ebb19f07` |
| `services/raw/pdf-topic-writing.ts` | `533daf0f9ac6d4c51d5b00cc19e89b904c4fb237523148d2820da7933ede2b8d` |
| `tests/pdf-cleanup-structured.test.ts` | `449d34eaa939bca18448419f39c487ed63d36b60f0ee51e4eee170ae80c39b9a` |
