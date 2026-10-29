# B09 续接缺口映射（2026-10-29）

本文件是现状映射，**不是新验收报告，不签任何新 PASS**。主线程授权本实例只读整理，随后授权独占写入本文；产品、测试、旧矩阵与状态未改。只读时 HEAD 为 `2fe5318e70e188cf28c15af7867aacf460213d66`；共享工作区中主线程正在另行处理 OpenAI strict schema，本文不重复 O/Q 技术方案。真实调用、配置读取、测试、服务与浏览器启动均为 0。

依据 [B09](../batches/B09.md)、[验收规约](../acceptance.md)、[旧109项矩阵](B09-delivery-matrix.md)，并以最新独立报告修正历史索引的适用性。旧矩阵“缺配置”及旧73/36、F3的78/3/28只是当时快照，不代表当前统计。

## 除 O/Q 之外的最小收口集

| 对象 | 有据现状 | 最小剩余动作 |
|---|---|---|
| R22 来源等级职责 | 已证代码将新 Source/提取页/综合页固定为 C；旧人工编辑可用。PRD §19要求 A/B/C/D及“用户可以修改 AI 的判断”，当前实现和文案实际采用人工参考判断。详见下节。 | 先裁决并实现/验证等级判断职责及默认值政策，不能笼统记“真实模型未测”，也不能凭默认值断言所有人工编辑失败。 |
| A63 / R42 完整桌面四链 | 知识 A/BR/C、综合、人工问题与字段、Prompt、Audit各有分散证据；HUMAN lab没有完整 App Audit 路由，F3 Audit确认经 HTTP，当前组合版本四条完整真实 UI 链尚无统一证据。 | 在隔离数据根和当前完整 App 实际点击四链，关联 Raw/Draft/Wiki/Audit/Prompt/operation ID、来源及日志。可复用已保存真实候选，新增请求按确实缺少的阶段计算，不默认重跑模型。 |
| 版本适用性、持久化及恢复 | A57/A61/A62、备份/恢复、错误安全已有历史 PASS；后续 App、共享存储、LLM边界及草稿规则有变化，旧整冻结不能直接套当前。 | 对变化落点作窄适用性审查；同一集成数据根刷新/重启、必要失败恢复、导出到新空根逐文件回读。历史恶意归档矩阵无新受影响边界无需全重跑。 |
| 最终109项交付关联 | [NEXT-PREP映射](NEXT-PREP-20261024-gap-map.md)已覆盖31个旧非通过ID及其余78项，但后续局部通过未形成当前整行裁决。 | 逐行关联有效证据、受测提交和限制；更新当前交付说明/运行入口/真实Provider支持范围，分别裁决局部修复和B09整体。不能由O/Q两目标直接宣布B09通过。 |

R16/R18整项的最终裁决仍需主线程将 O/Q 结果与既有模板、Concept、HUMAN证据合并；旧246/248/252自动FAIL原样保留，不等于必须重复抽样至原稿全完美。本文不为未完成的 O/Q 预签通过。

## R22：已证行为、问题与待裁决边界

- `services/wiki/drafts.ts:256,294`：`create`和`fromExtracted`给 Source及知识页固定 `source_level: 'C'`，未采用模型等级；注释称其为未知资料可人工提高的保守默认。`services/wiki/knowledge-workflows.ts:390,401,409`的更新补Source及综合正式页亦固定C。
- `rules/source-policy.yaml`明确D包含“来源未知、营销软文或尚未核验的 AI 内容”，guidance却采用“人工可编辑的参考判断”；`services/wiki/render.ts:85`输出“来源等级（人工判断）”。因此，**固定C并非AI判级证据；未知材料默认C与D规则之间存在已证政策不一致，PRD所述AI判断职责未在这些创建落点落实**。这比“未做一次真实判级测试”更具体。
- 定向 `rg` 在当前 `knowledge-extraction.ts`、`knowledge-planning.ts`、`kb02-facts.schema.json`、`kb02-planning.schema.json`、`wiki-extract.schema.json`未找到 `source_level/sourceLevel/sourcePolicy`。这支持“当前链未传递等级判断”的静态结论，不冒称运行反例或全仓形式证明。
- 人工能力存在：`DraftReviewPage.tsx:282,312`有Source/页等级控件；`drafts.ts:342–357,494`保存并校验，`commits.ts`传入正式页；`WikiPage.tsx:234`支持正式页改等级。历史[B02](B02-acceptance.md)及[B04第二次返修](B04-recheck2-acceptance.md)提供人工编辑证据，不能重列旧F04-01为OPEN。
- 下一裁决应明确：继续承诺AI初判还是明确调整产品职责、未知输入默认D还是其他有据规则、单来源/综合页怎样保留人工选择。该政策决定之后再做最小定向与UI保存回读；本映射没有擅改PRD或授权真实模型抽样。

## 已可复用的近期独立证据

