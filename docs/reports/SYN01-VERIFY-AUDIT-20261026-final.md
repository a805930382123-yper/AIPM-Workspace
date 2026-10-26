# SYN01-VERIFY 独立最终验收（2026-10-26）

审查者：Astra。依据冻结任务卡、独立工程/原稿报告以及实际落盘；没有读取私有response或配置，没有外发、启动服务、改产品或提交。主Agent负责Chrome操作与收尾，独立者核归档UI证据和隔离磁盘，不冒称亲自完成这些点击。

## 分层裁定

| 层级 | 结论与边界 |
|---|---|
| V01–02 新入口工程 | PASS。见本前缀engineering报告：实际差异仅受控前缀/序号绑定，108文件冻结与独立最小smoke通过；不再复跑旧矩阵。 |
| V03 原始质量 | PASS，本固定双Raw样本。见quality报告：新v1有效，逐条单Raw支持；共同月份/区域/100/公式、A20与B30冲突、未知采样日/负责人、未来AI且未上线/收益未知均进入正文。事实、推断、问题分列；不靠宽locator证明语义。 |
| V04 人审保存回读 | PASS。显式归属审查绑定未改原稿，正式三页、原8证据、12单元、3创建日志及两Raw逐项核实，详情如下。 |
| V05 额度与收尾 | PASS，归档账本实际244一次，累计244/500、Prompt15/24；245–246未用。服务/自有Chrome关闭依据主Agent执行记录，不重新启动验证。 |
| SYN01批次 | PASS，限当前Windows本机、固定双来源综合原稿→显审→正式保存→刷新回读闭环。历史242结构FAIL与243语义FAIL保留。不能将一次成功解释为全部输入永久遵从。 |
| 全产品/B09 | 未通过本轮整体验收；R12等剩余缺口不由SYN01覆盖。 |

## 直接核验结果

读取原export-1793003796373、最终export-1793004448646、MAIN-persisted，以及指定隔离根的workflow JSON、三Wiki Markdown、两Raw Markdown、knowledge/logs/wiki.jsonl。没有读取配置/私有响应/其他用户数据。

1. 原/终export的artifacts完全相同（request、原response、candidate-original），两Raw对象相同。当前持久workflow标题、category、sources、rawSnapshots、全部sections和8条evidence与原候选严格相同；无人工补写或删改。confirmed/revision3；原始revision1仍保留。最终导出的candidate-original保持未审原件，不能误当当前workflow。
2. 12个review units与原件完全相同，全部归属唯一页；basisDigest重算为76ced81158a8986b6efe5d65d304a583a84068bf9a76ccee622d9e831f4ea992。按生产candidateContent排除生命周期字段后独立重算内容摘要，唯一approval匹配f903e4baf81e58f1c13e28d3ddcbc8dcb77115633dd9d7ccb0e1b5a9cf0f36c6，pageId为workflow 2fa6839d-52b9-4236-b98d-b05b0fa9b805。确认时间早于正式写入。
3. 综合页abbeaf73-2077-4e1e-870d-1cec2944558a的六个标题区及每一条正文/引用，与原sections按现有规则组成的全文严格相同。正式Markdown除既有H1标题封装外，与export正文及全部元数据相同。两个Source页bc1d444b-5c8b-4b34-8e42-1602eb598818、29b7001b-0877-4627-8d2f-9a6425254a72各保存正确Raw ID、标题及完整短正文；三页均revision1。
4. 两Raw实际磁盘正文重算SHA分别9b9315e337c79270e472d4fc2084c776a7259dfee9cb633fe6ce337d3da476d7、2bb56ff5456c3b0d35a3634f0ddcaac2e1ddd805620396bcb5019e1c6444bfb4，与原输入/最终导出一致。
5. 实际磁盘只有对应三条create日志，与persisted归档一致，ID集合等于正式三页，operationId均为adf760d1-cc9c-4d0f-ad23-4345d221bbe1，绑定当前workflow提交。不是以Wiki计数代替内容核验。
6. 阅读MAIN的synthesis/sourceA/sourceB/rawA/rawB AX证据（部分是差异树）及saved.png：三页、来源Raw打开链接、正式正文和两Raw全文/SHA可见。Chrome显审→保存→正式确认→reload具体动作和退出结果见MAIN-final.md。独立磁盘比对补足截图无法覆盖所有正文的限制。

