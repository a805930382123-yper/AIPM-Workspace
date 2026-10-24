# BR独立工程通过，原B全过程仍待Chrome

本轮duplicates/必要create-defer接线在工程层面通过，实际DraftReviewPage链验证完成；原真实session尚未进行人审/正式确认，阶段B暂不能标PASS，KB02仍BLOCKED。新增模型0、配置读取0，知识226/500、Prompt15/24。原B失败和旧签收历史不改。

基线 `c35a35009b7be2afc8159f14a10787428d16dae8`，产品60f83ad。BR最终freeze SHA `a6345e9dbcd1742515c88662f0ab03765a4b485364be86b5f1151f672d2d1da6`、207文件前后零漂移。Sol交接并停写后执行；原真实root全部16文件与卡初始哈希及独立运行前后均一致，草稿保持revision1，未构造新模型请求。

## 实际审查

server现行生产registerKnowledgeRoutes提供真实duplicates和decision，输入白名单限制固定draft及create/defer，update决策409。实际DraftReviewPage需要的初载/保存/确认前查询都可达，未用伪造空列表或直接confirm替代前端。

BR未直接导入配置加载器/Provider构造器，不创建ExtractionRunner/LLMService，不重启原job或reconcile提交。生产模块的传递依赖含provider.ts清洗/校验函数，但没有构造调用；provider回调固定抛错。模型路径先拒绝、旧arm404、flag/env拒绝。已审PREP guardNetwork仅允许登记localhost，未登记sink0，计数不宣称全进程遥测。

CLI的UI使用Vite `configFile:false,envFile:false`，先用本机socket取得显式空闲端口，再strictPort指定；不会因为port0回退5173，也不加载.env。实际UI smoke为Sol最终同字节证据，本次静态复核参数，未声称独立重复UI进程测试。实际Chrome仍由主Agent执行。

原root/session/marker/Raw/candidate/账本绑定精确；业务写前核sidecar完整文件集，合法变更后响应前更新受控文件集/草稿版本。允许变更只含固定draft、对应raw-processing、Wiki/Source/index、commit/operation/log；不改原B session/原响应/账本。首次绑定要求v1，之后重开按sidecar当前版本，不重置v1或静默接受未知编辑。服务租约在独立sidecar；重复服务拒绝。

## 独立实际命令与覆盖

```text
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-BR-AUDIT-20261024-engineering-run.mjs
```

Node25.2.1。最终冻结代码的selftest实际只运行一次：05:47:10–05:47:13，11/11通过，模型0/config spy0/providerCallbacks0。它在原session的隔离副本上使用实际React DraftReviewPage/jsdom/localhost；原root只读取/哈希。独立runner仅把本次selftest证据文件写入AUDIT前缀，未改变产品、施工模块或业务行为。

| 检查 | 独立结果 |
|---|---|
| BR-E01 | 初始16文件/卡SHA绑定、错root/candidate拒绝，启动GET业务文件不变，重复服务拒绝。 |
| BR-E02 | 两页生产duplicates空结果200，另副本预置真实相似Wiki返回实际候选score≥0.35；create/defer、旧revision拒绝、decision清全审正确。 |
| BR-E03 | 六个模型入口拒绝、old arm404、update decision/flag/env拒绝；Provider回调0，文件读取spy0，未登记sink实际0。 |
| BR-E04 | 实际组件查询失败时不能正式写；恢复查询后加载→编辑→保存→全页审查→确认→回读；模型未调用，5原unit全对象保全，重复confirm reused且副本文件不变。 |
| BR-E05 | 重开接受最新受控文件集且不写，未知字节修改拒绝；原真实16文件及207源码前后不变。 |

本次主副本记录8次duplicates：前置直接查询两页2次、实际组件正常加载/保存/确认各两页共6次。Sol报告10次反映其额外React effect查询，不是必须达到的验收数量；独立实际请求次序包含每个必要阶段，不以凑次数替代覆盖。另一个相似Wiki副本的查询在对应检查单独通过。

独立runner有两个**汇总层**错误，均保留：首次误以为selftest返回对象，实际上它只落盘，11项已成功后出现undefined.pass；随后只读核该已完成证据时误硬编码duplicate≥10。核实际请求链后改为覆盖所需的8次最低数，未修改任何产品/施工代码或重跑组件。最终只读汇总命令为上述命令追加 `docs/reports/KB02-K204-BR-AUDIT-20261024-independent-selftest-2026-10-24T05-47-10-275Z.json`，exit0。前两次wrapper exit1不隐瞒，也不误判为产品或组件失败。

没有跑B提取fake、A整链、445/build或任何真实Provider。当前工程结论基于实际组件与HTTP、源码和原root哈希，不能替代真实Chrome。

## 主Agent可执行的原session续验

工程签收后执行 `node --import tsx tests/acceptance/KB02-K204-BR-20261024-cli.mjs inspect`，再`serve`。固定原session/root，无模型release。实际URL见BR lab.json；status/export/stop接口同前缀。首次启动后独立核原16文件未变再开始Chrome；后续允许的draft/正式写按sidecar记录，原immutable证据不变。

Chrome按已确认意见将第二页明确标作人工并列资料组、不证明同一流程/因果；保留全部原unit/事实，选择正式页，保存清审后逐页审全份，再明确确认、刷新/重开。原自动主题问题不称模型修复；实际完成后独立核正式磁盘、来源、commit和幂等，分别给缺陷关闭/阶段B整体结论。出现新失败立即停，不追加模型或C。
