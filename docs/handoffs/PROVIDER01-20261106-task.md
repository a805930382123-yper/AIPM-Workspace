# PROVIDER01 正式入口Provider上下文补齐

用户授权修复已定位接线缺陷，真实模型测试由用户进行。本轮0/1/1/1=3，A标准：目标确定、单入口关联四业务路由、主要功能受影响、实际运行已失败。Astra冻结计划，Sol High原kb03_r1_builder先审计划及独验，真实Terra施工实例另派；施工/验收不同实例。不借B扩大改造。

产品只补server/index.ts现ai predicate缺少的POST /api/knowledge/answers、/answers/:id/save、/inspections、/inspections/:id/draft，使原providerFactory快照进入AsyncLocalStorage，保留既有路由条件。不得重构Provider框架、修改QA/检查业务或读取真实配置。当前RAWZH01 763/763未提交工作树保留。

验收必须启动实际`node --import tsx server/index.ts`子进程，TEMP FMCG_DATA_DIR/FMCG_LLM_CONFIG_FILE，清代理/模型真实env，local fake HTTP Provider合成资料。可复用tests/llm-http.test.ts启动模式，新增一个聚焦测试文件，不能仅向registerKnowledgeRoutes注入fake。

四路由须分别证明走到本地Provider并取得各自合法业务响应/后续状态，覆盖answer异步/inspection异步上下文，不用仅不再报未配置代替成功。只读GET/health/手工Raw写在无配置或坏可选配置时继续正常，非AI路由不能意外加载Provider。无付费/无正式资料/无用户配置操作。

Terra所有权server/index.ts单predicate及tests/provider01-entry.test.ts（必要最小support须先说明）；Sol仅独立review/证据与验收测试，Astra本卡/status/control。所有worker共享工作区不撤销前批修改。用户工作台可能watch热更，但不触发其请求、不停止服务。只关本批自己TEMP进程。

施工定向真实入口测试、tsc、空envDir build及现llm-http/受影响QA检查回归，停写交SHA。独验重跑关键真实入口/核差异；适度复用同版通过记录，无需重复整站UI。失败返回原施工者修复后独验。无提交推送。任务完成记录局部修复和整批结论，不宣称真实模型测试通过。
