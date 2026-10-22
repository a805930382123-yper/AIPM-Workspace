# PA01 R-01/R-02 施工交接 — Sol High，2026-10-16

**施工完成、待用户另开 Astra 窗口独立审查；本报告不签批次 PASS。** 仅处理 [最小返修卡](PA01-REVIEW-20261016-repair.md) 的 R-01/R-02。原 PA01/KB02/FULL3 FAIL 保留。真实 Prompt 仍 0/24，KB02 仍 40/40；本轮无真实 Provider 外发、实际浏览器验收、提交、部署或下一批。

最终唯一审查冻结为 [main-frozen](PA01-SOL-20261016-builder-main-frozen.json)，时间 **2026-10-16T02:17:25.112Z（北京时间10:17:25）**，96 产品文件/58 默认测试文件。此后产品/default tests 停写。新窗口入口：[PA01 Astra 独立审查](../handoffs/PA01-astra-review-20261016.md)。initial/pretype 快照只是失败与校准历史，不是最终交付版本。

## 修复与兼容

R-01：只完善共享 isWorkflow 读盘校验，未改 KB02 算法或 Workflow 执行器。实际 get/list/RecoveryRegistry 已共用此门禁，patch/confirm 原有的 get 因而在执行前拒绝坏记录。kind/status/evidence.section 必须为字符串枚举，evidence 可省略、存在必须数组；元素字段、引用 Raw 绑定、整数范围、UTF-16 引文长度均检查。补齐 sections/sourceList、rawSnapshots/sources、按 kind 的目标版本与来源绑定，以及可选 baseWiki/wikiInput/inputDraft/提交 ID/错误字段。confirmed 必须有实际消费者所依赖的 operation/wiki 回执 ID。

合法旧 evidence 省略、update 未消费 baseWiki/inputDraft 省略继续兼容。inputDraft 历史标识只要求非空字符串，保留旧 B05 的 draft/page 值；不会将该未消费快照过严限定 UUID。新增默认测试从真实 createSynthesis/createUpdate 派生 **33 类**坏结构，对 get/list/scan/patch/confirm 验证 recovery 错误、原字节不变、健康邻居继续。合法旧记录可编辑及确认。实际 HTTP 六类反例补证返回 STORAGE_CORRUPT/category=recovery/inspect_or_restore；将同 ID 坏文件写回合法字节后 get/list 恢复且告警清除。没有只在 confirm 捕获 TypeError。

R-02：保持 items 最多 500，active 保留所有已知问题；新增 totalIssues、hiddenIssues、truncated。partial 表示扫描未完成，scanned 表示扫描完成，truncated 独立表示公开摘要截断；overflow 兼容原字段并在扫描预算溢出或摘要截断时为 true。partial=true 时 totalIssues 仅为已知下限，hiddenIssues 也是已知未返回量，不能推算未知文件。UI 显示已知总数、部分扫描的“至少/下限”、摘要截断和另有多少项，且说明当前仅展示前 5 项。旧服务缺新增字段时仍可读取并按 overflow 保守显示下限。

499/500/501/1201 实际 API+组件均验证返回上限、总数、hidden/truncated/overflow；多次重扫不清除隐藏问题，移除摘要外一条后 1201→1200、隐藏701→700，全部移除后刷新清零。超大文件 partial 与摘要 truncated 分开显示。原 10000 文件、2MiB 单文件、64MiB 总读取和10000观察队列预算保持；默认测试及旧边界回归覆盖，未扩大返回或预算。

## 变更与冻结证据

相对接手基线仅修改 app/api.ts、app/components/RecoveryNotice.tsx、services/storage/record-validators.ts、services/storage/recovery.ts；新增 tests/pa01-r01-r02.test.ts（4 测试组）。旧默认测试和验收原件未改。无 files.ts/server/recovery-api.ts/Workflow执行接线改动。精确前后 SHA-256、4 产品/1 测试范围见 [scope](PA01-SOL-20261016-builder-scope.json)；全部最终文件指纹见 main-frozen。

主协调在 **02:19:12.261Z** 完成 [最终完整性 verify](PA01-SOL-20261016-builder-main-integrity.json)：冻结产品/tests 零差异、1836 既有保护文件零变化、workspace 无新增、实际配置哈希不变，pass=true。正式数据和配置只读；未改 ACL、锁文件、全局 Git，也未停止用户服务。

## 实测结果与命令

