# 1B FTS 返修独立验收（第一轮）

基线提交 `fece070e066972c9f4027990fd641756338b724e`，检查对象为施工报告列出的工作树及文件 SHA。离线冻结 B1 漏检已修复，E2 仍为空；新增事实规则误收其他主体的证据，本轮离线交付待返修。真实 Hybrid 本轮未测，上一轮未通过；本轮没有模型调用或费用。

## 独立验证

使用 `node --import tsx --input-type=module` 运行独立内存脚本，临时目录下通过 lwFixture、WikiSearchIndexer 创建三个 concept 页面；调用 retrieveKnowledgeContextDetailed，查询仅设 title、空 content 和空 tags。引擎均为 sqlite_fts，未调用 Provider。

| 页名 | 完整正文 |
| --- | --- |
| 药店巡检 | 隔壁咖啡店营业面积为 120 平方米，每天营业十小时。 |
| 药店资料 | 货架占地 2 平方米。 |
| 药店记录 | 门店营业面积为 85 平方米。 |

“药店通常多大？”实际依次返回药店资料、药店记录、药店巡检，仅药店记录正确。“药店每天营业多久？”仅返回药店巡检，预期为空。页名命中后 hasEvidence 接受正文中任意主体的面积或时段。面积规则也接受非店面的占地。返修应保留页名补充隐含主体的有效样例，同时排除正文明确指向其他店型、物品的事实。

以 PowerShell Get-Content 比较两份冻结评测 Markdown 中 25 问 × 2 引擎的逐行评分、证据和上下文哈希，忽略耗时，唯一变化为 SQLite B1。SQLite A/C/D 分别 7/7、5/5、3/3，B 为 4/5，E 误召回 4/5。通过 git diff fece070 检查题库、冻结评分锚点及默认 1A 预期；新增评测选择只改变 SQLite 的 B1 预期，真实 Hybrid 门槛保持原值。独立样例暴露的误召回仍阻塞离线验收。

## 第二轮返修独立结论

第一轮归属缺陷关闭，本轮 SQLite FTS 离线验收通过。提交基线仍为 `fece070e066972c9f4027990fd641756338b724e`，修订后 tokenizer.ts SHA-256 为 `ab80a8324f316451a366ee6438f5b985bb53c26e3a0a38d5969028473647ff23`。真实 Hybrid 本轮未测，1B 整体质量仍维持上次未通过；本轮真实模型调用 0 次，费用 0。

独立执行下列命令，清除继承的模型配置，并使用临时目录和不存在的配置文件。

- `node --import tsx --test --test-concurrency=3 tests/search-runtime.test.ts tests/search-embeddings.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts tests/retrieval-quality-gate.test.ts`：51/51。第一轮药店三页在实际 SQLite 入口再现：面积仅送出 85 平方米正确原文，营业时长返回空。眼镜店自有营业时长、百货店和展台归属，以及其余面积及营业问法均通过。
- `node --import tsx scripts/run-retrieval-eval.ts workspace <临时报告.md> --fts-repair`：退出 0。独立生成报告并逐行核对，两份均 50 行，除耗时外仅 SQLite B1 变化。A/C/D 分别 7/7、5/5、3/3，B 为 4/5，E 误召回 4/5（E2 为空），长页 9/9。
