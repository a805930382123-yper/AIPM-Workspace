# B09集成独立准备与适用性审查

最终代码关联：主线程产品修复/测试/入口提交 `c6474fe98c63440d7b9cbdb7fe15e98eb8b6aba8`。本实例已核HEAD及该提交对本轮产品/测试/脚本工作区diff为空；此前阶段按各自冻结版本保留，不把旧失败改为通过。

2026-10-29，Astra resume_scope，当前主线程基线0cbb918；完整App隔离入口仍待Sol交接。本轮仅必要只读证据/版本核对，不运行测试、不读key、不调用真实模型、不修改主矩阵/产品。知识261/500、Prompt15/24不变。以下是证据适用性，不是当前四链PASS。

## 未受影响历史证据适用性

实际执行Get-Content/Select-String读取原109项矩阵、B03初验与返修报告；git diff --name-only 1c2c156 HEAD限定services/raw、search、prompt、demo、备份入口、依赖锁；Get-FileHash核parser。

- A04/A05解析子能力：services/raw/parse.ts实际SHA `92545e34e614ce629d60974482cc081ef7a21036d7aac430d1f1e2d8a16cb229` 与B03原独立实际解析证据一致；package-lock自首次快照1c2c156至当前无变化，raw/parse及raw/store亦无变化。应引用 **B03-recheck-acceptance.md** 的最终PASS（16/16后端、10/10浏览器等），原矩阵链接B03-acceptance.md实际为历史FAIL，不能直接拿它签最终PASS。解析器正常/失败样本可复用；当前RawPage和共享storage/files后续有变更，当前上传UI闭环不能凭parser未变直接重签。历史Node25.2.1实测不冒称当前Node24完整解析实测，最低版本仍未测。
- A35及中文检索/去重子条件：services/search在Git中最后修改仍是首次快照1c2c156；services/wiki/store.ts在该基线至HEAD无变化。复用B02最终及B03返修B02回归12/12的标题/别名/标签/正文/分类搜索证据；当前App点击搜索/来源导航仍由I01提供，不把索引引擎未变当UI已测。
- A62/R44：services/demo/service.ts及其目录自1c2c156无变化，B09独立报告的显式种子1Raw/5Wiki/4Prompt、幂等及演示标识证据可复用。当前首页/入口仅做集成可见性检查，不重灌多轮种子或重复故障矩阵。
- R40及A59的Prompt文件/独立性子能力：services/prompt目录自1c2c156无变化，复用B07-repair3及B09的Prompt独立存储、变量/元数据导出、删除关联边界证据。当前shared storage及App外层有变化，I03/I04仍须实际保存/版本回读与知识日志隔离，不能以此替代真实Prompt四阶段。
- R43排除项本轮修复没有新增外部运行Agent/多租户/自动研究等功能；这是本轮变更范围核查，不冒称重做全仓扫描。R46交付说明必须更新，历史PASS不能直接覆盖本轮新限制。

## 窄补验与非扩项

A57持久化、A58导出及B09恢复：scripts/backup_workspace.ts未变，但services/storage/files、record-validators与新等级/快照数据结构有变化，I05/I06需当前数据导出至空根、重启读回，检查新增字段及审批/来源关系。无需重跑未变的全部恶意归档矩阵。

A60失败安全：Provider/知识结构契约已变，不能全复用旧“不变Provider”说法；采用当前strict、R22、模板更新定向失败证据补对应边界，其他未变Prompt失败机制沿历史报告。A61无LLM当前UI小闭环仍在I05。

本轮不裁A63/R42、R22、模板更新U05及完整四链；它们各自等对应实际证据。上述已核目录无变化是自首次Git快照至HEAD的窄比较，并非声称所有历史报告都以该commit运行；历史无Git阶段仍按其原SHA证据归属。当前准备入口交接后在本文续写独立结论。

## 续接独立核对（integration_audit，2026-10-29）

