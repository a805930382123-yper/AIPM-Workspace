# B05 独立验收（2026-10-07）

**确定性实现与返修复验 PASS；B05 整批 BLOCKED：缺真实产品 Provider 配置，实际生成成功与质量尚未验收。** 初验发现的 F05-01–F05-05 均关闭。没有遗留已复现的实现失败；不能将 HTTP fake 的输出质量视为真实模型质量。

用户指定的施工子 Agent 实际以 `gpt-6-luna / high` 创建，完成施工与一轮返修；本聊天主 Agent 独立验收，未修改产品代码。未发生施工模型升级。B04 保持“11项缺陷关闭、确定性PASS、真实Provider BLOCKED”；本次根据用户明确授权开展B05，不补签B04 PASS。B06及以后未授权、未施工。

## 交付版本与证据

工作区无 Git 仓库，使用文件指纹固定交付版本。[最终冻结指纹](B05-acceptance-frozen.json)覆盖 app/server/services/rules 共46个文件；检查结束时文件集合及SHA256完全一致。[收尾记录](B05-acceptance-final-checks.json)同时记录 Windows/Node v25.2.1、正式workspace的2个非assets文件集合与摘要不变、服务关闭状态、配置存在性（仅布尔值，不记录密钥）。该workspace基线在本轮施工期间采集，不能据此声称验证了采集前的一切行为。

施工交接：[初次施工](B05-build.md)、[返修施工](B05-repair-build.md)。验收依据：[B05任务卡](../batches/B05.md)、[冻结交接契约](../handoffs/B05-luna-task.md)、acceptance.md 的 A18/A22–A24、R20/R24，以及 Raw、人工确认、恢复与并发不变量。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| `npm run build` | PASS，TypeScript与Vite完成；Vite阶段948ms | [构建日志](B05-acceptance-build.log) |
| `npm test` | PASS，107/107，0跳过，16.182秒 | [测试日志](B05-acceptance-test.log) |
| 独立HTTP与文件断言 | PASS，11组/11组，8.807秒；多断言场景，不等于11个断言 | [HTTP记录](B05-acceptance-http.json)、[脚本](../../tests/acceptance/b05-independent-http.mjs) |
| 主Agent实际浏览器 | PASS，三决策、更新/综合、保存/恢复、确认/放弃闭环 | [操作记录](B05-acceptance-browser.json)、[截图](B05-acceptance-browser.png) |
| 正式用户库与隔离清理 | workspace摘要不变；HTTP及浏览器隔离API/UI已关闭 | [收尾记录](B05-acceptance-final-checks.json)、[浏览器运行记录](B05-acceptance-browser-runtime.json) |
| 真实模型调用及内容质量 | BLOCKED，服务端环境三项均未配置，`.env.local`不存在 | [配置存在性](B05-acceptance-final-checks.json) |

复验命令为上述build/test与 `node tests/acceptance/b05-independent-http.mjs`；浏览器操作通过实际页面完成，另以 `b05-browser-verify.mjs`读取隔离文件核对。测试使用临时数据根及独立HTTP fake，没有将验收资料写入用户正式库。npm test会重写历史施工证据：运行前原件留在 B05-baseline，当前回归输出另存为 [B04 HTTP回归证据](B05-acceptance-b04-http-evidence.json)和[合并payload](B05-acceptance-b04-merge-payload.json)。平台未提供施工子Agent token计量，记为不可得；不推算计费或额度节省。

## 已实测的交付行为

1. 标题（含全角规范化）、别名、分类、标签、内容相似五维候选与原因可读；仅分类重合为低分建议。存在强候选且未决策时409；暂不处理不入库；用户显式仍新建可产生独立ID，同名/别名歧义提示可见，原页不改。
2. 更新预览并列现有、新来源、建议增加、冲突和推断。保存草稿不改旧页；确认后保留旧人工备注、两条相反公式、来源并集及待确认问题，revision递增；编辑标题真实写入，原标题保留为别名。旧预览或旧目标版本409，人工新编辑不被覆盖。
3. Raw/Source混合选择按Raw去重；同一Raw及其Source只算一来源，浏览器生成按钮禁用。两个不同来源可生成、编辑、保存、恢复并确认Synthesis，主要来源、一致观点、冲突、推断、问题分节存在。已有Source复用；缺失Source、正式Wiki、Index、Log按提交清单推进。
4. 确认前持久化operation清单；独立注入实际Index rename EIO后返回明确失败与operationId。解除故障、同目录服务重启恢复，原Source/Synthesis ID不变、Log每页一次、workflow收敛为confirmed。恢复前人工改旧Wiki会进入conflict并保留人工编辑。completed提交重试复用原operation，即使正式页后来人工修改也不重新执行或改写。
5. 非法JSON/必需标题/分类/引用拒绝，失败不伪装成功；未配置Provider返回503。来源实际正文SHA及quote位置校验成立：草稿后改Raw实际正文而保持过期frontmatter hash，确认409且无正式副作用。正常生成、保存、放弃、确认、恢复前后隔离Raw摘要不变。

