# B09 完整 App 隔离准备施工交接

2026-10-29，Sol High integration_prepare。受测代码提交 `0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89`，加本报告与两份未跟踪入口。依据 B09-INTEGRATION-20261029-task。仅准备与零真实调用自查完成，**四链 UI、真实 update/Audit/Prompt、重启 UI 及本批整体尚未验收**。主线程另行独立裁决。

本轮只修改 `tests/acceptance/B09-INTEGRATION-20261029-run.mjs`、`trace.mjs` 范围内既有准备入口及本报告；实际补丁仅在 run.mjs 增加 R22 源存在、候选身份、候选与磁盘一致、Raw 原文与摘要、259–261 原请求响应文件存在检查。未改产品、Raw、正式 workspace、其他并行文件；未启动用户服务、未提交。知识261/500、Prompt15/24保持。

## 隔离副本与身份

历史真实源为项目下 `.scratch-R22-REAL-20261029-1tqItB`，实际存在。提取/综合候选与对应磁盘草稿逐 JSON 一致，两份 Raw 原文及摘要匹配候选。prepare 逐文件复制 knowledge/drafts/state/prompts/meetings，复制后核 SHA；259–261 的公开原请求/响应、候选、旧规则 freeze/session 保存在新根 `integration/r22-original`，不复制 private 文件或凭证。历史输出回读不是当前模型生成。

最终交接根：`C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-STdmKw`，尚未启动服务。session `e90e80df-e7e0-43b4-9c7e-c88dd7fffcad`，freeze `c6a70d168cca85feae96d4cfc97d732034f155db341a282ee92ad9aa99329fd8`。copied 共7文件，Raw 2、提取草稿1、综合workflow1；初始正式Wiki/Prompt均无记录。

- 官方 Raw `c394e1a3-8b0d-4cbd-b943-1c60afa15a3d`，body SHA `801d022180ecc04dac73dd8ce49901d8b8ba3787b41997bf1af5bb547f32e773`。
- 未知来源 Raw `f021c715-6c0e-4b4a-8561-3b92ded31d39`，body SHA `82cec1034f72f09e493fa2425e39534fda9097a8350e2be64ef1ea6c94cfed9e`。
- 未确认 Draft `72bf8cbb-c209-49ba-9726-4eca9fc77c71`，文件 SHA `c56e6bb572e96206e3bb669defbc65d1fde36f6ddcbf6b9b490accc78f7267dc`；Concept页 `7da476c3-7f38-46fd-bb4d-dbd47bd231b3`。
- 未确认综合 `0c43e564-eb0e-43fa-b8c9-b177094415a0`，文件 SHA `1d59de517667c58a1cc298b91288edec9f9d36aecde0b8a6e579c2d95e9475f4`。

旧Wiki更新与Audit目标应由主线程先通过当前完整App确认生成，再实际预览/审核；不能将初始无目标称为已完成更新。可将已确认正式Concept作为旧目标，仍保存输入草稿的人审与完整字段。Prompt旧版本起点也由实际UI先保存生成结果或手工资产，不虚构历史版本。

## 实际检查

实际 Node `v25.2.1`。普通sandbox首次运行 `node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs smoke` 返回 `BACKEND_NOT_READY`，进程经 Ctrl+C 结束；该命令的sandbox TEMP不与后续shell共享，不作产品失败判断。随后授权升级在真实共享 TEMP 执行同一 smoke：exit0，2.352秒；11 HTTP检查通过、明确禁用Provider的Brief及连接探针均503、calls空。正式备份入口导出并恢复到新空根，资产路径/文件SHA集合完全一致。

smoke根 `C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-6KDXCo`，恢复根 `...\b09-integration-20261029-N7xKeF`，归档 `...\b09-integration-20261029-6KDXCo-backup.json`。检查结束后隔离服务正常停止。离线trace探针成功6次fake complete，知识序号262/263、Prompt16–19；上限拒绝通过。另一个独立manual根1次fake网络失败，第二次被首失败停拒绝。总计7fake、真实外发0、真实配置读取0；fake仅检验入口门禁，不替代真实产品质量。

随后升级执行 `node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs prepare` 创建上述最终 STdmKw 根，exit0。`git diff --check` exit0，仅他人现有文件LF→CRLF提示。未重跑产品全量测试或build；此处完整App使用现有dist，freeze同时绑定当前app/services/server/rules/dist与脚本/依赖。

## 主线程操作命令

所有命令从项目根执行，必须使用可读写真实用户 TEMP 的执行环境。先禁用Provider供零调用UI：

```powershell
$integrationRoot = 'C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-STdmKw'
node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs serve $integrationRoot manual 5179 63992
```

