# LIFEOS L2：Raw 状态与恢复表达（2026-10-31）

## 授权、基线与角色

用户明确启动[正式方案](../batches/LIFEOS-optimization-plan-20261031.md)阶段2，完成施工、必要验证和独立验收后提交同步，停止，不推进阶段3。基线 `f0f7630b4b1bec0d63fcd58dd88a349d1e1481ac`。KB03 R10整体PASS仅沿用其冻结范围；会议上传UI BLOCKED、历史收据缺口均不在本轮关闭。

评分需求0/耦合1/风险1/历史失败0=2，A标准：目标明确，涉及Raw组件与既有API状态的呈现和测试；误导恢复动作可能导致额外调用，但本轮不改引擎和账本；无本任务重复失败。Astra规划，Terra High施工，另一个Sol High实例独立验收。主线程统一提交同步。

本轮真实Provider请求0、配置读取0、正式workspace访问0；历史预算保持，不使用余量。只用临时隔离根、虚构资料和显式fake Provider。不得读取.env或启动默认读取正式数据的产品服务。

## 当前证据与最小范围

RawPage.tsx的RawDetail已有activeJob按Raw ID匹配、深度阶段、段数、累计/复用、显式继续、覆盖失败重规划、重新生成、保存恢复。现状信息分散在顶部按钮、模式提示、错误与检查点段落，标题位于操作后；应整理成对象→当前状态/阶段→已保留结果→问题→下一步。只改善阅读和动作说明，不建任务中心，不改状态枚举、恢复引擎、预算、来源门禁或持久化格式。

依据：`app/pages/RawPage.tsx:88–145`，`app/api.ts:101–119`及状态标签，`app/styles.css`现有Raw布局；`tests/kb02-storage-ui.test.tsx`已有真实HTTP/fake存储恢复验证，`tests/kb02-storage-http.test.ts`已有保存恢复零请求断言，`tests/kb02-storage-recovery.test.ts`已有重启恢复，`tests/app-m05-raw-navigation.test.tsx`已有切换/迟到隔离。Prompt已有恢复表达，本轮无必要缺口，不改Prompt。

设计沿用现有Operate界面、字体、颜色、按钮和警示样式，不引入图像、仪表盘、进度百分比或新设计系统。规划读取impeccable及clarify指导，context对该文件返回SCOPED_EXISTING_ALLOWED；无需建立PRODUCT/DESIGN。施工UI编辑前按技能读取craft-floor；完成后一次detect并解释与本次相关发现。

## 冻结UI结构和语义

在Raw详情原有区域内呈现，原文、来源元数据、导入/删除流程保持：

1. 处理对象：资料标题先于整理操作，状态与来源标识仍可见，不复制整段正文。
2. 整理状态：显示“当前阶段”，深度提取/知识页规划/大纲/写作/质量检查使用已有字段；done/ready只能表示草稿阶段结束，不能代表正式Wiki写入。无任务数据时使用状态本身，不编造阶段。
3. 已保留结果：有checkpoint才显示已验证段数、累计调用、复用段数；强调这是提取段数而非整项完成比例。存在draftId的待审状态显示“草稿已保存，待你审核”；有generatedWikiIds的generated状态显示“已确认写入”及实际ID。缺少证据时写“暂无可确认的已保存结果”或相应未开始提示，不把pagesFound推断为已落盘草稿，不把内存结果说成已保存。
4. 问题：失败原因以已有安全message为主，错误码可作补充；保存失败高于普通状态展示。保留阶段/累计信息，不能因已提取完成显示整个任务成功。
5. 下一步：操作与对应影响说明相邻；重导入/删除作为资料操作，与恢复动作区分。说明文本只在相关状态展示，避免重复段落。

动作条件继承现有服务语义，优先保持按钮现有标签与调用参数，避免破坏可访问名称和既有测试：

| 动作 | 显示/可用条件 | 必须说明的影响 |
|---|---|---|
| AI整理/失败重试 | 沿既有unprocessed、failed、generated条件；busy或storageBlocked禁用；Meeting来源不显示AI入口 | 新生成结果先进入草稿，仍需人工确认 |
| 显式继续提取 | failed且pipelineVersion；沿用原任务mode，不能偷偷使用当前选择的另一模式 | 从现有任务检查点尝试继续，保留累计调用；实际可恢复性由服务端判定，不能保证零调用或保证全部复用 |
| 仅重新规划（带覆盖诊断） | failed、非deep、LLM_PLAN_COVERAGE_INVALID；busy/storageBlocked禁用 | 使用既有提取结果重新规划，会继续累计模型调用；不写成重新提取全文 |
| 明确重新生成 | failed且pipelineVersion；busy/storageBlocked禁用 | 按当前选择模式重新生成，不等同继续；调用仍受既有累计预算约束，不承诺清零或免费 |
| 重试保存状态 | recovery存在且execution=settled，保存中禁用；running阶段提示等待停止 | 仅对账本机状态，不重新调用模型；失败保留错误和可再次显式操作入口 |
| 继续审核 | pending_confirmation且state.draftId且无storageBlocked | 审核草稿，正式写入仍需用户确认 |
| 取消整理 | 沿现有processing、未settled、无storageBlocked条件 | 不新增自动取消或其他副作用 |

