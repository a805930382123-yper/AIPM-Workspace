# KB01 R4 独立验收：FAIL

2026-10-14。用户授权检测进度并交GPT-6 Luna High返修；Luna已完成本轮代码返修，主Agent实测，独立GPT-6.1 Sol High两轴复核。**Standards及本次代码Spec审查范围PASS；KB01整批FAIL，K05真实长文未通过。** 不重签全项目，不推进下一批。

## 返修已关闭

- locator-v2：服务端有界定位目录，模型只选位置ID，Raw派生精确UTF-16引文，再严格校验；旧quote响应/持久化草稿兼容。未知/跨块/混合格式、页内引用、凭证检查及预算不放宽。
- 系统提示与v2契约一致，文档汇总单独document-only；规则版本包含locator-v2。
- 派生Raw引文后补扫凭证，已独立复现修前泄漏到service/merge输入、修后拒绝。jobs旧防御原已阻止草稿，不夸称正式落盘泄漏。
- 相同重叠证据去重，合法既有/当前分块ID均预留，生成后缀碰撞循环避让，所有事实引用保留。
- 候选查询恢复清旧错误；保存/决定/确认期间锁定可编辑字段与选择，提交与可见快照一致。旧选中项、部分成功、标题冲突断言保留。
- IAB发现侧栏Raw无法退出草稿、工作流覆盖也未随导航清理；Luna已统一显式nav清两覆盖，保留原页面/Raw选择/后台任务世代。真实App导航及原M05世代7/7、IAB draft→Raw和失败长文原文/同ID重试已复验。
- 仅knowledge+精确官方host+glm-5.3-flash追加JSON mode，其它wire不变。单变量诊断/官方依据见[决定](KB01-R4-20261014-provider-decision.md)，不把合法JSON等同领域schema/语义正确。

## 实测证据

| 检查 | 实际结果/证据 |
|---|---|
| 最终build | PASS，TypeScript/Vite；既有bundle>500KB提示保留 |
| 最终默认完整套件 | 228项227PASS/1FAIL，21.147秒；85产品/54测试精确临时副本；llm-repair2原子rename EPERM，`tests-writable-copy.json/log`；不签默认npm test PASS |
| 完整串行套件 | 228/228 PASS，67.896秒，同冻结全部原测试按文件串行，`tests-writable-copy-serial.json/log`；不改变产品或测试内显式并发场景，不代替默认并行结果 |
| 前版完整与定点 | 导航小修前同后端最终227/227 PASS、20.405秒，`pre-nav-tests-writable-copy.*`；此前E04成功链任务failed，13/13定点及同冻结完整重跑通过，首失败`final-suite-first-*`保留，根因未确定，不称已诊断修复 |
| 实际隔离HTTP/来源/恢复 | 10/10，`standards-http.json`；同名目标夹具改为独立名称，保留标题保护 |
| v2实际HTTP | 9/9，未知/跨块/混格式/缺引用/凭证及Raw派生凭证均fail closed；`locator-http.json` |
| 实际HTTP组件 | 11/11，jsdom；入口/仅保存/文件双击/部分失败/迟到导航/候选恢复，`standards-component.json`；UI源与最终一致，复用该已实跑结果 |
| 六链安全 | 最终100/100，实际HTTP+localhost fake，`standards-security-final.json`；不冒充真实AI质量 |
| wire作用范围 | 12/12，所有fetch内存拦截，`standards-adapter-wire.json`；预算/取消/输出上限10/10保留 |
| 配置隔离 | 热配置/旧任务快照1/1实际HTTP，`standards-config.json`；其它配置测试在完整套件，不冒称本次新跑完整CFG01 |
| 独立Standards/Spec | 各自审查范围PASS，历史P2及原FAIL保留；`review-standards.md/json`、`review-spec.md/json` |

短文真实外部GLM：134字符、3建议页、1调用，16715ms；明确选择指标后确认，仅选中条目写入，Raw未改。该请求在追加JSON mode前的R4冻结版本成功，提示/规范化已为v2；不冒称最终JSON分支新跑一次短文。

最终JSON分支真实补充160字符提取→自动候选→显式更新→冲突预览→确认成功，33750ms（包含提取与更新）；目标Wiki第3版，两来源、20%/30%及R4_HUMAN人工备注保留，确认前正式Wiki不变，事实/推断/问题分节。新提取5建议页仍有待确认事项作为独立条目、差异确认被归类business_process等粒度局限；需人工筛选，不保证所有AI条目类别质量。

实际IAB桌面只读检查：AI主入口/手动辅助、同Raw失败重试ID、待审核准确入口、默认0选择/确认禁用、候选原因与来源/显式决定、正式更新冲突与双来源、Raw/草稿分栏与事实/推断/问题各节、侧栏退出审核及失败长文原文/错误码。未在IAB触发新的Provider或确认；异步故障/busy race主要由实际HTTP组件及独立内存probe验证，不冒称浏览器故障注入/窄屏新测。

## 未关闭：R4-K05-LONG / FAIL

同一106400字符虚构十四区域Raw、14块最小覆盖策略。最初locator v2真实chunk2非法JSON，42721ms整任务失败；单变量JSON模式诊断15493ms且schema通过，随后最终产品同Raw重试仍于第4块失败，35880ms：

`LLM_SCHEMA_INVALID`：第3建议页缺少`source_evidence`，并含畸形键`剩余无需],"source_evidence`。这是实际模型不满足结构契约；本轮拒绝正确，不能删页/修补JSON/放宽schema或以部分块代签全长文。

最后长文只有首两wave4次Provider调用，全部14块完成、14区域事实质量和末尾覆盖均未完成。任务failed、draftId null，独立磁盘检查无该Raw的部分草稿；原Raw完整保留。详见`real-http.json`、`real-http-r2.json`、`provider-trace.jsonl`及`final-checks.json`。

累计27/40次：历史12产品+4诊断，R4产品10+诊断1；每次外发前计入attempt ledger，失败也计数。余13，低于完整14块（另可能1汇总）的最低复验需要；本轮停止盲试。两条即时“attempt count==completed trace”失败是验收脚本过早读取并发peer未结束的INVALID_EXPECTATION，原件保留；所有调用结束后11attempt/11trace、总27，安全核对6/6通过。

下一步须先评估当前Provider满足领域输出契约的方法与长文输出粒度，用精确失败wire定点诊断；新完整长文复验需足够预算。不能只改prompt盲试或提高产品timeout，不自动改实际模型/Key/配置。

## 数据和收尾

最终85产品/54测试与冻结一致；正式workspace7文件、实际.env.local及1458历史保护文件未变，原B04输出已恢复。最后仅App/导航新测试改变，后端/规则/Provider字节与真实复验冻结相同，真实结果及相关安全/HTTP证据按该相同子集复用。完整测试只用精确临时副本；没有改ACL/依赖。Luna曾原地repair3覆盖旧B04副作用输出，发现后按精确原件恢复，后续均在副本运行，过程记录保留于builder报告。

本机Node v25.2.1，未签最低Node/其它OS/所有长文体裁。独立服务、临时浏览器标签收尾关闭，虚构fixture根保留用于复现；不关闭未知或用户服务，不部署。子Agent token计量不可得。全项目FULL3 FAIL及Prompt/ST-F01事项仍在原范围外。
