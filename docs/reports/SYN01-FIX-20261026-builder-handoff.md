# SYN01-FIX 施工与自查交接

2026-10-26，Sol High。按 Astra 冻结卡 `docs/handoffs/SYN01-FIX-20261026-task.md`（SHA256 `5caac7e5350aeef71a6797353df9cd6fb98f20e618e9fb236f493b31e633f0e9`）完成 F01–F05 施工与必要自查，**现已冻结停写，待 Astra 独立验收**，不自签批次通过。

基线/当前 HEAD 均为 `c59c6fbc17af6b5c14cca7fc1d3f31162b591485`；下表为未提交工作树的受测冻结。真实调用0、实际配置/私有响应读取0，知识242/500、Prompt15/24保持。R03旧真实FAIL、R04真实NOT_RUN、SYN01与全产品未通过保持。

## 实际变更

- 产品仅 `services/wiki/knowledge-workflows.ts`：新 synthesis 请求传数值版本1、13项当前分类id/label、完整Raw正文/SHA/locator目录；默认512字符/256锚点限制保持，使用Raw ID+已核实际正文SHA的哈希绑定锚点，按 `(rawId,locatorId)` 精确解析。空正文/超目录/哈希不符/受限来源在Provider前拒绝。
- 新 synthesis 响应严格八字段、全必填，事实条目严格text/rawId/locatorId；缺字段、额外字段、错版本、旧/混合偏移、截断、非法分类及未知/跨Raw/旧正文ID拒绝。目录派生安全整数区间和精确连续原文，经派生秘密检查及原validateEvidence后，仍保存原来的text/rawId/quote/start/end。协议字段不写进Workflow证据。
- 提示明确空数组、分类只选id、每条最小断言与单方支持、双方冲突分别列证、未知/未来/推断区分。512字符锚点只是定位粒度，不能自动证明语义。
- 四个指定默认测试仅迁移受新协议影响的synthesis fake桩/相关证据结构断言。新增同前缀fake helper只用于合成测试，把测试作者指定的Raw/区间映射到包含它的目录锚点，不在产品中搜索quote或修正偏移。
- 新增 `tests/acceptance/SYN01-FIX-20261026-selfcheck.mjs` 定向自查。未改Provider/locator公共算法、规则、UI、依赖、旧验收/响应；未改Astra卡和主Agent状态/Git，外部AGENTS/.agents/AGENT-ROUTER修改保留。

## 实测命令与结果

Node `v24.20.0`，Windows PowerShell。没有运行445全量、旧11+6矩阵、Vite构建、Chrome、真实Provider或旧受控242入口。

| 命令 | 实际结果与耗时 |
|---|---|
| `node --import tsx --test --test-name-pattern 'B05 synthesis\|B05 非法综合\|B05 Raw正文\|B05 重启\|B05 更新' tests/b05.test.ts` | exit0，5/5，测试runner 3274.56ms（工具墙钟4.317秒）。包括综合确认幂等、分类拒绝、Raw哈希保护、重启恢复和createUpdate对照。 |
| `node --import tsx --test --test-name-pattern 'FINAL-02 synthesis\|FINAL-02 request\|HUMAN synthesis\|PA01 R01' tests/kb02-final-agreement.test.ts tests/kb02-human-review.test.ts tests/pa01-r01-r02.test.ts` | exit0，8/8，runner 3014.76ms（工具墙钟3.716秒）。包括update双侧ID请求对照、原存储证据结构、synthesis人审与三种旧事务恢复、旧记录读审确认/深层损坏拒绝。未跑PA01 R02大矩阵。 |
| `node --import tsx tests/acceptance/SYN01-FIX-20261026-selfcheck.mjs` | 最终exit0，脚本内部529ms，工具墙钟1.420秒；33条技术检查记录，见下方映射。它们与13个默认test是不同层级，不合并为业务场景总数。 |
| `npx tsc -b` | exit0，无类型错误。工具10.017秒时返回session74006，随后poll得到exit0；未记录独立总墙钟，不虚报精确编译耗时。编译后的修改仅为不参与tsc的mjs测试断言修正，产品和TS helper/默认测试均未再改。 |
| `git diff --check` | exit0；另已读实际产品/四测试diff及状态，符合所有权。仅有既有LF→CRLF提示，无空白错误。 |

表格中的 `\|` 为Markdown表格转义；执行时pattern实际使用普通 `|`。

首次默认测试被沙箱以spawn EPERM阻断，尚未执行测试用例；在已授权范围内通过执行权限重跑成功。没有自动审批拒绝或未完成的权限事项。

自查脚本曾有两次测试假设失败，均先定位后仅修脚本：

1. 误认为第二次重复句和emoji一定落同一既有locator；实际构造器按换行切分。改为分别选择第二次重复句的ID和emoji所在ID，保留原目录算法。终次选第二条[start,end)=[3,514)，emoji=[514,520)，原文slice完全一致且不拆代理对。
2. 旧记录没有humanReview时，确认原有行为返回HUMAN_REVIEW_REQUIRED；新记录未审返回HUMAN_REVIEW_INCOMPLETE。改为按记录是否已有humanReview分别精确断言，未放宽成任意错误或修改产品门禁。