本实例独立于施工者，主线程回传实际创建参数为 `model=gpt-6-astra`、`reasoning_effort=medium`、`fork_turns=none`，工具成功创建 `/root/integration_audit`；施工为另一实例 `/root/integration_prepare`，实际 `gpt-6.1-sol/high`。沿用已冻结B评分0/2/2/1=5，不重规划。本次 `git rev-parse HEAD` 为 `0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89`。只写本独立报告，未修改产品、准备脚本或主矩阵。

实际命令为 `Get-Content` 读取AGENTS、status顶部、B09批次/集成任务卡、本报告与当前矩阵，`rg -n 'B09|项目状态预检|独立验收' docs/acceptance.md docs/coordination.md`，以及 `git status --short`、`git rev-parse HEAD`。PowerShell按 `^\| [AR]\d{2} \|` 提取矩阵行并按ID及第4数据列分组，确认109唯一ID、63A+46R、16 REUSE_PASS/91 PENDING/2 NOT_RUN，与草案声明一致。这是文档完整性核对，无产品测试次数。

此前本报告已核未变化parser/search/demo/prompt边界，续接不重复相同SHA/历史测试。R22和模板更新的最新独立结果可更新相关历史状态，但不能据此批量签当前完整App结果。矩阵顶部“浏览器初始化失败”是此前状态；主线程现已恢复CUA getState及空白IAB标签，仅证明控制入口可用，不等于任何验收链实操通过。

尚缺必选证据沿原冻结卡：I01模板更新预览/显式确认与正式版本、双来源、日志及原文不变（亦为U05）；I02真实待确认Audit的实际接受/修订/resolved；I03/I04 Brief、generate、check、rewrite四次分段实际UI操作和输入/输出/正式Prompt版本关联；I05同根重启回读与明确禁用Provider的手工UI闭环；I06新空根恢复与不消耗真实请求的失败恢复；I07逐行当前适用性及最终统计；I08交付说明。知识最多2、Prompt最多4，起点261/500与15/24，首失败停。

R16/R18按现行PRD与集成卡可由模板、COVER/HUMAN/O/Q及当前I01受影响回归组合判定；旧自动质量FAIL保留，不要求重新抽样至自动完美。事实改写、问题丢失、编辑不失审、未审正式写入等仍属工程FAIL。

阶段结论：既有准备适用性复用可继续；本次尚未收到Sol停写交接，未签新入口PASS。B09整体仍待验证。真实模型调用0、配置读取0、浏览器/服务启动0、产品测试0；知识261/500、Prompt15/24保持。下一步仅在施工停写交接后核入口实物，并等待主线程实际UI证据再裁决。

## 停写交接后的入口独立裁决

Sol已确认两个入口及builder报告停写。实际读取两脚本全文、builder、server/index.ts及LLM配置定义、Provider/Audit/Prompt调用点；`Get-FileHash`核三文件与交接完全一致：run `e8461cbd627004c75bbcdf5b15acf86571ce932774ba56b41af9e7d477bec77e`，trace `e30395264312fe8148018973effc0d3bedde149887bf2df1f2d408f545580f62`，builder `c83708673cae6ef78cdcf9f64a447f0d98f678e41a44d87617bffd427d6d72ed`。首次读取时builder尚未写完不存在，命令exit1仅来自缺该报告；收到停写后已正常读取，不列产品失败。

独立静态核对：入口使用完整 `server/index.ts` 与built App；prepare只复制R22历史候选，检查身份、磁盘候选等价和Raw正文/摘要，复制逐文件验SHA；没有虚构确认或当前调用。manual清除三个LLM环境变量、指定空配置、禁止模型HTTP入口，trace二次禁止complete。real需start放行和按阶段arm；四个Prompt动作单次complete，Audit原调用无purpose，仅Audit由trace补knowledge计账；每stage一次、知识2/Prompt4上限，Provider错误写halt。未改模型返回，不将fake混为真实输出。

当前交付根为 `C:/Users/80593/AppData/Local/Temp/b09-integration-20261029-STdmKw`，session `e90e80df-e7e0-43b4-9c7e-c88dd7fffcad`、freeze `c6a70d168cca85feae96d4cfc97d732034f155db341a282ee92ad9aa99329fd8`。只读遍历freeze.files并逐项 `Get-FileHash`：**102文件、0不匹配**。主线程正在该根操作，独立实例未改该根、未并行启动服务。