## “人工审核 未审核”的准确含义

该显示忠实反映三Wiki的review_status=unreviewed。knowledge-workflows.ts:399/407创建正式页时既有默认即如此；humanReview.approvals是草稿主题/完整归属确认，具有独立内容绑定。当前卡V04及HUMAN门槛要求后者，未要求自动将Wiki独立审核元数据升级为reviewed。此次有真实approval与未改内容，故不是绕过无人工确认禁写的门槛，不因此拒绝本批。

仍须保留这个可见区别：不能对用户声称Wiki审核元数据已完成或内容已达到verified。综合页仍ai_organized，Source为source_supported，等级默认C；本次不证明来源等级自动判定。相似“审核”用词可能造成理解困惑，作为现有UI语义限制记录，不在本轮擅自改状态/扩需求。

## 实际命令、版本与证据指纹

基线HEAD实查：fcd0e23953e872d3f2bf733ef6d71617b7c98045；services/wiki/knowledge-workflows.ts SHA256仍eab0d663fb83835474f65fbaecd26df1a503d773dd26f2a7138c8dc7635a2032。冻结108摘要0abd0b2cf140a3a0f0c8e44daa23346ae420373a18cc5e83a387822f5bf51a3f，工程已独立核，本阶段未重跑工程。

实际命令：`node docs/reports/SYN01-VERIFY-AUDIT-20261026-final-check.mjs`，Node v24.20.0，最终exit0，0.434秒；断言结果Raw2/Wiki3/log3/evidence8/units12/approval1 PASS。脚本保留便于复核，仅读取固定证据与允许的隔离落盘。另执行`git rev-parse HEAD`、`Get-FileHash services/wiki/knowledge-workflows.ts -Algorithm SHA256`及定向Get-Content/rg阅读。

探查失败如实保留：首次临时here-string导入未安装gray-matter报ERR_MODULE_NOT_FOUND，未执行断言；随后使用项目已有js-yaml。持久JSON由PowerShell归档将updatedAt的.530Z序列化为.53Z，首版直接字节比较失败；核明同一时间后只对这一字段按时间值比较。Wiki磁盘有现有H1标题封装，下一次断言暴露该预期差异；对照store.ts:58读写规则后精确加入H1预期，未放宽正文或其他元数据比较。产品/原件均未修改。文件探查曾对不存在的根logs及markdown.ts返回路径不存在，已改读实际knowledge/logs及store.ts；无检查遗漏被记为通过。

| 证据 | SHA256 |
|---|---|
| 原export-1793003796373.json | 372a0dd0fd9e43252a254d97b79dec0ac57e1888d70e9c02db540e1f2333f4aa |
| 最终export-1793004448646.json | d3ea64b47ea6443d897af06f45294011d992605a4cc70b929f3044412331c130 |
| MAIN-persisted.json | 2ecd1999ef7ad04a966351082928b936eb823d740dab0b4d1aaa32e68b6e787d |

实际审批拦截/fixture核明后同操作获准过程见MAIN-final.md；独立者不重演该过程。两份账本和原稿显示真实发送仅一次；第一次被拦截的浏览器动作不计为第二次模型调用。此次独立最终核验真实0/config0/服务启动0。

## 下一最小建议（未启动）

结束SYN01，不为用完245–246额外抽样。依据NEXT-PREP-20261024-gap-map，优先收敛已明确原子FAIL的R12：C09/10未知内容未独立进入open_questions。建议下一独立小批先零调用复用C既有原稿/持久页和现行展示路径，确认缺口究竟在分类/组装/呈现，再仅修明确落点并用同原件定向回读；不重跑整套模型或重诊断SYN01。若必须改变事实与问题的产品归属规则，先交明确取舍，不用机械关键词掩盖语义。

R16/R18模板字段、R22来源等级职责和全产品组合版本/桌面四链证据仍单列后续，不能被本批PASS覆盖。这里仅建议，未写下一任务卡或施工。报告交主Agent更新台账及统一Git后停止。
