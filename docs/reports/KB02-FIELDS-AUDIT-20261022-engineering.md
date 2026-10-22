# KB02 FIELDS 独立工程验收

工程门槛 **PASS**。本轮字段职责说明、严格拒绝与兼容安全实现符合批准范围；真实模型是否纠正原type/category混淆尚未实测，F-KB02-EDGE-PLAN-01最终关闭待真实原例。**KB02整体仍未通过**：原短文、106400字符14区域及补充更新的真实Chrome完整链尚待主Agent另行放行。真实外发0，累计163/200，Prompt15/24；搜索竞态旁支未修。

基线HEAD `ea36a52ff81ab751149ca3a1d970803b02eca18a`，原产品提交 `420e123997c9fffc179af7bf32bd361ed341b9a9`。冻结时间2026-10-22T15:11:14.676Z；冻结对象紧凑JSON SHA256 `b1848a96dbd86cb725af5417d8ea0fdaf57782c07bbd1517da9069fd21161d68`，frozen.json原文件字节SHA256 `151f0f51dda7cf0ae1e8bc9543f8df79648cf098781847f9ce1dcd402406eb25`。二者序列化不同，产品哈希一致。未提交的新产品由该冻结绑定。

## 实际独立结果

2026-10-22T15:18:49.575Z开始，在字节一致临时副本运行 `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-run.mjs full`。副本不含正式workspace或.env.local；配置/正式资料不参与测试。独立runner补齐原baseline的根package/tsconfig等文件，绑定全部100产品文件，并覆盖已批准2文件最终哈希。起止 `copyMismatch=[]`、`afterCopyChanges=[]`；[完整命令与逐项结果](KB02-FIELDS-AUDIT-20261022-full-latest-run.json)以及同时间戳日志均保留，未发生本轮独立失败或重跑。

| 实际命令（均在隔离副本） | 结果 |
|---|---|
| Node25.2.1 `--import tsx --import ./tests/support/css-stub.mjs --test <52个默认测试文件>` | 389/389，0 fail/skip/cancel |
| `node node_modules/typescript/bin/tsc -b` | exit0 |
| `node node_modules/vite/bin/vite.js build` | exit0 |
| 同Node测试入口：FINAL-REPAIR历史boundary | 2/2 |
| SOURCE独立boundary、EDGE独立boundary | 2/2、4/4 |
| `KB02-FIELDS-AUDIT-20261022-boundary.test.mjs` | 7/7 |
| `C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe --version` | v24.19.0 |
| Node24同测试入口，SR01八文件 | 51/51 |
| Node24同测试入口，FIELDS/EDGE/SOURCE/KB02/B05等十一文件 | 110/110 |
| `node tests/acceptance/KB02-FIELDS-AUDIT-20261022-integrity.mjs`（前后各一次） | PASS |
| `git diff --check` | exit0，仅正常LF/CRLF提示 |

全部测试零跳过。旧版运行只覆盖上述受影响/SR01子集，未声称Node24全默认集实测。

## 规范与需求分别复核

规范：PASS。只改批准2产品、6个当前revision断言，新增1字段测试；其余默认测试和历史夹具保持字节。planning system动态来源来自当前schema枚举及FMCG，未硬编码seq148业务数据或ID。FMCG原文纳入revision10指纹，旧revision9以及标签/描述单独变化的旧checkpoint在调用/写入前409拒绝；旧完成草稿、显式restart、预算/取消恢复回归通过。未修改Provider wire、schema、unit、UI、持久结构或重试方式。

需求：工程范围PASS。type/category职责独立，示例仅在当前两组枚举内使用；AI主题不强制concept。原seq148非法响应仍LLM_SCHEMA_INVALID、保留4事实/1问题无plan；合法entity/ai_application及business_process/ai_application保存并恢复验证，非法持久type拒绝。请求/全覆盖/同源归属/旧原例保留由默认与历史probe共同覆盖。新增system known-secret及不适用示例规则均在planning checkpoint写入和beforeCall之前拒绝；7项独立probe确认零Provider调用、零写入且attempt不变。规则元数据的label和description变化使指纹变化，并拒绝旧记录。

192KiB维持原契约：限制 `planningJson` UTF8字节，包括sourceContexts、unit和显式coverageFeedback；不包括system或完整HTTP envelope。此轮未扩大/缩小该既有预算定义。PLAN-04两项超限用例与规划累计预算在默认/Node24回归均通过；未声称192KiB为整个请求上限。

## 保护与证据限制

[独立完整性](KB02-FIELDS-AUDIT-20261022-integrity.json)检查3236份受保护证据、62份正式workspace、5份配置，变化/新增均为空；产品、默认测试精确范围与最终冻结一致。正式workspace/密钥/配置未写；本验收者未写产品/default tests/status或Git。

施工首次在正式cwd执行曾因读取.env.local导致E04-01首败（387/388），并覆盖两份旧报告。独立核对两份恢复字节与本轮事前baseline一致，原副作用副本与hash已保留。施工首轮静态stdout曾被后续隔离日志覆盖，故**首轮完整stdout证据不完整**；首败JSON及施工说明仍在，不能把那些日志当原始失败完整记录。本报告通过结论来自本轮独立隔离执行，而非覆盖后的施工日志。此事件是已恢复保护偏差，不是未发生过。

后续仅待真实门禁，按短文→Chrome显式创建与人工备注→长文→补充候选/选旧目标/预览语义复核→显式确认/刷新持久回读执行；不以提示词说明或离线假响应推定模型可靠性。