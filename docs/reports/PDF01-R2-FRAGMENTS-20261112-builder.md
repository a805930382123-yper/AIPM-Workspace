# PDF01 R2 原文子段施工交接

2026-11-12。基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加既有工作树。revision 4 后端和测试停写，交 Astra 独立验收。实际 Provider 调用 0，真实账本 30/50。

revision 3 实际完成两批索引和三批展示，独立总分 25/30，归并轴 2/5。离线以原源码重算两批索引 JSON 为 6,288 和 12,594 字节，与账本一致。原 11 页和 62 页的重复规模内容已同批入索引，长单元同时含其他议题。现按原句、分号和换行记录精确 UTF-16 子段，让同一父单元的内容按实际议题分组。未被覆盖的子段继续显示。原文子段还可回到 Raw 绝对区间，AI 子段位置只指向 AI 输出。事实内容优先作为索引样本。

展示比较归一化了明确序号、范围符和断行否定。只有同一连续原文区间，或隔一个换行并有明确续写证据的原文，才共同核条件。`urban only` 与普通范围的双向错误映射均回退并列。新草稿可在多个候选共用相同父级证据，候选内重复及同 ID 异内容依然拒绝，提交时仍用实际原件复核。已完成的同源同模型 revision 3 清理可供新版复用，旧文件按字节归档，新版只计新索引及展示请求。

## 验证

- `node --import tsx --test --test-concurrency=2 tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts tests/openai-structured.test.ts`，44/44，含 19 项专项、8 项 PDF02 真实生产 HTTP 入口本机 fake、17 项共享结构化输出。实际 HTTP 将一个含商户数、一个含新用户数及方法的混合单元分进不同候选，规模只显示一条 AI 代表且有两页来源。原文片段位置经 `Raw.slice` 核对，AI 子段无 Raw 偏移。模拟篡改同父证据返回 `STORAGE_CORRUPT`。恢复后选择两项正式确认返回 201，隔离 Wiki 两条主题保留同父证据。另验证片段漏项、越界、重叠、断行及空行、旧版只读和复用、取消迟到与明确恢复。
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts`，退出 0。`git diff --check -- services/storage/record-validators.ts services/wiki/render.ts` 退出 0。前端构建复用 revision 3 的 233 模块空 envDir 记录，本轮无前端变更。浏览器证据由独立 UI 实例交接。
- 原始日志在 `%TEMP%/pdf-consolidation-27980514a066413f9364c7b782150534/` 的 `rev4-combined-final.txt` 和 `rev4-tsc.txt`。新增 HTTP 测试先暴露 200 点夹具页宽截断文字，扩大合成页面后暴露旧跨候选证据约束。最终用例覆盖两处。未运行范围外全仓测试。

同一真实 167 原单元离线预算见同目录 `rev4-frozen-sample-plan.txt`。23 个父单元分出 74 子段，需索引 7 批（16×6＋6），模拟继续使用旧版标题时为展示 4 批（48＋47＋36＋47）。预计 11 次，实际展示分批取决于新索引内容。四个成功清理批均可复用。真实质量仍需原六页 gold 验收。[上一版真实执行](PDF01-REAL-CONSOLIDATION-V3-20261112-execution.md)

| 文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `5b34ccad628fa0d481c291843eacd1b2ba165aec159524e3859ece8e4b48e38a` |
| `services/wiki/render.ts` | `c70f219b55735c0447cbea98ad7070b9f78f89603f99cd0af321c0d97f4bd8d1` |
| `services/storage/record-validators.ts` | `86ec7b5bb9f03320f0ccac11a9b8327e990b5b2438b1b8c47ba6c2c64915746c` |
| `tests/pdf-cleanup-structured.test.ts` | `3a62326ad531be22aea58e338ef4f038dc8c091b7e7fafdc2ea56ea8dc982f0e` |
| `tests/pdf02-http.test.ts` | `1723c36469e026ad277f31cc02f5fa513174186ae03287964f269c828ec979bc` |
