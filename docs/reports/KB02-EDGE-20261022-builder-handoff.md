# KB02 EDGE 施工交接

施工及必要离线自查完成，产品/default tests/施工脚本已冻结停写，待Astra独立验收。**不自签KB02 PASS，不以fake代替真实质量。** 真实新增0，累计146/200、Prompt15/24；不改状态、不提交Git、不启动下一批。

## 变更与范围

| 问题 | 最小变更 | 实际受控证明 |
|---|---|---|
| F-KB02-SOURCE-01/P1 | knowledge-extraction仅在发给分类器的目录投影处过滤现有trim语义下的纯空白，并增加一条目录边界说明；完整atom构造/byAtom/响应拒绝保持。rules revision8→9。 | 原seq144坏选择仍按“不能将空白分隔符选择为陈述”拒绝，无部分保存；请求无c1-a0005，但其它原ID/text/fragment及证据不变。受控正确响应保留5事实/1问题/非空来源声明，保存恢复后不增调用。 |
| F-KB02-SOURCE-UI-01/P2 | WikiPage.chooseItem仅在不同ID时清selected；同项保持详情/初载请求，仍退出编辑、清提示并调用selectId维护既有操作代次。 | 已加载/初载/快速同项、A→B→A迟到、编辑返回、普通搜索/清除、迟到保存与刷新、最近打开/无效ID均有真实组件回归。 |

[精确范围](KB02-EDGE-20261022-scope.json)：3产品文件、5既有测试适配、2新增默认入口，符合[Astra批准方案](KB02-EDGE-AUDIT-20261022-plan-review.md)。未改atom生成、unit规划、schema/持久结构、Provider、存储、预算、UI其它功能、依赖或配置。5适配只涉及revision9与发送目录纯空白投影预期，旧原始夹具和语义断言保留。

新增18项提取回归与9项Wiki回归，共27项。提取覆盖三栏空白/未知/跨块拒绝、LF/CRLF/Tab/Unicode trim空白、首尾空白非空记录、U+200B、8112字符跨块/UTF16、全空白及纯来源声明EMPTY_RESULT、精确计数、当前checkpoint保存恢复、真实revision8旧未完成HTTP409/三文件字节不变/显式restart、旧完成草稿HTTP读取与零调用复用。

全空白/纯声明仍按原每块计数契约处理合法空业务响应：保存成功空业务块，最终EMPTY_RESULT，无plan/草稿；不新增免调用或后台重试。模型即使引用未发送的空白ID仍被严格拒绝，不删除模型已选内容，不放宽校验。非空片段首尾空白、负面/未知/未来建议和非空标题照旧保留。

## 冻结与完整性

- [冻结](KB02-EDGE-20261022-frozen.json)：UTC **2026-10-22T13:52:05.091Z**；100产品资产、76测试支持资产、7夹具、7施工脚本，逐文件SHA256。
- 最终受测副本 `C:/Users/80593/AppData/Local/Temp/kb02-edge-sol-RzKhU2` 与上述冻结全部资产一致，运行前 `copyMismatch=[]`、运行后 `afterCopyChanges=[]`，本地最终verify亦无漂移。没有运行后再改测试或冻结脚本。
- [完整性](KB02-EDGE-20261022-integrity.json)：3091接手保护文件不变/无新增，正式workspace/config无变化/新增，实际3产品+5适配+2新增与scope精确一致。独立EDGE-AUDIT资产按所有权排除，不要求其停写。
- 临时副本未复制正式workspace或.env.local；本轮短文夹具为旧short-failure.json的逐字拷贝，旧报告未改，Raw原SHA保留。所有临时副本均保留，未清理历史资产。

## 命令与最终结果

完整入口 `node tests/acceptance/KB02-EDGE-20261022-run.mjs` 在SHA一致临时副本执行。[最终结构化记录](KB02-EDGE-20261022-2026-10-22T13-52-19.508Z-run.json)包含完整参数、运行时、目录、退出码和耗时；同时间戳各原始日志保留，`full-latest-run.json`指向同一最终结果。

