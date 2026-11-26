# LLM-Wiki 2A-3 施工记录

基线 `792bdba`。施工覆盖最后阶段 Step 5–6，源码指纹见下。独立裁决与提交由主 Agent 汇总。[任务卡](../handoffs/LLMWIKI-2A-3.md)

## 交付

- 知识库导航新增「复核工作台」，沿用知识库胶囊标签与面板样式。右侧单抽屉内有待复核、30天内到期、历史未核验与索引状态。列表在排除受限和已暂缓页面后排序，各标签最多显示五项。提醒显示实际命中原因和「系统提醒」或「系统推断」。索引页使用实时读取的 SQLite 可用性和向量补算状态。
- Wiki 详情和问答 Wiki 引用卡可直接确认仍有效。详情与抽屉可暂缓 30 天及调整周期，使用页面版本保护。冲突回读当前版本，由用户核对后明确重试。需要注意的时效状态显示徽章。
- 问答引用保留历史版本及原始 UTF-16 范围。旧引用定位允许纯复核元数据更新，继续核对正文、来源和当前权限。问答卡在底证有效时显示确认操作，点击时在 Wiki 写锁内重新核验保存的引用和 Raw 快照。底证确已变化时保留历史引文，撤下确认操作并提示重新提问。正式写入草稿的证据版本校验沿用原逻辑。
- Lint 面板显示实时巡检的时效汇总和计算日期。巡检在结构检查及汇总前排除受限知识来源。开关关闭时撤下复核导航和操作，并隐藏详情、问答及 Lint 的时效投影。

## 施工验证

Node 24.18.0，隔离服务显式指定系统临时数据目录、随机回环端口及不存在的模型配置文件。撤销继承的模型与 Embedding 配置。浏览器生产构建测试使用合成资料和回环假 Provider，冻结评测只读校验固定数据快照并在临时副本运行。

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=3 tests/fe01-api-barrel.test.ts tests/wiki-review-http.test.ts tests/wiki-freshness.test.ts tests/wiki-selection.test.tsx tests/search-sqlite-index.test.ts tests/search-runtime.test.ts` | 45/45，通过。含 130 项公共 API 运行时导出、真实 HTTP 开关、受限排除、当前写入版本与历史精确引用、状态损坏、SQLite 重建及页面选择。 |
| `npm.cmd run build` | 严格类型检查及生产构建退出 0，276 个模块。Vite 报告既有包体积提示。 |
| `npm.cmd run format:check`、`npm.cmd run lint`、`npm.cmd run guard`、`git diff --check` | 退出 0。ESLint 0 错误、761 条存量警告，Guard 检查使用进程级 Git 仓库所有权配置。 |
| `node --import tsx scripts/run-retrieval-eval.ts workspace <系统临时目录>/retrieval.md --fts-repair` | 退出 0。对照 1B FTS 修复基线，Legacy 与 SQLite 的 50/50 条评分、入模范围、证据和上下文 SHA-256 相同。长页 9/9，B 类 4/5，漏检 B4。报告 SHA-256 为 `f221518ce9f9175f335de98c4d2817765c61b0c873d5e588048e49e677964193`。 |
| `node --import tsx tests/acceptance/wiki-review-2a3-edge.mjs` | 退出 0。真机 Edge 158.0.4370.33 测试桌面和 390×844。实点 Raw 保存、抽屉标签、问答与详情确认、暂缓、周期和 Lint。验证方向键、Home/End、Tab/Shift+Tab 和 Escape 返回焦点。验证冲突后重试、原句 UTF-16 定位、开关关闭时打开旧 Wiki 引用、失效证据禁止确认并保留历史原句、关闭再启用及删除 SQLite 后重建一致。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` | 最终全量 1,139/1,139，0 失败、0 取消、0 跳过，357.43 秒。日志 SHA-256 为 `cde24b85135c3dd504f6589da13190da08e6c06c1a8e8be2a5bff9eaf6e1a327`。 |

首轮全量为 1,138/1,139，发现三项复核操作进入了公共 API 的运行时导出。现通过类型专用导出恢复已有 130 项接口。定向回归和真实浏览器均复测通过。

Edge 实测阶段关闭隔离库的定时任务，预置空资讯缓存以免工作台的资讯初始化访问公网。模型调用仅一次，目的地为假 Provider 的回环地址。浏览器无脚本错误，网络哨兵记录空。源改后未确认 Wiki 的原字节不变，确认及周期更新未改 Wiki 正文或问答文件，旧历史页未改写。删库前后四个队列视图及相关文件一致。

窄屏证据保存在仓库外临时目录，抽屉截图 SHA-256 为 `b5629f12cee3d5e11a04231b076b248b450d8d5d3b1d431e172939b7c7a41fff`，Lint 截图为 `9fe921e7851ca7f9f866df0d6ba4d227b4c45105b6c824375be617004247eb8e`。

## 源码与测试指纹

```text
2648c55204bac53072d667c97cf5b29b33fec4e87cc997e68ef1e48fd1884ba7 app/api.ts
0417dc11183362d7c48fc4900d73806be0f839c9b1b6ab03c1093197080a2775 app/api/llm.ts
ef24368bac4445024e970470ec3b676c3f681acf8f322df34176e279b2277d9c app/api/wiki.ts
77241937f6b51d9b9a372bfb9fd368b25c9b2bb0c4b21c3f5ac06904b5b19aa0 app/components/WikiLintPanel.tsx
dad761b9cf880e26c36efceb5a9d676a055a8c309ee7976ac29d939154293926 app/components/WikiQuestionPanel.tsx
91ee33486e6973e265a24b794c2846d10ca3da7d75fa43991c24b05cdb7e234c app/components/WikiReview.tsx
74d0dcb38e4e7641732b9d1e24c7be1daac186fae242892128ec1f4592921562 app/pages/WikiPage.tsx
3a9b2ba56b8268add0648f79864eb26405e5c4bdb428dccefca40d0f39cf6f68 app/wiki.css
46147a41210d48021528f6a234b0a19de4d880e2f2ee73b1782bbca68e6feadc server/index.ts
a8ac724edcaac779d482524f8f9d40248022c59c38924c5a2ff7de527f3f314e server/knowledge-api.ts
3d09d5cfdee0f887a01e32d10394fe01b8f518bf3bca6ec3c225593caefff812 services/audit/lint.ts
d2dc705f13764d76975fef1e8299cd2f746f5f1c2e1c0a62ab023abc67088357 services/llm/knowledge-answers.ts
5b02cf3fbd5e91f0308efb495a1b0564716b2b44d3a1789d00cfd430853effc7 services/search/indexer.ts
b23c9efd2ce8c44e58f2e0ebd46062428e5da24889c3c37e5fee774358842115 services/wiki/freshness.ts
f402755d2b68be4964f71d72e42302c589dbb70666c32aa0ab7aa689660f7d85 services/wiki/review-service.ts
6f2ebd7a1b57ba3cdec10f9a4bc9631142f7c48a784fbea83a5383fb583d2989 services/wiki/source-lineage.ts
18da9697ba5fb4983640ba368944f0ea8177c67249e1c12a87d25d22a4a4c2d8 services/wiki/store.ts
3cd0e65557db596dcf3cc05ff31826187fe998bbfcd6e1b3cf7ac1845366067f tests/acceptance/wiki-review-2a3-edge.mjs
75b05d6a6d13b18ccecb958ac78572c24a4fb91c0fa1d8d2fe89828ffd5bf28c tests/wiki-review-http.test.ts
```
