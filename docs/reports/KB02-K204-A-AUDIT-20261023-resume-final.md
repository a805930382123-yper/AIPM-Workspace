# 阶段A独立验收收尾

**本轮阶段A通过；KB02整体仍BLOCKED。** A1原生metric质量及创建、A2完整提取后的显式人工资料纠正/全页审查、A3原始更新预览质量与正式确认/回读/幂等完成。原自动主题问题仍在A2实际响应中出现，历史FAIL不关闭；不以人工成功称模型修复。B/C未授权、NOT_RUN。

受测提交基线 `41ee7862305f71ae9a35c26b84a8db58dcc747c3`，产品 `60f83ad`；四模块+188原文件冻结SHA `a6ba495b97cb271da732cbed32c0243ab4508a675333e3e1b440093d48d00aaa`。本次最终再次逐文件核192项均不变。待主Agent统一提交后关联新commit，不能预报尚未产生的提交号。

## 实际模型与分阶段结果

安全Provider摘要open.bigmodel.cn / GLM-5.3-Flash。主Agent逐段release后在Chrome分别触发；220/221为A1、222/223为A2、224为A3，共5次，无重试或附加调用，知识累计224/500、Prompt15/24。所有响应HTTP200、finish_reason stop。独立最终脚本核每次request.body hash等于持久账本、result response hash匹配，wire为生产模型且stream:false；原请求未存headers。具体五对hash保存在resume-A3-readback.json。

| 范围 | 结论与关键证据 |
|---|---|
| A1 | 原生metric、6fact+1unknown/7unit完整，定义公式、零分母边界、100/20/20%、单位限制、未知采样日保全；Chrome创建及固定备注保存后revision2回读通过，详见resume-A1。 |
| A2 | 4fact+1question全保全。原孤立AI边界页/“异常审批流程”主题有缺陷；按卡显式改为人工并列资料组，不推断业务关系。保存metric更新目标后清审0/2，再逐页重审2/2，原unit/ID保全，详见resume-A2。 |
| A3质量 | 原模型新增30/30、冲突并列20/20与30/30、100共同目标、推断不确定、口径/采样问题分栏正确。旧定义/公式/零边界/单位/未知日及人工备注全文保留；财务/AI不冒称双侧共识；不需人工改写模型输出。 |
| A3人审持久化 | 新workflow revision1 approvals0，2来源unit+6提议共8项。主AgentChrome核全页、明确审查v2、确认一次；真实刷新/重开显示目标第3版、Raw2及全部旧新内容。独立磁盘核模型sections、8unit/归属均未编辑，1有效审批，唯一commit completed。 |
| 幂等 | 主Agent明确授权本地检查后，独立调用生产公开confirm（原workflow/baseRevision2/idempotencyKey）返回reused:true；隔离session全40文件前后逐字节SHA完全一致，目标revision/日志/账本无新增。没有构造Provider，fetch拒绝守卫计数0。 |

## 命令与证据

实际命令均exit0：

```text
node --import tsx tests/acceptance/KB02-K204-A-AUDIT-20261023-resume-A1-readback.mjs
node --import tsx tests/acceptance/KB02-K204-A-AUDIT-20261023-resume-A2-readback.mjs
node --import tsx tests/acceptance/KB02-K204-A-AUDIT-20261023-resume-A3-readback.mjs
node --import tsx tests/acceptance/KB02-K204-A-AUDIT-20261023-resume-A3-idempotence.mjs
```

对应JSON同前缀同名；最终两命令没有读取配置/构造Provider/真实外发。完整工程独立16组及补充探针在resume-engineering报告，首localhost沙箱失败和获批后通过记录分别保留，不重跑445/build。真实阶段无失败重试。

Chrome操作由主Agent完成，本审查者独立核其AX及磁盘。A3证据：`KB02-K204-A-MAIN-20261023-A3-unreviewed-dom.txt`、`A3-browser-ax.txt`、`A3-browser.png`；最终AX确认第3版、Raw2、20/30分栏与固定备注。预览前已扫描导出 `KB02-K204-A-20261023-export-2026-10-24T04-56-04-681Z.json` SHA `c9950c86f032cc593bedb38058b1ce63c8b12dcbedbdcc64343ae57261c09f89`核验一致。最终导出及总保护扫描由主Agent收尾。

最终metric `c6590bed-1325-4456-899b-84804136ce1d` revision3，body SHA `099416f2c859fb128dfd10e88fca3b731bb923f49cf02144958244b3c044ed7b`；commit `b2e8703e-e8cf-468a-8f04-927158d1c287`。两个Raw SHA不变。知识库是两个Source加一个metric；A2非选中人工资料组仍保存在草稿中，没有额外正式创建。原候选、人工后草稿与正式目标三层证据各自保留。

## 剩余范围与停止

此轮没有产品代码修改，接线工程和阶段A验收目标已完成；历史模型自动主题缺陷未关闭。原混合短文B、原长文C新链仍未实测，KB02不能结批。A3 session仍由适配器记awaiting_review，独立最终报告给出审核PASS；本审查没有手改session状态或签下一阶段release。预算已到本轮上限224，不再外发。

主Agent完成自有服务停服、保护/秘密扫描、限定本轮文件提交与远端一致性核验后报告并停止。后续B/C或其他修复需新的明确指令，不自动推进。

确认后最终导出 `KB02-K204-A-20261023-export-2026-10-24T04-57-45-143Z.json` SHA `160ec2a6f6c8be303e85b924e1e0adf0ee4a530a1e9258f665298274093f44ac` 已独立Get-FileHash核验一致；不因此追加实测。
