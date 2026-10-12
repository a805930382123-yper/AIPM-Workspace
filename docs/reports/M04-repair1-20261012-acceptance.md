# M04 第一轮返修独立验收

2026-10-12，结论 **M04阶段PASS**。用户授权GPT-6 Luna High施工，主Agent独立冻结、执行验证并签收。原F04-01–08全部CLOSED；本轮发现的中断Raw删除、linked重放真实Raw核查、后退迟到响应及旧收据高修订号恢复也已闭环。[任务卡](../batches/M04.md)、[追加返修卡](M04-repair1-20261012-extra-repair.md)、[最终接口](../meeting-hub/M04-interface.md)。

本报告替代当前M04结论，不改写[首次FAIL报告](M04-review-20261012-acceptance.md)或其原始证据。未授权M05。原全项目S-03/S-04 FAIL与真实Provider36项BLOCKED保留，M04 PASS不代表全产品通过。

## 交付版本与独立性

起始[baseline](M04-repair1-20261012-baseline.json)与末次[最终冻结](M04-repair1-20261012-frozen.json)均为实际SHA清单。无Git元数据/旧完整源码，按文件SHA和当前实现复核，不声称行级diff。

Luna修改10产品文件：MeetingRawLinks、MeetingPage、server validation、Audit service、Meeting raw-bridge/source-policy/store/types、Prompt store、Wiki knowledge-workflows；3测试文件：import、meeting-raw-m04、meeting-raw-ui-m04。无产品/测试新增文件，依赖未变。主Agent只写本轮验收脚本、报告/状态/交接；没有替Luna改产品或单测。

最终82产品、47测试文件与冻结一致；正式workspace3文件、1080受保护历史/规划/验收文件与起始SHA一致。完整测试产生的旧B04输出另存本轮generated副本后恢复原字节。见[integrity](M04-repair1-20261012-integrity.json)。

## 必选检查与实际结果

| 检查 | 结果 | 主要证据 |
|---|---|---|
| 独立完整构建 | PASS，tsc 5688ms、Vite1851ms | [quality](M04-repair1-20261012-quality.json)、[build日志](M04-repair1-20261012-build.log) |
| 完整自动化测试 | 193/193，0失败/跳过/取消；进程18434ms | [测试日志](M04-repair1-20261012-tests.log) |
| Meeting Raw产品HTTP/磁盘 | 21/21，1670ms | [HTTP](M04-repair1-20261012-http.json) |
| 来源与实际两阶段恢复 | 11/11，3263ms | [deep](M04-repair1-20261012-deep.json) |
| 补充失败/兼容边界 | 5/5 | [edges](M04-repair1-20261012-edges.json) |
| React + 真实隔离HTTP组件 | 7/7，含history后退迟到响应 | [component](M04-repair1-20261012-component.json)；这是jsdom，不冒充浏览器 |
| M01/M03基础API回归 | 23/23 | [api-regression](M04-repair1-20261012-api-regression.json) |
| 实际CLI备份导出/恢复与保护 | 5/5组，5024ms | [backup](M04-repair1-20261012-backup.json)，27文件新归档SHA一致、旧归档、9恶意归档、junction及非空目标/源保护 |
| 旧知识Workflow回归 | 11/11，12222ms | [B05](M04-repair1-20261012-b05-regression.json) |
| 旧Audit回归 | 15/15，18261ms | [B06](M04-repair1-20261012-b06-regression.json) |
| 实际IAB浏览器 | 8/8，纯测试数据 | [browser](M04-repair1-20261012-browser.json)、[实际trace与关闭记录](M04-repair1-20261012-browser-lab-final.json) |
| Standards / Spec独立只读两轴 | 均PASS，无剩余可操作发现 | [交接记录](M04-repair1-20261012-axes.json)；读码不替代实测 |
| 证据/冻结/正式数据/端口核对 | 12/12 | [evidence](M04-repair1-20261012-evidence.json) |

98项服务/组件/API/回归/备份检查组均通过，另有8项真实浏览器。B05/B06运行于末次收据版本字段和Raw独立key补修前；之后只改Meeting收据兼容、types和UI key，旧Workflow/Audit路径未再变，因此复用这两项已实际通过证据；最终完整193测试及受影响Meeting HTTP/deep/edges/组件/API/备份均重新执行。

运行命令为`node tests/acceptance/m04-repair1-{quality,http,deep,edges,api-regression,backup,b05-regression,b06-regression}.mjs`，组件加`--import tsx --import ./tests/support/css-stub.mjs`；冻结/restore/check和evidence脚本也已实际运行。浏览器由CUA操作真实页面，独立本机API、Vite和fake陷阱使用临时数据根，关闭后56903/56911/56912均ECONNREFUSED。

## 返修闭环

