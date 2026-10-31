# LIFEOS L3：首页行动事项任务卡（2026-10-31）

## 授权与门禁

用户授权继续；本轮仅[正式方案](../batches/LIFEOS-optimization-plan-20261031.md)阶段3：首页行动事项，独立通过后提交同步即停，不推进阶段4。基线 `806b27096dce32d6ab5ddae5c590a7d31523a3cd`。[状态](../status.md)顶部L2整体独立PASS为前置证据，KB03限定范围PASS、会议上传UI独立BLOCKED、旧收据缺口保持。

评分0/2/1/0=3，A标准：目标清楚；跨四来源及App/Wiki导航；只读聚合不改正式数据写入，主要风险是漏报或错定位；本批无重复失败。Astra规划，Sol High先审本卡及验收可执行性；准入通过后Terra High施工，原Sol独立验收（不改产品）。若需要改变恢复/写入策略或引入重大完整性风险，停止该扩展并重新评分，不借本卡授权。

真实Provider/config/.env/正式workspace访问均禁止；只用临时隔离虚构数据，完整App/真实API/stores/runner，仅Provider fake。历史知识287/500、Prompt20/24、KB03 24/30沿历史报告，不重新核账或使用余量。

## 已核代码与范围决策

- HomePage.tsx:7当前workflow获取失败吞空；:19只显示更新/综合；统计待审核仅跳Wiki，Open Audit无操作。
- RawStateStore.list、ExtractionJobStore.list、DraftStore.list、KnowledgeWorkflowStore.list仅返回scan.records，丢弃issues/partial。AuditService.list的readdir异常转空。不能把这些list返回空当作来源完整可读。
- services/storage/files.ts的scanJsonRecords返回issues/partial/overflow；reportStorageIssue只记内存。本轮可复用扫描与现有记录validator的只读结果，必须检查质量信号；不改通用扫描/恢复语义。
- KnowledgeWorkflowStore.initialize及AuditService.initialize会reconcile；禁止聚合请求创建并initialize此类服务。ExtractionRunner.readJob/recoveryJobs是只读视图，复用已注入实例，禁止start/cancel/reconcile。
- App已有Raw选择世代、reviewDraftId、workflowId、pendingWikiId；WikiPage内部AuditPanel当前没有精确初始Audit入口，应窄传wikiId/auditId/版本，不重建全局路由。

保留真实统计、最近导入/正式变更、快捷操作、六项导航。替换旧首页待审核更新/综合区为“需要你处理”，避免同一workflow出现两遍。不改stats统计定义，不新增消息中心/后台轮询调度/未读/持久待办/DDL/AI建议，不自动恢复或提交任何业务对象。

## 冻结只读接口与数据口径

新增窄 `GET /api/home/actions`，响应含items和四来源sources状态。每item至少含kind、稳定id、title、问题/状态、已有结果摘要、主要动作label、updatedAt、priority、目标标识和versionToken。kind为raw-task、draft、workflow、audit；ID只由真实源给出，不以Raw ID合并不同事项。versionToken为已有revision或现有状态/更新时间/身份组合生成的确定性只读快照标识，不是新持久版本。客户端按kind+id作为key。

增加窄只读 `GET /api/home/actions/:kind/:id`，查询参数versionToken，点击前重读目标与依赖：身份/版本仍一致返回可定位target；已处理或删除返回明确404/410；版本变化返回409及安全刷新提示；来源不可读503。可复用同一聚合内部读取逻辑，避免另建状态源。返回错误不泄露绝对路径/正文/密钥。请求不触发initialize/reconcile/provider。再次导航前仍由既有详情GET与世代保护承接后续变化，不能保证跨请求原子性，不增加锁/事务。