打开 `http://127.0.0.1:5179`。完整server/index.ts和built App注册全部路由；每次模型入口均被manual模式拒绝。该session仍kind=integration，可在正常关闭后，同根授权real模式续接。独立无LLM新资产验证若需单独根，运行 `prepare manual` 后使用其root启动相同manual模式。不要将两个根混称同一测试。

采集磁盘辅助证据（UI仍由实际点击和截图证明）：

```powershell
node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs snapshot $integrationRoot
curl.exe --noproxy '*' 'http://127.0.0.1:5179/integration/export' -o "$integrationRoot\integration\main-export.json"
node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs backup $integrationRoot "$integrationRoot-backup.json"
node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs restore $integrationRoot "$integrationRoot-backup.json"
```

restore 返回新空根恢复结果，kind=manual，启动新根只能manual；从UI核代表资产。服务正常Ctrl+C后，同原根同命令重启核持久化。若启动失败，先停止该隔离进程并读取 `integration/backend.log`，不要留服务或重新发模型请求。

real模式尚未启动。主线程已报告当前Windows手动代理禁用、常用代理端口未见监听，必须先解决当前实际网络入口后再执行；本报告未读取配置或Key、未签网络可用。主线程独立放行时可用下列 PowerShell 生成明确release（先构造start，再逐阶段构造stage；施工未执行这些命令）：

```powershell
$session = Get-Content -Raw "$integrationRoot\integration\session.json" | ConvertFrom-Json
$release = [ordered]@{ kind='start'; sessionId=$session.id; freezeSha256=$session.freezeSha256; issuedBy='main'; issuedAt=[DateTime]::UtcNow.ToString('o'); released=$true; budgetApproved=$true; knowledgeBefore=261; promptBefore=15; knowledgeCap=2; promptCap=4 }
$releaseFile = "$integrationRoot\integration\main-start-release.json"
[IO.File]::WriteAllText($releaseFile, ($release | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
$releaseSha = (Get-FileHash -Algorithm SHA256 $releaseFile).Hash.ToLowerInvariant()
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs serve $integrationRoot real 5179 63992 $releaseFile $releaseSha
```

启动只读取配置，不发模型请求；每个实际UI模型操作前单独arm。下例必须在主线程判定上阶段通过后、另一shell执行，并按实际阶段改4项；audit/rewrite占位ID换成真实UI返回ID：

```powershell
$integrationRoot = 'C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-STdmKw'
$session = Get-Content -Raw "$integrationRoot\integration\session.json" | ConvertFrom-Json
$release = [ordered]@{ kind='stage'; sessionId=$session.id; freezeSha256=$session.freezeSha256; issuedBy='main'; issuedAt=[DateTime]::UtcNow.ToString('o'); released=$true; budgetApproved=$true; knowledgeBefore=261; promptBefore=15; knowledgeCap=2; promptCap=4 }
$stage='update'; $purpose='knowledge'; $route='/api/knowledge/updates'
$release.stage=$stage; $release.purpose=$purpose; $release.route=$route; $release.maxCalls=1
$stageFile="$integrationRoot\integration\main-$stage-release.json"
[IO.File]::WriteAllText($stageFile, ($release | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
$stageSha=(Get-FileHash -Algorithm SHA256 $stageFile).Hash.ToLowerInvariant()
node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs arm $integrationRoot $stageFile $stageSha
```

| stage | purpose | route |
|---|---|---|
| update | knowledge | /api/knowledge/updates |
| audit | knowledge | /api/audits/实际Audit-ID/propose |
| brief | prompt | /api/prompt-ai/brief |
| generate | prompt | /api/prompt-ai/generate |
| check | prompt | /api/prompt-ai/optimize/check |
| rewrite | prompt | /api/prompt-ai/drafts/实际草稿-ID/rewrite |

每阶段1 complete，上限知识2、Prompt4；不用兼容optimize两调用入口。首Provider失败或模型阶段HTTP失败写halt，不重试；未知pending按一次占用并停止。trace在 `integration/calls` 保存Provider实际完成调用与httpSent，另存原始request/response/wire输入输出（无鉴权头，private文件不公开），ui-http与http-stage只作辅助。session计数是准备时快照，**不能把其中realCalls=0当启动后的实时账本**；实际配置读取没有运行时计数器，real阶段不得声称配置读取0。

## 交接文件指纹

| 文件 | SHA256 |
|---|---|
| tests/acceptance/B09-INTEGRATION-20261029-run.mjs | `e8461cbd627004c75bbcdf5b15acf86571ce932774ba56b41af9e7d477bec77e` |
| tests/acceptance/B09-INTEGRATION-20261029-trace.mjs | `e30395264312fe8148018973effc0d3bedde149887bf2df1f2d408f545580f62` |

施工交接后停写；独立验收及主线程UI结果另记，不预签I01–I08、U05或B09 PASS。

## 续接：模板更新 UI 阻断最小修复与新分支（2026-10-29）

