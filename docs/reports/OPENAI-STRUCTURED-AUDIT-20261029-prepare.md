# OpenAI strict schema 独立工程审查

2026-10-29，Astra规划/独立验收实例resume_scope，未参与产品/测试施工；施工为另实例Sol High structured_build。依据 OPENAI-STRUCTURED-20261029-task.md 及其执行前Q修订。基线提交2fe5318e70e188cf28c15af7867aacf460213d66加交接工作区差异；尚未提交，以主线程后续提交关联。

## 当前结论

S01–04工程PASS；S05旧准备机械入口可复用，但真实Q可执行性未通过，待新fixture/runner精确gate及两个新会话冻结后复验。真实O/Q未执行，结构失败在真实Provider上的消除尚未证；R16/R18、B09整体未通过。不得放行旧准备会话。

独立检查实际provider/extraction差异、新openai-structured模块、schema-validator及定向测试：两个调用显式传递加载schema；官方host/model/knowledge门槛与温度处理正确；wire只对原可选属性允许null，先wire校验再按原可选字段省略，之后原exact/归属校验保持。必填null、字符串页、非法引用不修补。原始text保留；refusal/异常结束/截断失败。revision16拒绝旧未完成恢复，完成草稿读取可复用。实际schema已有nullable类型能力，未扩大业务validator。

Q旧样本全questions与无事实拒绝边界冲突，不能以fake成功或随机模型双轨签通过。已在零真实阶段修订卡：新独立事实承载主题，原两问题保持，要求两问题都only questions；不要求整篇纯问题成稿，不改产品事实门槛。这属于准备缺陷修订，不是strict工程缺陷。

## 独立实测及复用

实际执行：

```powershell
node --import tsx --test tests/openai-structured.test.ts tests/provider-knowledge-reasoning.test.ts tests/kb02-pipeline.test.ts tests/kb02-planning-attribution.test.ts tests/kb02-planning-context.test.ts
Get-FileHash services/llm/provider.ts,services/llm/knowledge-extraction.ts,services/llm/rules.ts,services/llm/openai-structured.ts,tests/openai-structured.test.ts,tests/kb02-planning-attribution.test.ts,tests/kb02-planning-context.test.ts -Algorithm SHA256
```

45/45 PASS，exit0，测试duration1305.11ms；7项SHA逐项与builder交接一致。请求由fake fetch模拟，无网络/密钥/真实配置读取。覆盖两阶段实际wire请求、nullable整对象/嵌套栏目成稿及渲染、错误拒绝、原254拒绝、首失败无重试、指纹和已完成记录兼容、非目标Provider行为。未以fake推论真实模型语义。

复用builder同产品/测试版本 `npm run build` exit0（TypeScript通过、214模块）；独立未重复build。原smoke5fake及prepare记录只证明当时机械路径，不证明旧Q可执行；本卡及随后runner变更使原67项freeze不再有效。待新准备交接后复验S05，未重复全矩阵、浏览器或真实API。

知识254/500、Prompt15/24、连接1单列不变。本次仅卡和本报告写入；未修改产品/测试/Raw/旧响应，未提交。

## S05 返修独立复验（最终准备结论）

S05 PASS，S01–05准备全部PASS。新fixture逐字符合卡修订，旧两问题保留；读实际questionTargets/gate实现，三个独立atom机械核对及按sourceId/text检查两个question-only unit正确，gate在规划请求预约和配置读取前执行。不改变产品无事实门槛。

复用同runner SHA `9db4f0056ea75d385f34efbc69a0909ee53373471fc84ebb915022abdc34d524` 的7fake/0real/config0 smoke；独立读取成功Q gate（两个questionOnly=true、独立fact）和缺第二问题/双轨反例result，两者均reserved=sent=1，QUESTION_ONLY_TARGET_NOT_OBSERVED，独立Test-Path确认无attempt-258/candidate-original。不重跑产品45项或build。

独立PowerShell逐条Get-FileHash核两个新freeze的67文件，均drift0；读取session确认O255–256起账254、Q257–258起账256、maxCalls2、Prompt15及各fixture/Raw绑定；目录扫描release/attempt/run-started均0。通过Node createHash核JSON.stringify(freeze.files)得到清单逻辑摘要 `5ba9e4499e01326f3232605b734ff4a68344037967211ef6b448384dd6c6d75d`，符合session；freeze.json文件原字节摘要不同是格式化JSON与逻辑清单哈希的区别，非漂移。

可放行的准备会话仅O `.scratch-OPENAI-STRUCTURED-20261029-yO3s6e`、Q `.scratch-OPENAI-STRUCTURED-20261029-eklVgy`；旧会话仍禁止放行。主线程先执行O，独立语义通过后才Q；沿新4次封顶和首失败停。本复验真实/config0，累计知识254/500、Prompt15/24、连接1单列不变。

本轮准备缺陷已关闭；真实结构适配和O/Q内容质量未测，R16/R18、B09整体仍未通过。S01–04产品7SHA证据沿前段及施工未变交接复用。
