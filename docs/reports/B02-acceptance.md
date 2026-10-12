# B02 独立验收报告与冻结检查映射

执行者：acceptance_monitor（GPT-6.1 Sol High）。授权仅 B02，PASS后停止，不施工 B03；验收 Agent不改产品源码。最终结论：**B02 PASS。独立HTTP/文件12/12，加B02-13真实桌面闭环，合计13/13 PASS。** UI-01–04均有实际失败与修复复验记录，当前未解决缺陷0；后端证据版本未变，无需重复全部测试。

依据：`docs/batches/B02.md` 的冻结接口，及 `docs/acceptance.md`。主 Agent负责实际浏览器操作/截图；验收 Agent负责隔离 HTTP、磁盘、失败边界、重启并合并两类证据。B01用户服务5173/4317和用户数据不被独立脚本修改。

## 运行与证据约定

脚本 `tests/acceptance/b02-http.mjs` 已在冻结交付后运行，使用自建随机端口和 `FMCG_DATA_DIR` 临时目录，不导入产品内部函数。成功路径与失败路径均通过公开 HTTP 验证，并解析真实Markdown/YAML；真实下载检查响应与落盘一致。测试样本均标“验收资料”。后端实际依赖server/services/rules/package执行前后指纹比较，本次11个文件指纹稳定；UI可并行施工，最后另对浏览器版本核验。

证据：`docs/reports/B02-api-evidence.json`（最新）与归档 `docs/reports/B02-api-2026-10-04T05-04-22-292Z.json`。隔离资料保留在 `C:\Users\80593\AppData\Local\Temp\fmcg-b02-acceptance-PsJG5l`；主5173/4317、浏览器隔离5174/4318和用户数据未被脚本修改。直接在提升环境执行，避免已知沙箱loopback限制；未因环境问题升级模型。

运行时间为`2026-10-04T05:04:22.296Z`至`05:04:24.145Z`，主体约1.85秒，工具命令墙钟约2.3秒。本机实测qmd不可用，仍完成全部搜索；无产品LLM调用/测试AI替身。token计量不可得。构建/单测属于施工证据，独立HTTP和浏览器才是运行结论。

## 检查场景与覆盖

| 场景 | 正确路径与关键负面判据 | 原文映射 | 当前 |
|---|---|---|---|
| B02-01 Schema/规则/模板 | 公开schema六类型、13分类、统一枚举与6模板，关键模板节完整；HTTP模板与rules逐项相等。AI内容约束仍留后续。 | A19，R06/R14–R22/R32 | PASS |
| B02-02 六类型创建/来源 | 六类型真实创建，UUID+全frontmatter/revision=1；Source关联1条Raw，其余可多条；API/磁盘正文、元数据与来源一致，Raw摘要不变。Source UI回跳仍待B02-13。 | A14–A17/A19/A20，R15–R21 | PASS |
| B02-03 可信度与输入错误 | 10类无效请求400且全资产摘要不变；默认needs_verification；verified有有效来源+reviewed允许；source_supported+有效来源+unreviewed允许；confidence/source_level可改。 | A19，R21/R22 | PASS |
| B02-04 编辑/过期版本/竞争 | 正确PUT revision1→2、created不变；stale PUT/DELETE均409、资产不变；真实并发为200+409，仅revision+1；Raw摘要不变。 | A19，R21/R24 | PASS |
| B02-05 改名/别名/歧义/入链 | 旧title保留alias并resolved到原ID；共同别名ambiguous显示2候选；不存在missing；references包含实际入链页。 | A21，R24 | PASS |
| B02-06 五字段中文搜索 | 5字段中文及全角KA归一化均命中；分类筛选有效；query不改变完整13类计数；更新正文/标签后旧搜索消失，无qmd仍正常。 | A35/A36，R30/R32 | PASS |
| B02-07 Markdown下载 | 真实HTTP attachment下载至隔离文件，独立解析YAML/正文/来源/Wikilink，与正式文件逐字相同；摘要772801177b964ce2665861e6800f0f2ed97c81f4b11d443a0470de6c6ca4c720。浏览器下载待B02-13。 | A58，R07/R21 | PASS |
| B02-08 删除影响/回收 | 入链影响先可读；DELETE后404，目标回收在knowledge/recycle/wiki，计数减1；引用页文件摘要/revision/正文不变，旧链接missing。 | A21/R24，A35/R30 | PASS |
| B02-09 Index/Log/分类数量 | 10正式Wiki，13类合计10，首页Wiki=10/Raw=2/本周新增=12；Index包含现存页排除删除页；Log含create/update/delete和删除ID。 | R28/R31/R32 | PASS |
| B02-10 写入/派生失败 | 把wiki目录替换为文件真实触发500，无资产改变；Index替换阻断触发500，正式已提交页可见、错误不伪称完成；解除故障可恢复Index，Raw不变。未宣称复杂多文件事务。 | R07/R28，冻结任务卡 | PASS |
| B02-11 重启与Raw不可变 | 同目录重启后12条正式Wiki全部字段/正文/版本相同，页文件SHA-256不变；两个Raw文件SHA始终不变，无LLM可用。 | A57 Wiki子能力/A61 Wiki子能力，A06 Raw子能力 | PASS |
| B02-12 `created`周界统计 | 真HTTP统计4个created边界页，Wiki=4/Raw=0/本周新增=2；上周日及下周一排除，本周一含；完整13类计数合计4，Index未被计页。 | R31/R32 | PASS |
| B02-13 实际桌面闭环 | 六类创建/搜索/Raw回跳/歧义/删除/原生下载/刷新重启均有真实证据；UI-04修复后Metric rev3保存立即显示关联并可跳转，rev4保存后立即选Source未被迟到响应覆盖，无需刷新，浏览器error日志为空。 | A14–A17/A19–A21/A35/A36/A58 | PASS |