| 检查 | 实际结果 |
|---|---|
| 系统Node25.2.1，51默认入口完整执行（tsx + css-stub） | **385/385，0fail、0skip、0cancel**；21.96秒 |
| `node node_modules/typescript/bin/tsc -b` | exit0；3.76秒 |
| `node node_modules/vite/bin/vite.js build` | exit0；2.61秒 |
| 原历史KB02-FINAL-REPAIR-AUDIT边界probe单列 | 2/2、0skip；原脚本只读 |
| bundled Node版本实际探测 | **24.19.0** |
| 旧Node SR01/预算/存储/HTTP/React恢复8入口 | **51/51、0skip**；17.83秒 |
| 旧Node受影响提取/规划/分类/更新语义/B05/新增UI等10入口 | **106/106、0skip**；3.62秒 |
| `node tests/acceptance/KB02-EDGE-20261022-freeze.mjs verify` | exit0，精确范围/冻结/历史保护/正式数据配置通过 |
| `git diff --check` | exit0，无空白错误 |

本机系统实际为25.2.1，未声称重测历史Node24.20。真实浏览器/Provider本施工阶段均NOT_RUN；组件交互使用真实React+jsdom及本地fetch stub，不冒充Chrome。

## 首败与修正保留

1. [首定向日志](KB02-EDGE-20261022-first-targeted.log)：27项中8通过/19失败、0skip。18个提取用例在沙箱临时目录初始rename即EPERM，尚未到目标断言；另一项UI无效最近打开的断言只匹配友好提示，但已有两个读取effect也可显示服务返回的明确404文案。随后同一离线测试获工具批准在沙箱外运行。未改存储实现、重试或ACL。
2. [第二次定向](KB02-EDGE-20261022-targeted-2.log)：25/27、2失败。新增跨块夹具括号位置造成短句重复40次，fake回88事实超过32上限；另旧已完成任务复用应HTTP200，测试误写成新任务202。仅修夹具和准确HTTP预期，既有覆盖、恢复、计数断言未弱化。
3. [第三次定向](KB02-EDGE-20261022-targeted-3.log)：27/27、0skip。产品没有因这些测试构造失败再修改。
4. [首次完整工程](KB02-EDGE-20261022-2026-10-22T13-50-59.490Z-run.json)385/385、tsc/Vite/旧Node51及106/历史2均通过；随后仅补强UI测试等待“匹配搜索请求实际返回”和“无效最近项列表加载后仍不误回落”，故最终另跑上表同冻结全套。首套指纹另存first-engineering-frozen.json，没有覆盖原运行。

诊断脚本及diagnosis.json记录的是基线HEAD024fbbe上已执行的原失败重放；revision升级后原checkpoint会先不兼容，不能把基线诊断脚本误称为最终规则的成功用例。最终默认新增测试明确覆盖revision9下原坏选择的严格拒绝。

## 遗留与独立验收门槛

**F-KB02-EDGE-DIAG-UI-02/P2搜索乱序竞态保留**：慢查询迟到可覆盖快查询列表，与本轮同项点击独立；Astra已明确不纳施工。refreshList未改，不能声称该旁支通过。普通搜索和详情异步保护回归通过不等于乱序搜索已修复。

规则和请求目录已改变，原14区域真实通过证据不能代签本轮。Astra仍须在工程独立通过、主Agent另行开门后，按本轮24次阶段硬上限，从146/200接续，完成原短文→必要全文→补充→真实更新/Chrome链：明确创建短文目标与人工备注，候选/选旧目标/更新预览、20%/30%冲突和共同观点双侧证据、双Raw来源、明确确认、刷新/持久回读及重复确认幂等；同时复验新旧Wiki同项点击。fake仅证明契约与受控路径，不能证明模型不会产生其它质量错误。

施工已停写，交主Agent统一验收、状态与GitHub同步。本施工者不自签批次PASS、不自动真实重试或推进下一批。