浏览器另验证了两次保存恢复：更新草稿 `4a4bb63c-2473-4020-9834-bd5ca2b0ea5c` 保存标题/人工增加后，刷新及全部验收服务以同数据目录重启，正常Raw待审核列表可找到同ID及原编辑；放弃后正式资产全摘要不变。[放弃文件证据](B05-acceptance-browser-cancel.json)的contentPreserved=false是“取消内容未写入正式页”的预期，不是丢失已确认内容。

新的更新确认后旧页变为“铺货率 浏览器确认更名”，原标题别名与旧备注保留。综合草稿 `bb4f2f83-2d86-4c30-9a89-4facdb61ac41` 保存人工问题后，API同目录重启并刷新，经正常列表恢复、确认并在Wiki读回。之后再测试暂不处理、显式独立新建，最终隔离库为5页；[最终文件证据](B05-acceptance-browser-files.json) rawUnchanged=true、updateTitleLost=false、contentPreserved=true。其中formalUnchanged=false为已明确确认正式写入后的预期。截图拍于综合确认后、最后独立新建之前，显示4页；不要将截图页数冒充最终计数。

## 缺陷关闭与验收边界

| 缺陷 | 独立关闭证据 |
|---|---|
| F05-01 非法综合schema可保存并兜底分类 | E05-09非法title/category/quote拒绝、零正式写入 |
| F05-02 保存后正常UI无恢复入口 | 浏览器更新与综合的刷新/同目录服务重启恢复，同ID同编辑 |
| F05-03 更新标题编辑丢失 | E05-03及浏览器确认更名，正式标题一致且旧标题别名保留 |
| F05-04 恢复后草稿状态不收敛、completed重试重新执行 | E05-06恢复confirmed、E05-06b保护人工编辑、E05-11已完成重试零正式改写 |
| F05-05 只信frontmatter而未复核实际Raw正文 | E05-12实际正文变更409且零正式副作用 |

保留初验FAIL：[返修卡](B05-fix-card.md)、[首次HTTP](B05-first-http.json)、[恢复状态失败](B05-first-recovery-finalization.json)、[首次浏览器文件](B05-first-browser-files.json)。E05-11/12的[补充探索](B05-first-extra-integrity.json)发生于返修中，不计作首次冻结版本的完整统计；最终重新冻结后全部重跑通过。

| 验收ID | 本轮判定与限制 |
|---|---|
| A22/R24 创建前重复候选与三决策 | 确定性运行PASS；候选是启发式建议，不代表语义等价判定 |
| A23 旧Wiki预览与人工确认 | 预览、版本保护、人工编辑、写入行为PASS；真实模型建议质量BLOCKED |
| A24 冲突保留、R19/R20对应指标/综合子条件 | 注入相反公式后双方保留、问题标记与追溯PASS；真实模型识别未知冲突质量BLOCKED |
| A18/R20 多来源Synthesis | 确定性工作流PASS；真实多来源调用成功/综合质量BLOCKED，整项不签PASS |
| A06 Raw不改写 | B05已测工作流子条件PASS；真实AI未测、B06 Audit未实现，整项不能提前PASS |

内容相似使用字符片段与阈值、最多10个候选，可能误报共同用语，也可能漏报语义改写；低分分类/标签不保证实体相同。引用校验验证原文位置和文本，并不证明模型结论蕴含于该原文。以上语义判断应由真实Provider质量验收及人工审核承担，不在fake证据中冒签。

解除外部阻塞需在服务端配置现有 `FMCG_LLM_BASE_URL / FMCG_LLM_MODEL / FMCG_LLM_API_KEY`（环境或忽略的本地配置），用真实业务资料独立完成B04提取和B05更新/相反来源/多来源综合成功、引用与质量核验；无需在聊天发送密钥。本轮到此结束，不进入B06。
