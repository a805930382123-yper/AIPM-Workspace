# KB02-R2 S01 返修复验：S01 PASS，KB02 整体 FAIL

2026-10-18 独立验收。审查依据为最新 status、KB02-R2 任务卡、S01 审查入口及原返修卡。产品保持冻结，只新增验收脚本、证据和本报告。最终结论不是施工自测转签。

| 裁决轴 | 结果 | 范围 |
|---|---|---|
| Standards（S01增量） | PASS | 共享预算公式、前置409、后台防线均保留，无新增可操作缺陷 |
| 受控 Spec | PASS | 自然耗尽连续拒绝零写入、取消、恢复、并发及安全回归通过；S01关闭 |
| 真实 Provider 质量 | FAIL | Q01：提取响应契约不稳定，长文两次均在第1段失败，0/14有效块 |
| 实际浏览器 | 已执行链路 PASS | 补充资料恢复、候选选择、更新预览、确认及刷新持久化通过；长文失败显示正确，不代表长文成功 |

## S01 已关闭及工程证据

97产品/60默认测试与施工冻结一致。增量为 `jobs.ts`、`checkpoints.ts`、`knowledge-extraction.ts` 三文件及新增 `kb02-planning-budget.test.ts`。前台在任何 job/checkpoint/raw-state 写入前检查同一 `min(128,2*chunkCount+4)`，后台调用限制和恢复上限继续有效。未更改提示、schema或额度。以前的源字节临时副本已不可访问，本次按接手指纹、scope、当前代码及新增测试核验，不能声称重建了旧基线的全部逐行diff。

实际正常 HTTP 耗尽1块6次，再连续3次 planningRetry，均立即409/LLM_ATTEMPT_LIMIT、Provider增量0；三文件SHA256、完整job/checkpoint、missing `f-c1-2`、成功块及attempts均不变。最后可用预算成功及显式restart由默认测试覆盖。独立 [peer报告](KB02-R2-S01-REVIEW-20261018-peer-review.md) 已在子审查结束前落盘，主审复核其实际结果；随后子Agent终止消息报告平台额度限制，不影响已保存的运行证据，也不据此宣称额外检查。

| 独立执行 | 结果 | 证据 |
|---|---|---|
| 同字节可写副本完整默认测试 | 251/251、0skip，约19秒 | [suite](KB02-R2-S01-REVIEW-20261018-main-tests-writable-copy.json) |
| 同副本 tsc/Vite | PASS | [build](KB02-R2-S01-REVIEW-20261018-main-build.json) |
| S01/取消迟到 | 2/2 | [探针](KB02-R2-S01-REVIEW-20261018-peer-standards-probes.json) |
| HTTP主链路、恢复、旧缓存拒绝、离线旧trace及更新 | 4/4 | [HTTP](KB02-R2-S01-REVIEW-20261018-peer-http-initial.json) |
| 秘密防护/Meeting | 28/28 | [安全](KB02-R2-S01-REVIEW-20261018-peer-security.json) |

本轮未复现施工首次 E04-05 draft2 缺失；不将一次通过解释为已根治该历史偶发现象。20261016 的原子分类/目录绑定静态与受控证据保留，本次三文件变化仅预算相关，未重复消耗在所有不受影响的旧探针上。

## Q01 / P1：实际提取契约反复失败，长文不能完成

运行配置：既有 `open.bigmodel.cn / GLM-5.3-Flash`，knowledge reasoning_effort=low；只发送隔离虚构样本，无真实业务资料。严格校验正确拒绝坏输出，不是“应放宽校验”的问题。

| 全局调用sequence | 操作 | 结果 |
|---|---|---|
| 41 | 短文首提取 | `sourceNotes[0]` 多出 `kind`，LLM_SCHEMA_INVALID |
| 42–43 | 同任务一次显式继续：提取+规划 | 成功，随后HTTP明确确认选中指标并加入人工备注 |
| 44 | 补充资料首提取 | 非法顶层 `ambiguous`，LLM_SCHEMA_INVALID |
| 45 | 原106400字符长文首提取 | sourceNotes三个元素为字符串，期望object，失败 |
| 46–47 | 浏览器点击补充任务“继续提取” | 成功，同job累计3次，进入审核，默认全未选 |
| 48 | 浏览器显式生成旧Wiki更新预览 | 成功，之后明确确认，无额外模型调用 |
| 49 | 同长文任务一次显式继续 | sourceNotes 32个元素为字符串，第1段再次失败 |

长文 Raw `47f126a1-2c03-4c29-95db-6e42478c513b`，106400字符，SHA256 `a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`，沿用原14区域附录样本而非缩短输入。最终同job callCount=2，validatedChunks=0/14，draftId=null。未进入全篇规划，故14区域11%–24%、未知负责人、未来AI边界及长文更新闭环均未能签收，不能称覆盖遗漏问题已解决。

