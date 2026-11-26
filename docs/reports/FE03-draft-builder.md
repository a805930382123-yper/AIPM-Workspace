# FE03 Draft 施工交接

2026-11-26。依据 [冻结任务卡](../handoffs/FE03-task.md)，基线 `3e19e24dae8c19e79e388393033563126ddb7345`。本侧完成施工与自查，**待独立验收**；不以本侧自查签发整批 PASS。共享工作区，仅编辑 Draft 所有权范围，未提交。

## 文件映射

原 `DraftReviewPage.tsx` 的职责按原逻辑移动，公开导出和全部 props 保持不变；入口仍以 `draftId` 为 key 重挂载。知识维护、Raw outcome 与结构化笔记继续交给原组件。

| 文件 | 职责 | 字节 | 行数 |
| --- | --- | ---: | ---: |
| `app/pages/DraftReviewPage.tsx` | 页面组合、来源编辑和原委托分支 | 16,763 | 458 |
| `app/pages/draft-review/useDraftReviewState.ts` | 加载/候选/保存/审查/人工确认及原异步所有权 | 18,596 | 502 |
| `app/pages/draft-review/draftReviewModel.ts` | 内部类型、指纹、候选输入、冲突文本与字段更新纯函数 | 3,122 | 70 |
| `app/pages/draft-review/TemplateFieldsEditor.tsx` | 原字段归位编辑 DOM 和回调 | 3,216 | 92 |
| `app/pages/draft-review/DuplicateCheckSection.tsx` | 原重复候选与显式决策区域 | 3,208 | 86 |
| `app/pages/draft-review/DraftAssignmentEditor.tsx` | 原逐页主题及完整归属审查区域 | 3,798 | 85 |
| `app/pages/draft-review/DraftPageEditors.tsx` | 原知识卡片编辑区 | 17,422 | 430 |

全部产品模块均严格小于 40,960 B / 800 行。组件仅向 hook/type/叶模块依赖，叶模块不反向导入入口。未引入框架、公共模块或运行时 Agent。

保持原有 dirty/noteDirty、fingerprint、加载世代、挂载标记、候选失败门禁、逐页审核、提交前候选刷新、可见快照锁定、幂等键及部分提交处理。提取后的卡片 props 使用原 `input` 分支之后已收窄的 `RawDraftView`。未重复修订基线已修好的 `duplicateInput` 顺序。

## 实测证据

使用 Node `v24.22.1`；以下 `node` 指本轮明确选用的该版本运行时。临时数据通过 `os.tmpdir()/aipm-fe03-draft-*` 隔离，LLM 配置指向不存在文件；启动前清除继承的 `FMCG_LLM_*` 和 `EMBEDDING_*`。既有 HTTP 夹具使用随机回环端口与 fake Provider，未访问真实 Provider。

| 实际命令 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc -b` | 退出 0 |
| `node node_modules/prettier/bin/prettier.cjs --write app/pages/DraftReviewPage.tsx app/pages/draft-review tests/fe03-draft-split.test.tsx` | 仅格式化本侧文件；后续运行均 unchanged |
| `node node_modules/eslint/bin/eslint.js app/pages/DraftReviewPage.tsx app/pages/draft-review tests/fe03-draft-split.test.tsx --max-warnings 0` | 退出 0；0 errors / 0 warnings |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb02-human-ui.test.tsx tests/kb03-confirm-ui.test.tsx tests/kb03-review-ui.test.tsx tests/r13-merge-ui.test.tsx tests/ui-b04.test.tsx tests/fe03-draft-split.test.tsx` | 获准允许回环的隔离执行后 22/22；0 fail / 0 skip，6.54 s |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/fe03-draft-split.test.tsx` | 强化迟到候选断言后的最终版本 2/2，0 fail / 0 skip |

新增测试实际挂载公开入口，并通过提取后的卡片/状态模块执行：未保存标题和合并选择在切换草稿后清零；相同 pageId 下旧 Raw、重复候选的迟到响应不覆盖新草稿；字段更新保留原对象和证据，保存正文展示不影响脏指纹，人工选择会影响指纹。

环境诊断：默认沙盒首次五组联合执行出现 HTTP 等待超时，未将不完整运行计作通过；单项 TAP 复现页面显示 `fetch failed`，独立最小回环 HTTP 服务得到 `EACCES connect 127.0.0.1:<随机端口>`。经批准在允许回环的环境执行相同产品版本后 22/22 通过，无产品修改。联合测试输出了既有测试路径中的 React `act` 与 controlled input 诊断；未修改既有测试消除输出。临时隔离目录已清理。

## 未提交文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app/pages/DraftReviewPage.tsx` | `1e7f3bea6aac84465c4f8a8af17b151358a4e5fbd021ec0c9b5f653b52861884` |
| `app/pages/draft-review/DraftAssignmentEditor.tsx` | `feefc6a3d0a0c02975b0d0dfdf8573f80740bd754cddad976c76cde338fe648b` |
| `app/pages/draft-review/DraftPageEditors.tsx` | `f5fbc3ea2024b68bf7577eca3e20841005a2f772008c2d1f7759034fd3260492` |
| `app/pages/draft-review/draftReviewModel.ts` | `33751d9fe934a17f918e647c94332d13bd84447251b73c8b75e16c477c34b7da` |
| `app/pages/draft-review/DuplicateCheckSection.tsx` | `66944f9b33576164a027430705feac4849d0cd19cab350c29b1639d57c7e57d4` |
| `app/pages/draft-review/TemplateFieldsEditor.tsx` | `9bdbd239aed9a51b89dd70f8ca78f985d8e5dd88421e074771b7f9d843fd7288` |
| `app/pages/draft-review/useDraftReviewState.ts` | `568cf64d659ea7ffb552e25c55abfec5eb02eb76d5105604594caca095a021d5` |
| `tests/fe03-draft-split.test.tsx` | `474d38c006fd89a6134707715a813002991d5b7698f1e9d1f70306e883e6c7f7` |

本轮施工范围结论：Draft 提取完成，自查通过，无已知待修产品缺陷。批次整体结论：待独立验收，整批静态门禁、默认全量、真实浏览器、远端 CI 与同步由主 Agent / 独立验收补齐。本侧未执行这些项目，不标 PASS。交接后停止写入，等待范围内返修任务。
