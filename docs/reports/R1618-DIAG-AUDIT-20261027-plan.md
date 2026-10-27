# R16/R18 规划契约：独立方案审查

2026-10-27，Astra medium。受查基线 `c23b536cf0c21c6b9879c8109f8fa2e5daaa5c90`。用户本轮授权零调用诊断、最小方案及独立审查，不包含产品施工。独立读取Sol已停写的[方案](R1618-DIAG-20261027-plan.md)并核必要源码，复用[246真实验收](R1618-QUALITY-AUDIT-20261027-real.md)，未重复旧矩阵或调用Provider。

## 结论

**方案可接受，可作为后续获授权施工的小批依据。** 最小产品范围是两文件：`services/llm/knowledge-planning.ts`中的字段提示常量，以及`services/llm/rules.ts`现有提示revision从13到14。加一项定向离线检查即可，不需要扩协议、schema validator或产品运行流程。

**本轮没有施工，不能声明缺陷修复成功。** 本方案是降低契约表达歧义的可检验假设，不是已证明的模型遵从修复。Q02真实原稿FAIL、Q03 NOT_RUN、Concept覆盖缺证、R18历史失败及R16/R18/B09整体未通过均保持。

## 对具体缺口的审查

层级与类型：246请求已经包含完整schema及类型目录，首失败是模型把metrics/related_knowledge放page顶层。明确唯一templateFields路径与page合法键能够直接解释错误输出，但不能把已有schema称为缺失。schema字段并集不等于各类型均可用；现有expand/project继续拒绝Process definition，不应通过宽松解析或响应搬移绕过。

未知与引用：原questionUnitIds已有通向open_questions及待确认正文的完整通道。提示应直接说明只有question支持时省略相应字段，不借同页无关fact，不将question ID放入factUnitIds；保留原question归属即可。此方案不增加question字段接口，能针对本次“负责人未知引用AI未上线事实”的具体行为提出正确替代输出。当前ID/归属校验仍不证明语义支持，新增提示也不能代替真实逐断言核对。

两型覆盖：一次只产Process仅说明本轮两型覆盖不足，不能据此强拆两页、复制unit或写死页数。方案保留该边界，接受。后续若补Concept样本，须另按独立业务主题证据选择，不以人为拆页冒充自动质量。

提示可保留三条短说明和短正反例；无需复制完整字段目录或针对固定六句写标准答案。建议实际文案使用“所有**模板栏目**内容放在templateFields内”，避免“所有栏目”与page的合法fact/question引用属性产生字面冲突；含义沿原方案，不新增范围。

## 必要版本依赖已核实

独立读取rules.ts的rulesVersion计算式，摘要包含KB02_PROMPT_REVISION及规则/schema文本，但不含KNOWLEDGE_TEMPLATE_FIELD_INSTRUCTION。因此仅修改planning常量会让新旧提示共用rulesVersion，revision13→14确是本次必要伴随修改。

`validateKnowledgeCheckpoint`现有代码在rulesVersion不一致时抛出 `LLM_CHECKPOINT_INCOMPATIBLE`，要求明确重新生成并保留检查点。沿用该行为即可；不改存储格式、不迁移旧计划、不为复用245抽取结果增加绕过机制。版本递增属于现有契约，不需要新版本框架。

## 后续允许范围及最小证据

如主Agent另获施工启动，允许上述两产品落点与`tests/r1618-auto-fields.test.ts`的一项定向增量。实际planning请求须包含新说明及原schema，另核bundle.rulesVersion采用revision14并与归档revision13不同，不要求把revision标识额外加入请求；一份明确标为人工合成的合规plan证明question-only保持独立待确认正文、无依据字段省略、Raw/事实/证据不变；原246响应保持原样并继续由严格schema拒绝。原版本冲突、字段类型和人工正式保存机制未变，复用既有相应证据，不重复全矩阵或浏览器。

这些工程证据只能证明新指令进入请求、现有合法通道可用及拒坏不退化。不能证明模型随后一定正确归位/引用；真实验证仍须后续明确样本、版本与请求预算。当前247未使用，本轮不得消费。无需为把已知失败改成通过而修补原响应或追加试抽。

## 本轮实际检查

- `Get-Content`读取Sol诊断报告、rules.ts版本常量及摘要计算、knowledge-extraction.ts检查点拒绝分支；`rg`定位版本使用处。命令exit0。
- `git diff --name-only`仅见外部AGENTS及主Agent状态文件修改；`git rev-parse HEAD`返回上述基线。独立未改产品/tests、状态或外部工作。
- Sol内存探针结果作为其诊断证据引用，独立本轮未重复运行；原246错误与后续约束依据沿用上轮独立已实测报告，不冒称本轮新测试通过。

本轮真实调用0、实际配置读取0；知识246/500、Prompt15/24不变。方案审查完成后停止，不自动施工。平台token计量不可得。