主线程实际I01完成后只读追踪发现：后端59b94ca已支持模板更新，但 `DraftReviewPage.tsx` 的 makeUpdate 仍在有templateFields时直接throw，尚未发请求；字段说明也仍称旧Wiki更新不支持。主线程冻结并授权最小修复，本轮仅删该旧阻断，说明改为“旧 Wiki 更新会保留已审字段的来源整理快照”；合并/切型限制保持。实际caller为重复候选下“选择更新”保存decision，再“生成旧 Wiki 更新预览”调用makeUpdate；仍先PATCH完整可见快照，再POST updates，由后端当前input审批、字段快照、目标版本验证，成功才打开独立workflow审核。

新增 `tests/ui-b04.test.tsx` 两项真实React组件点击测试（HTTP stub，明确非真实模型）：Concept/Process字段完整送PATCH，当前saved revision与decision目标进入updates；后端409显审拒绝时显示原错误、无导航、无自动重试，下一次明确点击成功才导航，预览阶段没有confirm请求。先定向2/2 exit0（2.274秒）。必要回归普通sandbox中UI12通过，后端6项均被TEMP原子rename EPERM阻止；普通build也被Vite realpath EPERM阻止。授权升级后同两文件 **18/18 PASS**，exit0（2.763秒），包含新2项、旧UI10项与模板后端6项；仅既有controlled-input提示。随后 **npm run build exit0**，tsc通过、214modules，Vite build1.28秒（命令7.594秒），现有大bundle提示。没有通过改产品绕过sandbox失败，没有追加真实调用。

主线程STdmKw原Draft现已confirmed，不能合法从UI重新选择update：DraftStore.setDecision要求pending，UI也readOnly；HTTP updates还要求预先保存update decision。createUpdate服务本身不看status不代表可以越过上述实际UI/API决策门禁。因此没有把confirmed改回pending，也没有重提取或伪造新候选。

按主线程明确批准，新build后使用原prepare创建 **`C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-7SOfcf`**，session `add48a69-7222-408b-9a05-de83fe2688ef`，freeze **`d63870be02d27c115326518de23d9eaa326e9dee523441bb0333642cb76af902`**。然后一次性只读STdmKw的Wiki目录与真实日志，逐字复制四正式Wiki、index、wiki.jsonl共6文件，并逐SHA复核；清单保存新根 `integration/wiki-inheritance.json`。保留原R22两个Raw、pending提取及pending综合的原身份/原SHA；未复制STdmKw confirmed草稿、completed manifest或当前raw-processing，没有改其已完成状态。新根是“历史pending候选分支＋继承实际UI完成的正式页”，不是声称新根执行过这些原confirm。

新根继承正式记录均revision1：Source `80dcf14b-2a8b-4610-8895-ae74c1a37205`、Concept `869df8fc-8634-4a60-8ba4-c041aefd6562`、未知Source `961b41f7-0784-43dd-ae20-d2205f871db9`、综合 `b57c36ac-0e0e-49cf-bf2b-6dceace5f288`。综合已含官方/未知两个Raw，按主线程批准优先作为实际UI更新目标，保留原正文与双来源；是否出现在启发式候选、UI是否可选、当前真实U05均待实际验证，不提前签成功。

新根尚未启动。使用前文命令时将 `$integrationRoot` 替换为 **7SOfcf**，start/stage release必须从该新session读取绑定，不复用STdmKw旧release。主线程已实际无凭据GET核api.openai.com返回401、GitHub200，报告网络直连TLS可用；因此后续real启动可用普通 `node --import tsx ... serve $integrationRoot real 5179 63992 $releaseFile $releaseSha`，无需强用当前失效的proxy入口。施工没有执行real、读取真实配置或发送模型请求。

旧STdmKw freeze绑定修复前dist；本轮改app/dist后不能再把旧freeze用于新的arm。7SOfcf已在成功build后绑定当前app/dist；前文smoke属于修复前隔离入口实测，不冒称本修复后又跑一次smoke。本轮UI自查与18项回归是修复后的新增证据。脚本两SHA未变。

新分支新增身份及文件继承核验：准备命令exit0、0.669秒，真实/config0。完整文件SHA见继承JSON；其中综合 `2eea2888a09a2ddb3c05d18cdb82f233cdebc26c21ab68bf1ebb820ec93d687d`，Concept `a6e678412b3c182dfb0673e4179b1a90aae06a07638fdfe8f85daf9080dbe885`，日志 `93bc3fb9a4807506a6b66edf64780ed52c740134cd921db29f7f2cabd7c9c9e0`。原pending Draft仍 `c56e6bb572e96206e3bb669defbc65d1fde36f6ddcbf6b9b490accc78f7267dc`。