| 来源 | 纳入与真实目标 | 版本/结果摘要 |
|---|---|---|
| Raw任务 | 当前RawState失败任务，以及runner明确待恢复或磁盘running但实际settled任务；通过当前jobId和recoveryJobs定位，不枚举历史失败为重复待办。稳定ID优先jobId，旧失败无job用rawId，明确旧状态。target含rawId及jobId（存在时） | 状态updatedAt+job身份及已有恢复/终态字段组成token；只展示真实checkpoint/草稿保留信息；不能凭pagesFound声称已落盘 |
| 待审草稿 | drafts根的pending_confirmation提取草稿，每draftId独立；target draftId及rawId | revision、updatedAt；“草稿已保存，待审核”，不表示正式Wiki已写 |
| 更新/综合 | knowledge-workflows的pending_confirmation或conflict，每workflowId独立，保留kind update/synthesis | revision、updatedAt；冲突/待确认及lastCommitError安全摘要 |
| Open Audit | status=open，每auditId独立；target wikiId+auditId；关联Wiki不存在也必须明确目标已删除，不能导航其他Wiki | audit revision及关联Wiki当前revision（可取到时）；comment适度摘要，不能生成AI修订 |

优先级：保存/恢复阻断、Raw失败、workflow conflict为阻断组；待审核草稿/普通workflow/Open Audit为待决策组。同组updatedAt降序，时间相同以kind+id稳定排序，不按AI猜测紧急度。Raw pending_confirmation的draft引用只用于关联/去重，不再生成第二条raw-task；同Raw不同draft/workflow/audit各保留。存在恢复阻断与待审草稿时可各显示其真实独立操作，不将“同Raw”当成重复。

读取方式冻结为新增聚合服务内的窄只读reader：使用现有scanJsonRecords+既有validator（需要审计Audit最小结构时只在此边界验证一次），保留issues/partial/overflow并把对应源标为error；该源不返回不完整计数或误导空状态，其他来源继续可用。不修改原list默认行为。目录ENOENT且无已知引用依赖时按未建立该类数据的合法空源；EACCES/ENOTDIR/坏JSON/结构错/扫描截断均是读取失败；记录指向缺失Raw/job/Wiki需按真实失效对象处理，不悄悄算为空。已有raw/wiki只读get可用，必须传播真实读取错误，不能用吞错list证明完整性。不读正文生成摘要，标题可用登记快照，缺标题以ID提示。扫描仅规定目录，不递归把其他草稿/版本当事项。

四sources各返回ok/error及安全提示；全部ok且无items才显示“当前没有需要处理的事项”。有错误时显示具体来源“读取失败，无法确认是否还有待办”，提供显式刷新；其他来源正常显示，计数标为“已读取事项”，不宣称全量。组件独立获取事项，不被旧统计接口失败强制隐藏已有可读事项；不扩大改stats服务。进入首页/手动刷新/从事项处理页面返回后重新读取，卸载和迟到响应不得覆盖新页面。

## 界面与导航

沿用现有Operate样式：在统计之后、近期内容之前展示清晰列表；每行对象、来源/状态、保留结果/问题摘要、一个主要动作。问题说明不截断到失去含义；长标题换行，键盘可达，错误用可访问提示。首页不直接执行恢复、模型、Audit决议或正式提交，只导航。待审核/Open Audit统计卡可定位到对应行动区域或筛选，不因数量点击任意第一条。

Raw沿App已有nav(raw,id)，确认目标job仍属该Raw当前任务；draft沿reviewDraftId；workflow沿workflowId；Audit窄传初始wikiId+auditId+revision到WikiPage/AuditPanel并实际选中详情。缺失/版本变化保留明确反馈，不自动改选第一条；主动刷新后可点击新版本。离开/选择其他对象使旧定位意图失效。Audit定位GET不调用propose或resolve。详情加载变化错误按既有安全边界显示。

## 文件所有权

规划者唯一写本卡，冻结后停写。Terra施工所有权：`app/pages/HomePage.tsx`、`app/App.tsx`、`app/api.ts`、`app/pages/WikiPage.tsx`（仅初始Audit定位）、`app/styles.css`（首页局部）、新增`services/home/actions.ts`、新增`server/home-api.ts`、`server/index.ts`（注入/装配窄路由），新增`tests/lifeos-l3-actions.test.ts`、`tests/lifeos-l3-home-ui.test.tsx`、`tests/lifeos-l3-navigation.test.tsx`、`scripts/lifeos-l3-isolated.ts`及`docs/reports/LIFEOS-L3-20261031-builder.md`。需要额外既有服务修改先提交证据给主线程，不自行扩大。

