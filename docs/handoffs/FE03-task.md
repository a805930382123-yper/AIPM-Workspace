# FE03 Prompt 与草稿审阅页面拆分

2026-11-26 冻结。基线 `3e19e24dae8c19e79e388393033563126ddb7345`，工作树初始干净。依据 [ENG04 拆分方案](../reports/ENG04-20261122-split-plan.md)、[协作规则](../coordination.md)、[测试约定](../testing.md)。用户授权本批实现、独立验收、状态更新、提交推送及远端 CI，完成后停止，不进入 BE01 或 LLM-Wiki 后续批次。

## 范围与角色

目标是移动现有职责、缩小文件并保持行为。当前 Prompt 页面 56,216 B / 1,480 行，Draft 页面 62,430 B / 1,564 行。四维评分为 0 / 2 / 2 / 1 = 5，B 模式：目标明确；跨页面内部异步与确认链；正式写入人工门禁风险；历史竞态返修。规划兼验收者不参与产品实现，两名施工者分别负责独立页面，实际模型与实例由主 Agent 记录。

所有施工者共享工作区，不覆盖或撤销他人改动。每个所有者交接后停写；仅协调者提交推送。

| 所有者 | 可写范围 |
|---|---|
| Prompt 施工者 | `app/pages/PromptLibraryPage.tsx`、新建 `app/pages/prompt/*`、新建 `tests/fe03-prompt-split.test.tsx`、`docs/reports/FE03-prompt-builder.md` |
| Draft 施工者 | `app/pages/DraftReviewPage.tsx`、新建 `app/pages/draft-review/*`、新建 `tests/fe03-draft-split.test.tsx`、`docs/reports/FE03-draft-builder.md` |
| 规划兼独立验收者 | 本任务卡、`docs/reports/FE03-review.md`；临时验收脚本放系统 TEMP |
| 主 Agent | `docs/status.md`、必要的现有总控状态记录、集成验证、Git 与 CI 核验 |

禁止修改后端、存储、API 门面、公共 hooks/router、App、CSS、规则、依赖/锁文件和既有测试；不重编依赖。若确有必要，先向主 Agent 提交具体证据裁决，不自行扩围。不引入通用状态框架、不重写 reducer、不调整 UI/文案/DOM/ARIA/URL 契约。原有文件读取后再编辑。

## 冻结拆分方案

1. Prompt：提取 `PromptEditor`、`PromptDeleteDialog`、`VersionDetail`、`PromptDetail`；保留现有 props/DOM/回调语义。将列表/筛选、详情/版本、编辑、变量预览/复制等现有状态与操作集中迁移至 `usePromptLibrary.ts`，仅在达到体积门槛需要时按现成独立边界再分模块；常量和类型放内部模块，避免子组件反向导入入口。入口保留 `PromptLibraryPage` 原导出与参数，并负责工作台组合。
2. Draft：提取 `TemplateFieldsEditor` 与字段更新纯函数、`DuplicateCheckSection`、页面卡片编辑区域；将现有加载/保存/重复候选/审核/确认逻辑迁移至 `useDraftReviewState.ts`，必要时将大 JSX 按现有语义区域再分组件。入口保留原导出和全部 props，以及按 `draftId` 的 keyed remount；知识维护、Raw outcome、结构化笔记分支保持原委托行为。公共内部类型/指纹/冲突文本等置于无环叶模块。
3. 允许在上述目录内根据真实代码边界选择最终文件名和数量，交接列明映射；不允许仅搬成另一份大文件。全部本批产品模块均须严格 `< 40,960 B` 且 `< 800` 行，依赖无环。

兼容重点：Prompt 的 selection/list/history/render 世代、busy token、requestId 与 inflight 所有权、卸载后的迟到响应、变量签名和预览版本、剪贴板失败手工复制、409 保留输入、删除焦点/忙碌关闭锁、生成器保存后跳回选中新模板保持原样。Draft 保留 dirty/fingerprint、noteDirty、挂载/加载世代、候选失败阻止提交、人工勾选与显式决策、审核摘要失效、提交前刷新候选并锁定可见快照、幂等键、部分提交/轮询及返回导航。