只读核既有smoke根 `.../b09-integration-20261029-6KDXCo` 与恢复根 `.../b09-integration-20261029-N7xKeF` 的knowledge/drafts/state/prompts/meetings，实际使用 `Get-ChildItem -File -Recurse`、`Get-FileHash`、`Compare-Object`：**原8文件/恢复8文件，路径及SHA差异0；smoke calls目录0项**。active-app记录manual完整后端与built App，ui-http有7个API GET全部200。施工同SHA的成功smoke exit0、11HTTP、6次fake成功及1次fake失败停作为可信同版结果复用，未在本实例重跑；其stdout无独立落盘副本，此限制保留。恢复8文件是初始R22资产，尚不含待执行的四链正式结果，不能替代I06最终恢复。

本轮未重build；模板更新施工报告已有同产品版 `npm run build` exit0，但未冻结该次dist SHA。当前102文件freeze绑定实际dist和源文件，不能仅凭freeze断言其生成时间/构建出处。U05等当前UI仍需实际操作验证。session中的realCalls/config计数只是准备快照；启动real后以calls/httpSent及实际配置读取证据记账，不沿用零值。

**入口准备PASS（限定隔离、历史候选保全、完整路由入口和有界账本能力）；本轮无新产品缺陷修复可签。I01–I08、U05及B09整体仍待实操，不签PASS。** 本实例新增真实调用0、配置读取0、浏览器/服务启动0、产品测试0，仅静态审查和既有证据独立比对。后续主线程实际阶段失败/未知即停，当前真实网络可用性未在本准备审查验证。

## 当前UI发现：U05未关闭

主线程完成R22候选的编辑保存、刷新、重新审批和显式正式创建，并交接Source `80dcf14b-2a8b-4610-8895-ae74c1a37205`、Concept `869df8fc-8634-4a60-8ba4-c041aefd6562`、operation `f9f54bae-8b04-4e81-9496-16939d8d8fa3`。本实例实际读取并查看 `B09-INTEGRATION-20261029-evidence/i01-wiki.txt` 及 `.png`：完整工作台中文“结构化输出”搜索命中两页、Concept第1版、来源A、可打开原Raw、人改AI草稿标签和事实/问题分区可见。该最终截图证明正式回读结果，不独自证明此前每个点击；过程以主线程原始操作记录为据。正式Wiki“人工审核：未审核”是独立知识审核元数据，不等于草稿逐页审批失效。

主线程随后报告U05实际被阻断；本实例只读复核 `DraftReviewPage.tsx` 的 `makeUpdate` 仍有 `hasTemplateFields(...)` 直接抛错“本批字段归位仅支持新建正式页，旧 Wiki 更新未执行”。这是确认的当前UI工程缺陷，**U05 FAIL待返修，B09整体未通过**，不能继续仅标环境BLOCKED。先前U01–U04后端工程证据不覆盖此UI guard。Sol已获主线程授权最小修复；验收者未改产品。修复/build后必须重新冻结当前文件，旧freeze仅证明原版准备，不放行新版本真实阶段。当前已confirmed草稿不可伪改回pending；后续合法候选/目标准备需保留原始身份及输入版本。

## I01创建与综合子链独立核验

主线程补交 `B09-INTEGRATION-20261029-main.md` 和 `i01-export.json` 后，本实例用 `Get-Content/ConvertFrom-Json` 读取导出与R22原extract/synthesis候选，逐字段JSON比较，用 `Get-FileHash` 将导出两份Raw文件SHA与原始归档比较，并读取当前两次commit及知识日志。结果：两Raw完整Markdown SHA均一致；提取页source_facts/source_evidence/open_questions均与原候选一致；综合sections/evidence/rawSnapshots均与原候选一致。