两次失败均非产品失败；失败退出的finally也关闭自有HTTP（若已启动）并删除自有临时目录。终次必要检查满足后没有追加回归。

## F01–F05 自查映射

F01：原seq242 response.text完整原样经新生产createSynthesis拒绝，LLM_SCHEMA_INVALID，workflow新增0；不要求继续返回旧的首个错误消息。原导出运行前后SHA仍为 `17b8eb6db27db107f01cca85addbf56c7f476d977a44682530b1beffeca21978`。诊断阶段脚本是旧请求基线诊断，不当作新协议回归入口，也未改其历史结论。

F02：明确标SYNTHETIC的新协议经实际Store保存四条原结构证据；输入分类与实际Schema完全相同，Raw正文/标题/SHA与fixture相同、目录完整覆盖，两Raw首锚点ID不同。人工编写的fake结果有意保留共同100/公式、A20%与B30%、未知负责人/采样日、AI仅未来/未上线/收益未知。重复句跨锚点和emoji使用明确目录ID解析，不走首匹配quote。不能据合成语义内容声称真实模型已遵从。

F03：28条技术负例记录：21个结构/ID变体、length截断、响应秘密、派生quote秘密，以及4个Provider前门禁。覆盖缺数组/缺或错版本/多字段/非法分类/缺标题/空或超长text/null条目/错误数组/问题类型/空ID、未知ID或Raw/错Raw/另一Raw锚点/旧正文ID/旧与混合偏移。拒绝后workflow数量不增；SHA/受限来源/空正文/目录超限调用数增量0。前置异常Raw快照由测试桩注入，不破坏历史Raw。

F04：新隔离Express装配生产registerKnowledgeRoutes，fake Provider走公开POST synthesis→未审confirm被409拒绝→review/start→带当前摘要且confirmed:true的单页明确确认→正式confirm→公开workflow/测试只读WikiStore回读。两Source+一synthesis均落盘，页中共同值/冲突/未知/未来内容保留；Raw完整记录前后一致。Wiki GET仅测试只读接线，读生产WikiStore；未宣称启动整个App或Chrome。

另手工建立一条明确标SYNTHETIC的旧持久结构synthesis（无协议版本/locator/humanReview），GET不重写原文件，未启动审查前confirm按原行为拒绝；显式开始并确认审查后正式写入，可回读；全过程不增加Provider请求，无迁移或模型重建。默认受影响测试还覆盖未解决项、旧零写/部分写/冲突事务、深层记录损坏及update evidence-id分支。

F05：上述定向检查和tsc完成。自查HTTP仅监听127.0.0.1随机端口，全部退出路径关闭；自有TEMP根先核父目录/前缀再清理。复用offline guard，终次configReadsDenied=0/networkDenied=0，未读实际配置或workspace，guard只放行本次本机HTTP。无残留自有服务；未提交推送。

## 受测冻结 SHA256

| 文件 | SHA256 |
|---|---|
| services/wiki/knowledge-workflows.ts | b3269a215ed042b6822a2b77320d3cd2be60d0c40797b7cce50794e8047efbc9 |
| tests/b05.test.ts | 14bf48d5aa5b614707f046997664cfd8b5f98a33642de2420151fcc065dfa7a8 |
| tests/kb02-final-agreement.test.ts | 1f79cb8e45bf3c8ed575566346547eea7238568e719ee75868e72203af0869ad |
| tests/kb02-human-review.test.ts | d8191d11d357b9301bea640d8d6e7a1bae827159ae2765eb89a5decd4dc885dc |
| tests/pa01-r01-r02.test.ts | 7748a7db55706d3485b81c7224c16bedcd939f5595de1b87d7f87bd2a6c8d208 |
| tests/acceptance/SYN01-FIX-20261026-fake.ts | 9d702b2f1774ffc21d60b5a354a65b11e2dbe6e98a36629d5cfc8e8df8b66278 |
| tests/acceptance/SYN01-FIX-20261026-selfcheck.mjs | fe85fb2eb44468796f18235b2b9de8c54f1257c831b6e1186858caa1b915e2b1 |

## 剩余风险与交接

新发起synthesis仅接受新协议，旧Provider响应格式不fallback；旧合法存储格式兼容。目录每Raw最多256个锚点，超限明确失败，输入完整正文+目录会增加请求长度；未宣称任意长度/真实模型成功。机械目录只能证明来源与区间，语义、跨来源共同命题与复合断言仍需模型遵从及人审。真实遵从率/质量未测，需后续单独额度与新冻结。

本轮施工自查未发现未解决产品错误，结论仅为**已施工且自查完成，待独立验收**。Astra应按冻结卡核实际diff与必要定向测试，分别裁定本轮缺陷与整个批次；不得把本报告或合成闭环当R03/R04真实通过。交接后Sol停止产品/tests写入，不推进其它批次；Git与状态归主Agent。
