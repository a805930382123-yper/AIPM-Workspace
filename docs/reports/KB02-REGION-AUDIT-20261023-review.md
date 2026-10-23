# KB02 REGION 独立根因复核与模式裁定

本轮独立复核完成，批准有界最小方案，正式裁定 **A模式，Sol先审计划、Luna施工，本轮最终由Astra独立验收**。这是方案裁定，不是产品验收PASS。F-KB02-FIELDS-LONG-01尚未修复；KB02整体仍未通过。

代码HEAD `5be06023bb8200e82cb0131b0588601632c4e941`，产品提交 `a836270f53f0fc5bb802695e3f4101cf182ee3b9`。本轮Node v24.20.0，真实外发0，累计183/500、Prompt15/24不变。本阶段真实门禁关闭，须工程后主Agent按用途放行，阶段最多24次。未修改产品、默认测试、历史证据、状态、配置或Git。

## 独立证据与根因边界

已读AGENTS、status、agent-control、coordination、KB02任务卡及acceptance对应门槛、FIELDS最终验收和Sol诊断；独立检查knowledge-planning.ts的build/expand/project与instruction，以及knowledge-extraction.ts规划、覆盖校验与组装代码。

独立探针直接读取历史seq180请求/响应及checkpoint，重建原106400字符虚构Raw：SHA256 `a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`。重建规划输入与实际wire逐字段相等，运行时完整system与原请求相等。每个边界unit的sourceContext逐字匹配原文，14/14主体均含明确区域、2026年9月、门店数量、比例及区域独立说明。不能把本样本归因为上下文缺失、截断或chunk号缺少主题含义。

seq180原响应将27个边界unit归于同一泛化未知/未来页：14个fact unit、13个question unit，25个原事实ID与21个原问题ID。全部55unit/100原ID覆盖完整且无unit拆分。expand输出与原checkpoint.plan.pages相等；一次内存fake规划被原pipeline接受并组装15页。这里15页断言只核对历史重放一致，不作为业务页数门槛。业务失败是跨主体边界被抽离到没有主体的泛化页，不是多出一页。

原system已包含禁止泛化待确认建页、根据sourceContexts保主体时间条件口径、未知/未来归相关事实主题等总则。因此已证实机制是：充分输入下Provider选错语义归属，结构/覆盖门禁只保证机械完整性，确定性后段忠实沿用错误选择。旧同unit拆页与本次不同主体合页不是同一机械故障。来源仍可追溯，不能描述为Raw或来源永久丢失。

模型为何忽视总则尚未证实。注意力、措辞优先级、字段示例影响均仅假设；本次没有真实对照试验。Sol的主体保留人工响应证明现协议可表达，但fake不能证明模型行为改善。不得把新增提示称为根治。

## 最小方案裁定

采纳Sol诊断中的主体优先决策步骤及抽象正反例，原因是它把已有结果要求展开为可审决策过程：先依据本unit来源确定主体/时间/条件/口径，再识别独立业务主题，随后将该主体的未知/否定/未来边界归属到承载主题，最后反查标题与成员是否保留主体。此增量有明确可检视内容，不是仅重复禁令；输入已充分，无依据先增上下文、加解析器或改持久协议。

必须保持以下语义边界：不同主体相同文字不能抹平归属；同主体同口径同主题可跨chunk合并；不强制一主体一页或固定14页；原文具有独立定义/流程/机制的AI主题允许单独建页，不能按未来/未知关键词过滤；同位置fact/question为独立unit，只有表示同一边界时应归同承载主题，不新增硬性跨列绑定。仅进行同一次响应内自检，不删除记录、补事实、搬移模型输出、放松严格校验或自动重试。

文件范围仅2个产品文件：knowledge-planning.ts中KNOWLEDGE_PLANNING_INSTRUCTION；rules.ts的KB02_PROMPT_REVISION 10→11。build/expand/project、unit/source/schema、Provider、UI、持久兼容与预算不改。7份既有测试仅必要revision断言适配，保留真正旧版本夹具；新增规划归属窄测试。抽象例不用原区域编号/真实样例ID/固定页数。

