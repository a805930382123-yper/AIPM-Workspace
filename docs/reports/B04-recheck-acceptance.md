# B04 返修独立复验（2026-10-05）

**最终独立结论：FAIL。** 已读取并合并主 Agent 真实浏览器、公开API持久化和独立构建/单测记录，11根因中 **8项关闭，F04-04/F04-05/F04-11三项部分修复仍OPEN**。真实产品 Provider 仍缺用户配置，另列 BLOCKED，fake 不代替真实 AI 成功/质量。不修改产品、不修改 status/任务卡、不覆盖首次验收证据，也不进入 B05。

复验实例 GPT-6.1 Sol High；依据 [冻结B04契约](../handoffs/B04-deepseek-prompt.md)、[原返修卡](B04-fix-card.md)、[施工返修报告](B04-repair-build.md)。仅复验 F04-03–11 的后端断言与修复边缘，并跑必要回归；F04-01/02 由主 Agent 真实浏览器操作，本报告最终合并其证据。

## 版本与独立运行

| 组 | 实际结果 | 证据 / 耗时 |
|---|---|---|
| 返修专项公开HTTP/文件 | **23业务场景：20 PASS / 3 FAIL**；另冻结PASS，合计24检查21PASS/3FAIL | [B04-recheck-http](B04-recheck-http-2026-10-05T14-56-33.011Z.json)，29.853秒 |
| B02手动Wiki关键回归 | **12/12 PASS** | [独立B02回归](B04-recheck-b02-regression-2026-10-05T14-57-36-549Z.json)，2.294秒 |
| B03受影响关键回归 | **5业务＋冻结=6/6 PASS**，没有重跑整套B03 | [独立B03回归](B04-recheck-b03-regression-2026-10-05T14-57-42.823Z.json)，8.513秒；四格式、引用删除、并发无坏来源、原件关联失败恢复、删除关联恢复 |
| build / npm test | **独立build PASS / 92/92 PASS** | [主 Agent记录](B04-recheck-main-checks.json)，实际stdout归档，npm test16.536秒；施工92项自测不代替本轮独立HTTP结论 |
| 真实浏览器 | F01/F02/F03 CLOSED；正常UI部分选择链接/持久化子路径PASS | [真实浏览器报告](B04-recheck-browser.md)、[API/文件断言](B04-recheck-browser-checks.json)；界面先PATCH同步selected，不能代替公开confirm.selectedPageIds边缘验证 |
| 真实Provider | **BLOCKED** | 无用户配置产品Provider/model/key，零真实调用 |

本轮冻结 README/package/lock/忽略/示例配置及 app/server/services/rules 共 **47产品文件**；完整SHA-256在专项JSON的 frozenBefore/frozenAfter，并汇总到 [独立复验JSON](B04-recheck-independent-review.json)。前后无变化，返修施工指纹表的产品文件一致。独立脚本仅 import Node builtin，不 import 产品模块；启动真实产品进程，fake 是自建 localhost HTTP 服务，发送随机无效测试Key。主 Agent在npm test重写施工HTTP证据前已归档 [原始返修HTTP](B04-recheck-builder-http-evidence.json)，SHA为 `e2341db76834112d871f9173d280be312e5e456c4833f226228b5b72081f5e07`；本轮不会把新自测覆盖件冒充原件。

命令为 `node tests/acceptance/b04-recheck-http.mjs`、`node tests/acceptance/b04-recheck-b02-regression.mjs`；B03设置 `B03_ONLY=E03-01,E03-09,E03-10,E03-12,E03-15` 后运行 `b04-recheck-b03-regression.mjs`。鉴于前轮已有真实沙箱 EPERM/EACCES 证据，本轮按批准的 escalation 在全新TEMP目录运行，未把权限环境失败当产品缺陷。

## 缺陷关闭与残留