| 能力 / 对应ID | 有效证据和边界 |
|---|---|
| 双来源综合 A18/R20/R07子条件 | [SYN01最终](SYN01-VERIFY-AUDIT-20261026-final.md)：固定双Raw真实244，一致/冲突/未知/未来、显审、3正式页/8证据/12unit/3日志、刷新回读PASS。旧242/243失败保留；不能按10/24旧图再列“没有真实综合成功”。 |
| 人工独立问题 R12 | [R12最终](R12-AUDIT-20261026-final.md)：同C09/10人工标记→独立问题→14页显审→3页正式回读；Raw/事实/证据不变。原自动分类FAIL仍保留。 |
| Concept及Process字段 | [COVER](R1618-COVER-AUDIT-20261028-real.md)：Concept真实质量PASS，C/P Draft及渲染保真PASS；[HUMAN最终](R1618-HUMAN-RESUME-AUDIT-20261028-final.md)：P纠偏、审批1→0→1、Source/Process正式回读PASS。outputs及question-only缺证由O/Q处理，HUMAN lab不代完整Audit链。 |
| 提取、更新、冲突、长文及Raw保真 | [A](KB02-K204-A-AUDIT-20261023-resume-final.md)、[BR](KB02-K204-BR-AUDIT-20261024-final.md)、[C](KB02-K204-C-AUDIT-20261024-final.md)、[HUMAN收尾](KB02-HUMAN-CLOSE-20261023-acceptance.md)：按样本支持 A06/09/10/23/24、R09/11/15/17/19/23/24等；不能把metric/entity证据代签所有模板。 |
| Prompt生成/优化及恢复 | [PA01续验](PA01-CONTINUE-20261016-acceptance.md)：真实Brief7、generate2、check3、rewrite3；六模板+custom、修改Brief/选Wiki、弱/完整优化、浏览器恢复保存及新版本。SP-F01、BL-F01、ST-F01及R-01/R-02已关闭，勿按F3旧行重开。当前共享边界适用性仍需核对。 |
| Audit | [FULL3](FULL3-20261014-acceptance.md)真实有指导Audit成功；正确20%已在人工反馈，非自主发现。accepted确认当时走HTTP，补实际桌面点击；B06/FULL2定位、四决策与日志工程可复用。 |

## 完整 App 最小 UI 步骤与证据

1. Raw导入/打开→实际AI候选→人工纠偏/显审→明确确认Wiki→详情返回Raw→中文搜索；同链覆盖旧Wiki更新预览、确认前不变、确认后版本/双来源/日志。
2. Wiki整页或段落提交Audit→显示已保存真实建议→预览/明确accepted→正式Wiki变化→Audit resolved→刷新读回及处理日志。不能只用API写状态代点击。
3. 自然语言任务→真实Brief→人工修改→勾选/取消Wiki→真实Prompt Preview→必要编辑→明确保存Library→读回元数据、变量及关联。
4. 旧Prompt→真实九维检查→优化→编辑→保存原Prompt新版本→新旧版本回读；核Prompt操作没有伪造知识日志。
5. 同根刷新/重启，核关键ID/正文/版本/计数/日志；导出/新空根恢复并回读。无LLM手动和错误安全尽量复用未受影响历史证据，仅为变化落点补验证。

每条标明候选究竟来自哪个历史真实响应/受测版本，当前UI与当前持久化检查单独记录；不把历史响应重放称当前Provider重新成功。

## 脚本入口与复用限制

- 完整生产server/Vite隔离启动参考：`tests/acceptance/full3-20261014-lab.mjs`；Prompt恢复参考 `pa01-continue-20261016-lab.mjs`。两者会读取真实配置，并写硬编码历史前缀/根；**不可原样运行覆盖旧证据**，只作新前缀/显式预算入口的参考。
- 真实候选/显审导出模式：`SYN01-VERIFY-20261026-cli.mjs`、`SYN01-VERIFY-20261026-server.mjs`；知识A/BR/C的 `*-server.mjs`及 `*-final-check.mjs`可参考ID/来源/幂等核对。它们仍是专项lab，不能充作完整App四链。
- `R1618-FIELDS-20261026-lab.mjs` / `-browser.tsx`已有实际人审成功，但没有完整Audit路由；已有 `R12-AUDIT-20261026-final-check.mjs`及 `docs/reports/SYN01-VERIFY-AUDIT-20261026-final-check.mjs`是固定历史证据只读核对。
- 备份：`scripts/backup_workspace.ts`实际实现；`tests/acceptance/b09-backup.mjs`覆盖新空根、字节一致和恶意归档，`full3-20261014-backup.mjs`覆盖真实AI隔离资产/meetings。后者读取配置且写历史报告，前者基于旧fake契约，均须先检查适用性与输出前缀。`b09-backup-race/change.mjs`仅在对应边界变更时重跑。
- 历史适用性工具：`docs/reports/NEXT-PREP-20261024-verify.ps1` / `NEXT-PREP-AUDIT-20261024-check.ps1`提供冻结比较方式；旧213/188/96项数量只能按各报告当时版本解释。

## 预算记录来源

- 最新公开知识账：`docs/reports/R1618-OQ-20261029-real-evidence/output/result.json`、`session.json`、253/254的`attempt/request/response`；[独立真实报告](R1618-OQ-AUDIT-20261029-real.md)记reserved=sent=realCalls=2、configReads=1，知识252→254/500、Prompt15/24，Q255–256未放行。该报告关于254语法的早期误判已由[零调用诊断](R1618-OQ-DIAG-AUDIT-20261029.md)澄清，不重复其错误根因。
- Prompt独立账：`docs/reports/PA01-CONTINUE-20261016-budget.json`，15/24，分项7/2/3/3；不能与知识额度混算。旧KB02阶段上限40/74/200是历史窗口，不回退累计账。
- OpenAI连接验证另列：[主线程真实记录](OPENAI-CONNECT-20261029-main.md)及`OPENAI-CONNECT-20261029-result.json`，真实连接1/config1、26输入/4输出token，知识254/500与Prompt15/24保持。
- `/500`与`/24`为累计历史上限/账面剩余，非自动放行。后续实际请求只按主线程当前用户授权和新的冻结会话计，失败/超时计实际外发；可复用候选不另收一次模型调用。

实际检查仅Get-Content/rg/rg --files及一次 `git -c safe.directory='E:/AI/Work/AIPM Workspace' rev-parse HEAD`。若干猜测路径不存在/PowerShell通配rg失败后已改用实际路径；未把这些查询错误当产品失败。本文无测试命令或新验收结果可报告，交主线程独立核查、统一提交，不改状态或旧矩阵。
