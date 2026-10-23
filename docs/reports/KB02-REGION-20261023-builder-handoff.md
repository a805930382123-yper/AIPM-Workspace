# KB02 REGION 施工自查与冻结交接

状态：**Luna施工自查完成，现停写并交Astra独立工程验收。** 本报告仅是施工结论，不签F-KB02-FIELDS-LONG-01修复PASS或KB02整体验收PASS。当前代码基线HEAD为`5be06023bb8200e82cb0131b0588601632c4e941`；施工前产品提交为`a836270f53f0fc5bb802695e3f4101cf182ee3b9`。主Agent负责后续统一检查、提交与同步。

## 实际变更

- 仅在`services/llm/knowledge-planning.ts`的`KNOWLEDGE_PLANNING_INSTRUCTION`加入主体/时间/条件/口径优先判断、独立主题标准、相同措辞跨主体归属、跨chunk合并边界、非固定页数、独立AI机制正例及同次响应自检。明确由模型在本次响应内调整分配；不指令程序事后搬移、删改或补事实，也不自动重试。
- `services/llm/rules.ts`将`KB02_PROMPT_REVISION`从`kb02-atoms-planning-10`升至`kb02-atoms-planning-11`。
- 必要适配任务卡列出的7个既有测试：`llm`、`kb02-extraction-contract`、`kb02-classification-priority`、`kb02-final-classification`、`kb02-planning-context`、`kb02-edge-extraction`及`kb02-planning-fields`。原revision4/6/8/9历史夹具与其严格拒绝语义保留。
- 新增[归属测试](../../tests/kb02-planning-attribution.test.ts)、[虚构隔离fixture](../../tests/fixtures/kb02-planning-attribution.fixture.json)及[本轮seq180内存重放脚本](../../tests/acceptance/KB02-REGION-20261023-original-response.mjs)。施工资产和逐次日志均为`KB02-REGION-20261023`前缀。

没有改build/expand/project、unit/source/schema、Provider、UI、存储兼容、预算/自动重试或依赖。共享状态、Astra和Sol前缀资产、正式workspace、`.env.local`与密钥未修改；没有模型调用或外发，真实0，Prompt累计15/24不变。

## 自查和证据

所有会生成报告、运行构建或测试的命令均在仓库内隔离副本`.scratch-KB02-REGION-20261023`运行。副本排除正式`workspace/`、`.env.local`、`node_modules`内容与构建目录；依赖以只读junction供运行。运行后对完整`app/`、`server/`、`services/`、`rules/`、`tests/`及包/构建配置共874个文件逐一SHA256核对共享工作区与隔离副本，差异0；[逐文件冻结SHA256清单](KB02-REGION-20261023-frozen.json)现另列当前完整产品、默认测试和fixtures共180条路径，以及任务scope和本Agent重放脚本哈希。并行中的Astra验收脚本作为可写资产明确排除。此前[最终副本对比](KB02-REGION-20261023-freeze-check-r2.json)只保存874文件的计数/差异结果，没有逐文件原始指纹；副本已清理，无法重建当时逐文件值，不能将新清单描述为历史复原。首轮副本缺项发现仍保留于[首轮对比](KB02-REGION-20261023-freeze-check.json)。

| 实际命令 | 环境与结果 |
|---|---|
| `node --import tsx --test tests/kb02-planning-attribution.test.ts` | Node v24.20.0；4/4 PASS、0 skip，含实际pipeline system检查、机械可接受/语义错误负例、人工主体保留方案完整pipeline接受，以及revision10检查点409/零调用/提取块字节一致。日志：[attribution-test.log](KB02-REGION-20261023-attribution-test.log) |
| `node --experimental-transform-types tests/acceptance/KB02-REGION-20261023-original-response.mjs` | Node v24.20.0；seq180原106400字节fixture及历史Provider响应在内存重放通过。14/14上下文充分，55 unit/100 ID，27边界unit（25事实/21问题ID）完整；原泛化响应仍被新pipeline机械接受，语义FAIL保留，networkAttempts=0。原磁盘revision10检查点未改；仅将旧提取块复制到内存并绑定当前revision11重放。日志及[结构化结果](KB02-REGION-20261023-replay.json)、[逐主体矩阵](KB02-REGION-20261023-source-matrix.json) |
| `npm test` | Node v24.20.0；完整默认套件393/393 PASS、0 skip。日志：[default-test.log](KB02-REGION-20261023-default-test.log) |
| `npm run build` | Node v24.20.0；`tsc -b`与Vite build成功。Vite报告一个bundle超过500kB的既有优化提示，未影响成功。日志：[build.log](KB02-REGION-20261023-build.log) |
| Node v24.19.0：8项SR01/存储相关测试 | 51/51 PASS、0 skip。日志：[node24-sr01.log](KB02-REGION-20261023-node24-sr01.log) |
| Node v24.19.0：7项既有受影响测试＋新归属测试＋历史FIELDS独立边界probe | 84/84 PASS、0 skip；覆盖revision适配、规划/字段/恢复和历史FIELDS边界。日志：[node24-related.log](KB02-REGION-20261023-node24-related.log) |
| Node v24.19.0：FINAL-REPAIR、EDGE、SOURCE三项历史独立边界probe | 8/8 PASS、0 skip。日志：[historical-probes.log](KB02-REGION-20261023-historical-probes.log) |
| `git diff --check -- services/llm/knowledge-planning.ts services/llm/rules.ts tests` | PASS；无空白错误。Git仅对7个现有测试的必要版本断言及两项产品各有一行变更；新增测试、fixture、重放脚本另列于状态中。 |

原seq180回放报告记录旧历史请求提示与当前代码提示不同；探针只断言新system实际包含revision11归属步骤，并保持完全相同的wire规划输入和原Provider响应。原Provider响应仍将不同主体的边界句归入一个泛化页。由此证明的是该响应在新提示下仍可机械通过、语义仍错；不证明提示修改已改善模型行为。

## 失败记录及限制

本轮所有首败及处置见[attempts.log](KB02-REGION-20261023-attempts.log)，包括Node test worker在sandbox内spawn EPERM、首版正对照归组漏分boundary IDs、pipeline调用次数断言错误、旧system文字断言未同步，以及首次哈希副本未包含并行新增的Astra验收脚本。相关代码/断言已按任务卡局部修复并重跑成功；首轮冻结差异也另行保留。没有未解决的施工范围测试失败。

人工正例只是隔离fake证明现schema与pipeline能表达主体分别归属，不能签模型语义质量。原seq180实际错误响应重放表明本缺陷尚未证明关闭。真实长文、短文、更新及Chrome流程本轮未运行，须按任务卡由Astra完成独立工程审查，再由主Agent另行放行真实验收；不得将本施工交接作为批次PASS依据。

产品文件施工最终SHA256：

- `services/llm/knowledge-planning.ts`: `88306c16e06a66e98bf9e6d3490fd74797a84be65799f075f6fafb26cd85d625`
- `services/llm/rules.ts`: `2651ac248a502c66a72c06761fa8b3d4c2f4e48619cfc0431e4d9b9e246ef0df`

产品/tests施工未提交，当前HEAD仍为基线`5be06023bb8200e82cb0131b0588601632c4e941`。已将副本日志、原响应重放结果及最终874文件冻结核对保存至`docs/reports/KB02-REGION-20261023-*`，并按校验后的绝对路径清理临时副本；真实外发仍为0。施工者自此停写，交Astra核对完整diff与874文件冻结，再独立复跑门禁。