| 原ID | 后端复验判定 | 本轮实际结果 |
|---|---|---|
| F04-01 SourceUI保存 | CLOSED（真实浏览器） | 保存Source人工标题/body/等级A后仍保留Raw左栏；刷新重开保留，最终正式Source/API仍为人工值。浏览器RUI02/RUI03及文件断言已读取。 |
| F04-02 编辑直接确认 | CLOSED（真实浏览器） | 本地改页标题/定义后未另点保存直接确认，正式API/页面/重启后皆为人工新内容；Source人工正文/A也保留。RUI04–07已读取。 |
| F04-03 默认未选 | CLOSED | 3/3默认false；空选确认400 NO_SELECTION且Wiki/Index/Log无变化。UI按钮/全选行为由主 Agent验证。 |
| F04-04 幂等 | **部分修复，OPEN** | 任意key同payload并发、重启后任意key重试复用同operation/IDs/Log；同key或异key换真实选择集合都409。带额外未知ID的重试仍被过滤后201，见残留一。 |
| F04-05 Source链接/选择 | **部分修复，OPEN** | 新页/预览引用实际既有Source标题，links resolved，旧Source文件SHA不变；正常UI已同步flags时选中/未选链接正确。公开确认ID集合与flags不同仍错误标“未创建”并丢Key Takeaways，见残留二。 |
| F04-06 Source元数据/快照 | CLOSED | Raw真实类型/名称/作者/日期/URL/标题同时出现在默认Source预览和正式页；缺可选字段明确未提供；人工Source标题/正文/A等级/verified及页标题/定义/推断保存后正式文件一致，PATCH仍返回raw；旧revision409。 |
| F04-07 合并事实 | CLOSED | 三页两种事实完整保留且去重；同事实引用两个不同证据；整理/推断/问题各3条；证据保留；正式页确有两种事实。 |
| F04-08 并发/删除/取消 | CLOSED | 同Raw6个并发提取复用唯一job和1草稿；6次两种先后顺序extract∥DELETE均无孤儿pending；取消后等待晚到响应无草稿，pending重启恢复/放弃待确认0且零正式变化。 |
| F04-09 失败/恢复 | CLOSED（本轮已测路径） | Source/第二页/Index/Log/Raw状态5阶段失败正确500+operationId，committed精确对应已写集合，解除故障恢复与第二重启幂等；prepared清单首次失败零正式变化；持续清单更新失败如实响应；Source已写但清单pending的真实exit(86)窗口恢复；真实index.md目录障碍恢复。 |
| F04-10 Key泄漏 | CLOSED（本轮4探针） | 非法JSON、401回显、schema未知字段、合法知识字段回显随机无效Key，GET job/config/state、日志、任务/Raw/草稿/正式文件零精确命中；全部失败零草稿/正式变化。报告只存计数/位置，测试Key已脱敏。 |
| F04-11 长文汇总 | **部分修复，OPEN** | >100k中文/CRLF/emoji逐块覆盖、末尾证据、并发≤2、callCount=块数+1和实际额外汇总通过；带Provider位置的每块事实/证据/整理/推断/问题输入完整。Provider合法省略可选start/end时已定位位置没有传汇总，见残留三。 |

浏览器同目录重启后Raw2/Wiki4/待确认0；16个数据文件SHA全部不变，包括Raw/正式页/Index/Log/草稿/任务状态/清单。界面成功证据与后端快照独立读取；正常UI选集路径通过并不抵消下列公开HTTP边缘。

## 三项残留最小复现

### 一：F04-04 重试静默忽略未知选择ID（P2残留）

1. 新草稿revision=1，确认 `selectedPageIds=[p1]`、`idempotencyKey=A`，201完成。
2. 同草稿、同key重试，选集改成 `[p1, 新生成的未知UUID]`。
3. 实际 **201 reused=true**，原operation `7410c25d-2ccf-42c0-8318-101b520bfd22` 被复用；未知ID被默默丢弃。

预期未知ID明确400 UNKNOWN_PAGE或确认payload不一致409，不能在比较payload前删掉无效ID，再报告该请求成功。首次确认本就逐项拒绝未知ID，重试需保持同一业务约束。位置 **services/wiki/commits.ts:111**，requested先 `.filter(id => knownIds.has(id))`，随后digest相等；并非重新产生了页面，但仍违反冻结“同key不同payload明确409”。证据场景 `F04-04-unknown-id-retry-not-silently-accepted` 保留第一次和重试完整响应。

### 二：F04-05 正式Source与实际确认选集矛盾（P2残留）

