# B09 当前完整 App 续接实操

2026-10-29，用户授权按只读预检建议开展工作。基线 `0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89`。沿原任务卡 B 模式评分 0/2/2/1=5；实际创建施工 `gpt-6.1-sol/high`（integration_prepare）、独立验收 `gpt-6-astra/medium`（integration_audit），均 fork_turns=none，工具成功返回实例。主线程负责实际浏览器与有界放行。本文是过程证据，未完成项不签通过。

## 环境与预算

- CUA getState、IAB创建及当前完整App页面实际成功，上一轮kernel初始化阻塞本轮已解除。首次空白标签随后失效，重建标签2后正常操作。
- 普通与升级shell的 `git ls-remote origin refs/heads/main` 均因127.0.0.1代理不可达失败；未改用户代理配置。系统ProxyEnable=0。
- 零凭据Node HTTPS探针：github.com根路径200；api.openai.com根路径421；官方 `/v1/models` 未认证401，说明直连TLS/API入口可达，不是模型请求，也不证明真实模型成功。
- 本阶段累计起点知识261/500、Prompt15/24；上限新增知识2、Prompt4；首失败停。以下manual操作真实调用0、配置读取0。

## I01 已有真实候选当前UI审核子链

隔离根 `C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-STdmKw`，session `e90e80df-e7e0-43b4-9c7e-c88dd7fffcad`。完整server/index.ts与built App，5179/63992，Provider明确禁用。入口施工及独立审查另见builder/prepare报告。历史R22真实259–261候选按原文件复制，未重新提取。

实际命令：`node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs serve <root> manual 5179 63992`（升级shell，共享用户TEMP）；结果返回完整App URL与mode manual，主线程执行CUA点击。

1. 首页显示Raw2、Wiki0、待审2、Prompt0。打开官方Raw `c394e1a3-8b0d-4cbd-b943-1c60afa15a3d`，正文126字符、SHA `801d022180ecc04dac73dd8ce49901d8b8ba3787b41997bf1af5bb547f32e773`。
2. 继续审核提取draft `72bf8cbb-c209-49ba-9726-4eca9fc77c71`。初始未审0/1、默认未选、正式确认禁用。先确认归属，再勾选写入，将一句话解释AI字段改为“Structured Outputs 是让模型响应遵循给定 JSON Schema 的功能。”。保存后v3、已审0/1、确认写入禁用；刷新并从Raw重开，人工编辑与失效状态保持。
3. 再次确认本页归属，v4、已审1/1，明确点击确认写入。operation `f9f54bae-8b04-4e81-9496-16939d8d8fa3` 全阶段done；Source `80dcf14b-2a8b-4610-8895-ae74c1a37205`、Concept `869df8fc-8634-4a60-8ba4-c041aefd6562`。
4. 知识库搜索“结构化输出”可找到正式页。Concept v1/A等级，人工编辑带“AI草稿经人工修改”标签，原始事实及问题保留。点击来源返回原Raw，同ID/全文/SHA。正式Wiki的“人工审核未审核”是Wiki真实性元数据，与草稿主题审批不同，不冒称真实性已认证。
5. 打开真实综合workflow `0c43e564-eb0e-43fa-b8c9-b177094415a0`。未审直接确认被明确拒绝“请先保存并审查当前完整预览，解决所有未解决项”。实际审核官方功能陈述、未知成本陈述与独立问题后确认归属v2，再点击确认写入成功。保留综合D/官方Source A/未知Source D。首条综合原引文止于JSON、尾词Schema未包含，原Raw全文支持该陈述；不声称逐引文语义完整性已修复。

当前证据：`B09-INTEGRATION-20261029-evidence/i01-wiki.png`、`i01-wiki.txt`、`i01-synthesis.txt`、`i01-export.json`。导出命令：`node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs snapshot <root>`，exit0。PNG/AX证明最终可见状态；操作过程见本轮CUA工具记录，磁盘与原Raw比对交独立验收。

## U05 新发现缺陷与返修

静态沿实际UI更新入口发现 `app/pages/DraftReviewPage.tsx` 的makeUpdate仍用hasTemplateFields直接拒绝带字段候选，且字段说明仍写旧Wiki更新不支持。这会在模型请求前阻断U05，属于实际工程遗漏，不能仅列环境阻塞。主线程已授权Sol最小移除旧阻断、准确文案、必要UI测试及build；不放宽后端人审约束。

已完成提取draft不能通过UI再改为update决策。后续使用R22原始pending副本，追加本根实际确认的Wiki字节作为已有更新目标；保留两个分支来源与SHA，不把confirmed草稿改回pending，不重抽。新构建后须重新冻结并独立审查再放行。

## 新版本U05与手工恢复续接

Sol修复后18/18回归及build通过；Astra独立组件2/2通过，新freeze102文件一致。新根 `C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-7SOfcf`，freeze `d63870be02d27c115326518de23d9eaa326e9dee523441bb0333642cb76af902`，继承6个正式Wiki/index/log文件逐字一致。旧根停服，新根按真实入口启动，但未逐阶段放行前不允许模型请求。

