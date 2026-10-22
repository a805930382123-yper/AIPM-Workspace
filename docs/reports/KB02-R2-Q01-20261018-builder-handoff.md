# KB02-R2 Q01 施工交接

2026-10-18，gpt-6.1-sol/high施工。**当前授权Q01工程施工完成，待新窗口Astra中独立审查；不签批次PASS。** S01已独立关闭且保留；原KB02真实质量/整体FAIL及FULL3未过结论、PA01独立PASS保持。真实新增0。

产品/默认测试最终冻结于北京时间16:25:56；新增验收脚本/夹具于16:27:24另记指纹，此后停止所有产品/tests写入。见[最终冻结](KB02-R2-Q01-20261018-builder-main-frozen.json)、[精确范围](KB02-R2-Q01-20261018-builder-scope.json)、[新证据脚本冻结](KB02-R2-Q01-20261018-builder-evidence-frozen.json)。没有提交、部署、推进下一批或启动独立审查。

## 修改与Q01映射

| 文件 | 最小变更及验证 |
|---|---|
| services/llm/knowledge-extraction.ts | 提取请求直接序列化实际加载bundle.kb02FactsSchema；显式说明四个必填顶层字段、facts项kind枚举及ambiguous位置、所有对象禁止额外字段、questions/sourceNotes仅{atomId}对象；给出facts fact/ambiguous和两种非空对象数组的完整合法示例。示例ID明确仅示意且禁止照抄，实际仅可选当前目录。条数/枚举取自同一schema。 |
| 同上 | sourceNotes可为空，仅选虚构/验收免责声明、排版、来源说明等非业务声明，按需代表性选择且不要求穷举，最多实际schema的32条；不能转入facts/questions，声明仅checkpoint元数据、不入planner。业务否定、未上线和未来AI边界保留为业务。 |
| services/llm/rules.ts | KB02_PROMPT_REVISION从kb02-atoms-planning-3升4，经既有rulesVersion哈希链生效。没有改检查点存储或恢复实现；旧未完成revision3严格409并保字节，显式restart创建新job；旧已完成草稿仍可读、复用并执行候选/更新/确认。 |
| tests/kb02-extraction-contract.test.ts | 新增8项默认测试，覆盖完整实际schema一致、合法非空/歧义/来源分离、临时rules上限变化、四个旧真实失败响应不净化且单次调用拒绝、未知/重复/跨分类ID、原revision3指纹不兼容保字节。 |
| tests/llm.test.ts | 仅将既有严格rulesVersion正则的revision3更新为4；首轮完整258/259由此定位，旧断言其余内容保留。 |

严格rules/kb02-facts.schema.json、所有schema/wire、Raw、Provider、预算/超时、S01实现、PA01实现均无修改。没有自动重试、补ID、修JSON、净化响应或自动迁移旧缓存。逐文件SHA256见scope；97产品文件中仅2文件变化，61默认测试/支持文件中新增1文件、迁移1行；额外夹具单独纳入冻结。

## 实测与证据

