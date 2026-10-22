# KB02 FIELDS 独立最终验收

**本轮type/category返修：在工程与指定原例实测范围内PASS。KB02整体：FAIL。** 原短文及独立更新完整链已补齐；长文仍有跨区域语义归属与泛化待确认独立成页问题。不能由局部修复或unit完整性通过推定整批通过，不启动下一批、不自动返修或重试。

审查者Sol未施工产品/default tests，按code-review分别复核规范与需求；工程详情、全部测试命令及证据限制见[工程验收](KB02-FIELDS-AUDIT-20261022-engineering.md)。基线HEAD `ea36a52ff81ab751149ca3a1d970803b02eca18a`，产品原提交 `420e123997c9fffc179af7bf32bd361ed341b9a9`；本轮未提交代码绑定施工冻结 `b1848a96dbd86cb725af5417d8ea0fdaf57782c07bbd1517da9069fd21161d68`（紧凑JSON对象hash，原文件字节151f0f51dda7cf0ae1e8bc9543f8df79648cf098781847f9ce1dcd402406eb25）。主Agent统一提交时补最终提交关联。

## 分层结论

| 检查层 | 结果与实测范围 |
|---|---|
| 规范/最小范围 | PASS：2产品、6必要revision适配、1新增测试，未改Provider/schema/unit/存储/UI/预算/重试；FMCG动态来源绑定指纹 |
| 独立工程 | PASS：默认389/389，历史8及本轮7，Node24 SR01 51/51、相关110/110，全部0skip；tsc/Vite exit0 |
| 原type/category失败 | PASS：原134字Raw哈希一致，seq164提取/165规划首跑成功，metric/sales及concept/ai_application两页，4事实/1问题保留。真实指定样本已纠正，不承诺模型普遍稳定或提示词根治 |
| 原长文机械完整性 | PASS：14块+规划共15调用，106400字及11%–24%十四区域数值/日期支持，55固定unit、100原ID（79fact+21question）全覆盖恰好一次，split0 |
| 原长文业务语义 | FAIL：泛化负责人未知/AI未来主题把14区域不同位置陈述独立合页，区域口径从主题呈现中丢失；详下。页数本身不作缺陷依据 |
| 短文目标补充更新链 | PASS：Chrome候选/明确选原目标/预览/语义审查/显式确认/刷新/重复同项/磁盘重开/幂等，旧正文、人工备注与双Raw保留 |
| KB02整体 | FAIL：K2-02长文语义质量门槛仍失败。搜索乱序旁支未修，也不冒称关闭 |

## 真实调用与操作证据

资料均虚构，配置只读，发送仅open.bigmodel.cn，GLM-5.3-Flash/knowledge low；运行于自有临时根 `fmcg-kb02-fields-audit-real-F52lvT`，API55928/UI55929。未启动正式workspace。每个请求事前记账，seq164–183共20条，20响应均200/stop，无自动重试。累计 **183/200**，本阶段20/24，余4封账；总额度余17不构成继续授权。Prompt保持15/24。

实际执行命令（相对路径均从项目根；对应报告以相同前缀保存）：

| 命令/操作 | 实际结果 |
|---|---|
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-lab.mjs` | 隔离API/Vite启动，无模型调用；最终进程exit0 |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-real-http.mjs SHORT` | exit0，seq164–165，134字，2页，无自动正式写；real-http-SHORT.json |
| `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-browser.mjs` | 实际安装Chrome/Playwright；控制1–3审核、明确创建metric201、人工备注PUT200、同项重复保留；最后exit0关闭 |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-real-http.mjs LONG` | exit0仅代表HTTP/原文/引文/十四区域数值检查；seq166–180，14块+规划、15页，不代表语义PASS；real-http-LONG.json |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-quality.mjs` | 首次sandbox EACCES；提升后exit1（15!==14），原失败保留。该固定页数断言过严，不据此定产品缺陷 |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-long-diagnosis.mjs` | exit1，收集全量区域成员与语义质量，未重提取；更新后再次只读检查三Raw哈希，仍exit1；quality.json/quality-before-update.json |
| `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-long-units.mjs` | exit0，55unit/100ID、split0；same-source-split.json |
| Chrome控制4 long | 原14卡断言15!==14失败，未完成该路径后续refresh；browser-result-4.json保留 |
| `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-long-browser-observe.mjs` | exit0只读记录实际15卡，不声称语义PASS；第6/7/14/15卡截图、全卡字段保留；第7/15截图人工视检 |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-browser-prepare.mjs` | 经主Agent确认独立分支可继续，exit0，补充160字、seq181–182、3页；不依赖长文成功 |
| Chrome控制5–6 review/preview | 真实重复候选/明确原目标，seq183预览201；未自动改写旧Wiki |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-update-check.mjs before` | exit0，预览后目标rev2未改，旧文/人工备注保留 |
| `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-preview-review.mjs` | exit0保存原Provider输入输出与待主Agent语义判断；之后按主Agent精确hash授权置approved，不改模型sections |
| Chrome控制7–8 confirm/readback-reclick | 首确认201，目标rev2→3，刷新/再次点击详情稳定；已视检截图 |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-update-check.mjs after` | exit0，重复同幂等键返回200，目标无再改；磁盘WikiStore重开等于API，长文未正式写 |
| Chrome控制9 close；lab控制shutdown | 两进程exit0；browser-closed/main-lab-final servicesClosed=true |
| `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-closure.mjs` | exit0，20账本/trace连续且一致、资源关闭、分层结论与封账写入 |
| `node --import tsx tests/acceptance/KB02-FIELDS-AUDIT-20261022-local-safety.mjs`，`node ...-integrity.mjs`，`git diff --check` | exit0；无已知秘密泄漏，3236保护无漂移、workspace/config未变、产品/default tests冻结一致 |

