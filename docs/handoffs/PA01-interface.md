# PA01 第一版修复方案与冻结接口

2026-10-15。主Agent范围裁决，配合[任务卡](../batches/PA01.md)。现状依据FULL3验收：Brief context不合规及非法JSON、生成/优化60秒超时，具体历史响应形状未保留；listJsonRecords吞读盘错误造成ST-F01。当前知识调用已限定low/JSON但Prompt未使用，不把推理预算推测当已证实唯一根因。

## A. 契约与服务端组装

Brief沿用九个必填字符串 taskName/taskType/role/goal/context/input/tasks/constraints/output，未知业务写明确待用户补充，禁止虚构。现有每字段10000/总30000硬预算保留；提示要求简明，完整schema、合法示例、非法/缺字段边界同源。不要把数组/对象猜测转文本。最终用户仍可自由编辑字符串。

Provider生成/重写新协议版本pa01-1：严格对象 {version:1,name,category,scenario,sections,inputRequirements,outputRequirements,examples,tags}。sections是1–16项 {heading,content}，heading非空<=200、content非空字符串，总渲染正文<=B07 100000；其余字段按B07既有限制，category动态限定现有类别，tags按既有限制。完整shape/example与验证同源。服务端按顺序渲染“## heading\n\ncontent”，不丢内容，不要求固定七个标题；正文含JSON/Markdown示例、中文变量、换行仍可保存。最终preview保留原10字段，relatedWikiIds完全取本次用户选择快照，favorite=false，变量继续由正文确定性提取；模型禁止输出这两个受控字段或id/版本等系统字段，未知字段明确拒绝。旧已完成草稿保持既有preview读取，不把旧provider wire混进新协议。API generate输入/成功输出形状和confirm保持兼容。

九维检查协议 {version:1,checks:[{id,status,evidence}],improvements:[{dimensionId,issue,action}]}，恰好九个已知唯一ID；label服务端补。改进仅对应实际missing，无缺项时允许空数组；不得为了优化捏造问题或输出总评分。输出正文和检查分开，不在检查阶段生成preview。

## B. 调用能力与预算

LlmCompletionRequest用途允许knowledge/prompt，Prompt每阶段显式purpose:prompt。保持精确host(open.bigmodel.cn/api.z.ai)+模型glm-5.3-flash能力限定，才发送 reasoning_effort:low、response_format:json_object；其他兼容端点保持通用wire，不能全局硬塞厂商参数。连接探针不变化。模型请求schema与客户端严格校验独立；不宣称当前端点支持json_schema强约束。

Brief、generate、check、rewrite各阶段最长60000ms，输出响应体上限沿用现有512KiB；分阶段并非把原单次超时改长。优化两阶段最坏各60秒，UI明确阶段与已完成结果，整体不无限循环。兼容optimize协调入口最多两调用/120秒，阶段预算不突破；新UI用分开的请求。信号取消到底层；本机读取错误不能伪作取消或Provider失败。没有自动网络/格式重试和JSON修复。Provider快照单次请求固定，检查draft存非敏感Provider身份/规则版，重写前变更409要求重做检查。

每次调用记录可安全显示的requestId、stage、开始/结束/耗时、状态码/finishReason/usage（若有），不存完整业务prompt/response/思维链/headers/key。schema错误details仅字段路径、expected与actualType、总错误数；非法JSON仅长度/finishReason等安全元信息。动态错误键值/路径先脱敏且有长度上限，所有存储/组装后仍扫已知凭证。

## C. 两阶段接口和恢复

保留 POST /api/prompt-ai/brief、generate与现有get/confirm。新增：
- POST /api/prompt-ai/optimize/check：输入沿用 {body,supplement?,targetPromptId?,baseVersion?}；返回 {draftId,stage:'checked',originalBody,checks,improvements,target,provider}。严格校验完原子保存同一optimizer草稿，无preview不可confirm。
- POST /api/prompt-ai/drafts/:id/rewrite：输入 {requestId:UUID}，只用已持久化的原文/补充/检查/目标/规则与上下文快照，成功同draftId添加preview并stage:'ready'。checked失败不得重写。失败保留checked内容并返回draftId/stage/retryable/preserved信息；同requestId成功重放零Provider；同draft运行中拒绝409或复用同promise，不能双外发；失败重试需用户新requestId，一次点击一次调用。超预算拒绝。
- GET /api/prompt-ai/drafts：仅摘要列表，kind/status/stage/title/createdAt/id，可恢复checked或ready，不在列表含正文；GET :id返回完整本人草稿，只读零Provider。界面提供显式继续入口。旧无stage的完整preview草稿视为ready，无preview旧Brief依原流程；损坏草稿明确错误而非404。
- 旧 POST /api/prompt-ai/optimize 作为兼容协调器：check落盘→rewrite，成功保持原 {draftId,originalBody,checks,improvements,preview,target,provider}；失败携带已保存draftId，可由新接口恢复，不能吞checked结果。新UI不依赖两段一起返回。