主 Agent补充冻结JSON契约：list为`{items,categoryCounts}`，categoryCounts含完整13个分类ID的全库计数且不受q筛选；detail.links为`{target,status:resolved|missing|ambiguous,candidates:[{id,title}]}`；references为`{items:[{id,title}]}`，歧义入链亦计入影响。schema实交响应以`pageTemplates`提供rules的模板。本机准备时`Get-Command qmd`不存在；冻结运行再确认搜索无需外部qmd。脚本可修自身接口适配，不可降低行为判据或调用产品内部函数冒充HTTP证明。

## 整项判定边界

- 本批完整候选：A14/A15/A16/A17/A19/A20/A21/A35/A36/A58；须HTTP/文件和UI对应证据齐备。
- 本批只能部分覆盖：A18（手动Synthesis模板；真实多来源AI综合留B05）、A57（Wiki持久化；Prompt留B07）、A61（Raw+Wiki手动；Prompt留B07）、A63（完整四主线留B09）。这些整项仍NOT_RUN。
- R15–R22为手动数据/模板能力候选，AI行为/内容生成约束仍留B04/B05；R28/R31/R32逐子条件记录。Lint、Audit、Prompt或文件上传不提前验收。
- 初次失败给最短复现/预期/实际/文件指纹，修复后只复测影响项；同根因两次有证据修复仍失败才请求施工Luna→Sol→Astra，验收角色不接产品修复。外部环境EPERM/凭证/网络不算能力升级理由。

## 浏览器证据与独立文件核对

主 Agent在隔离5174/4318与 `docs/reports/fixtures/B02-browser-20261004` 真实操作，记录见 `B02-browser-evidence.md/json`，六页对象与删除前内容在 `B02-browser-pages-before-delete.json`。验收 Agent已实际查看 `B02-wiki-overview.jpg`，可见六类型列表、13分类地图、Source元数据及发布日期。截图不能独自证明全部交互，其余依据是主 Agent实际操作记录加独立文件断言。