超过30000字符深度模式禁用保持；失败继续使用原模式与重新生成使用当前模式的差别必须可读。Meeting本机专用限制保持。若发现现有动作与服务契约存在实质缺陷，记录具体证据交主线程裁决，不自行改引擎扩大范围。

## 文件所有权

规划者只写本任务卡，冻结后停写。Terra负责 `app/pages/RawPage.tsx`、必要且仅Raw局部的 `app/styles.css`、新增 `tests/lifeos-l2-status-ui.test.tsx`，必要时为新表达调整 `tests/kb02-storage-ui.test.tsx` 的断言；允许新增窄隔离完整App/API fixture `scripts/lifeos-l2-isolated.ts`（参考现有 `scripts/kb03-review-isolated.ts`，不建通用框架） 及施工报告 `docs/reports/LIFEOS-L2-20261031-builder.md`。不默认修改App/api/服务/其他测试；确有必要先说明最小范围由主线程裁决。

Sol独占新增实际浏览器脚本 `tests/acceptance/lifeos-l2-browser.mjs`，并写独立报告 `docs/reports/LIFEOS-L2-20261031-review.md`，可运行独立验证不改待验产品。主线程负责版本绑定、必要状态记录及提交同步。共享工作区还有其他工作，不覆盖或回退他人修改：AGENTS.md、docs/reports/B04-http-evidence.json、docs/reports/KB02-R1-20261015-builder-merge.json、docs/reports/AGENT-ROUTER-20261023-packaging.md。施工前后记录这四文件SHA并保持不变。

## 冻结验收

- **L2-01 状态与结果**：组件fixture至少覆盖标准/深度进行中（deep outline/writing/quality之一及段数已满仍未完成）、待审、一般失败、保存失败running/settled、正式完成，以及无checkpoint旧状态。逐项核对对象、阶段、真实保留结果与下一步；失败不得显示整项成功，完成草稿不等于正式写入，未知值不虚构。实际浏览器核看进行中/失败/待审/正式完成及保存失败布局，截图与操作记录绑定版本。
- **L2-02 动作矩阵**：标准覆盖失败有重规划，deep同错误及其他失败无重规划；继续传原mode，重新生成传当前mode；busy/storageBlocked禁用保持，恢复running不可点击，settled可点击；Meeting没有AI入口、超长deep禁用。组件记录实际回调/HTTP参数；浏览器实际操作至少覆盖继续与重生成的说明和模式选择、保存恢复、继续审核，使用fake或受控模拟，不发真实模型。
- **L2-03 持久化与隔离**：隔离服务重建/重启后读取既有job/state，页面刷新仍展示对应阶段/草稿与动作；切换Raw A→B后释放A迟到响应，B的对象、阶段与动作不被A覆盖。复用已有定向测试或增补缺少断言，不能仅以静态代码签通过。浏览器刷新和切换两个虚构Raw核对；服务重启可由真实隔离服务测试提供，不要求浏览器伪造服务重启。
- **L2-04 零调用保存恢复**：实际临时服务+fake故障注入生成保存失败，记录恢复前草稿/检查点和fake请求计数；显式恢复后recovery清除、草稿保留可审，计数完全不增。优先运行既有storage HTTP/UI用例，记录实际结果；模型计数不能只统计浏览器HTTP请求。

建议必要命令（先检查fixture隔离，不能读实际配置）：

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l2-status-ui.test.tsx tests/kb02-storage-ui.test.tsx tests/kb02-storage-http.test.ts tests/kb02-storage-recovery.test.ts tests/app-m05-raw-navigation.test.tsx
npx tsc -b
```

构建用空envDir的Vite程序化build或现有已验证隔离构建方式，不能直接读取项目.env；记录实际命令。实际浏览器使用完整React App和真实路由/stores/runner，仅Provider为fake；Terra的harness输出会话JSON（url/api/root/fixtures/requests），支持--root重启沿用原数据而不重seed，覆盖标准覆盖失败、deep失败、保存失败与迟到响应。主线程已发现bundled Playwright和本机Chrome，Sol已实际launch/click通过；CUA初始化失败不直接视为无浏览器。由Sol通过实际headless Chrome执行上述UI操作，桌面约1440宽及窄桌面约1024宽检查文本换行、无重叠、按钮可见与键盘焦点；不扩为全站响应式改造。JSDOM不是实际浏览器。可复用同版本可信服务测试，但必须指明命令/报告及未受影响依据，新的UI仍需实看。无UI通道则完成其他验证并将相关项BLOCKED，不签整体PASS。

必要门禁通过且无新问题后不扩大全仓测试。施工交接记录diff、实际命令/结果、文件SHA、真实/config=0、隔离根、未测项后停写。独立验收分别裁决“本轮表达/动作范围”和“L2整体”；四项全部有对应证据才能整体PASS。报告绑定受验基线+交付指纹、最终提交由主线程补绑定。通过后统一提交同步、核远端一致，停止，不启动首页阶段3。
