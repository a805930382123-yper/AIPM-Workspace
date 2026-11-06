# PROVIDER01 施工记录

真实入口红测：`node --import tsx --test tests/provider01-entry.test.ts` 修复前问答返回 400 `LLM_NOT_CONFIGURED`，1/1 失败。仅补 `server/index.ts` 的 AI POST predicate 后，真实子进程配合隔离 fake HTTP 模型，四阶段 knowledge_answer、answer_maintenance、knowledge_inspection、inspection_maintenance 顺序调用，问答完成、保存成功、检查完成、草稿成功。

最终定向命令 `node --import tsx --test tests/provider01-entry.test.ts`：2/2 PASS；无配置与坏可选配置下 health、GET 和手工 Raw 写入通过。回归 `node --import tsx --test tests/provider01-entry.test.ts tests/lw02-core.test.ts tests/lw03-core.test.ts tests/lw03-http.test.ts tests/llm-http.test.ts`：24/24 PASS（该次运行早于追加第二个无配置测试，后者已单独通过）。`npx tsc --noEmit` PASS。空临时 envDir 调用 Vite build API PASS，227 modules，既有大包警告；首次误用 CLI `--envDir` 被拒绝，已改用 API。

真实模型、用户配置和正式数据未读写，全部数据位于临时目录，测试子进程和 fake 已关闭。无提交推送；HEAD 275067c 加既存未提交工作树，本轮不代表独立验收或整批结论。

SHA256：server/index.ts 632E8FC307C4A06387140917A6FC788552E32C5A3804266AB626BF080A1A384C；tests/provider01-entry.test.ts AAAAAA834E7AA3E9FC0BBA81A45CD9AA233A55B9592739B08B7BD6285C0607EE。
