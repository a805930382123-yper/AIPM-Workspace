# KB02 EDGE 最小方案独立评审

结论：**通过，建议主Agent按以下精确范围放行施工。** 这是方案评审，不是修复或批次验收通过。已读 `KB02-EDGE-20261022-plan.md`、原始 `diagnosis.json`、seq144与真实浏览器历史失败证据、当前提取及Wiki选择源码和KB02原标准；本次未改产品/default tests、未运行验收或真实外发。

## 裁定依据

短文候选目录包含服务明确不可选的纯空白atom，原响应逐字回放和三栏反例均拒绝。只在外发目录投影处以现有 `text.trim().length > 0` 筛选、完整atom生成/byAtom/严格响应校验不动，是内容无关的最小约束。它不改原文、不重编号、不静默删除返回内容，保留非空标题、首尾空白、业务否定/未知/未来建议及U+200B现有语义。新增提示仅解释目录边界，不能加入业务分类启发式。

全空目录沿用现有每块调用/计数、空数组合法响应和最终EMPTY_RESULT，不额外加入空块免调用，避免扩大预算/恢复范围。revision8→9正确反映请求变化；旧未完成409、原字节保留、显式restart与旧完成草稿兼容必须实测。提取输入已变化，本轮必须重新实测原106400字符14区域全文，不能沿用上一轮质量签收。

Wiki同项仅不清selected，仍退出编辑并清提示；保留selectId更新选择代次符合现有保存/刷新失效语义。先前准备中“不无谓递增代次”的建议不作为强制条件：源码已有操作代次门禁，应以保留异步安全为准。初始详情请求使用effect存活标记，不因同项selectedId不变而重跑，保留已有请求即可；需要受控测试证明同项初载仍最终显示，旧保存/刷新迟到不覆盖新状态。

已复现的慢搜索覆盖快列表F-KB02-EDGE-DIAG-UI-02/P2独立于chooseItem，主方案不触碰refreshList，**不纳入本轮施工**。将其列为已知旁支失败，不能声称该竞态通过；普通搜索及清除后的选择行为仍做必要回归。没有证据要求为完成本轮短文→更新链而先修此搜索竞态。

## 精确批准建议

- 产品仅：`services/llm/knowledge-extraction.ts`（外发目录投影/一条边界说明）、`services/llm/rules.ts`（revision9）、`app/pages/WikiPage.tsx`（chooseItem同项保留selected）。
- 默认测试适配仅：`tests/llm.test.ts`、`tests/kb02-extraction-contract.test.ts`、`tests/kb02-final-classification.test.ts`、`tests/kb02-classification-priority.test.ts`、`tests/kb02-planning-context.test.ts`；允许准确迁移revision与发送目录预期，保留旧原始夹具及语义断言。
- 新增默认测试仅：`tests/kb02-edge-extraction.test.ts`、`tests/wiki-selection.test.tsx`。
- 本轮施工/审查前缀各自资产；额外产品或测试文件确有必要先说明。Provider、atom构造、unit规划、schema、持久结构、存储、预算、依赖、配置、正式workspace及历史证据不得改变。

## 必须提交的受控证据

1. 原seq144坏响应仍按原错误拒绝，无部分保存；请求目录不含纯空白，非空原ID/text/span/locator/fragment逐字相同。受控正确响应保留5事实/1问题/非空来源声明。facts/questions/sourceNotes空白、未知、跨块ID均拒绝。
2. LF/CRLF/Tab/Unicode trim空白、带首尾空白非空陈述、U+200B、UTF16/跨块边界、全空白/纯声明EMPTY_RESULT；不改变调用次数或自动补发。
3. 当前保存/恢复，真实revision8旧未完成409零调用/原字节、显式restart不复用旧块、旧完成草稿可读；秘密/192KiB/预算/取消回归。
4. 已加载同项、初载未完成同项、快速同项、A→B→A迟到、编辑返回同项、普通搜索保留/排除选择及清除、最近打开/无效ID；不让旧详情或旧保存/刷新覆盖新选择。
5. 冻结后的完整默认0skip、tsc/Vite、实测旧Node24.19 SR01及相关集合、历史独立probe，附实际运行时、首败/修正、精确差异及文件指纹；独立验收重新执行，不采信施工结果代签。

## 真实验收与结束条件

既有用户指定目的地/虚构资料及Playwright授权持续。主Agent已批准本轮阶段硬上限24，从146/200续记，最多累计170；Prompt15/24不变。原短文2→全文15→补充2→更新预览1合计必要20；预留不是自动重试许可。施工0外发，冻结且独立工程通过后主Agent另行打开真实门禁。

实际Chrome必须完成原短文草稿/明确创建目标/人工备注，补充候选→选择该旧目标→更新预览→20%/30%冲突及共同观点双侧证据→明确确认→刷新与持久回读，保留双Raw来源/旧正文/备注，并复验新旧Wiki同项重点击。不得用单来源创建替代更新。全文逐页主体/日期/数值、原ID全覆盖与unit归属、Raw不可变同时核对。同核心再失败停止盲试，工程通过不替代真实质量通过。最终主Agent裁决，不自动进入下一批。
