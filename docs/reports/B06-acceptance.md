# B06 独立验收（2026-10-07）

最终结论：**确定性实现与返修复验PASS，F06-01–F06-05全部CLOSED；B06整批BLOCKED。** 真实产品Provider未配置，A28真实成功/质量未实测。本报告由主Agent独立撰写，未修改产品代码。

## 范围与职责

用户授权B06，明确指定GPT-6 Luna High施工子Agent，主Agent独立验收。施工及返修均由同一个子Agent承担，无模型升级。当前范围为Audit整页/段落、锚点、四决议、AI草稿与人工确认、可恢复写入、11类Lint、首页知识日志、独立CLI；B07未授权。

依据：[B06任务卡](../batches/B06.md)、[冻结交接](../handoffs/B06-luna-task.md)、[验收计划](B06-acceptance-plan.md)、acceptance.md A25–A34/R25–R29。B04/B05的真实Provider外部阻塞继续保留，开展B06并不把前批补签PASS。

## 独立验证记录

| 检查 | 当前有效结果与证据 |
|---|---|
| 构建 | 最终冻结独立PASS，[build日志](B06-acceptance-build.log)，Vite 40模块、1.76秒。此前记录另存，未用施工报告代替。 |
| 仓库测试 | 最终冻结独立113/113 PASS，0跳过、16.899秒；[测试日志](B06-acceptance-test.log)。 |
| B06公开HTTP/文件 | 15/15组PASS，14.934秒；[独立证据](B06-acceptance-http.json)，含真实磁盘故障、恢复冲突及只读CLI。 |
| B05关键回归 | 本轮完整11/11组PASS，10.509秒；[新证据](B06-regression-b05-http.json)，原B05独立报告已恢复。 |
| 实际浏览器 | 首轮单页闭环通过，多页切换FAIL证据保留；最终双向切页、同页切Audit、两次延迟Provider及保存确认/Lint/首页复验PASS，[最终记录](B06-acceptance-browser.json)。 |
| 版本/正式库保护 | 最终51个产品文件与冻结一致，正式workspace完整2个文件集合/SHA不变；38个后端/规则/脚本文件与此前15/15、11/11运行版本一致；[收尾检查](B06-acceptance-final-checks.json)。 |

15组HTTP分别覆盖：四严重度与持久化/统计；上下文定位、行号移动、重复/删除/整页变化和重新定位；同文不同上下文精确替换；生成/编辑/保存/丢弃/重启；四决议与人工内容保留；确认、Wiki/Audit/draft版本与终态幂等；Index真实EIO恢复；人工API修改冲突；Log真实EIO恢复；同revision外部Wiki修改冲突；实际Raw被改但旧hash字段未变的冲突；非法JSON/证据/未配置Provider；严格schema与错误来源；慢Provider与人工拒绝竞态；11类Lint及只读CLI。检查通过的是机械契约与持久化结果，不是模型建议的真实业务质量。

Lint有效注入覆盖坏链、孤儿、Index缺失、Frontmatter缺失、Source缺失、knowledge_status/confidence/source_level缺失、无来源事实、open Audit、重复标题。扫描真实Markdown，缺YAML的文件未被列表过滤隐藏，坏链行号按含frontmatter的实物行核对；非Source且无有效入链/出链才算孤儿。有效B04短/长offset引文、B05及显式Raw引用正例不误报，伪前缀/越界/无证据普通段落负例命中。API和两条CLI前后整个隔离数据根目录SHA一致；有问题Lint退出1，Audit分组CLI退出0。

## 缺陷及返修

原FAIL证据保留：[首轮HTTP](B06-first-http.json)11/13、[同冻结补充](B06-first-extra-integrity.json)0/2、[首轮Lint](B06-first-lint.json)。这些失败独立于施工自测112/112 PASS；没有以自测代替验收。[返修卡](B06-fix-card.md)记录复现和关闭标准。

| ID | 独立结论 |
|---|---|
| F06-01 | CLOSED：Index中断后人工改页，恢复保留原Audit operation清单为conflict；正常详情API可读operationId/原因，Audit仍open。 |
| F06-02 | CLOSED：恢复核对实际Wiki内容/字段及实际Raw SHA；同revision外部Wiki变更和Raw变更均不虚签resolved；正常中断仍完成一次。 |
| F06-03 | CLOSED：来源事实节的普通段落也要求可核验引用，11类fixture逐对象命中。 |
| F06-04 | CLOSED：兼容B04全局offset与90字符+省略号显示，长引文正例通过，伪前缀和越界仍报错。 |
| F06-05 | CLOSED：同一故障样本双向切Wiki和同页切Audit均清理旧详情、预览、理由；跨页及同页两次延迟Provider返回后当前选择不变，回原记录正常恢复持久化草稿。最终人工保存确认正确写入原页。 |