Git失败已定位仓库url-specific proxy；使用仅本命令 `git -c http.https://github.com/.proxy= ls-remote origin refs/heads/main` 返回0cbb918，与本地一致，不修改持久配置。

U05先在真实UI选择双来源综合页 `b57c36ac-0e0e-49cf-bf2b-6dceace5f288`，添加人工说明“此处仅解释官方功能，不推断本地业务成本”，保存、重新选择更新、重新显审，v6已审1/1。首次arm被自动审批审查拒绝，理由为未具体列数据及外部目的地；未发请求。用户随后明确确认公开摘录、虚构隔离笔记/Wiki/草稿、人工说明与虚构Prompt任务可送现有OpenAI API，知识最多2/Prompt最多4、首失败停。随后arm成功，实际UI点击唯一update。

知识262返回workflow `bf23201b-74cd-49ac-a5f9-c43592fe2110`。预览显示完整原正文、已审输入只读快照（人工说明/AI整理/完整两段引用），独立新审查未完成；此时正式目标仍v1。主线程逐项审查后确认归属v2，再明确确认写入；知识库回读目标v2、Raw2、等级D，原正文仍在，新增来源整理附录及待确认问题。`u05-preview-export.json`/`u05-confirmed-export.json`及同名前缀AX/PNG保存实物；实际请求/响应存新根integration下knowledge-262文件。尚待阶段独立裁决再放行Audit，累计知识262/500、Prompt15/24。

I05独立禁Provider空根 `...\b09-integration-20261029-158Bue`，5180/63993：实际UI新建“无模型手工验收知识”，再编辑为人工修订正文，Wiki `e6ef12e4-b231-405d-86d6-b8e838329a16` v2。新建手工Prompt `2ebaefaa-bb62-477e-89b0-37e0bb65fda5`，带变量主题及该Wiki关联，编辑为“请将{{主题}}整理为三条待确认问题，并注明所需证据；不补造事实。”，v2/历史2。刷新回读保持。实际点击生成Brief，明确提示Provider禁用，无模型请求。

同根正常Ctrl+C停服、再次serve后UI回读两v2保持；正式backup入口导出5文件/5154字节，restore到新空根 `...\b09-integration-20261029-nYqs7q`，启动后UI再次回读Wiki与Prompt v2/关联/正文。snapshot三份文件以Node assert.deepEqual核资产集合/SHA **5/5一致**，三份calls累计0。证据i05-before-restart/after-restart、i06-restored-export、manual/restart/restored AX及PNG。此为无Provider手工资产恢复，不代签尚未完成的真实四链全资产恢复。

## 尚未完成（待后续证据更新）

U05更新、I02 Audit、I03/I04 Prompt四阶段、I05重启/独立无Provider手工闭环、I06完整恢复与失败恢复、I07逐行最终裁决和I08最终交付说明。现有I01创建/综合子链不等于整个I01或B09通过。真实预算仍为261/500与15/24。

以上为前序快照，以下续接覆盖当前状态。

## I02 完整真实Audit通过

U05经Astra独立通过后，主线程在Concept页提交整页反馈，明确仅把首段简称改为“Structured Outputs：模型响应遵循给定 JSON Schema 的功能。”，其余正文/引用/问题原样。Audit `d2f069f3-4891-40b5-813e-fca4054e6606` 初始open/rev1；唯一实际263请求返回建议，UI审阅替换预览后点击“接受并写入”，Concept v2，Audit resolved/rev3、accepted，open计数0。刷新页面重开该页状态保持。Astra核正文精确仅替换指定首句、其他逐字不变，单次Wiki update和audit日志，操作 `b0d512ab-7da3-4a42-bf78-491a28c46bd9`。这是人工有指导修订，不声称自主发现错误。

证据i02-preview/accepted/refreshed.txt、accepted.png、export.json；263 request/response/call。知识本阶段2次用满，累计263/500。

## I03 真实失败与停止

独立放行Brief16后，UI提交虚构快消企业30分钟经销商访谈任务，禁止虚构及推断ROI/成本。返回任务名/类型及7字段，独立PASS。主线程把约束增加“末3分钟核对记录”，选Concept，再选并取消综合页。generate17唯一实际请求返回预览，但“实际采用Wiki背景”仅16/1364字符；只包含标题 `## 原草稿一句话说明（未归位）`，没有来源支持的定义正文。模型据此如实指出Wiki正文待补。未保存正式Prompt。

独立核原请求：只发送已选Concept，取消项未发送；人工Brief约束正确送出。但空行分段+零关键词匹配首段兜底后跳过其他段，使充足预算下仍只发送标题，属于必要Wiki上下文工程FAIL（I03/R36），非模型虚构。立即停止18/19，不重试17、不挪剩余额度。当前知识263/500、Prompt17/24；四实际请求各httpSent1，无重试。配置运行时读取次数未计，不能写0。

主线程已关闭本轮real5179/63992与恢复manual5180/63993实例，保留数据/原失败响应。公开证据（经过trace已知凭证检查）归档到evidence/calls：update/audit/brief/generate.json及四次request/response/wire-request/wire-response；private响应与.env不归档。

