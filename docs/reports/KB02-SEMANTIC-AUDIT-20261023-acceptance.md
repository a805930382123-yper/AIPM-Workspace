# Astra 独立验收：本轮真实缺陷未修复，KB02未通过

主Agent提交前检查补注：暂存全部新证据后，完整git diff --cached --check提示原始失败stdout日志中的尾随空格；为保留原日志字节未清洗。排除docs/reports/*.log后的源码、测试和文档差异检查exit0。此项不改工程/真实验收结论。

**B1程序门禁工程通过；真实质量返修未通过。** 原补充反例被新审核器错误放行，原F-KB02-REGION-SUPPLEMENT-01/P1未关闭。合法独立AI正例的规划有完整原文支持，但审核返回非法结构，产品正确拒绝，正例未形成草稿。KB02整体未通过，不进入阶段二、三，不启动下一批。

代码绑定：HEAD `0e44ab5563e5de3f4cdd8ed663a51393fde53422`，产品基线17121be；当前五产品变更以899文件冻结SHA256 `1cdc22d855c3a4e2175cfe22899799a49471f14ff355d6cf99669ed90220d421`绑定，主Agent后续关联最终提交。本报告不把旧原长文有限通过追改为失败，也不将旧证据当作本次新审核全链验证。

## 阶段一实物与独立语义裁定

完整输入/输出见 [provider-trace](KB02-SEMANTIC-AUDIT-20261023-provider-trace.jsonl)，阶段一副本见stage-1-trace.jsonl。逐原文范围→unit/memberIds→页面、原始schema issues与逐项裁定见 [stage1-semantic-review](KB02-SEMANTIC-AUDIT-20261023-stage1-semantic-review.json)，没有只写人工bool绕过问题。

| 样本及调用 | 实际结果 | 独立裁定 |
|---|---|---|
| 原160字补充，seq204提取/205规划/206审核 | 4fact＋1question＝5units/5原ID恰一次，5/5全文context；3页，审核全部pass，job completed，生成草稿 | **FAIL**：pageIndex2只有未来/未上线边界，仍缺独立主题依据 |
| 固定203字独立AI机制，seq207/208/209 | 4fact＋1question＝5units/5原ID恰一次；定义、触发、流程、未上线/无实测、负责人未知完整归1个business_process/ai_application主题；审核非法，job failed，无plan/草稿 | **FAIL**：不是内容不支持的语义拒绝，是实际审核协议失败阻断正例 |

反例具体定位：Raw `1210e5d5-8312-40bc-944b-ad58d45f0a8f`，job `232f6c84-4a82-41a1-b53a-79e1757f7abd`，页 `72c60dd9-b4e4-4a6e-9d5d-0cfceec28dc4`，标题“AI异常提示（未来建议，未上线）”，concept/ai_application。唯一unit `fu-139-160-fact`、原ID `f-c1-4`、原文[139,160)：“AI异常提示为未来建议，无上线或收益事实。” 全文context[0,160)确已提供；没有AI定义、触发条件或流程。原句应保留业务边界，不能据其独立生成空主题。其余两页保留100/30/30%及旧20/20%差异、财务每周核对和负责人未知，失败精准指向第三页。

seq206的原审核理由称：原文“含触发对象与状态边界”，“满足独立AI主题允许条件”，因此给pass/OK。**这是可观察的错误支持判断**：命名“异常提示”及状态限制不等于给出触发条件；标注未上线也没有补足独立主题。当前审核system已包含相应禁止和正例例外，input/plan与seq205一致，程序遵照合法pass保存。证据见 [seq206-review-evidence](KB02-SEMANTIC-AUDIT-20261023-seq206-review-evidence.json)。不推断模型内部心理原因，不声称仅加提示、字段或另一审核器能解决。

正例seq209原响应两项都pageIndex=0，两项均缺必填reason；首项unitIds还重复 `fu-110-162-fact`。原schema issues完整保留：`$.pages[0]: 缺少必需字段 reason`、`$.pages[1]: 缺少必需字段 reason`；重复索引/引用另列。产品报 `LLM_SCHEMA_INVALID`、成功提取块1/1保留、累计3次、无plan无draft，符合fail closed工程要求。新增记录 **F-KB02-SEMANTIC-POSITIVE-01/P1**：真实审核格式可靠性未达，不能靠放宽schema或自动补字段变成成功。

## 实际命令、UI和调用账本

- 工程命令/424默认、build、旧Node199＋46、独立5、历史18及首汇总生成物误分类见 [engineering.md](KB02-SEMANTIC-AUDIT-20261023-engineering.md)。本轮未因真实失败重跑工程或修改产品。
- `node --import tsx tests/acceptance/KB02-SEMANTIC-AUDIT-20261023-lab.mjs`：启动自有隔离root，read-only配置open.bigmodel.cn / GLM-5.3-Flash；最终exit0、服务关闭。
- `node --import tsx tests/acceptance/KB02-SEMANTIC-AUDIT-20261023-real-http.mjs supplement-original`：exit0，job完成；collector完成不是语义PASS。
- 同命令 `independent-ai-positive`：exit1，真实job LLM_SCHEMA_INVALID；原失败保留，无再次提取、继续或重试。
- `node tests/acceptance/KB02-SEMANTIC-AUDIT-20261023-stage1-ui.mjs`：exit0，真实已安装Chrome只读查看3页草稿及正例失败，4张截图；全部非GET及非localhost被禁止，实际无被拦请求，未点击重试/确认，浏览器关闭。Astra实际查看了坏AI页与失败UI截图。见 [UI证据](KB02-SEMANTIC-AUDIT-20261023-stage1-ui.json)。
- `node --import tsx tests/acceptance/KB02-SEMANTIC-AUDIT-20261023-stage1-close.mjs`：exit0，核对两个Raw原文SHA不变、全部映射及审核原响应，记录FAIL并请求关闭服务。
- `node --import tsx tests/acceptance/KB02-SEMANTIC-AUDIT-20261023-final-protection.mjs`：exit0，899冻结/3543保护无漂移，40个本前缀报告/截图已知密钥扫描无泄漏。见 [closure](KB02-SEMANTIC-AUDIT-20261023-closure.json)。

实际首次lab准备命令错误引用无AUDIT的fixture路径、未加tsx，分别ENOENT/strip-only TypeScript错误；未启动服务、未调用Provider。仅改启动命令后成功，原工具失败不掩盖、不计为产品重试。真正模型外发只有seq204–209，每次事前持久账本，6响应均HTTP200/stop，失败审核也计入。

**预算封账：203＋6＝209/500；阶段一6/6，阶段二0/20、阶段三0/4；Prompt15/24。** real门禁false，自有API/UI/Chrome均关闭。两Raw未改、无正式Wiki确认；隔离Wiki目录只有初始化index.md。正式workspace/config/历史证据未变；主Agentstatus/control及新授权SEMANTIC-DIAG资产不在本保护声明内。隔离root保留供离线诊断，无后台服务。

## K2门槛与未执行项

| 门槛 | 本轮结论 |
|---|---|
| K2-01 原文/ID证据与严格拒绝 | 工程及两份真实提取引用核对通过；不推断其余资料普遍完整 |
| K2-02 独立主题与有效草稿 | **未通过**：反例误放，正例格式失败；本轮缺陷未关闭 |
| K2-03 预算/恢复/fail closed | 独立工程通过；真实正例保成功块且无plan/draft，未执行真实继续/重试 |
| K2-04 完整质量与UI更新链 | **未通过/后续依赖门槛未执行**：阶段一失败，原混合短文、新长文、通用更新、新metric目标及更新Chrome完整链均未启动 |

新明确metric样本尚未真实验证，能力缺证保留；原混合concept不被强制判错，旧任务历史metric未达不改。旧长文有限通过仍仅属于旧冻结实测。

按同核心修后再失败规则，停止提示盲试/新增审核链/补字段猜修。主Agent已另授权原Sol只做受限离线定位；其交接后Astra只读核对附注，不在此轮自行扩方案或施工。后续范围和调用必须另行决定，本轮不自动推进。

## Sol有限诊断交接后的独立附注

已只读核对 [SEMANTIC-DIAG诊断](KB02-SEMANTIC-DIAG-20261023-diagnosis.md) 与replay.json。额外零外发Node断言确认其trace SHA与本轮原trace相同，seq206/209 rawReview分别与原始content解析结果完全一致；与Astra先前实际request/plan/响应和源码检查结论一致。接受责任定位：seq206为Provider结构合法但无依据的独立性判断，seq209为Provider原始结构违约；没有证据支持上下文漏传、候选错接或后处理篡改。模型内部原因与成功概率仍未证明。

Sol把结果改成reject/合法格式的两个人工内存控制仅证明门禁接线和表示能力，不替代真实修复或本轮正例成功。其12次内存fake请求不是新增真实调用。本次只读复核未重复全量或重放，累计仍209/500，结论维持本轮质量FAIL、KB02 FAIL。所有自有服务与Chrome已关闭，未派发新施工。
