# R16/R18 HUMAN续接：本机TEMP副本准备

2026-10-28，`human_prepare`施工交接；代码基线 `5ed727128b12e5bb5c004f1205a2cf4a69f532ed`。沿已冻结HUMAN B5方案，仅准备隔离副本及本报告，没有修改产品、测试或原稿；本轮不提交Git。实际UI与独立验收交主Agent后续执行。

## 可交付root

原P：`E:\AI\Work\AIPM Workspace\.scratch-R1618-COVER-20261028-Gjkejk`。

**新root：`C:\Users\80593\AppData\Local\Temp\r1618-fields-lab-s5ZJzI`。** 这是本机非sandbox的当前`os.tmpdir()`直属新建目录。已跨两条`require_escalated`命令成功持久回读，父路径与本机TEMP一致。后续启动同样使用本机环境，否则既有lab的TEMP父目录校验会拒绝。

只复制`knowledge`、`drafts`、`prompts`、`state`四目录；保留原ID、字段、事实、证据和unit身份，不预先清除痛点、补outputs或人工改稿。没有复制源根目录的release、请求/响应或private归档，没有读取实际配置。

- raw：`0fb6e144-3db7-43f0-a06a-16cb57b1c288`。
- draft：`b27f1cfd-be27-4365-8962-5164f8241bd4`。
- 唯一Process page：`32d1e8ad-8286-43dd-93e8-04c8ee0ee87e`。

`r1618-lab.json`沿既有格式写入kind=`r1618-fields-lab-v1`、精确root、当前baseline、draftId/rawId、originalRawSha256，以及原稿派生的originalPages（pageId/source_facts/source_evidence）。realCalls/configReads均0，仅描述本轮准备。

主Agent在本机非sandbox环境从项目根启动（本施工实例未执行）：

```powershell
node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --root "C:\Users\80593\AppData\Local\Temp\r1618-fields-lab-s5ZJzI"
```

入口预期为`http://127.0.0.1:5176/r1618-fields?draftId=b27f1cfd-be27-4365-8962-5164f8241bd4`，导出预期为`http://127.0.0.1:5176/lab/export`，实际监听与就绪以启动stdout为准。本实例没有启动服务、浏览器或模型，没有运行smoke、矩阵或产品测试。

## 实际命令与摘要

准备命令为PowerShell here-string管道`node --input-type=module`，使用Node内置fs/os/path/crypto：读取指定原Raw/Draft，先比历史SHA，`mkdtemp(os.tmpdir()/r1618-fields-lab-)`，依次`fs.cp`四目录，比较副本Raw/Draft Buffer，`writeFile(...,{flag:'wx'})`写元信息，复读原稿确认未变。本机准备exit0，0.444秒。

另一条同形式只读Node命令跨调用回读新root与元信息，核本机TEMP父路径；递归生成四目录所有相对文件路径和文件SHA的排序清单并比较源/副本。本机回查exit0，0.383秒，四目录全部一致：knowledge 1文件、drafts 1文件、prompts 0文件、state 1文件。

| 对象 | SHA256 |
|---|---|
| 原/副本Raw文件 | `6be6c24bc5c61d1f45c45a0462a0726f4ce1f4938544eb9bfd01b0f5ad97944f` |
| 原/副本Draft文件 | `ece20626438f53e47d49d3a22f2991c4209211b761f1a3a1e618dccc327d93f4` |
| 新r1618-lab.json | `b9265ebb94dd6c6f84812170a7d2195a8450bc4e13c4d8b933a671737c5bcf9b` |

Raw/Draft摘要与历史`R1618-HUMAN-20261028-builder.md`完全一致；复制后源Raw/Draft仍与复制前字节相同。

## 首次sandbox环境证据

首次默认sandbox准备命令exit0，0.905秒，同调用复制及Raw/Draft比较成功，得到`C:\Users\80593\AppData\Local\Packages\sandbox.{e40f5350-5876-4bfd-a23c-14978f15c5f0}\AC\Temp\r1618-fields-lab-Nwb8zK`。随后新调用读取其knowledge目录返回ENOENT（exit1）；该sandbox目录没有作为交付root。主Agent另已报告其sandbox使用不同TEMP父目录，首次lab尝试被既有父路径校验拒绝、未启动；该启动证据由主Agent报告记录。

因此本轮另在真实TEMP准备上方新副本，并实际跨命令回读成功。没有把sandbox环境失败记为产品故障，也未修改入口校验。

## 交接边界

本轮准备成功，只证明真实P原稿被保真复制并可持久回读；H01–H04实际UI、人工纠偏、审批失效、重审、隔离正式确认及刷新回读均未由本实例执行，不能签人审闭环或R16/R18/B09整体PASS。旧自动FAIL、outputs/question-only缺证保持。

真实调用/配置读取0，累计知识252/500、Prompt15/24保持。原scratch与公开历史归档未改。共享工作区他人编辑保留，AGENTS.md及AGENT-ROUTER报告排除；本实例只写本报告，交接后停止写入。