## 长文失败实物与门槛校准

候选缺陷记录 **F-KB02-FIELDS-LONG-01/P1**：seq180的额外页标题“异常审批负责人未知与AI仅未来分析建议（待确认）”，type=concept/category=ai_application。该页包含来自区域01–14的 **25条事实、21条问题**，唯一原句为“异常审批负责人未知，AI仅未来分析建议。”。在原文每7600字符的区域附录中该句有独立位置/区域上下文；它们被抽离到没有区域主体的泛化待确认页面，十四指标页反而没有相关未知/未来边界。第15卡呈现大量重复来源事实/待确认，已实际视检。

判据是KB02 K2-02“无丢失/跨主题乱合并”“说明/待确认不独立灌水”及整篇规划保主体/时间/条件/口径、未知/未来陈述归入有事实支撑相关主题，而不是“只能14页”。Q02旧任务卡明确不固定页数，当前FIELDS卡未覆盖该规则。因此独立脚本硬编码14页是验收探针局限；原15!==14失败记录不抹除，但不采为产品缺陷证据。最终FAIL由[完整区域成员](KB02-FIELDS-AUDIT-20261022-quality.json)、[全15卡](KB02-FIELDS-AUDIT-20261022-browser-long-observed.json)和[第15卡实物](KB02-FIELDS-AUDIT-20261022-browser-long-observed-15.png)支撑。若额外页面有独立有效业务主题且保持主体口径，15页本可接受。

这不是SOURCE旧核心“同一个固定unit拆到多页”复发：所有unit成员原ID均在同一页且只出现一次，unit/来源位置完整。失败在不同位置的区域语义被泛化合并，结构校验不能代替业务归属。新system使该输出出现的具体模型内部原因未证明；不把一个样本归因为提示词某句，不自动设计下一轮施工。

## 更新语义审查与确认范围

Workflow `7b7d667a-309a-40df-9574-da9c93899d7b`，原目标 `31114f0a-209f-4f9f-9f0e-f83eb16d78cf`；sections hash `76795ac9327c175a9a69ed8e54cb46e0a21d7d3b32c96b0e61eac96cc63f8d81` 经Sol逐条检查后主Agent明确批准。见[实际Provider输入输出](KB02-FIELDS-AUDIT-20261022-update-meaning-evidence.json)、[语义裁定](KB02-FIELDS-AUDIT-20261022-semantic-review.json)、[最终读回](KB02-FIELDS-AUDIT-20261022-final-wiki.json)。

共同观点1的目标门店100在双方同实体/区域/日期直接支持。共同观点2“在售门店数÷目标门店数”旧侧直接定义，新侧明确按门店数计算、100目标/30在售/30%支持本次相同口径；这是此样本的语义推导，不声称新文逐字给出通式。旧侧独有“门店数不能解释为销量”只保留existing，未被夸为共同观点。旧20家20%和新30家30%列冲突，明确统计口径/采样时间待确认，不静默覆盖。无新推断；负责人未知、AI未上线/无收益保持待确认边界。

首次确认201、重复确认200（更正此前进度消息将重复误写201）。旧正文每条非空行、KB02_HUMAN、双Raw源保留。Raw三份逐字hash一致。此更新PASS独立于长文FAIL，不能代替长文整批门槛。

## 保护、限制与交接

自有Chrome和API/Vite均关闭，真实执行结束，余4封账；门禁由主Agent统一关闭。最终产品/default tests持续冻结，独立者未写产品/default tests、status/agent-control/Git。保护3236项无变化（含正式workspace62/config5），秘密扫描无泄漏。施工曾覆盖两份旧报告后已恢复baseline，首次stdout不完整的限制保留在工程报告；本轮独立证据没有借用覆盖后的日志冒充首败原记录。

最终建议仅为记录上述长文语义阻塞供用户判断；未获得下一轮施工/诊断授权，不执行下一批。由主Agent统一状态、提交与GitHub同步，补充最终提交标识。
## 后续候选建议（未启动）

F-KB02-FIELDS-LONG-01/P1下一最小步骤只需离线重放seq180原请求/响应：核对每条未知/未来陈述的sourceContext区域主体、固定unit边界与规划页归属，区分“跨chunk同一业务主题合并”与“不同区域主体被泛化抹平”，并把业务有效主题与单纯待确认/边界页的判据写清。继续保留全部ID/事实/问题，不删模型输出，不以固定页数、硬编码区域编号或关键词过滤代替语义契约。不需要先再跑长文或额外模型，也不预设提示词可根治。

预评分按需求明确度/耦合/修改风险/历史失败 **0/1/1/2=4**：K2-02语义目标明确；暂限规划语义与来源上下文，未证实必须跨模块；全篇输出行为与规则兼容有风险但现有门禁可复用；长文主题质量链历史多次失败计2，不能误称本次type/category核心再次失败。建议优先A、Sol先审计划，再由独立验收覆盖原例；若离线诊断发现必须修改unit/source协议、Provider/schema/存储或新增兼容机制，须重新评估B。仅供用户决定，不是下一轮施工授权；不执行上述建议。