# K204-PREP 最终独立验收

2026-10-23。Astra medium独立验收子Agent，依据主Agent正式放行对Sol repair1冻结进行实际审查和复跑。

**本轮准备工具：PASS；本轮P04网络守卫缺陷：已修复并独立复验PASS。KB02整体：BLOCKED，K2-04真实质量NOT_RUN，未结批。** 当前真实授权0，知识累计219/500、Prompt15/24不变。22是后续建议上限，不是已批准或本轮实际真实调用数。没有真实Provider请求、实际配置加载、真实workspace写入或Git提交。

## 版本与冻结

- 基线HEAD `5de67e33e19d4dce3ca650c8c5ee9f1c472970ba`，产品 `60f83adba102d887fcd925df13a8021ff7669de1`。
- 有效 [repair1-freeze](KB02-K204-PREP-20261023-repair1-freeze.json) SHA256 `cc8fbd4166d3ad79ab6a83a4ceaa0f1c38ebb9059210fab2eb9d8940abb61497`，24项aggregate `e1847eac017d492c31d046122796d65c101d6f5d6fc3227bcd2f81e266dd29c9`。
- 本次独立实际核验24项逐文件SHA、复制后同字节及运行后源文件SHA；另核历史独立188个产品/配置/默认测试指纹，全部零漂移。卡/spec不变。复跑目录为被忽略的`.scratch-KB02-K204-PREP-AUDIT-DjjBHF`，仅生成独立新报告，不覆盖施工冻结报告。
- 审阅support/run/gates与repair1最小修改。生产runner/服务、实际DraftReviewPage/KnowledgeWorkflowPage与HTTP注入fake；没有调用Provider配置加载器或创建真实Provider。产品provider模块的纯错误/校验工具导入不等于真实transport实例化；fixture与路由实际provider闭包始终返回fake。

## 本机实际命令

本机Node **v25.2.1**。独立总入口：

```powershell
node tests/acceptance/KB02-K204-PREP-AUDIT-20261023-final.mjs
```

因已确认Windows沙箱本地连接/原子rename限制，自动审批允许后在同字节隔离副本运行。总入口exit0，约15.76秒；child实际argv、起止时间、SHA、报告列表见 [final-execution.json](KB02-K204-PREP-AUDIT-20261023-final-execution.json)。每个child均设置`KB02_REAL=true`，验证环境变量无法开启真实模式。

| 同字节副本中的实际child命令 | 结果 |
|---|---|
| `node --import tsx tests/acceptance/KB02-K204-PREP-AUDIT-20261023-network.mjs repair1` | exit0，约0.36秒。正常登记localhost fetch/http均成功；原302跳转与第二参数覆盖端口均拒绝，未登记目标各0命中。见 [独立网络结果](KB02-K204-PREP-AUDIT-20261023-final-network-repair1.json)。 |
| `node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-PREP-20261023-run.mjs` | exit0，约5.37秒。完整 **22次fake**（2+2+1+2+15），12项模拟门禁、6次独立模拟回调通过。见 [完整原始证据](KB02-K204-PREP-AUDIT-20261023-final-run-2026-10-23T12-27-47-929Z-offline.json)、[gates](KB02-K204-PREP-AUDIT-20261023-final-run-2026-10-23T12-27-47-929Z-gates.json)、[计划](KB02-K204-PREP-AUDIT-20261023-final-run-2026-10-23T12-27-47-929Z-plan.json)。 |
| 同上完整入口加`--real` | **预期exit1**，实际OFFLINE_ONLY拒绝。没有开始fixture/调用；见 [CLI日志](KB02-K204-PREP-AUDIT-20261023-final-real-denied.log)。 |

22次正常fake与6次预算模拟回调分账，均不是知识真实219账本增量。未重跑445/default/build：产品188项未变，已有工程证据复用；本次新增验收工具使用上表实际运行验收，不把历史自查当独立结果。

## P01–P06

