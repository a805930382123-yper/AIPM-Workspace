# B增量独立工程验收通过

本轮B适配器工程PASS，真实B质量及实际Chrome流程NOT_RUN，KB02整体仍BLOCKED。未读真实配置、未创建真实release、真实0；知识224/500与Prompt15/24不变。主Agent可签唯一B release（225/226最多2次），不追加逐send人工审批。C不启动。

受测基线 `d2176eca0632e69a9b082acbb80a1ec0523bdc56`，产品60f83ad。最终freeze SHA `12dad741181e7e74a95d58d2f49a24774343c6f11903b1083d7bbb4d4f6f2463`；202文件逐项同字节复制/核验，结束后零漂移。Sol交接SHA `fea8303e8a0ced15b9e1e7b4f4ac40b1f1cb03a90c396037f9421aff3cc9174c`，明确停写后才运行。freeze中BUILDER_SELFTEST_PENDING为开测前不可变标签，不覆盖后续实际独立结果。

## 实际审查与验证

核四模块及相对A的实际diff：B core窄复制已审持久锁、transport、Provider透传/wire、错误停止，修改仅独立前缀、单B/225起算/2上限、prepare创建固定Raw及单工程证据。server直接使用生产stores/ExtractionRunner/confirm路由；没有注册knowledge update/synthesis写入口，POST旁路由白名单拒绝。CLI只arm一次，真实构造必须在release/begin后；GET/启动没有Provider构造。B未改A/PREP/product/rules，未使用运行时源码替换。

运行依赖通过freeze和PREP冻结spec两级验证：freeze包含202项；PREP support在运行时还按已冻结spec.files核历史HUMAN freeze、长文checkpoint、旧provider trace等校验资料。独立副本同时复制并核这些传递依赖；其明确hash列于execution报告。依赖来源不是未校验的任意报告。

实际命令：`node --import tsx tests/acceptance/KB02-K204-B-AUDIT-20261024-engineering-run.mjs`，Node25.2.1，最终exit0。脚本创建独立同字节副本，在副本运行 `node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs selftest`，随后运行独立门禁副作用与result落盘故障探针。只访问127.0.0.1合成服务，未触碰主Agent的55515/55516服务。

首轮05:23:10复制清单只含freeze直接文件，缺PREP spec引用的历史HUMAN freeze，selftest在0组/0调用时报ENOENT；这是独立测试副本准备缺项，原execution/selftest/log保留。补充复制spec.files后，**同冻结产品/施工字节**05:23:37–05:23:47通过；没有修改施工文件或放宽断言。所有输出保留时间戳。

| 检查 | 实际观察 |
|---|---|
| B-E01 | 缺/错/漂移release、卡/代码/绑定、非B阶段、错Raw、retry、flag/env拒绝，loader/send/账本0；新增独立probe逐字断言无release provider/begin失败后session不变。 |
| B-E02 | 正常产品提取规划仅225/226，实际fake服务见pending先落盘；重复点击202+409，第二服务拒绝；第三次、update/synthesis/C/B1拒绝。 |
| B-E03 | 提取/规划schema、未知来源、截断、假秘密、账本/私有响应落盘失败、pending重启与在途停服均stop；独立另将result-225.json置目录，合法响应后EEXIST，恰1fake/1attempt，后续arm拒绝。 |
| B-E04 | redirect/http二次options/fetch dispatcher拒绝，未登记sink实际0；假秘密export只hash/withheld、private排除，真实配置不读取；最终202项零漂移。 |
| B-E05 | 完整fake正常2calls后未审确认阻断、编辑清审/旧revision拒绝、全页审后创建Source+concept；原5unit全对象/Raw保全，重复confirm reused且全文件SHA不变，服务重开回读一致/config0/send0。 |

17组独立完整B自查正常2fake、全套10fake；额外独立result落盘探针1fake，共11fake，全部非真实。细节见 `independent-selftest-2026-10-24T05-23-39-018Z.json` 与 `engineering-execution-2026-10-24T05-23-37-774Z.json`。没有重跑旧A整链、445/build或60秒超时；未变transport超时/未解决池门禁分别复用A独立与HUMAN已审产品证据和源码核对，不冒称本轮实测。实际浏览器与真实语义留真实B阶段。

## 主Agent准确放行接口

先按施工交接执行CLI prepare、serve、bindings B；命令前缀 `node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs`。prepare创建新的B隔离session和134字符Raw，bindings原样输出rawId与SHA `d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515`。不复用A session或ID。

release字段按卡：sessionId、stage:B、released:true、issuedAt、allowedSequences:[225,226]、maxCalls:2、cardSha256:`252f13c7e63306967e326b1b1736d8ab0b5ac9e50bfd479c38a87b7a6d5b0b0a`、adapterFreezeSha256:上述freeze、previousEvidence:{path:`docs/reports/KB02-K204-B-AUDIT-20261024-engineering.json`,sha256:该文件精确SHA}、bindings:原样输出。主Agent签后执行`arm B <绝对路径> <精确SHA>`，arm零请求；实际Chrome固定Raw点击生成草稿一次，提取/动态规划属于同一release。

端口/root看新lab.json；status可安全读取，export仅本进程已持有秘密扫描上下文时使用，stop关闭自有服务。未进行实际Provider探测，真实可用性不能由本报告保证。真实候选先独立核事实/主题，必要按HUMAN显式改组；全页审查、确认、刷新/重开/磁盘与幂等之后才签B阶段PASS。模型原自动主题与人工成功分别记录，B完成仍不能替代C或KB02整体验收。