首轮静态交接另发现缺“保存草稿”按钮，Luna在第一轮返修补齐；实际编辑保存后读回同draftId/rev2，刷新及API重启仍恢复，确认前Wiki/Raw文件SHA不变。它与上述四个首轮实测失败分别记录，没有伪造第五个首轮失败计数。

## 实际浏览器与落盘

测试材料为隔离Raw及Wiki，调用本机HTTP fake。实际拖选铺货率段落（不含末尾句号）→提交error Audit→生成建议→人工修改→保存并读回draft `9460a3c9-d45a-4e87-b925-1a72dcb57702` rev2→刷新及同目录API重启恢复→部分接受。正式Wiki仅该选段替换，原句号、标题、人工备注、别名及Raw来源保留，Wiki升rev2。

整页Audit生成后人工输入完整保留正文及补充说明，不另点保存就直接接受，实物为人工预览且升rev3。拒绝留下“原页符合业务口径”并resolved；另一Audit生成后放弃草稿、以“待业务负责人确认”延期，仍open。四决议历史及正式文件由独立API读取核对：[文件证据](B06-acceptance-browser-files.json)。当时首页openAuditCount=1、最近知识变更来自实际日志；Lint显示孤儿/open Audit并可选页。

另用HTTP注入恢复冲突样本，正常浏览器读到人工正文、open状态、原operationId及“Wiki revision、正文或页面字段与已提交目标不一致”。随后切回原Wiki发现F06-05，截图保留。该冲突样本建立脚本最初误用PATCH及被extra覆盖body，均属于验收脚本错误，已纠正，不计产品缺陷或有效验收组；原B06完整HTTP恢复场景没有这些错误。浏览器文件核对脚本最初误用history而非decisionHistory，也已更正重跑PASS。

第二轮Luna只改`app/pages/WikiPage.tsx`，主Agent重新冻结、独立build/test并用同一数据复验。实际打开冲突详情→切原Wiki后旧详情消失，反向同样；同页切记录时未保存理由不残留。HTTP fake通过隔离标记延迟，实测两次请求已到达后才释放：跨Wiki返回不覆盖当前延期Audit；同Wiki切A/B返回不覆盖A已保存的预览。返回原记录仍能从持久化草稿恢复，保存draft `3bbe832b-bd84-4061-a5a5-a162fe123188` rev2，显式接受后仅其Wiki升rev3并含人工输入，原铺货率Wiki完整文件SHA仍不变。最终Lint点击另一页的open Audit定位正确Wiki并清旧详情；首页Open Audit=3与实际8条Audit中的3条open一致，最近变更为实际知识日志。新增UI请求保护同时覆盖创建/详情/保存/决议/定位/放弃的回调，但延迟save/resolve等未逐个注入实测，不把静态检查冒充这些竞态的动态证据。

最终截图：[已解决段落和人工内容](B06-acceptance-browser.png)、[首页](B06-acceptance-browser-home-final.png)。第一轮和最终隔离API/UI分别均关闭；fake随独立harness.close关闭。B06完整HTTP和B05回归的所有自有服务关闭。最终UI返修未改38个后端/规则/脚本文件，因此保留此前有效15/15与11/11结果，没有宣称UI返修后再次全量重跑HTTP。npm test会重写的两份B04施工证据已事先归档，最终新输出另存B06前缀并恢复原件；B05独立原报告SHA恢复也已核对。

## 门禁与未测边界

- A25/A26/A27/A29及A30–A34、R25/R27/R29确定性实现PASS。R26读Raw+Wiki+反馈的请求结构和四决议机械行为通过，真实Provider成功/质量仍待测。
- A28明确要求真实调用，当前未实测，不签PASS。Raw不可变在HTTP fake、实际人工确认及故障恢复中通过；A06真实AI操作不可变的跨批整项保留BLOCKED。
- R28首页Audit知识日志子条件通过，Prompt尚未实现，完整跨批日志门禁留B09，不提前签整项。
- Raw证据核验只保证来源属于该Wiki、引文存在于实际Raw，以及保存/确认/恢复时版本内容一致；不证明建议的语义正确或引文唯一定位。模型质量不能用fake补签。
- 上游llm-wiki-skill只读参考及差异见[复用记录](../open-source-reuse.md)：未取得不可变commit SHA；实际LICENSE路径404，README称MIT。没有复制上游代码，本批独立实现；不声称精确版本和许可证文件已核验。
- 实测Windows/Node v25.2.1，未另测Node最低版本环境。平台未提供子Agent token计量，记不可得。

收尾实测`.env.local`不存在，FMCG_LLM_BASE_URL/MODEL/API_KEY三项均未配置（仅记录布尔值，零真实调用）。全部测试材料在临时隔离目录，Raw整个文件SHA保持不变；正式开发服务未操作，正式workspace完整集合/SHA无变化，产品最终冻结无变化，自有服务与标签均已关闭。工程当前无Git元数据，版本证明使用文件集合及SHA，不声称Git提交。最终止于B06；B07未开始、未授权。
