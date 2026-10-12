# B04 第二次返修独立验收（2026-10-05）

**最终结论：FAIL。累计10项根因 CLOSED，F04-11 部分修复仍 OPEN（P2）。** F04-04/F04-05 的原失败请求和直接回归已通过。长文汇总使用规范化结果后，跨块同主题合并会破坏每块事实的证据引用，实际汇总 HTTP 请求仍丢失证据。真实 Provider 缺用户配置，另外列 **BLOCKED**；96项自测与普通浏览器路径通过不能抵消独立复现。未进入 B05。

独立实例 GPT-6.1 Sol High，依据 [冻结契约](../handoffs/B04-deepseek-prompt.md)、[第二返修卡](B04-recheck-fix-card.md)、[第二返修施工报告](B04-repair2-build.md)。只读产品、只写新验收脚本/报告，旧报告和 JSON 保留。已读取并合并 [主 Agent独立检查](B04-recheck2-main-checks.json) 与 [真实浏览器报告](B04-recheck2-browser.md)。

## 有效运行与版本

| 组 | 判定 | 计数与证据 |
|---|---|---|
| 本轮公开 HTTP/文件专项 | **FAIL** | 去重后 **10业务场景：8 PASS / 2 FAIL**；两个失败属于同一 F04-11 根因。7个非长文场景来自[首跑](B04-recheck2-http-2026-10-05T15-39-49.783Z.json)，3个长文场景来自[最终定点运行](B04-recheck2-http-2026-10-05T15-43-28.747Z.json)。 |
| 运行期间产品冻结 | **PASS** | 47文件，四次运行均 `frozenChanged=[]`，各次起始指纹相同。 |
| 施工指纹文档核对 | **DOC FAIL** | 声明的4个产品文件中3个一致，README.md不一致；详情下述。 |
| 独立 build / 自测 | **PASS** | 主 Agent build 39 modules；npm test **96/96**，18.856秒；stdout与新自测HTTP归档，见main-checks。 |
| 真实浏览器关键回归 | **PASS** | 初始零选禁用；选择并改标题/定义、保存派生、确认Source1＋页1、刷新读取，共R2UI01–05路径通过；[API断言](B04-recheck2-browser-checks.json)。 |
| 真实 Provider | **BLOCKED** | 产品用户配置不存在，零真实调用；只读[存在性记录](B04-recheck2-config-presence.json)，未读取真实Key。 |

本轮四次脚本实际累计12.985秒、16次业务执行；有效场景去重为10，不能把重复执行计作额外覆盖。首跑两个长文失败停在错误的验收假设：要求每条证据的chunkIndex等于外层块号；合并页可含跨块证据，该断言已撤销，**首跑这两条FAIL不作为产品失败依据**。随后改为按证据自身块号验证原文区间与草稿逐字段一致，才定位到真实 `resolved:false`。中间两份[定位记录](B04-recheck2-http-2026-10-05T15-40-53.592Z.json)、[补齐payload记录](B04-recheck2-http-2026-10-05T15-42-57.088Z.json)保留；最终运行同时留下有hint失败、无hint失败和无重名对照PASS。整理汇总见 [独立JSON](B04-recheck2-independent-review.json)，不是新的产品运行。

脚本 [b04-recheck2-http.mjs](../../tests/acceptance/b04-recheck2-http.mjs) 默认只运行 F04-04/F04-05/F04-11 与Source人工快照回归；定点长文设置 `B04_ONLY=F04-11`。脚本只 import Node builtin，产品走公开HTTP；产品适配器真实请求自建localhost fake，fake名称及随机无效Key明确，未伪装真实模型成功。使用全新TEMP数据目录及随机闲置localhost端口；基于前轮已证实的沙箱EPERM/EACCES，按批准的escalation运行，不将环境权限失败算产品FAIL。

冻结内容为README/package/lock/忽略/示例配置及app/server/services/rules，共47个产品文件；完整前后SHA保存于专项JSON及汇总。当前三个修复代码SHA均与施工报告一致：commits `17dc1bd1…`、drafts `320edbef…`、LLM service `f31bc73b…`。README实物为 `6c371e193056c0ad92118b6a6dc3a1d9ef28f2b04e89e3d37d2d16116d62a9c0`，施工报告声明 `814b4c5d1317e3f73db70e4c358486ada4b5bcc30e2f473c54a4fb19128042cd`。这属于**文档指纹差异**；运行期间没有文件改变。原四份JSON的 `FROZEN-VERSION=FAIL` 同时检查了运行变化与施工表差异，保持原记录，不重写成PASS；本报告将两个判断拆开。

主 Agent在npm test覆盖施工HTTP文件前已归档 [施工原件](B04-recheck2-builder-http-evidence.json)，SHA `63e74190fe1f7470c7fa4bf09f7a982a183995758aeb3415b4da5f50b0c7afa0`；自测覆盖件单独保存，未拿新自测结果冒充施工原件。

## 三项复验裁决与直接回归