| 检查 | 结果 | 证据 |
|---|---|---|
| 最终完整默认 suite | **241/241，0 fail/skip**；28.059秒 | [JSON](PA01-SOL-20261016-builder-main-tests-writable-copy.json)、[原日志](PA01-SOL-20261016-builder-main-tests-writable-copy.log) |
| 最终 tsc / Vite | exit 0 / 0；7.025 / 4.387秒 | [构建](PA01-SOL-20261016-builder-build.json) |
| 新增 HTTP + jsdom | 7/7；11.583秒 | [反例](PA01-SOL-20261016-builder-r01-r02-http-component.json) |
| 服务/HTTP | 26/26、8/8 | [服务](PA01-SOL-20261016-builder-preflight3-probes.json)、[HTTP](PA01-SOL-20261016-builder-preflight3-http.json) |
| 恢复组件/扩展 | 15/15、5/5 | [组件](PA01-SOL-20261016-builder-preflight3-component.json)、[扩展](PA01-SOL-20261016-builder-component-extended.json) |
| 原边界/实际存储 | 35/35、3/3 | [边界](PA01-SOL-20261016-builder-preflight-edges.json)、[存储](PA01-SOL-20261016-builder-preflight-storage-supplement.json) |
| 六链秘密/Meeting门禁 | 62/62；15.100秒 | [安全](PA01-SOL-20261016-builder-security.json) |
| 旧B05定点/新增默认定点 | 6/6、4/4，0skip；0.874/8.840秒 | [B05](PA01-SOL-20261016-builder-b05-targeted.json)、[新增默认日志](PA01-SOL-20261016-builder-default-final-targeted.log) |

上表服务26/HTTP8/组件15+5/边界35/存储3/安全62及新增HTTP+组件7，运行于最后一次 inputDraft 旧标识兼容放宽之前；随后产品唯一变化是该未消费身份字段由UUID放宽为非空字符串，默认测试又作了类型/完成元数据校准。这些专项按影响分析复用，未声称在最终SHA上全部重跑。最终产品由新增默认4项、旧B05六项和最终完整241项+build覆盖；无需为未受影响链路重复外发或测试。

完整 suite 与 build 在同一可写临时副本 **fmcg-pa01-sol-builder-fullsuite-9X25hM** 执行，复制最终96/58文件 SHA 零差异；无断言/shim修改，Node v24.20.0。原工作目录没有运行完整 suite，以免旧B04测试写历史报告。各隔离 HTTP/fake 服务已关闭，测试/build子进程已退出。jsdom 不是实际浏览器验收。

[命令与耗时账本](PA01-SOL-20261016-builder-commands.json) 列出实际命令、结果、工具壁钟或脚本计时；边界组中途yield，精确总耗时不可得，未虚构。专项脚本由既有施工脚本复制到本轮新builder前缀，替换输出目的地保留原断言；继承的“independent”描述只是脚本历史文字，本轮都是施工自测，不能代替新窗口独立验收。

## 初始失败与校准记录

1. 首轮新增默认27类结构反例4/4，加入伪枚举/回执边界后31类版本4/4；工具输出摘录分别保存在 default-initial-transcript.log / default-refined-transcript.log，明确是摘录，不冒充当时原始输出文件。随后加入旧inputDraft空标识/版本边界成为最终33类。
2. 首轮完整 suite **240/241、0skip，30.088秒**，真实产品兼容失败：新增校验拒绝旧B05的非UUID inputDraft标识。保留 [initial结果](PA01-SOL-20261016-builder-initial-main-tests-writable-copy.json)、initial日志/冻结/范围及原可写副本；仅放宽未消费旧标识到非空string，旧B05断言未改。
3. 修复后完整 suite **241/241、0skip，29.364秒**，随后的 tsc 失败于新增测试fixture：sourceType 推断为 string、fake 缺 finishReason/bytes。保留 [pretype suite](PA01-SOL-20261016-builder-pretype-main-tests-writable-copy.json)、[pretype build](PA01-SOL-20261016-builder-pretype-build.json) 与 tsc日志。使用 literal 类型及真实完成元数据修正，未加 any 掩盖契约、未改断言；最终再次冻结并完整通过241/241+build。
4. 新HTTP+组件首轮7/7原报告保留为 r01-r02-http-component-initial.json；最终增补同文件合法修复路径。逐行耗时原计算位置导致0，已移除无效元数据，保留有效整体耗时和 timingNote，没有为此盲目复跑旧矩阵。
5. apply_patch 遇reparse-point读限制、python商店stub退出1均未写入；随后使用正规require_escalated Node/PowerShell保存，未改ACL。权限事件并非产品PASS证据。

## 遗留门禁

R-01/R-02 的施工与受控自测已完成；独立裁决由用户新窗口执行。真实 Prompt质量、六模板/custom实际输出、实际浏览器恢复、OS不可读文件ACL注入未在本轮执行。不能据此关闭ST-F01或PA01整批，也不能将fake成功计入真实预算。真实 Prompt 0/24、KB02 40/40及原FAIL维持；本轮到此停止施工，不推进下一批。
