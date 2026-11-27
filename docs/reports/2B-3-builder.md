# LLM-Wiki 2B-3 施工自查

2026-11-27 · 基线 `c4097dd` · 施工范围见[任务卡](../handoffs/LLMWIKI-2B-3.md)。产品提交 `098fb5a`。

## 实现

- 常规成果卡和旧草稿审阅卡提供「发送本页内容进行语义查重」。按钮说明发送内容与目的地，使用保存后的当前页。该操作显式提交当前草稿版本及发送确认。后端忽略请求携带的正文替代值，使用最多 3,000 UTF-16 单元的已保存标题、定义、来源事实与 AI 整理。发送前检查草稿版本、状态、当前 Raw 正文哈希、会议限制、已知服务端凭据，并复用草稿证据校验核对该页的原文和媒体依据。PDF 页整理草稿仅提供词法候选。自动加载、词法刷新、保存和确认均沿用原路径。
- 已配置服务只生成这次查询向量。Wiki 端复用当前模型、维度及端点对应的本地向量。余弦相似度阈值取 0.70，逐页选最高分段，最多核对 15 页并展示 5 个语义候选。用当前文件哈希和来源可见性核验结果，同一 Wiki 页合并词法和语义依据。原有词法分数保留，语义分数独立显示为系统提示。
- 无向量、配置关闭或调用故障时返回词法候选。提示不会写入草稿、Wiki、向量索引或处理决定，配置或维度不符时不会为提示触发回填。成果卡可打开候选 Wiki，后续按原成果流程人工确认。查询进行中仍可提交，已有词法门禁继续生效。

## 自查

- `node --import tsx --import ./tests/support/css-stub.mjs --test '--test-name-pattern=2B-3|候选查询失败阻断提交' tests/search-embeddings.test.ts tests/ui-b04.test.tsx` 通过 4/4。真实 HTTP 路由与回环向量替身验证纯语义正例、0.69 负例、同页合并、候选上限、旧文件和不可见页排除、单次授权、会议限制、失效媒体证据、密钥过滤、没有可用向量、服务错误、模型/维度不配及关闭回退。正常构建的 PDF 页整理草稿即使显式 POST 也只返回词法结果。对比草稿、Wiki 文件、索引记录和模型锁，查询前后相同。真实成果确认返回 201，确认没有发出草稿查询向量请求。
- React 成果卡测试确认渲染未自动发出 POST，点击发送只请求该页，等待期间可确认入库。候选理由、分数和打开 Wiki 操作均可见。PDF 成果卡显示词法刷新。既有词法失败和人工门禁用例通过。
- 最终 `npm.cmd run check` 使用六核处理器亲和性与进程级 `safe.directory`，类型、格式、静态检查、体积守护、测试和生产构建全部通过。测试 **1,151/1,151**，零失败、零跳过。ESLint 0 错误、761 项警告。Vite 构建 289 个模块，保留包体积警告。早期检查分别在 guard 的仓库所有权与 PDF 测试夹具缺少页证据处停止，最终版已完整复跑。

Node `24.18.0`。验证使用系统临时数据目录与不存在的模型配置文件，清除继承的模型、向量与检索配置。真实 Provider 调用 0 次。冻结题库、千页基准、浏览器和整批结论由独立验收记录。

## 施工文件

| 文件 | SHA-256 |
| --- | --- |
| `app/api/llm.ts` | `db0e981e5ef299f3962b6cd51342c2ef0ce112a8d987d14d667a78f21478a390` |
| `app/pages/DraftReviewPage.tsx` | `b24bcdeb0cdd54d6ab6118cf6a0a87b391d3b2fc2f353f415032854f94ce24a4` |
| `app/pages/RawOutcomeReview.tsx` | `83e09cacf8753a1f81ef8e98a665bc03e3d2afc7690f708681120f5d6ada5361` |
| `app/pages/draft-review/DuplicateCheckSection.tsx` | `e347cbf220e629abe2f59c2bb989147fa4a6fc4934c6468998eb96444be08e3b` |
| `app/pages/draft-review/draftReviewModel.ts` | `a97357be72e58013a75d19d35199b31313316ee03feff0cf3e2916819fb3f567` |
| `app/pages/draft-review/useDraftReviewState.ts` | `5978b494d6b5c3c1b86d0175da244f4194f5799c3c313e5e87f1ef03b20ea81c` |
| `server/index.ts` | `d2e4bb7dee16483c364c26ba85004f1e3076e28610233edca14c4a6591fdab00` |
| `server/knowledge-api.ts` | `b7f1fa6d539075f42c9041ce2deb0c143f6939deff4796ab4801fc479f771d9a` |
| `services/search/duplicates.ts` | `a58f7d90e080789d7938687329b0e6a588f49f20069187f4622029408630bd6a` |
| `services/search/indexer.ts` | `2c45a710f05a6f04d99967169386e86575816d88cc4e0d05c40cdae95961b2c4` |
| `services/search/vector-retriever.ts` | `f607bf5faf325f25f89bda9605bb1d61200d232420cc13ed072c5c3e01d50af3` |
| `tests/search-embeddings.test.ts` | `73b71167facf6f8ade4b1c8e932c0cb0bb9a3a164653ecef784ddfcf98596dea` |
| `tests/ui-b04.test.tsx` | `4b12cefc9f3149ec3a602c9742e3da0e065b974b5cb12076a4b30ff42003953b` |