Sol进行零调用最小context修复，Astra冻结C01–C05验收，原失败不抹除。修复后若补完整真实链需新generate18、check19、rewrite20共3次，而原阶段剩2次，因此需用户具体批准本阶段额外1次（累计最高20/24，全局24不增加），准备与独立工程完成后再请求。未获批准前不再外发。


## 最终续接：上下文修复与18–20补验

产品/验收入口提交：c6474fe98c63440d7b9cbdb7fe15e98eb8b6aba8，基于0cbb918。本轮两处最小修复为模板更新UI旧阻断、Prompt选中Wiki正文遗漏。Sol工程Prompt11/11与build、Astra独立3/3及continuation门禁smoke通过，详见CONTEXT-builder/prepare报告；模板UI18/18与独立2/2为此前同版本验证，不合成一次全量测试。

用户明确批准补验3次并增加1次阶段预算，全局24保持。新根oZSBMc/profile prompt-context-continuation，仅generate18/check19/rewrite20逐次放行。102文件freeze 87a1e3a3219c24e4155c54c1da4058dfcd3409890e282bfc055dd0377d79ae8d。复用Brief16及原17人工输入，通过UI手动填写全部9字段，未重新请求Brief。18实际发送同一Concept的1363/1364字符（仅末尾空白裁剪），定义与边界保留，独立PASS。人工改名称、追加{{访谈对象}}后明确保存Prompt ce473ac4-3902-4eeb-a6c2-13a4c7fbb000 v1。19九维全部具备，无虚构缺项；20优化保留30分钟/末3分钟核对、不推算ROI成本及事实边界，独立PASS后人工改回名称，明确保存同ID v2，版本来源ai_optimized、原v1保持。刷新与Markdown下载已实测，i04-*、prompt-export.md留证。

最终本阶段知识2次、Prompt5次（16–20，包含失败17），累计知识263/500、Prompt20/24，历史连接1单列。每阶段httpSent1，无自动重试。原17 FAIL保存；真实配置读取未计数，不宣称0。18–20公共trace共15份新增归档在evidence/calls，未归档private文件、配置或正式workspace。

## I05–I07 最终持久化与界面证据

同oZSBMc正常Ctrl+C关闭真实服务，再用serve root manual 5179 63992重启，UI读回Prompt v2/历史2、Concept v2/A、Audit resolved rev3及官方Raw ID/原文SHA。官方backup命令导出23文件106375字节，restore到新空TEMP根b09-integration-20261029-ofqyDv，serve manual 5181 63994后同样UI回读四链代表对象。

实际命令：node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs snapshot|backup|restore|serve（具体根/参数见本轮工具记录和导出session）。Node assert.deepEqual比较i04-final-export.files、i05-restart-export.files、i06-restored-export.files，23/23一致，exit0；独立审查另对两个磁盘根逐SHA核23文件无漂移。证据i05-i06-comparison.json。i05-restart-prompt.txt/i06-restored-prompt.txt/i06-restored-export.json最终属于四链根，覆盖早先手工子链同名文件；手工子链依据i05-before/after、manual根158Bue/恢复根nYqs7q及旧Wiki截图，不再引用这些同名最终文件。

额外零调用UI：空manual根yqIAZf粘贴Raw与上传Markdown，原件233B保留、正文回读，首页六计数正确；真实四链根首页Raw2/Wiki4/本周6/待审2/OpenAudit0/Prompt1，待审为继承pending提取/综合各1。Prompt新建改版未新增知识日志，SHA保持。实际Wiki/Prompt Markdown导出均已读回。Lint只读，真实根报告1条ORPHAN_WIKI（综合页无Wiki关联），两个根资产前后不改。失败提交重启恢复复用同版tests/b05.test.ts:94的WORKFLOW_COMMIT_PENDING→重启完成→再次确认不覆盖人工改动证据，不新增真实失败请求。

## 交付范围与剩余事项

本轮工程缺陷及四链I01–I06通过；最终109项由独立matrix审查逐行归并，不将局部通过写成B09通过。R13仍有已披露的模板字段合并缺口，应另按字段/引用/人工说明保全和合并失审规则制定最小修复与验收，再补该行；不清空字段绕过，不继续模型抽样。README已更新启动、数据隔离、strict适用范围、无Provider及模型限制，上游说明保持。外部AGENTS与包装报告排除提交。

最终清理：仅本轮隔离服务session70254/92805/89242正常Ctrl+C退出，5179/5181/5180标签关闭；未删除任何验收根。产品commit钩子已推送c6474fe，最终文档提交后再核远端。

I07最终独立矩阵与主线程采纳：109唯一ID，A63 PASS，R45 PASS+R13 FAIL，总108 PASS/1 FAIL/0 WAIT。I08说明已独立核验，范围内任务完成；B09整体仍未通过。

提交检查：git diff --cached --check仅余wiki-export.md第54/70行原始引用尾空格，保留实际下载字节用于证据，不为格式检查改写导出内容；独立报告末尾多余空行已清理。
