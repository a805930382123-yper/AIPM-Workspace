# B增量独立工程检查准备

本文件仅检查准备，不是工程签收或真实放行。依据已冻结B卡SHA `252f13c7e63306967e326b1b1736d8ab0b5ac9e50bfd479c38a87b7a6d5b0b0a`；真实0，累计224，单B最多225–226。Sol仍施工，未执行任何未冻结模块；不读真实配置、不创建真实release。

初读施工中core/cli仅用于确定差异轴：单B CAPS与225起算、单mixed-short Raw、prepare提前创建Raw、独立AUDIT证据前缀、CLI禁止flag/env。最终验收以交接freeze字节为准，不把初读当最终代码审查。

冻结后检查：

1. 比较A已审模块与最终B实际差异，追踪import到PREP/产品，核freeze覆盖所有运行依赖。确认B正文精确SHA、卡/spec/fixture指纹以及A/旧产品冻结不变。
2. 核实际server只给B生产提取和必要人审/确认路由；update、综合、旧A路径没有可达Provider出口。单stage固定release在arm时独立工程证据门禁，在begin/send重核绑定；两次请求属于一次已放行的正常产品任务，不增加逐send人工审批。
3. 以最终自查覆盖图确定最小独立运行：最终B fake生产完整2次链独立一次；门禁前loader/send/账本0、跨stage/错Raw/重复进程、225/226配额和先pending、产品失败stop、恢复/落账失败、精确transport/秘密保护各核实际断言。窄同字节A机制复用附源码等值和既有证据，不重复A整链或445/build。
4. 针对新增/未覆盖分支做独立故障注入或本机sink探针，首失败保留并交Sol最小复现；不为补数量扩测。隔离副本运行防覆盖施工证据，独立输出仅AUDIT前缀，所有请求均fake/127.0.0.1。
5. 完整fake创建之前全部页必须显式审查，未审/旧digest/未解决阻断；确认后Raw/原unit保全、正式回读及幂等无新调用。实际Chrome真实阶段由主Agent另做，不将HTTP或fake称Chrome/真实语义通过。

工程结论给`stage:"engineering",pass:true/false`、代码基线/freeze、实际命令/结果/必要限制、release精确格式与接口。通过后仅主Agent能签B release；真实内容质量、HUMAN修订、最终正式回读/幂等另行裁定。B完成仍不等于KB02结批，C不启动。