1. 草稿默认所有页 `selected=false`；PATCH只将p1标题改为「人工改名但未在草稿勾选」，不改selected，revision增加。
2. 公开POST confirm传当前revision和 `selectedPageIds=[p1]`，有效返回201，Source1＋p1确实创建。
3. 正式Source有 `[[人工改名但未在草稿勾选]]`，链接唯一resolved，但同一正文的“本次未创建的建议”又称此页 **未创建**；Key Takeaways为 **暂无**，即使p1有非空定义。

预期所有派生段落以这次确认的selectedPageIds为准：p1不应出现在未创建集合，Key Takeaways应包括p1定义。位置 **services/wiki/commits.ts:98**，selectedPages来自本次确认IDs，但skipped仍按旧 `draft.pages.filter(!page.selected)`；**services/wiki/drafts.ts:72** 的derivedTakeaways再次筛选旧flag。正常UI先保存flags通常隐藏此问题，而冻结公开confirm接口独立接收selectedPageIds，服务已把它用于真正创建集合，Source不能再采用另一套选集。证据 `F04-05-selection-renamed-page-and-skipped-text` 包含正式Source全文和resolved链接。

### 三：F04-11 汇总丢已规范化的证据全局位置（P2残留）

1. 27,200字符中文，每段quote唯一；fake合法JSON返回quote/rawId/id，**不提供可选start/end**。四块摘要不同，实际触发一次额外汇总请求。
2. 产品成功计算草稿完整Raw UTF-16位置，如第一块 `[0,16)`、第二块 `[7600,7616)`，全部精确匹配原文。
3. 实际汇总HTTP每条事实的evidence仅有 `{id,quote}`，缺start/end；草稿却有正确的这些位置。

预期汇总使用块证据验证后的完整结构化结果，保留已计算全局位置及来源，不能依赖模型恰好提供可选hint。冻结明确“每块 evidence 转完整Raw全局索引后验证”和“汇总输入包括所有块结构化结果”，返修报告亦声称每个事实的证据包含全局start/end。位置 **services/llm/service.ts:313–318**：从 `entry.result.suggested_pages`（原Provider对象）读取证据，而已规范化数据在 `entry.pages`。证据 `F04-11-no-provider-offsets-summary-gets-located-evidence` 同时保留真实汇总payload和规范化draft证据。这项不代表草稿本身定位失败，也不代表带hint的长文汇总失败。

## 恢复、未测与数据边界

F04-09的故障分两类：acceptance-only preload包装Node builtin rename/appendFile的明确EIO/exit(86)，以及真实index.md被目录占位。无产品模块导入/产品文件修改。持续清单故障时Source已写，磁盘source phase仍pending，500响应现保留operationId、已写1个ID、committed=true及failedPhase=source；解除后同目录重启补齐到4个文件，同操作新key重试和第二重启不重复文件/Log。prepared首次清单错误committed=false且草稿可审阅。Raw文件SHA前后不变。

本轮没有重复前轮无变化的60秒timeout整套测试，也没有执行十分钟总期限、legacy Raw>500k、aggregate51、所有Provider错误完整矩阵、缺配置提取请求、最终draft-confirmed写和最终completed清单写单独故障。缺配置UI展示由主Agent实测，拒绝请求的历史证据保留，不宣称该请求在本轮已再次运行。此前通过证据仍保留，但不宣称这些边界已在返修版全部独立重跑。B03仅跑5个受影响业务场景，不把首次16/16复制为本轮整套。

各脚本用新 `%TEMP%/fmcg-b04-recheck-*` 数据及OS分配闲置localhost端口，明确FMCG_DATA_DIR，没有进入正式workspace。全部后端自有产品子进程和fake HTTP服务已关闭，cleanup在专项JSON；主Agent专属API/UI/fake三PID及标签也已关闭，见 [浏览器清理记录](runtime/B04-recheck-browser-cleanup.json)。隔离数据/故障观察/日志留存复查，不递归删除用户数据。没有读取真实Key或开发工具凭证，只有随机无效fakeKey。Token计量平台未提供，记不可得。

**本轮不可PASS。三项残留返修后定点复验；即使全部确定性缺陷关闭，真实Provider未配置时整批仍BLOCKED。下一批B05未授权。**
