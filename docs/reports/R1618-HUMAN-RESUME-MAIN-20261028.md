# R16/R18 HUMAN 本机续接实际操作

2026-10-28。用户“继续”授权；执行基线 `5ed727128b12e5bb5c004f1205a2cf4a69f532ed`。沿既有 HUMAN 计划，B 5分（0/2/2/1）；Astra既有规划，Sol High `human_prepare`准备，主Agent实际CUA UI，Astra medium `human_audit`独立裁决。未修改产品或测试。

## 环境与命令

首次启动 sandbox TEMP副本的 `node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --root <sandbox root>` 在第23行TEMP父目录校验拒绝，exit1、未启动服务。不同调用/实例TEMP不共享，Sol改用本机持久TEMP重建；见[准备报告](R1618-HUMAN-RESUME-20261028-builder.md)。未更改lab限制或配置。

实际成功命令（require_escalated）：

```powershell
node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --root 'C:\Users\80593\AppData\Local\Temp\r1618-fields-lab-s5ZJzI'
```

session2440，UI5176、API63988；Provider禁用，envDir隔离。IAB tab1创建与导航成功，旧浏览器阻塞本机未复现。未运行测试矩阵、smoke或真实模型；真实/config0，知识252/500、Prompt15/24。

## 实际 UI 与证据

证据位于 [evidence](R1618-HUMAN-RESUME-20261028-evidence/)。操作均由CUA的click/setValue或Playwright可见控件执行，无API写入或直接改草稿文件。

- H01：进入真实P草稿v1，看到一页Process、六事实及独立问题、原痛点。点击“确认本页主题与归属”，v2、已审1/1。初始Raw详情短暂显示0字符，异步加载完成后显示137字符及完整原文；未判为内容丢失。
- H02：将痛点AI编辑框改为“原资料说明异常审批负责人未知、AI尚未上线且收益未知；尚不足据此确定业务痛点。”。保存v3，刷新后已审0/1，人工改写文字与“AI草稿经人工修改（待核对）”标记保留。选择“写入”，保存，未重新审批时“确认写入 Wiki（1）”仍disabled。选择后保存的即时快照仍显示v3，属于异步观察，不用它推定服务器最终版本。
- H03：再次逐页确认，v5、已审1/1，提交按钮可用。点击一次“确认写入 Wiki（1）”；等待状态由提交中变为已完成。operationId `562a1573-4010-4c67-851f-47f9abd44a5c`，source/pages/index/log/state全done。
- H04：刷新浏览器并点击“查看正式 Wiki”，加载后显示2页。Process及Source分别回读，人工纠偏、AI未来/收益未知、独立待确认问题和原事实可见。Source `fdd21caf-72ee-43da-a57c-c080065250e8`；Process `5fd1317a-c8eb-42e5-97b9-d59982c1f468`。保存AX及Process截图；正式页Audit区域有“请求失败，请稍后重试”，页面元数据人工审核为“未审核”，交独立验收核其与本轮主题审核的边界，没有隐去提示或声称完整Audit链通过。

只读导出命令：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:5176/lab/export' -OutFile 'docs/reports/R1618-HUMAN-RESUME-20261028-evidence/final-export.json'
```

exit0；导出draft.status=confirmed、formal数量2。阶段证据为真实AX/DOM快照，仅最终状态有结构化导出，未补造中间结构化状态。独立验收核原始数据和最终文件，不以本报告自签PASS。

快照边界：h01-initial.txt是初始AX后的差异，完整原痛点见h01-approved.txt。h02-reloaded.txt捕获到刷新加载中，不能作为完成证据；其后同次工具的DOM输出已显示v3/0/1/人工修改，随后h02-selected-blocked.txt保存了刷新加载后完整DOM及已选1页但仍禁用提交的状态。

## 清理与边界

CUA tab1已关闭。session2440 Ctrl+C后exit1（未输出正常stop消息）；随后 `Get-NetTCPConnection -State Listen` 筛选5176/63988无监听。TEMP留存供独立核查，原scratch只读。本轮不推进R22/四链，旧自动FAIL及outputs/question-only缺证不追认通过；R16/R18/B09整体另行裁定。