| ID / 场景 | 结果 | 实际断言 |
|---|---|---|
| F04-04 并发/任意key/重启 | PASS | A/B不同key并发同payload返回201且同operation；重启后A/B/C重试复用原IDs；正式Wiki/Index/Log摘要不增。 |
| F04-04 改变真实选择 | PASS | 同key和异key换p2均409，正式摘要不变。 |
| F04-04 未知ID原失败请求 | **CLOSED** | 首次 `[p1,unknown]` 400 UNKNOWN_PAGE，整个隔离目录零变化；提交后同/异key追加unknown、只unknown、空选共6次均400（UNKNOWN_PAGE/NO_SELECTION），整目录不变；重启后追加unknown仍400。累计8次拒绝。 |
| F04-05 已有Source复用 | PASS | 预览/新页引用实际旧Source标题，链接resolved；复用原ID，旧文件SHA不变，只新增选中页。 |
| F04-05 flags全false但确认p1 | **CLOSED** | 只PATCH改标题后公开confirm选p1，Source有有效链接及定义0；实际创建页不再出现于未创建列表，其他建议纯文本；恰好Source1＋页1。 |
| F04-05 flags与确认集合相反 | PASS | 草稿flags为true/false/true，confirm为p3/p2/p3，按去重后的p2+p3创建；两页链接resolved、两条定义进入Key Takeaways，仅p1标未创建；原Raw文件摘要不变。乱序异key重试复用同operation。 |
| Source人工快照/旧revision | PASS | 预确认正式摘要不变；人工Source正文/等级A和页标题/定义保存后确认原样写入；旧revision409。派生修复未覆盖人工正文。 |
| F04-11 有hint同主题跨块 | **FAIL，OPEN** | 112,012 JS字符，15块，实际额外汇总callCount16；汇总第2–15块出现42条 `resolved:false`，事实证据quote/rawId/start/end缺失。 |
| F04-11 无hint同主题跨块 | **FAIL，OPEN** | 27,200字符4块，各块quote均可唯一定位；最终草稿规范化位置有效，但实际汇总第2–4块出现9条 `resolved:false`。 |
| F04-11 无hint无重名对照 | PASS | 同样4块，12个不同标题主题，5次调用；汇总每个事实引用均有真实rawId、正确chunkIndex和全局start/end，Raw.slice等于quote，与草稿规范化证据一致，0 unresolved；Raw不变、零正式页。 |

F04-01/02/03/06/07/08/09/10 延续 [上一轮独立关闭证据](B04-recheck-acceptance.md)，本轮没有冒称重跑全矩阵。F03及F05普通UI派生路径另获本轮真实浏览器确认；Source快照是本轮直接后端回归。累计 **F04-01–10 CLOSED，F04-11 OPEN**。

## F04-11 残留最小复现及根因（P2）

1. 公开POST `/api/raw` 创建多块资料。无hint最小fixture为1,700条唯一中文记录（27,200 JS字符），每条 `唯一段000000库存材料正文。` 递增；真实分块为 `[0,8000)`、`[7600,15600)`、`[15200,23200)`、`[22800,27200)`。
2. POST `/api/raw/:id/extract`。自建fake对每块返回合法JSON：各块摘要不同以触发额外汇总；知识标题相同、事实文本相同，证据ID都是e1，但quote来自各块唯一真实片段，rawId正确。测试同时覆盖Provider提供全局hint及合法省略hint；所有分块通过校验并生成草稿。
3. 捕获产品适配器发往fake的额外汇总HTTP请求。预期各块事实保留其全部规范化证据；实际第2–4块示例为：

```json
{"chunk":2,"pages":[{"source_facts":[{"text":"原文事实0","evidence":[{"id":"e1","resolved":false}]}]}]}
```

这不是Provider返回非法引用。最终草稿确实存在 `e1-c2` 的有效原文证据；产品在聚合过程中修改了分块对象，使汇总的旧引用找不到证据。证据仅用测试数据、随机无效Key已脱敏。112k有hint版同根因，15块中的后14块每块3条引用失效；无hint版4块的后3块每块3条失效。不同标题对照则全部有效，排除“省略hint本身不能定位”的解释。

准确位置在 [services/llm/service.ts:135](../../services/llm/service.ts#L135)：先执行mergePages，再调用callDocumentMerge。第241行把首块page对象直接保存到聚合Map；第249行就地改写后续页的evidence.id；第253–260行把映射后的fact引用写入existing聚合页，却不改后续entry.pages自身fact.evidenceIds。第322–325行汇总按旧ID查询修改后的证据数组，找不到就输出 `{id,resolved:false}`，仍成功继续。首块page也被追加其它块内容，已不是独立块快照。

冻结要求“汇总输入必须包括所有块的结构化结果”和“分块响应保留块摘要/页结构/证据”；合法且已定位的事实证据在汇总时不能丢失。完整草稿定位通过不足以证明汇总输入完整，真实模型摘要可能因缺证据变差。应保持规范化分块快照独立、聚合时证据ID与事实引用一致；返修由施工Agent执行，验收方未修改产品。主 Agent已将残留转为 [第三返修卡](B04-recheck2-fix-card.md)。

## 边界与清理

本轮未重跑无变化的60秒超时、10分钟总期限、全部输出/输入预算、取消/删除竞争、磁盘部分提交恢复和B02/B03完整独立矩阵；保留历史独立证据。96自测覆盖另有主 Agent记录，不能标为本轮独立重新实测。当前验证针对实际HTTP结构与文件行为，不能证明真实模型语义正确；真实中文成功链路/真实长文质量仍BLOCKED。

四次运行共18个自有产品进程实例（含重启）全部退出，4个fake监听全部关闭。全新TEMP fixture保留，路径/随机端口/PID/退出日志在各JSON；未触碰正式workspace数据，未关闭他人服务。主 Agent自有3个浏览器测试服务和临时tab也已关闭，见 [清理记录](runtime/B04-recheck2-browser-cleanup.json)及browser报告。没有修改status/批次卡/产品/旧证据，B05未授权。