Sol独占`tests/acceptance/lifeos-l3-browser.mjs`与`docs/reports/LIFEOS-L3-20261031-review.md`；先审可在报告中记录准入结论，不写产品。主线程处理状态记录及统一提交。共享工作区他人四文件不碰、不提交：AGENTS.md、docs/reports/B04-http-evidence.json、docs/reports/KB02-R1-20261015-builder-merge.json、docs/reports/AGENT-ROUTER-20261023-packaging.md；施工前后SHA一致。

## 冻结验收 L3-01–04

- **L3-01 聚合正确**：隔离真实记录至少含同一Raw的两个不同draft、workflow、Audit，以及当前失败/保存恢复任务和无关历史失败job；同一事项从状态引用与实际记录出现只能一条，不合并不同kind或同Raw不同id。断言纳入/排除、阻断优先、updatedAt及稳定次排序，且数据来自真实记录。不把Prompt草稿/历史版本纳入。单测/真实GET契约验证。
- **L3-02 精确导航及失效**：真实Chrome完整App/API点击四类入口，实际断言rawId/jobId、draftId/revision、workflowId/revision、wikiId/auditId/revision。另在列表加载后删除目标、改变revision/token、移除关联Wiki；点击给失效/刷新提示，不落到其他对象或旧内容。刷新后新版本可重新进入。切换目标后释放旧预检/详情响应，不串选择。组件/集成覆盖全部，浏览器至少四类成功+删除+版本变化+迟到Audit之一。
- **L3-03 更新与分源错误**：通过已有明确操作处理一条（可用放弃草稿/拒绝Audit等无需模型动作），返回首页后消失或更新；每个来源分别注入坏JSON、不可读目录（可用ENOTDIR确定性构造），断言该源error而另三源可用，无“零待办”假象；扫描partial/overflow信号须有定向测试。合法缺目录显示空，已知缺失引用明确失效。浏览器展示单源失败、刷新恢复、真空状态；统计失败时事项仍能显示其结果。
- **L3-04 无副作用**：完成服务正常初始化后拍隔离业务目录文件集合及字节SHA快照，重复首页GET、预检GET和实际浏览器首页刷新；对Provider/config入口设调用计数或直接抛错探针，预期0。业务文件集合/字节保持，不发生reconcile/init/start/confirm等副作用。包含损坏/失败源的读取场景；内存storage issue登记不是业务写入。启动初始化与fixture准备可写隔离数据，必须放在测量边界前并如实区分，不冒充整个服务生命周期零写入。

Terra harness参考L2现有实现，输出url/api/root/fixture IDs/counters，支持--root重启不重seed；只显式fake Provider，完整真实路由/stores，外部网络关闭。Sol已验证bundled Playwright+Chrome可用，CUA不可用不构成浏览器阻塞。桌面1440与1024宽实际查看行文、错误、焦点，截取证据绑定版本。不得将JSDOM当实际浏览器。

建议定向命令：

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-actions.test.ts tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l3-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx
npx tsc -b
```

再按实际改动运行现有Wiki/Audit导航及Home相关回归（由施工交接列精确文件）；构建使用空envDir Vite程序化build，不运行会读取.env的默认构建配置。本会话impeccable context已加载且Home继承Operate；编辑前读craft-floor，完成后detect一次，不新建PRODUCT/DESIGN。不扩大为全仓无关测试。

## 交接和结束

Sol先审本卡可执行性并确认准入后Terra开工。施工报告含实际命令/结果、版本/文件指纹、接口与数据口径、四文件SHA、真实/config/正式数据访问0、自有服务清理、未测项，交接后停写。Sol复核实物和四项证据，分别给本轮缺陷关闭结论与L3整体结论；未实测/环境缺失明确BLOCKED，不以局部通过或fake冒充产品质量。范围内返修完成后受影响复验，不降低标准。全部L3必选通过后主线程提交、核远端一致并停止，不推进阶段4。