| 原问题 | 状态 | 最终行为与独立证明 |
|---|---|---|
| F04-01 投影导致记录损坏 | CLOSED | 重导入/清空重算active Raw投影；历史Raw保留；H14/H17/H21、备份读回。追加E01证明真实Raw已写、linked rename EIO后删Raw仍GET200，raw_deleted不伪造registered_at |
| F04-02 匹配摘要/目标旧来源恢复旁路 | CLOSED | 恢复输入来源无条件检查，确认和恢复复查目标现有来源；H19匹配SHA恢复manifest conflict/Wiki404，D07/D08旧目标拒绝无Wiki/Index/Log/草稿写入；旧B05恢复回归通过 |
| F04-03 缺失来源流入Provider | CLOSED | 缺失/损坏来源fail closed，Audit不预先丢弃；H12受控409、Provider0，D06实际8条受限/缺失路径均拒绝且无资产/草稿写入，D09/D10确认及非法origin拒绝 |
| F04-04 派生标题超限 | CLOSED | 派生Raw标题≤200，合法会议标题不落不可读pending；H18真实200字符登记/GET成功，完整单测195/196/200，E03实际Unicode边界Raw可读、原件不变 |
| F04-05 同会议表单过期/迟到串会 | CLOSED | revision/import选择同步；最新ID ref和独立raw:UUID key；C01/C02与实际BR02–04，C07真实HTTP挂起A登记回包、history后退B后放行仍留B |
| F04-06 缺独立Raw删除确认 | CLOSED | 数量/保留/限制说明及confirmRawReferences；H15/C03/BR06；未勾Raw确认禁用、取消无删除、明确删除后真实Raw保留且仍受限 |
| F04-07 revision指纹/失败恢复 | CLOSED | 初次查revision，现代v2只绑定固定业务输入；failed/pending同ID恢复，检查当前授权/原件/现存Raw；H05/H16/C04/D02–05/D11。追加E02/E04实际错origin/缺失Raw重放409且不补建；E05旧base10001/current10002恢复201，不枚举旧revision |
| F04-08 普通meeting分类被拒绝 | CLOSED | 无新origin旧meeting创建/文件导入与手动Wiki兼容；H07/D01，伪造origin/Raw ID仍拒绝H06及完整单测 |

旧版收据未保存原baseRevision，最终用无版本字段明确识别旧格式，并依据持久request/import/confirm:true业务语义兼容；现代`request_fingerprint_version:2`必须精确匹配稳定哈希，未知版本严格拒绝。旧SHA只验格式，不宣称恢复其不可逆原输入；当前授权、原件摘要和真实Raw来源检查未放松。本机文件不是签名/防本地篡改存储。

实际浏览器完成工作副本保存/原文核查、重导入、明确新版本Raw登记、解除取消/确认、额外Raw删除确认取消/提交、刷新后两个Raw仍存在，以及会议删除后的综合请求受控拒绝。见[确认截图](M04-repair1-20261012-browser-confirmation.jpg)、[Raw保留截图](M04-repair1-20261012-browser-Raw-retained.jpg)。本轮browser原有knowledge字节不变，只增加预期2个会议Raw；prompts/drafts/state未变，Provider0。不能把这项描述为“零knowledge写入”。

## 失败证据、校准与限制

追加修复前真实产品遗漏保留在`pre-extra-*`、[最初追加卡](M04-repair1-20261012-extra-repair.md)；旧10000上限失败另存[legacy-failure-edges](M04-repair1-20261012-legacy-failure-edges.json)。后续Raw/Minutes兄弟key重复曾导致组件超时，Luna改为raw:UUID后最终7/7通过。

验收脚本自身误判也保留，不隐藏：初轮H12只接受403而实际受控409；C03未勾新增Raw确认；C04仍找旧恢复按钮；D09使用了错误Prompt确认requestId；M01-14仍期待现已交付Raw路由404，校正为非法请求受控拒绝。末次旧收据夹具只换旧哈希但仍带新v2字段，被正确拒绝；[误夹具证据](M04-repair1-20261012-versioned-fixture-error-edges.json)保留，移除新版字段后重跑E05通过。修正未改变业务预期或放宽产品门禁。HTTP H20的probe描述沿用初审“known failure”短语，实际H12与Provider计数均已通过，以结构化状态/实际值为准。

浏览器两个精确DOM等待因原文模式/组合AX文本不匹配而无效，之后实际状态已验证；fullPage截图失败改用真实滚动后的viewport截图。这些不是产品FAIL或独立检查项。跨页面Raw列表沿用App缓存，reload后读到2条真实Raw；列为M05集成检查事项，不能声称缓存自动刷新已完成。

受限/缺失来源拒绝路径未到Provider。deep总计1次fake调用是明确的正常Prompt预览夹具准备，随后受限确认新增调用0；B05/B06也是正常fake机械回归。没有真实外部Provider调用或AI质量验收，不补签原36项BLOCKED。

仅Windows/Node25.2.1、本轮本机环境；最低Node、其它OS、真实Provider、企业DLP/防磁盘篡改没有代签。构建仍提示单bundle>500KB；不属本轮行为失败。原M03大归档证据可参考，解码模块未变，本轮未重跑45MB大归档。子Agent实际token计量不可得，不估计费用。正式workspace与配置/密钥未改，未部署。

**可交付M04；M05需用户另行授权。**