optimizer草稿版本pa01-1新增stage(checked/rewriting/ready/failed)、输入SHA/规则版/Provider身份、attempts、supplement、检查快照/目标version/原关联Wiki快照、安全lastError；与旧pending/confirmed提交状态区分。rewrite最多3次实际尝试（每请求在Provider前落盘计数，失败也算，显式重做check创建新草稿）；不得自动重写。首次check一次。重启发现rewriting标中断/可显式继续，绝不自动调用Provider；服务端串行防重复。重写前校验检查结果结构、输入一致、目标version及来源策略/关联Wiki仍有效；不混用不同目标或后改内容。原文或补充改动须新check，不复用旧诊断。目标已变409且零调用。检查后不允许通过直接覆盖draft字段绕过绑定。

生成Brief、用户已编辑Brief、Wiki选择、未保存预览在UI请求失败时保留；手动Brief入口必须可达且明确由用户填写，不冒充AI成功。输入编辑/切页/旧请求迟到不得覆盖当前。取消并终止实际请求；已提交资产根据receipt对账，不当未保存处理。

## D. 用户错误与存储恢复

错误既保留稳定code，也提供safe details {requestId,stage,category,retryable,preserved?,draftId?,committed?,nextAction?}；不要把错误码/原始JSON作为主要文案。用户输入400、模型返回502明确分开。分类：configuration/auth/rate_limit/network/timeout/response_invalid/conflict/storage/recovery。每种给阶段、原因、保留内容和适当按钮；重试不重做已完成check。已提交但草稿标记失败，先回读真实id/version/同payload对账，不盲重建。

ST-F01先新增scanJsonRecords返回 {records,issues}，issue只含safe basename/opaque id、记录类别、read/parse/shape/dir原因code，不向UI暴露绝对路径或原始异常。只把ENOENT目录作空，其它目录/逐文件错误可见。为现有listJsonRecords保留健康调用返回array；有损坏且无明确issue接收者时抛StorageError，禁止静默continue。迁移所有现有callers，使列表仍返回正常记录并登记issue；reconcile继续正常操作但坏文件不执行。验证记录基本结构后再恢复，不能把合法JSON错误shape当可执行清单。

本机根绑定recovery registry集中收集扫描/读取问题；重复扫描按类别+安全文件ID去重，重新扫描修复后才能移除，文件仍坏不能“关闭提示=已修复”。扫描/摘要有界，至少可准确表达未扫描/溢出，不把超限当无问题。服务启动扫描及运行列表/读盘发现均可登记。新增只读GET /api/recovery-issues返回安全清单；全局RecoveryNotice显示数量、类别、安全文件标识及“原文件保留，需要检查/从备份恢复”，允许刷新检查，不提供自动修复/删除按钮。重启后仍能重新发现，不要求新数据库。

覆盖commits/workflow manifests及邻接draft/raw-state/jobs/workflow、PromptAi draft get，保留正常项；不存在404与损坏/权限错误明确区分。扫描与错误展示不得泄漏Key、业务正文、路径。并发登记不串根；正常或部分提交/幂等恢复保持。get损坏不能再catch全部当undefined；主Agent验收会模拟截断JSON、不可读、错误shape、目录错误、健康邻居和修复后重新扫描。

## E. 验收门禁

PA01-01：同源schema/示例与严格负例；六模板+custom不固定内容，不编造未知；Brief可编辑影响生成。
PA01-02：精确能力guard、其他端点wire不变；阶段超时/取消/限流/截断/非法JSON/类型错误有安全诊断；无隐式重试/正式落盘。
PA01-03：provider内容契约→确定性Preview，受控字段取用户快照；中文变量/Markdown/长正文不丢，未选Wiki零外发，现有6页/3000每页/12000总上下文边界保持。
PA01-04：check持久化→rewrite成功；rewrite失败/取消/重启仍可读检查与原文；只续rewrite，GET/重启零外发；重复/并发/3次上限可实证。
PA01-05：原文/补充/目标/Provider/规则变化及迟到响应隔离，版本冲突零调用；旧草稿/旧API/Library读写/版本/确认幂等保持。
PA01-06：分类错误动作与真实状态一致，任务/Brief/选择/检查保留，人工Brief路径不替代AI验收；无catch吞列表错误。
PA01-07：损坏/不可读/shape/目录扫描可见，健康项继续，坏文件字节保持、零外发/猜测恢复；修复后刷新才清问题；全局UI及API不泄密。
PA01-08：六链秘密与Meeting门禁、确认原子/重复提交/部分提交恢复回归；KB02工程已通过项不能退化。正常存储返回契约保持。
PA01-09：同冻结完整默认测试+build，旧断言wire迁移记录；原目录ACL限制精确副本执行不冒称原地PASS，0skip。
PA01-10：主Agent真实虚构取证，两类Brief编辑→选Wiki→预览→显式保存，弱/完整Prompt检查优化→保存新项/新版本；六模板覆盖分列，超时/失败记录明确。桌面实际UI检查与恢复，只有fake不能签质量。

真实本批最多24请求，主Agent记账且计全部阶段/失败；KB02原40不重置，不用本批预算重测知识链。全部工程/真实证据后才判本批，原FULL3全项目仍需其它未过项，不自动升为PASS。
