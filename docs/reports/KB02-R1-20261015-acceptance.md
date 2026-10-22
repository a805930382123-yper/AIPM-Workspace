# KB02 R1 主 Agent 验收报告

2026-10-15。用户指定 GPT-6 Luna High 施工、主 Agent 亲自审查验收。Luna 交接停止写入后，主 Agent 冻结并独立执行本报告中的检查。

## 结论

**整体 FAIL；工程 Standards PASS，真实使用 Spec FAIL。不能推进下一批。**

原 F-K202-01（有效恢复）、02（严格检查点）、03（测试迁移）已实测关闭。04（业务事实与完整规划）仍 OPEN。真实更新预览也未成功。恢复可靠不能替代生成、维护业务闭环的真实验收。

[最终证据](KB02-R1-20261015-main-final-evidence.json)、[剩余返修卡](KB02-R1-20261015-repair.md)、[施工交接](KB02-R1-20261015-builder-handoff.md)、[冻结](KB02-R1-20261015-frozen.json)、[完整性](KB02-R1-20261015-integrity.json)。

## 范围与代码审查

相比本轮基线，四个产品文件修改：services/llm/checkpoints.ts、knowledge-extraction.ts、jobs.ts、rules.ts。已验证完整严格嵌套schema、16MiB有界读写、Raw实际摘要/版本/分块/Provider绑定、唯一ID/完整证据集合/已知凭证校验；损坏预检先于Provider调用和状态写入。合法500000字符上限为66块，没有错误缩为64块。

未完成任务沿用原job和累计attempts；完成任务的新提取不再被旧规则检查点阻断。新提示修订号进入缓存身份，旧草稿可阅读。没有提高产品预算、JSON修补、隐式重试、自动补ID或放宽完整性。

九个受影响测试/fixture文件已迁移新wire。主Agent对比旧断言：保留安全、事务、来源、选择/确认、原文全局引用、末尾覆盖；人工整理/推断通过正常draft编辑加入，合并及正式正文落盘仍断言两侧保留。直接LLMService legacy独立保留。完整231项未删、未skip。具体文件和断言迁移见施工交接。提示词加强不能单独证明语义通过。

## 主 Agent 工程复验

| 项目 | 实测 | 证据 |
|---|---|---|
| 构建 | PASS，tsc -b及Vite，212模块，Vite 3.04秒 | [日志](KB02-R1-20261015-main-build.log) |
| 完整默认并行 | 231/231 PASS，0skip，25.421秒 | [字节副本与结果](KB02-R1-20261015-tests-writable-copy.json)、[日志](KB02-R1-20261015-tests-writable-copy.log) |
| H01–H21所有子项 | 21/21组 PASS | [HTTP](KB02-R1-20261015-standards-http-initial.json) |
| C01–C04 | 4/4 PASS，jsdom+实际HTTP | [组件](KB02-R1-20261015-standards-component-initial.json) |
| 六链安全与Meeting门禁 | 62/62 PASS | [安全](KB02-R1-20261015-standards-security-initial.json) |
| E01–E03校准 | 3/3 PASS | [校准](KB02-R1-20261015-main-calibration.json) |
| X01–X09额外边界 | 9/9 PASS | [补充HTTP](KB02-R1-20261015-main-extra-initial.json) |

完整测试运行于与冻结91产品/55测试文件逐字节一致的可写临时副本，copyMismatches为空，没有在副本修改断言或替换实现。原目录继承ACL不变，不声称本轮原目录直接全套测试PASS。默认并行已通过，串行NOT_RUN。构建仅有现存大于500kB分包提示。

H组包括块失败/规划失败继续、同根重启、双resume、取消缓存、显式restart、篡改、版本/Raw/秘密变化、调用记账、草稿落盘崩溃对账；H10七个篡改子项全部执行，无首失败遮蔽。X组覆盖超过32MiB文件409且零副作用、缺块伪完整plan、重复事实ID、嵌套未知字段、500000字符66块失败后续跑、重复证据掩盖缺失引用、跨块ID、累计attempts回退，以及已确认旧草稿保留而新job不读旧规则检查点。全部可控Provider仅证明工程行为。

## 实际 Provider 验收

只读本机配置 open.bigmodel.cn / GLM-5.3-Flash；所有知识请求实际为low reasoning。仅外发隔离临时目录的虚构资料。