- 六类型由UI逐一创建，Source单Raw摘要与回跳，Synthesis手动两Raw，流程正式正文标“分析建议”；标题/别名双向关联、歧义2候选、missing提示与五字段搜索已实操。HTML作为文本显示，无alert/浏览器错误。
- 改名保留旧标题为别名、revision2；停止并同目录重启后Raw2/Wiki6/本周8。删除前UI显示2页入链影响，确认后Wiki5；存活页在删除检查时字段/正文不变，概念revision2、断链可见，回收在wiki外；刷新后Raw2/Wiki5/本周7。
- 真正原生下载事件取得Downloads文件；独立读归档 `fixtures/B02-downloaded-source.md`，730字节，SHA-256=`154c726971d095a101901a9364d3cc37dbe68cbe674e54d967907e039ab90833`，与正式Source页逐字节相同，YAML来源指向Raw。
- `tests/acceptance/b02-final-file-review.mjs` 独立只读复核：两Raw正文摘要与初始基线一致、6类型文件（含回收页）存在、流程分析标记/综合2来源正确；删除快照对比按同一ISO时间值归一化。Metric随后为UI-04明确编辑至rev4，其body/updated/revision变化属于新的授权操作，不误判为删除破坏；其他字段及页严格不变。最终针对变动的只读复核再次PASS，证据见 `B02-final-file-review.json`。
- 最终核对：后端11指纹与API证据全部匹配，前端7指纹与最终浏览器JSON全部匹配；最终WikiPage SHA-256=`73bbbcfd0905c61845cc102cd5559acd5e8e675ab83bade895cf15cf78de4940`。原UI-04失败版本SHA为`f1a385690e5dedf6570029c0c43525def81da35c58a5b67e00538175d8f7209d`，不将旧版成功检查冒充新版验证。
- UI-04补测：rev3保存后立即显示“Wiki关联1”和`[[门店补量]]`，可点击打开改名概念；rev4换回Source链接，保存即切Source，API完成后当前heading仍为Source，error日志为空。即时关联与迟到响应选择保护均由主 Agent真实操作证实。

## UI缺陷历史与最短复现

| 缺陷 | 实际失败与处理 | 当前 |
|---|---|---|
| UI-01 | 首页快捷新建先于schema加载，默认模板为空；builder等待schema后初始化；默认概念模板98字符、含定义等节，已真实复验。 | 修复后PASS |
| UI-02 | 来源卡缺原发布日期；builder增加字段，已实测显示2026-10-01。 | 修复后PASS |
| UI-03 | blob临时链接没有浏览器下载完成事件；改同源原生attachment链接，真实下载730字节与磁盘相同。 | 修复后PASS |
| UI-04 | Metric `5b6c3f81-e361-4d26-9cd0-0863fc74cd31` rev1→2编辑后新正文存在但关联面板消失；PUT响应无links被直接作为selected，ID不变不重读detail。builder改保存后按固定ID GET完整detail，并防迟到响应覆盖新选择。rev3即时显示并跳转关联、rev4快速切页保护均实测通过。 | 修复后PASS |

四个缺陷根因分别记录，尚无同根因两次有证据修复仍失败，无模型升级触发。一次测试过早选页是保存同步问题；PowerShell时间`.750Z/.75Z`归一化是证据序列化差异，不算产品缺陷，不改产品迁就断言。

## 交付记录

冻结后端11个文件指纹见JSON，运行前后和最终逐文件比对均未变。stats SHA-256=`6b7e35714ac12d1e04514485726334db9a9652be5ec7440c8ecca8c69e9e1c84`，created统计已由B02-12真实验证，不重复测试。主 Agent与builder确认最终WikiPage SHA73bbbcfd对应版本已实跑提升build PASS、npm test14/14 PASS，施工报告已记录UI-03/04最终行为；这是施工证据，没有冒充独立执行。独立HTTP/文件12/12 PASS，真实浏览器B02-13修复后PASS；四项缺陷历史保留，未解决FAIL=0、BLOCKED=0，无模型升级触发。

原文A14/A15/A16/A17/A19/A20/A21/A35/A36/A58共10项，**DOC/RUN均PASS**：六类型模板与四种核心页创建、统一YAML、来源回跳、链接与编辑后关联、五字段中文搜索、无qmd及Markdown导出均有实际对应证据。R14/R21/R30/R32的本批类型约束、统一元数据、搜索与13分类视图已验证；R15–R22其余生成/冲突等行为按各自未来批次保留范围边界。A18/A57/A61/A63等跨批整项仍NOT_RUN，手动Synthesis/Wiki持久化等子证据可复用；不声称Prompt或AI主线完成。

最后运行恢复由主 Agent记录：正式5173/4317恢复、health正常，保留用户已有1条Raw，Wiki0；已核对身份后停止隔离5174/4318进程，隔离样本、截图和下载证据保留。验收Agent没有移除用户资料。本批批准完成并停止，不进入B03。