Sol现有诊断包含明确实现顺序、范围与验证建议，可作为A模式先审计划的基础；主Agent需让Sol对最终施工卡核对一次，新增范围必须重新裁定，不能在施工中自行扩展。

## 四维评分

| 维度 | 分数 | 独立依据 |
|---|---:|---|
| 需求明确度 | 0 | K2-02要求保主体及待确认不独立灌水，原响应实物充分；允许有效独立主题，页数不固定，未见关键需求歧义。 |
| 模块耦合度 | 1 | 变更限共享规划instruction与既有revision失效门禁及对应测试；不改跨模块契约，但影响所有规划请求和未完成检查点兼容。 |
| 修改风险 | 1 | 提示改动可能影响长文、短文和更新输入质量，须真实复验；严格机械门禁和明确确认保留，无新自动写入或数据迁移机制。 |
| 历史失败 | 2 | 长文主题质量链多次失败，必须从严计2；不谎称本次type/category或旧unit拆分再次复发。 |
| 合计 | **4/8** | **A模式，Sol先审计划，Luna施工；按用户本轮指定Astra最终独立验收。** |

若扩至unit/source协议、存储/兼容策略、自动语义修正或跨模块完整性机制，立即停止扩大范围并重评B；同核心真实返修后仍失败，停止提示叠加与盲目重试，由Astra升级诊断/重规划。

## 冻结后验收门槛

工程需独立核对实际diff、必要定向回归、完整默认0skip与build；覆盖规则revision10旧未完成checkpoint的409/保字节/零调用、显式restart重提取、旧已完成草稿可读，以及原ID、秘密、预算、取消/恢复、字段职责和规划输入预算。会写历史报告的旧测试必须在隔离字节副本运行。保留原错误响应机械可接受负例，明确它是语义失败记录，不能把fake正例当真实质量PASS。

工程通过后建议最少20次真实：短文2、原106400字符长文15、补充提取规划2、更新预览1，从183到203/500；阶段24上限余4不自动使用。需原长文全部unit/ID恰好一次、各区域数值日期、14处边界原主体和独立主题依据审查；不以14页固定断言裁决。实际Chrome审核、刷新、持久回读必测。短文及更新需重新验证type/category、原目标、双方语义支持、20%/30%冲突、人工备注、双Raw、明确确认和幂等。独立工程通过仍不等于此缺陷关闭或KB02整体通过。

## 本次实际命令与结果

`node --experimental-transform-types tests/acceptance/KB02-REGION-AUDIT-20261023-review.mjs`

首次sandbox exit1：spawnSync git EPERM；提升执行首轮exit1：原独立探针beforeCall错误返回undefined，后续组装缺completedChunks。只修本轮AUDIT探针使回调按接口返回内存checkpoint，未改产品。普通写脚本也遭EPERM，提升后写入成功。

最终同命令提升执行exit0，工具wall time6.26秒，结果见[review.json](KB02-REGION-AUDIT-20261023-review.json)：exactInputAndSystem=true，55unit/100ID，14主体/27边界unit，existingRulesPresent=true，originalResponseAccepted=true，fakeCalls=1，memoryWrites=3，networkAttempts=0；3496个Git跟踪产品/测试/报告文件前后无漂移。保护检查范围仅所列跟踪目录，不冒称本探针验证了所有未跟踪文件或正式配置；本轮没有操作它们。

未运行完整测试/build/新真实模型/新浏览器，本阶段无产品修改，不将历史FIELDS测试写成本轮结果。平台token计量不可得。独立脚本exit0证明复核断言成立，产品语义FAIL仍保留。

后续等待施工冻结与主Agent工程门禁指令，再执行独立验收；不推进其它批次。