| ID | 结论 | 独立证据 |
|---|---|---|
| P01 | PASS | 冻结卡/spec/原fixture SHA与当前规则、chunkText边界均重新核验；1/1/1/14块，对应2/2/1/2/15共22。五阶段approved=false、当前authorizedNow=0；update90秒/256000字节与提取60秒/2MiB分开。动态planning/update发送字节尚未产生，未谎称已冻结真实请求。 |
| P02 | PASS（离线工程） | 实际A1候选metric，未手改type；真实组件全页审查后创建隔离目标并保存固定备注。A2保存update决策使全页清审，旧摘要/unresolved/未全审拒绝且update fake0；重新逐页审查后实际DraftReviewPage触发一次预览。KnowledgeWorkflowPage实际查看、移未解决阻断、归回、标题编辑保存清审、重审、明确确认、重新挂载、磁盘回读和幂等全部通过。非选中输入撤审/目标revision变更独立负例拒绝。旧正文/备注/双Raw/20和30分源及差异待确认保留。 |
| P03 | PASS（离线工程） | C创建不存在的新job/checkpoint，14次fake提取+1规划；不是导入旧完成cp。实际产生 **42unit/81原ID**，不同于历史真实候选55/101；ID集合与实际cp完整一致，归属唯一。14主体各77字业务段逐字区间覆盖，逐项月/100/11–24/百分比/独立/未知/未来核对；所有实际页组件审查后正式隔离回读，Raw字节不变。B同样新cp2次，concept不强改metric。 |
| P04 | PASS（repair1后） | 原两个绕过均由独立本地正负例复验关闭；正常网络未被一概禁用。fetch manual拒绝3xx且拒自定义transport/init；http只允许URL[,callback]并用私有Agent，options覆盖被拒；https拒绝。无真实入口/transport，环境无效，真实CLI拒绝；fake B1/extra/提前规划拒绝。边界是本工具已审调用路径，不声称通用进程防火墙。 |
| P05 | PASS（模拟） | 12项：未审批零派发、先持久pending再fake回调、账本失败零回调且保留占额、A3硬上限、timeout/cancel/invalid-json占额停止、两个在途均记账/失败后无第三请求/规划、重启不派发、合计22与阶段false。模拟6次回调，不是假称真实Provider预算控制已实施。 |
| P06 | PASS | 24冻结/188产品源前后零漂移；所有服务finally关闭、组件卸载、主fixture及3个负例/模拟根清理。独立产物只在AUDIT前缀，历史失败保留。主Agent另负责4045保护基线及真实已知密钥扫描，未冒称本子Agent执行。 |

## P04失败与证据口径

原 [network-finding](KB02-K204-PREP-AUDIT-20261023-network-finding.md) 及 [实证失败](KB02-K204-PREP-AUDIT-20261023-network-permitted.json) 保留，不改写成通过。此前发生的是**未登记localhost目的地命中**，没有连接外部主机或Provider。旧externalSent恒0无法证明安全；repair1已删除该常量，本轮不再引用它。

本轮正常链wrapper记录97次登记请求尝试、2次拒绝；独立网络probe记录3次登记请求尝试、1次重定向拒绝和1次签名拒绝。它们不是全进程包级遥测；零真实调用的证据是实际fake闭包与无配置/真实transport执行路径、拒绝入口、未登记本地sink观测共同支持。旧run输出对象尚有一个`externalSent:network.state.externalSent`字段表达式，当前值undefined，JSON省略；没有断言依赖它，属于无功能影响残留，不将其解释为0遥测，也不为此再次冻结。

独立首沙箱探针EACCES曾被初版“hits=0”错误判据标成pass=true；其效力已在失败报告明确否定，原件保留。本次加入正常fetch/http正例，两者都必须成功，再要求绕过错误为OFFLINE_NETWORK_DENIED和sink0，避免把环境断网误判守卫成功。Sol自己的fixture等待、对象排序、fake Source标题冲突及沙箱失败保持各时间戳原始证据，均未用来掩盖产品修复。

repair1 freeze记载通用扫描将文件名`network-permitted`/`network-2026`的`rk-...`后缀误当密钥，之后加词边界；所述后缀确为证据文件名，可保留作为扫描误报说明。**该通用模式扫描不是实际密钥扫描替代品**，也不对报告中的任意字符串做密钥豁免；主Agent提交前仍按原方案执行已知实际密钥检查。本验收没有读取真实配置来获取密钥。

## 方案与未完成项

建议后续一次明确授权范围最多 **22次**：A1/A2/A3共5，原混合短文2，原长文15；总计最多219→241/500，Prompt不变。若获用户授权，主Agent依据独立证据逐阶段放行，不重复向用户询问已批准同一范围；首失败停止新增请求，已记账两在途保留，禁止重试/恢复/换样本借余量继续。

当前仍只有准备授权，没有真实执行接线；五阶段均false。未来真实接线需另行独立审查，按实际前序输出/人工动作冻结planning/update请求，send前落账，不能拿本次fake正确响应冒充真实质量。实际React/jsdom+HTTP已测，Chrome/真实浏览器引擎未测；真实metric能力/更新语义、新链长文质量均NOT_RUN。历史自动模型FAIL与旧长文有限通过分别保留，不能因准备工具PASS关闭KB02。

主Agent可更新原台账并提交本次准备与repair1独立证据，然后汇报方案/22上限并停止。本子Agent停写，不提交Git、不创建真实入口、不推进下一阶段。token计量不可得。