| 场景 | 实际结果 |
|---|---|
| 原短文134字符 | 2调用，约7.165秒；2条建议。目标100/在售20/比率20%正确；显式只确认隔离指标页，加入人工KB02_HUMAN备注。[SHORT](KB02-R1-20261015-main-real-http-SHORT.json) |
| 补充160字符 | 提取/规划2调用成功，候选包含旧指标，显式update成功。但把“旧资料是20家及20%”扩写为“旧资料显示目标门店20家及铺货率20%”；旧短文明确20为在售门店，补充句未说明目标维度。免责声明也进入来源事实。[UPDATE](KB02-R1-20261015-main-real-http-UPDATE.json) |
| 新更新预览 | 第3调用HTTP502/EVIDENCE_INVALID。模型使用Raw中间业务段落quote，却给完整Raw的start=0/end=160，未复用已校验完整引文四元组。拒绝正确；无更新工作流，冲突预览/后续确认BLOCKED，不能签本轮更新后双方数值、来源及人工备注保留。 |
| 原106400字符长文 | 14段提取完整覆盖0至106400，共46事实/23问题。第15调用提出14个区域主题，却只分配45/46事实，漏f-c2-3，LLM_PLAN_COVERAGE_INVALID；约75.834秒，无草稿。[LONG](KB02-R1-20261015-main-real-http-LONG.json) |
| 浏览器显式继续同一长文 | 同job复用14段，只新增1次规划，累计16调用；恢复PASS。规划约17.766秒再次漏同一事实，无草稿。[续跑](KB02-R1-20261015-main-real-resume.json) |

两次规划均finish=stop，46输入/45归属，23问题全部归属，无重复或未知ID。漏项f-c2-3是“两个虚构区域的异常审批负责人未知，原文明确AI仅用于未来分析建议。”不是截断、分块未处理或恢复失效，不能删除合法输入或自动编造归属来过门禁。[逐调用分析](KB02-R1-20261015-main-final-evidence.json)

长文规划提案未再独立生成排版说明页，问题大体围绕原文明示负责人未知；但完整性失败未组装草稿，不能签最终长文页面质量PASS。短文单列“AI异常提示说明”记为粒度观察，不用固定页数单独判FAIL。引用存在仍能承载错误的事实解释，结构通过不能证明业务正确。

### 实际浏览器范围

IAB观察长文提取/规划/失败、14/14检查点，点击继续并用HTTP/账本交叉确认同job复用。补充“继续审核”可打开实际草稿，来源事实、AI整理/推断、待确认问题、证据分栏可见；默认0条选中，确认按钮禁用。未点击补充确认或再次生成更新预览。

[审核页面文本](KB02-R1-20261015-main-browser-review.txt)、[审核截图](KB02-R1-20261015-main-browser-review.png)、[长文失败截图](KB02-R1-20261015-main-browser-long-failure.png)。成功长文审核和更新确认BLOCKED，组件检查不冒充完整浏览器闭环。

## 处置与边界

| 原项 | 状态 |
|---|---|
| F-K202-01恢复 | CLOSED，受控HTTP及真实同job继续均验证 |
| F-K202-02严格检查点 | CLOSED，坏JSON/未知字段/超限/引用/版本/秘密409预检验证 |
| F-K202-03测试迁移 | CLOSED，独立完整231/231及build通过 |
| F-K202-04真实事实/规划 | OPEN，语义错误及两次漏项 |
| 本批补充更新闭环 | FAIL/BLOCKED，实际预览502；既有更新链新观察问题，不能认定R1引入回归 |

KB02原19+本轮新增21=**40/40次实际请求**，失败也计入：短文2、补充提取规划2、更新预览1、长文14+1、显式继续1。历史KB01 27另列，两批合计67；停止外发。[请求账本](KB02-R1-20261015-main-provider-attempts.jsonl)、[脱敏trace](KB02-R1-20261015-main-provider-trace.jsonl)

冻结后产品/测试未变且无新增；1622保护文件（含正式workspace7文件及旧报告/验收脚本）均未变，实际.env.local指纹不变，正式workspace无新增。R1文本产物扫描无实际API Key。自有隔离服务及标签已关闭，64565/64566不可达，用户原服务未停止。[清理](KB02-R1-20261015-main-lab-final.json)、[完整性](KB02-R1-20261015-integrity.json)

本轮未部署、提交、自动切换模型或推进其它批。FULL3、Prompt/ST-F01及历史KB01未过项保留。剩余返修需要明确有限新增取证预算，不能把已耗尽预算重置或在无真实证据时签PASS。
