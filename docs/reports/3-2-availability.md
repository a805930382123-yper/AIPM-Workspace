# LLM-Wiki 3-2 · 模型可用性与状态抽屉施工自查

施工基线 `d4c62e33d5fdafca5cfd66b71439d1da28161892`。本记录覆盖 [3-2 任务卡](../handoffs/LLMWIKI-3-2.md) 的可用性、离线操作边界和状态抽屉。产品提交由主 Agent 统一生成。

## 实现与边界

- `GET /api/llm/availability` 读取本机配置及本次进程实际调用观察，区分未配置、主动关闭、未验证、上次成功和已知故障。模型地址或凭据变化时，旧观察不套用到新目标。进程重启后重新积累健康观察，历史分端用量及切换继续从 3-1 账本读取。
- 网络失败影响同一连接配置的重轻档。超时、限流和可重试上游错误沿用 3-1 的主备切换条件。主端返回鉴权错误时，继续遵循 3-1 的鉴权失败不自动跨端约定。用户可更正凭据，手动测试恢复，或关闭主路后使用已配置的备用路。调用取消或业务结构失败不会让模型入口整体灰显。
- 设置中的手动测试支持选择主备 Provider 及模型档位，沿用本机来源检查、写令牌、配置版本和显式确认，固定测试文本且仅发往所选目标。页面加载、可用性刷新及读取账本均无探活调用。
- 问答、主动知识巡检、维护草稿、Raw 模型操作、Prompt 生成/优化及其他明确发模的按钮读取共享可用状态。Wiki 浏览、FTS、编辑、Markdown 导出、审核已保存结果、Prompt 变量填充和复制保持可操作。PDF 从已完成清理结果组装草稿可继续使用。
- Wiki 复核工作台的「索引与系统状态」保留索引现状，追加主备档位健康与最近观察时间，复用主、备和 Embedding 的累计调用、已知 Token、平均延迟及错误率，展示最近 5 条主备切换及触发原因。

## 验证

- Node v24.18.0，`node --import tsx --import ./tests/support/css-stub.mjs --test tests/provider01-entry.test.ts tests/provider-router.test.ts tests/provider-config.test.ts tests/provider-config-ui.test.tsx`，15/15 通过。真实产品 HTTP 进程与合成回环 Provider 验证了缺配置、主动关闭、无效配置、主 503/备成功、两端 401/403、重轻档独立恢复、两端关闭套接字后的网络故障、读取零调用和错误令牌零调用。另核对更换 Key 使旧健康观察失效以及 3-1 账本结构兼容。测试使用系统临时工作区与隔离配置，无真实 Provider 请求。
- `npm.cmd run typecheck`、`node node_modules/prettier/bin/prettier.cjs --check <本分项修改文件>`、`node node_modules/eslint/bin/eslint.js <本分项修改文件> --quiet` 和 `git diff --check` 通过。
- 应用端的真实浏览器离线操作、冻结检索回归及整批结论由独立验收和主 Agent 记录。

| 文件 | SHA-256 |
|---|---|
| `services/llm/provider-router.ts` | `3038a9af6d1006953f51a1c0165071bebc49078b979818c596e97af9d39ce118` |
| `server/llm-config-api.ts` | `46c17de15a33ad2941621a886882186052aebb9b7c1090d4d7bdc3fb1c4869aa` |
| `app/hooks/llmAvailability.tsx` | `18d968f36f4a669b20f2a41d0d6c8d36cc503e73ba8ae808f2beba5e449c28cc` |
| `app/components/WikiModelStatus.tsx` | `de1024f8b1232c6f543a15175ae7e52bd01c30b576aabf96c07e2a14dae6476a` |
| `tests/provider01-entry.test.ts` | `cc711871ae09aed99f71e5d7b4052c5c8bb276d42ae096020a4f1b8ab95f5e53` |
| `tests/provider-router.test.ts` | `8ed05812491b861246c7cdcf0d1c3ccbd4c68af37a33467b132d507ba1bf46a3` |