ENG04 提到的 `duplicateInput` 顺序与 Prompt ref 同步已在基线修好，本批不得重复改写。`tests/prompt-ai-http.mjs` B08 历史 mock 漂移不属于本批；不得通过删除断言、放宽行为或改测试基线隐藏失败。若默认测试新增失败，须对基线复现后区分旧问题和本批回归。

## 验收项

| ID | 必须满足的证据 |
|---|---|
| FE03-01 | 两入口与所有新产品模块均满足字节/行数门槛、无循环依赖；公开导出/props 兼容，变更限于所有权清单。 |
| FE03-02 | 上述 Prompt 兼容行为通过既有 `prompt-ui`、`uifix01-ui`、`uifix04-ui`；新增测试只补拆分后实际缺口，至少覆盖模块边界及一项有意义的异步或状态隔离行为。 |
| FE03-03 | Draft 的 `kb02-human-ui`、`kb03-confirm-ui`、`kb03-review-ui`、`r13-merge-ui`、`ui-b04` 全过；新增测试补拆分边界或状态隔离，确认门禁不得变化。 |
| FE03-04 | `npm.cmd run typecheck`、`format:check`、`lint`（0 errors，警告不高于基线）、`guard`、`build`；定向 ESLint 本批文件 0 errors / 0 warnings。仅格式化自身改动文件，必要时两遍，不运行全仓写入。 |
| FE03-05 | 按测试约定隔离运行 `npm.cmd test`；本地环境不足如实记 BLOCKED，不伪造 PASS。远端 Windows Node 22/24 对同一产品版本全套 CI 成功闭环。 |
| FE03-06 | 独立真实 Edge/Chrome 在隔离生产服务执行下述交互；实际 HTTP/文件核验保存结果，浏览器错误与非预期 HTTP 错误为 0。 |
| FE03-07 | 报告写明实际命令、结果、产品提交或未提交文件 SHA-256，区分实测/复用/未测；分别给本轮缺陷关闭与整批结论；状态/文档链接、guard、hygiene 通过。 |
| FE03-08 | 主 Agent 核验推送后实时远端 SHA 一致，Windows Node 22/24 CI 成功；更新最终报告/状态并同步，最终工作树干净，止步。CI 未完成前整体不得签 PASS。 |

定向命令：`node --import tsx --import ./tests/support/css-stub.mjs --test tests/prompt-ui.test.tsx tests/uifix01-ui.test.tsx tests/uifix04-ui.test.tsx tests/kb02-human-ui.test.tsx tests/kb03-confirm-ui.test.tsx tests/kb03-review-ui.test.tsx tests/r13-merge-ui.test.tsx tests/ui-b04.test.tsx tests/fe03-prompt-split.test.tsx tests/fe03-draft-split.test.tsx`。新文件选择 `.test.ts` 时相应调整命令。

浏览器最小闭环：Prompt 新建/保存→筛选/选择→变量渲染与复制可用态→编辑保存→历史只读→删除弹窗 Escape/取消→切换生成器后返回；不调用真实 AI。Draft 用合成数据走列表进入审阅→编辑并保存/刷新→候选与显式选择门禁→明确人工确认→核对正式写入结果，并验证另一草稿切换不串状态及返回导航。覆盖普通草稿和已有 outcome/维护委托入口；后两种复杂行为可复用同版本真实 HTTP UI 测试，不必重复全部浏览器操作。至少桌面 1440×900 与窄屏 390×844 查看核心界面，若发现既有布局问题先基线对照，避免未经授权视觉重做。

全部测试使用 `os.tmpdir()/aipm-fe03-*`、不存在的 LLM 配置和随机空闲端口；清除继承的 `FMCG_LLM_*` 与 `EMBEDDING_*`，产品子进程采用 `withoutInheritedEmbeddings`，阻断非回环请求。禁止触碰真实 workspace、真实 Provider 或已有服务端口。证据按[规范](../evidence-policy.md)存放，临时脚本和数据结束清理，不提交密钥、本机绝对路径或完整日志。

施工各自提交文件映射、体积、测试结果和 SHA 后停写；独立验收失败仅由对应施工者修复。相同核心缺陷重复失败时先诊断；必要证据缺失则保留 BLOCKED。所有必选项有证据后由独立验收签发，主 Agent 完成同步并停止。
