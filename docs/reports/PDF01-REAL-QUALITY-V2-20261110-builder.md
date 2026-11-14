# PDF01 清理语义返修施工交接

针对原样本独验发现的机构规模误略和图表碎片误保，本次只调整 PDF 清理与主题索引的通用提示，以及清理提示版本保护。新增合成检查使用其他机构和数值。

- 清理提示区分纯修辞与可追溯的机构自述。即使出现在关于页、致辞或宣传附近，具体规模、覆盖、时间、方法和样本仍应保留并标明来源。修辞与具体事实混在同一单元时保留。只有完整同页图解已覆盖的信息才可省略孤立轴刻度或解析碎片。文字层和图解中同一议题应同组，重复校验仍要求内容完全相同。
- `promptRevision=2` 与业务状态格式分开。旧状态仍可读且 GET 不调用模型。保留待审核草稿门禁，显式开始新提示后先逐字节归档旧检查点，再空建新版批次。原 PDF、Raw 和 R1 保留。
- 组合 `node --import tsx --test tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` 通过 15/15，含 8 新专项和 7 公开 HTTP 回归。严格范围 `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` 及 `git diff --check` 退出 0。日志 `quality-v2-test.txt`、`quality-v2-tsc.txt` 位于 TEMP `pdf-cleanup-structured-ff2c8d17-58a8-4df5-be4f-fa383a457702`。fake 验证提示发出和机制，真实语义另验。

| 冻结文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `18fbb674b00cc66a0a4c48ad89722cb6935cf6afbf7f6be551b0e599392a2fc1` |
| `tests/pdf-cleanup-structured.test.ts` | `ee09acd2e7825bc7743226cab78cea165fd5bcc1e60708c4127b812924b11676` |

同账工具 `pdf-real-quality-v2.mjs` SHA-256 `21143c900b5418875bbfbb3d93933e464a53b224af598337b49778c2e1f6b6a9`，`freeze-quality-v2.json` SHA-256 `6f1d69aef1e1638ab3c8cc6fd3c6defbbc768046615aa217de1559db729bd6d1`。位于此前真实验收 TEMP 根。实际 `prepare` 与 `fake` 通过，副本 `quality-v2-fake-mgyQAg` 从 15 发送 4 批清理 48/48/48/23 个单元，随后 2 批索引，在累计 20 以内生成待审草稿，正式 Wiki 0。仅在克隆结束旧选择。原真实根、账本 14 次、旧 4 批和 15 项草稿保持原 SHA。准备阶段真实请求及配置读取 0。