| 命令（cwd为项目根目录） | 实际结果 |
|---|---|
| node tests/acceptance/kb02-r2-q01-20261018-builder-targeted.mjs | [最终21/21、0skip](KB02-R2-Q01-20261018-builder-targeted-3.json)，约0.83秒；含KB02 pipeline/R2/S01、新增Q01默认回归。 |
| node --import tsx tests/acceptance/kb02-r2-q01-20261018-builder-standards-probes.mjs | [实际HTTP 2/2](KB02-R2-Q01-20261018-builder-standards-probes.json)：自然1块6次耗尽后连续3次planningRetry立即409；Provider增量0，checkpoint/job/raw-state三文件SHA256完全相同，missing f-c1-2诊断/已完成块/attempts/job保留。取消迟到规划无草稿。 |
| node --import tsx tests/acceptance/kb02-r2-q01-20261018-builder-http.mjs | [实际HTTP 4/4](KB02-R2-Q01-20261018-builder-http-initial.json)：普通继续不带反馈、显式重规划只发一次且复用块/账本、并发/重启恢复；当前秘密拒绝；相同kb02-2但旧revision3规则明确409及restart保旧字节；旧已完成revision3草稿复用后候选→更新预览→确认/重放保20%/30%、双来源及人工备注；另有seq39/40旧规划离线覆盖诊断。 |
| node --import tsx tests/acceptance/kb02-r2-q01-20261018-builder-security.mjs | [28/28](KB02-R2-Q01-20261018-builder-security.json)：长短虚构秘密在提取/规划/更新的值、key、转义及嵌套key被拒绝，健康预览控制通过；Meeting提取/综合403且Provider增量0。自有服务全关闭。 |
| node tests/acceptance/kb02-r2-q01-20261018-builder-command.mjs fullsuite | [同冻结完整259/259、0skip](KB02-R2-Q01-20261018-builder-tests-writable-copy.json)，18.067秒，逐字节一致可写临时副本；无源树历史报告写入。 |
| node tests/acceptance/kb02-r2-q01-20261018-builder-command.mjs build | [同副本tsc/Vite通过](KB02-R2-Q01-20261018-builder-build.json)，3.184/1.667秒，冻结产品/测试/夹具hash无差异。 |
| node tests/acceptance/kb02-r2-q01-20261018-builder-provenance.mjs | [四份夹具与原脱敏响应逐值一致](KB02-R2-Q01-20261018-builder-fixture-provenance.json)；seq41多kind、44多顶层ambiguous、45/49字符串来源声明在默认测试均严格拒绝，完成块0、请求数1，不修补或重试。 |

完整suite已包含最后一行revision断言迁移；定向及HTTP/安全验证之后仅改该测试期望，产品未变，因而其业务证据仍对应最终产品。全部首败、沙箱审批复跑与新增测试校准见[calibration](KB02-R2-Q01-20261018-builder-calibration.md)，不能把首轮失败删去当作从未发生。

## 保护与已知历史问题

[接手基线](KB02-R2-Q01-20261018-builder-baseline.json)97产品、60测试文件、2136既有保护文件；[最终完整性](KB02-R2-Q01-20261018-builder-main-integrity.json)显示产品/测试/响应夹具冻结无漂移，2136保护文件本轮变化0，正式workspace无新增，实际.env.local不变。未修改依赖/lock/ACL/全局git，未停止用户服务。

该保护结论只相对本轮接手字节。此前4项PA01历史摘要异常及其中2项再次变化的事实，沿用原[历史漂移记录](KB02-R2-S01-REVIEW-20261018-main-historical-drift.json)和[原完整性](KB02-R2-S01-REVIEW-20261018-main-main-integrity.json)。当前原字节保留，不恢复、不归因，不追溯宣称全部历史证据一直未变。seq41/44/45/49原trace及原审查报告均在保护集内，本轮未改。

## 未测边界及有限预算建议

本轮真实外发0；KB02累计49/64、追加剩15，Prompt独立15/24，未挪用额度。fake/离线回放证明请求和严格机制，不能证明GLM实际稳定性、语义分类、跨句条件完整性或原106400字符全篇质量。未运行实际浏览器、真实短文/补充更新/长文；这些留给独立审查工程门禁通过后。真实长文必须原106400字符14区域，全部14块+整篇规划、11%–24%逐区域、未知负责人/未来AI边界及声明分离，不能替换成短片段。

若按新规则从头完成短文（提取1+规划1=2）、补充（提取1+规划1+更新建议1=3）、长文（14块+规划1=15），**无失败的基本需求20次，剩15缺5**。页面候选/预览读取/显式确认通常不增加模型调用。新revision不应沿用旧未完成checkpoint省略这些调用。

建议独立审查前由用户明确有限追加10次：本次可用总额25=基本20+失败/显式恢复/必要诊断余量5，累计硬上限可从64变为74；失败同样计数，余量不保证覆盖任意多次失败，发现重复同类失败应保留证据并停止。本段仅预算建议，**不是新增授权**，施工不调用也不请求授权，不修改账本上限。若没有追加，只够长文理论15，不能同时签收全部真实场景，须明确分配和未完成项。

交付后明确停止产品/tests写入，等待用户新窗口独立裁决。
