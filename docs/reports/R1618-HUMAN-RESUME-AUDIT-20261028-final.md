# R16/R18 HUMAN续接：独立验收

2026-10-28，独立验收 `human_audit`（Astra medium），受测代码提交 `5ed727128b12e5bb5c004f1205a2cf4a69f532ed`。沿[冻结HUMAN B5计划](R1618-HUMAN-20261028-plan.md)，Sol准备停写、主Agent实际UI操作停写后核查；本实例未改产品、未操作UI、未调用模型或读取真实配置、不提交Git。

**本轮H01–H04人审闭环PASS：真实P候选经过人工纠偏、修改失审、重新显审和隔离正式写入，原来源保持。旧浏览器进入阻塞在本机此次操作中未复现。R16/R18整项、B09及全产品仍未通过。** 本轮无产品施工，不能表述为自动质量缺陷已由代码修复；旧P自动FAIL、outputs自动改善未覆盖和question-only真实分支缺证均保留。

## 实测及证据

主Agent使用本机TEMP `C:\Users\80593\AppData\Local\Temp\r1618-fields-lab-s5ZJzI`、既有lab和IAB。实际操作证据位于 [evidence目录](R1618-HUMAN-RESUME-20261028-evidence/)，最终结构化导出为 [final-export.json](R1618-HUMAN-RESUME-20261028-evidence/final-export.json)。过程没有另存阶段JSON，审批过程以实际AX为依据，不补造过程导出。

| 验收项 | 独立核查结果 |
|---|---|
| H01 | `h01-approved.txt`显示v2、1/1已审、唯一Process及原六事实、独立问题、原争议痛点。`h01-initial.txt`为增量AX，展示原Raw六句；不将它说成完整初始快照。原始v1来自既有归档与本轮复制SHA核对。争议原稿未提交。 |
| H02 | 主Agent在AI文字控件改为“原资料说明异常审批负责人未知、AI尚未上线且收益未知；尚不足据此确定业务痛点。”，保存刷新。`h02-reloaded.txt`仅为加载中快照，不能单独证明持久化；随后完成加载的`h02-selected-blocked.txt`显示v3、上述文字及人工修改标签、已审0/1、已选择1页而确认按钮disabled，构成刷新后实际证据。改写符合计划允许的最少操作分支，未改原事实。 |
| H03 | `h03-reapproved.txt`显示v5、1/1已审及可用确认按钮；`h03-committed.txt`显示操作 `562a1573-4010-4c67-851f-47f9abd44a5c` 已完成。最终Draft confirmed、审批1条；Source与Process各1条且revision均1。 |
| H04 | `h04-process.txt`、`h04-source.txt`与最终导出正文经空白归一后完整包含比对通过，截图提供正式页视觉证据。痛点明确人工修改且不再断言业务痛点，AI未来/未上线/收益未知限制、六事实和独立待确认问题保留。 |

正式Process：`5fd1317a-c8eb-42e5-97b9-d59982c1f468`；正式Source：`fdd21caf-72ee-43da-a57c-c080065250e8`。独立枚举TEMP Wiki只有这两个Markdown及index.md。操作次数由主Agent实际交接及单一完成operation提供，最终目录/导出佐证没有重复正式页。

独立使用PowerShell here-string管道 `node`（内置fs、assert/strict、crypto）读取COVER `candidate-original.json`和最终导出，深比较source_facts、source_evidence、open_questions、provenance以及humanReview.units/assignments/basisDigest；**6事实、1完整证据、7原unit（6fact+1question）及归属不变**。除pain_points外的templateFields全等；痛点factIds/evidenceIds不变、humanEdited=true。正式正文包含六事实、独立问题及人工修改文案，Source/Process正文均与实际刷新AX相符。该断言命令exit0，0.848秒。第一次同类核对将Markdown标题与列表误按一个换行匹配，exit1；实际正文有正常空行，读明后改为允许空白的匹配通过，未修改产品或证据，不是产品失败。

另以 `require_escalated` 的只读here-string管道 `node` 跨环境核实际TEMP：Raw文件与源scratch相同；源Draft保持历史SHA；TEMP Draft深比较最终导出相同；枚举正式文件。exit0，0.430秒。

| 摘要对象 | SHA256 |
|---|---|
| 原及TEMP Raw文件 | `6be6c24bc5c61d1f45c45a0462a0726f4ce1f4938544eb9bfd01b0f5ad97944f` |
| 原scratch Draft（本轮未改） | `ece20626438f53e47d49d3a22f2991c4209211b761f1a3a1e618dccc327d93f4` |
| 最终导出 | `e39c2f0fe2a826ecdde9b2404efa984c64adc890178794d6cf0ac21aacb79528` |

## 复用和边界

实际 `git rev-parse HEAD`、`git diff --name-only c55b30a HEAD -- app services server storage shared tests` 及COVER d6cbb73至HEAD同范围比较无产品差异，当前产品工作区亦无修改。AUTO交付a064ebc至HEAD的app/services/rules及lab/browser比较仅有knowledge-planning.ts、rules.ts变化，UI、草稿持久化、渲染和入口未变；lab `Get-FileHash`仍为 `93ecd26190924ed4cbe1e0f6e1b32903253038a14786a8920392b5999e5eefab`。据此复用COVER真实Concept质量/传递、TIMING F04两型人工闭环与AUTO新增AI控件保存/标签证据，不重跑C、不跑旧矩阵/tsc/模型。

只读 `rg` 核 `WikiPage.tsx:269`自动请求Audit，而本lab无registerAuditRoutes；生产 `server/index.ts:316`有挂载。正式页下方“请求失败，请稍后重试”属于隔离入口未覆盖的辅助Audit，正文已完整读取，不影响本次H04；不签Audit链或完整App通过。Wiki元数据“人工审核 未审核”来自 `commits.ts:285/296`既有新页review_status=unreviewed，独立于Draft humanReview主题/归属审批；本轮显审及提交证据不等于正式Wiki知识真实性已审核，不为此扩范围修改元数据。

首次sandbox TEMP副本无法跨实例持久访问、lab父目录校验拒绝的准备尝试保留于builder与主Agent报告；可交付root随后通过真实TEMP跨调用读回。本轮来源隔离和UI实际完成，不能追认上次HUMAN NOT_RUN为通过。Provider固定undefined，envDir指TEMP、configFile=false；导出硬编码realCalls/configReads=0本身不是审计证明。本轮没有模型请求或实际配置操作，知识252/500、Prompt15/24保持。

清理采用[主Agent实际交接](R1618-HUMAN-RESUME-MAIN-20261028.md)：tab1已关闭，session2440 Ctrl+C exit1、未输出正常stop消息；随后Get-NetTCPConnection筛5176/63988无监听。本实例读取记录但未重复探测。共享AGENTS.md和AGENT-ROUTER报告排除，独立只写本文后停写交接。下一步应单独决定剩余自动outputs/question-only覆盖及B09其余门槛，不因本轮人审PASS自动推进R22或完整四链。