本轮最小UI阻断修复施工自查通过，独立验收待定；U05真实及B09整体仍未通过。施工再次交接停写。

交接附录：按主线程要求再调用既有 `prepare manual`，exit0、0.668秒，得到I05专用空根 `C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-158Bue`，session `e5bbaec9-30ef-4c1d-abb7-44172246919e`，与7SOfcf相同新freeze `d63870be02d27c115326518de23d9eaa326e9dee523441bb0333642cb76af902`。source=null、copied=[]、kind=manual，尚未启动；Provider强制禁用，不能real启动。主线程可使用 `node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs serve "C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-158Bue" manual 5180 63993`，与U05端口分离。

| 本轮新增冻结文件 | SHA256 |
|---|---|
| app/pages/DraftReviewPage.tsx | `044c57d3cbc19c1b3b2ea4b5555277be1b31a1e80b7f75547496eb9615b5a292` |
| tests/ui-b04.test.tsx | `3eb879e3aaaa06cd2fb81d1975042c6dc8ce17d8ad8fca1fac49adaab6048b0d` |
| dist/index.html | `a247d9d5f3d095519ae05cf14708fe63a4e4bc878f95359cec58c452d4bf3807` |
| dist/assets/index-BwMLIOGy.js | `02fe7364f342f1b3dd6fe25c860939af3efc8524cb9681eef26f6fe89b3abb78` |

## 当前失败恢复证据适用性（只读核查，2026-10-29）

主线程另行要求检查I05/I06安全失败恢复是否需要窄补验。本次仅Get-Content/rg/Get-FileHash/git log读取测试与已有施工/独立报告，不运行产品测试、不制造网络失败，不触碰7SOfcf或I05手工根；未改产品或两份冻结脚本。调用账本由主线程实时维护，本附录不改准备时历史账本。

结论：**现有同版证据已覆盖一条安全、可重复的持久化未完成工作流故障恢复，不需再注入或重跑矩阵。** 精确复用来源为 `B09-TEMPLATE-UPDATE-20261029-builder.md` 第二组命令及独立 `B09-TEMPLATE-UPDATE-AUDIT-20261029-prepare.md` 的SHA核对和复用结论：

```powershell
node --import tsx --test --test-name-pattern='U0[1-4]|B05|HUMAN update|R22 update' tests/b09-template-update.test.ts tests/b05.test.ts tests/kb02-human-review.test.ts tests/r22-source-level.test.ts
```

原实际结果14/14 PASS、exit0、1.479秒，运行时受测代码已关联提交 `59b94ca`，当前HEAD `0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89`；本轮只有前端最小修复，当前 `services/wiki/knowledge-workflows.ts` 只读实核SHA `b9721bf6836b0975c8b272a2ef1c0fde5210c029bb07f5d2ca502ab88b7e9e7c` 与模板施工/独立冻结完全一致。B05恢复测试及相关后端本轮未修改；不将R22之前旧版本的H07/H10报告直接称为当前新实测。

该14项中明确包含 `tests/b05.test.ts:94` 的“B05 重启恢复完成提交后收敛workflow，completed manifest不覆盖后续人工编辑”：在全新TEMP、fake Provider创建已审综合，实际服务confirm时注入 `rebuildIndexLocked` 的index EIO，断言 `WORKFLOW_COMMIT_PENDING`；恢复原函数后实例化新的WikiStore与KnowledgeWorkflowStore并initialize，核workflow confirmed、manifest completed；随后真实人工编辑正式页，再以不同幂等键confirm，核reused=true且人工编辑仍在。它验证了持久化未完成事务的安全恢复和已完成重入，不涉及活跃UI根或真实网络。首次confirm之后未靠重新模型生成来恢复。

本轮已实际复验18/18中的模板后端6项，是另一条当前新增字段证据：`tests/b09-template-update.test.ts:79–85` 新实例initialize后保留完整inputTemplateFields，相同confirm返回reused，正式正文仅含一次“本次来源整理”，对应target/revision更新日志仅一条；其他用例验证源字段/审批变化与目标版本冲突阻止正式写入、无部分Source。它们支持模板快照与原事务格式兼容、完成幂等不重复附录/目标日志；**不把这6项描述为已经注入未完成模板update事务**。

适用范围：I05“安全持久化故障恢复或明确停止”后端子能力可复用上述同版B05实际故障证据，结合当前模板完成幂等与冲突门禁；不要求把每种当前四链都制造一次磁盘失败。I06备份格式未改，恶意归档/越界/冲突历史子能力仍沿独立适用性审查复用。本附录不签当前完整App重启或备份后回读，新增R22等级、人审、Audit状态、Prompt版本的实际导出恢复仍以主线程I05/I06当前根/UI/磁盘对照证据为准。没有必要新增测试文件、产品修复、真实网络试错或重复故障矩阵。