证据：[首跑长文](KB02-R2-S01-REVIEW-20261018-main-real-http-LONG-first.json)、[显式继续长文](KB02-R2-S01-REVIEW-20261018-main-real-http-LONG.json)、[完整脱敏Provider请求/响应](KB02-R2-S01-REVIEW-20261018-main-provider-trace.jsonl)。短文/补充首次失败分别保存在 SHORT-first / UPDATE-first，重试成功不抹掉首败。

定位：`services/llm/knowledge-extraction.ts:101–107` 给提取模型的提示只有 `sourceNotes:[]` 空示例，没有说明非空项必须为 `{atomId}`；`kind:ambiguous` 的放置也缺少完整契约示例。服务端依据 `rules/kb02-facts.schema.json` 严格检查。这是可核实的契约表达缺口，与本轮四个响应失败吻合；不能仅凭这些样本断言它是模型出错的唯一原因。归并为一个真实质量问题Q01，不归因于S01预算修复。建议及复验要求见 [最小返修卡](KB02-R2-S01-REVIEW-20261018-repair.md)。

## 真实成功链路及浏览器证据

短文同任务恢复后，原文引用可定位、20÷100=20%及门店数不能解释为销量等边界保留；选中一个指标，明确确认后生成指标及Source，未选建议未落盘。见 [SHORT恢复结果](KB02-R2-S01-REVIEW-20261018-main-real-http-SHORT.json)。

补充资料在实际IAB浏览器完成：失败状态显示→继续提取→审核默认全未选→启发式候选中选择旧铺货率指标→生成更新预览→核对冲突双方→确认写入→刷新→打开第3版。旧20%和新30%、两个Raw来源、KB02_HUMAN均保留，更新证据位置精确对应新Raw。其余两个建议仍待审核，未强行批量确认。

最终只读HTTP/文件核验 [final-audit](KB02-R2-S01-REVIEW-20261018-main-final-audit.json) 确认 Workflow confirmed、Wiki revision=3、三条Raw正文hash均不变。浏览器 [预览文本](KB02-R2-S01-REVIEW-20261018-main-browser-preview.txt)、[确认文本](KB02-R2-S01-REVIEW-20261018-main-browser-confirmed.txt)、[刷新文本](KB02-R2-S01-REVIEW-20261018-main-browser-refreshed.txt) 和 [确认截图](KB02-R2-S01-REVIEW-20261018-main-browser-confirmed.png) 可复查；[长文失败截图](KB02-R2-S01-REVIEW-20261018-main-browser-long-failed.png) 显示0/14及2次调用。

浏览器成功仅指上述实际操作，未声称长文成功或真实预算耗尽UI通过。已确认长文连续同类失败后停止外发，未为用完额度反复重试，也未增加跨句条件额外真实样本；该语义边界仍未完成验证。

## 账本、环境及保护

[最终预算](KB02-R2-S01-REVIEW-20261018-main-real-budget.json)：历史40，本次9，累计49/64；追加24已用9、剩15；Prompt独立15/24不变。9条attempt与9条trace逐条相符，全部失败也计费计数。工程独立门禁通过后才发sequence41，测试hook在每次外发前持久化计数并实施累计64硬上限；没有并行真实任务或自动补调用。

环境首败保留：沙箱symlink/rename、Vite链接依赖解析、localhost EACCES使部分命令未进入业务；按审批同命令复跑，未改ACL/产品/配置。上午会话服务失效后下午重新启动新的隔离目录，真正首次外发为16:10的sequence41；此前毫秒级fetch失败和缺账本不计Provider请求。真实脚本按阶段保留证据，增加显式同Raw恢复选择，不修补模型输出、不减弱断言。补充更新最终由浏览器完成，UPDATE-first是首败证据，不能仅看旧阶段文件误判其恢复结果。

[最终完整性](KB02-R2-S01-REVIEW-20261018-main-main-integrity.json)：97产品/60测试、正式workspace、实际配置均无变化。2077个接手保护文件中发现2个旧PA01文件相对本轮基线又有变化：`docs/reports/PA01-R1-20261015-baseline.json`、`tests/acceptance/pa01-r1-20261015-main-preflight3-probes.mjs`。它们属于此前4项异常集合，新增前后hash见 [历史漂移](KB02-R2-S01-REVIEW-20261018-main-historical-drift.json)。原因未知，不擅自恢复、不归因本次产品修复，不声称全体旧保护文件PASS；这些不是本轮S01验收证据。PA01原独立PASS保留。

自有受控服务已关闭；本次真实API/UI已按控制文件关闭，[关闭记录](KB02-R2-S01-REVIEW-20261018-main-lab-final.json) 确认进程结束且日志无密钥。未修改产品、自动返修、提交、部署或推进其他批次。S01关闭，KB02整体继续FAIL，下一步只需针对Q01准备返修并重新独立验收。