提取draft当前confirmed/v4，one_line_explanation人工改文和humanEdited=true保持；审批digest与completed commit `f9f54bae-8b04-4e81-9496-16939d8d8fa3` 完全一致。综合workflow当前confirmed/v3，审批digest与completed commit `6644f3b3-86b0-40f8-9978-6057febcecaa` 完全一致。知识日志恰4个create：前者Source/Concept各1，后者未知Source `961b41f7-0784-43dd-ae20-d2205f871db9` 与Synthesis `b57c36ac-0e0e-49cf-bf2b-6dceace5f288` 各1，全部revision1；综合保留两个Raw来源、整体D、对应来源A/D。导出calls=0，历史模型身份/规则版本保留，不冒称本轮生成。

主线程过程报告及其CUA操作记录作为实际UI动作证据复用：编辑后已审1→0、刷新保持、重新审批0→1、显式写入、搜索和来源回跳；综合未审先被拒绝后显式审查确认。独立磁盘比对与最终PNG/AX支持其结果，未用HTTP代签点击。`i01-synthesis.txt` 是Raw视图最终快照，不单独当作综合正式页截图；综合确认动作依据主线程过程，正式结果依据导出/commit/日志。首条综合引文缺尾词Schema为既有已披露限制，本次未修改，也不签逐引文语义完整性修复。

**I01创建/综合人审与正式落盘子链PASS；整个I01仍因更新U05待返修未通过，B09整体未通过。** 本结论适用于0cbb918及原冻结完整App；后续最小UI修复若未影响该子链可复用，不重复提取或已通过点击。真实调用仍0，知识261/500、Prompt15/24保持。

## UI最小修复独立复验与U05准备放行

Sol再次停写后实际 `git diff -- app/pages/DraftReviewPage.tsx tests/ui-b04.test.tsx` 核范围：产品仅删makeUpdate旧模板throw并修改旧说明；PATCH保存完整快照、使用保存后revision、POST updates、成功再导航均保持。未修改后端审批门禁或模型行为。独立运行：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --test --test-name-pattern="B09 template" tests/ui-b04.test.tsx
```

**2/2 PASS，exit0，duration1917.8231ms**。Concept/Process两组件实际点击均覆盖模板原样送PATCH、正确revision/目标进入updates、后端409原错误可见/无导航/无自动重试、下一次明确点击成功导航且没有confirm。测试是React＋HTTP stub，不代替真实模型或桌面U05。

`Get-FileHash` 独立确认DraftReviewPage `044c57d3cbc19c1b3b2ea4b5555277be1b31a1e80b7f75547496eb9615b5a292`、ui-b04测试 `3eb879e3aaaa06cd2fb81d1975042c6dc8ce17d8ad8fca1fac49adaab6048b0d`、dist/index `a247d9d5f3d095519ae05cf14708fe63a4e4bc878f95359cec58c452d4bf3807`、built JS `02fe7364f342f1b3dd6fe25c860939af3efc8524cb9681eef26f6fe89b3abb78` 与交接相符，因此复用同版施工18/18及build exit0，不重跑已通过全量。普通sandbox EPERM与升级成功记录并列保留，不算产品失败。

新根 `C:/Users/80593/AppData/Local/Temp/b09-integration-20261029-7SOfcf`，session `add48a69-7222-408b-9a05-de83fe2688ef`、freeze `d63870be02d27c115326518de23d9eaa326e9dee523441bb0333642cb76af902`：独立逐hash **102文件0漂移**。读取wiki-inheritance清单并在原STdmKw/新根两边比对，**6文件0差异**；pending draft与原R22文件逐字同SHA。四正式Wiki＋index＋日志来自已完成实际UI，原confirmed记录未篡改为pending；新根是历史pending分支叠加可追溯正式目标，不冒称新根重做过创建操作。

**本轮旧UI阻断缺陷工程修复PASS，U05准备可放行；U05真实及B09整体仍未通过。** 主线程可绑定新session/freeze执行既有上限内的一次update；目标优先继承双来源Synthesis v1，是否可选和更新语义须实际UI核验。若阶段失败/未知即停。知识261/500、Prompt15/24不变，本独立复验真实/config0，不启动服务或实际浏览器。代码基线为0cbb918加上述两文件，最终提交由主线程关联。
