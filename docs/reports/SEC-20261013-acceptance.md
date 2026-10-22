# SEC-20261013 安全返修独立验收

2026-10-13。**本批 PASS；S-03/S-04 CLOSED。** 用户授权 GPT-6 Luna High 施工、主 Agent 独立检查。只关闭本批已知凭证保护缺陷，不签全项目 PASS；原36项真实 Provider 成功/质量仍 BLOCKED，会议来源保持 local_only。未部署、未配置真实 Provider、未推进下一批。

## 实际变更与版本

仅修改五处产品服务：`services/llm/provider.ts`、`service.ts`、`jobs.ts`、`services/wiki/knowledge-workflows.ts`、`services/prompt-ai/service.ts`；新增 `tests/security-output-sec.test.ts` 三项测试。详见[施工交接](SEC-20261013-builder.md)、[冻结指纹](SEC-20261013-frozen.json)。主Agent及两轴审查方未改产品代码。

共用递归门禁检查 Provider 持有的所有非空已知凭证，无短凭证长度下限；检查解析后字符串值及键，覆盖数组、嵌套和JSON转义。知识更新/综合、Brief/生成/优化及每次提取chunk/merge响应在schema或字段转换前拒绝；最终提取outcome另有防御检查。错误码、消息、details及键脱敏，非法JSON诊断先脱敏完整文本后截取，拒绝消息不带命中路径/片段。失败不写新草稿或正式资产，提取任务与Raw处理状态明确failed。

## 独立结果

全部运行使用 Windows / Node v25.2.1、隔离临时数据和本地 fake/虚构凭证，无真实外部模型。命令、耗时、汇总及进程关闭见[证据汇总](SEC-20261013-evidence.json)。各组独立计数，不加成需求项总数。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 独立 `npm run build` | PASS，exit 0；保留既有Vite bundle >500kB提示 | [build](SEC-20261013-build.log) |
| 独立 `npm test` | 204/204 PASS，19.915秒；正常本机权限，无os.userInfo shim | [tests](SEC-20261013-tests.log) |
| 六链实际产品HTTP/真实适配器→本地fake | 有效98/98 PASS | [HTTP](SEC-20261013-http-final.json) |
| Audit实际HTTP关联回归 | 2/2组PASS；每组1干净proposal及4拒绝场景，旧pending草稿字节保护 | [Audit](SEC-20261013-http-audit.json) |
| 多凭证直接产品服务 | 113/113 PASS；包含短/长、引号/反斜线、Unicode/emoji及单字符、空secret、正常输出、错误details及Audit回归 | [services](SEC-20261013-services.json) |
| 既有B05更新/综合HTTP回归 | 11/11 PASS，报告另存，原脚本未改 | [B05](SEC-20261013-b05-regression.json) |
| Standards独立静态轴 | PASS，0 actionable findings，6审查文件冻结一致 | [Standards](SEC-20261013-standards.md) |
| Spec独立轴 | PASS，0 actionable findings，43/43独立内存探针；不计入主Agent113服务场景 | [Spec](SEC-20261013-spec.md) |
| 正式数据/历史/冻结保护 | 1226保护文件零变；79产品/50测试冻结一致；B04两份历史输出已恢复 | [integrity](SEC-20261013-integrity.json) |

### 关闭依据和门禁映射

- **S-03 / SEC01–02 CLOSED**：更新和综合分别经实际HTTP确认长/短凭证值、转义、键、嵌套键、合法嵌套字段拒绝为502/LLM_OUTPUT_CONTAINS_SECRET；原Raw/Wiki/Library/草稿摘要不变。多凭证服务检查及干净重试通过。
- **S-04 / SEC01–03 CLOSED**：Brief、生成、优化及提取覆盖同一矩阵；提取202只表示任务启动，最终job failed、无draftId且Raw退出processing。短凭证错误回显和非法JSON前缀不会进入HTTP/job/磁盘/进程日志。正常重试completed及待审草稿成立。
- **SEC03–04 PASS**：首个受污染chunk只允许已发的第一并发波次（2调用），不进入后续wave/merge；干净三chunk汇总输入无凭证，受污染merge输出拒绝，同根干净重试完成。旧pending草稿字节保留；Prompt显式收藏/优化新版本/回读一致，预览不改正式资产。Raw摘要损坏409且零Provider；实际会议登记后提取/综合403且零Provider。B05确认/冲突/故障恢复及人工编辑保护11项通过。
- **SEC05–06 PASS**：独立完整检查、两轴审查、冻结/正式数据/历史证据保护通过；自有产品服务与fake关闭。当前矩阵只将R41由FAIL更新为PASS，保留其它行的明确历史复用及36项BLOCKED。

## 校准与实际限制

返修前基线实际确认8条失败：长/短凭证更新/综合、短凭证Prompt三入口与提取；同根早期泄漏污染的4条后续长凭证观测记INVALID，不作产品新增FAIL。[基线](SEC-20261013-http-baseline.json)、[原观测](SEC-20261013-http-baseline-calibration.json)。

冻结后HTTP首跑94PASS/4无效观测：汇总fixture重复引文未给global start/end，Prompt GET回读误用非wrapper字段。修正独立脚本后仅重跑对应4项，4/4PASS，产品未改。原结果/日志保留为[校准记录](SEC-20261013-http-final-calibration.json)，[定点复验](SEC-20261013-http-recheck.json)；最终98项矩阵明确标记correctedProbe，没有把脚本错误隐藏成第一次成功。

普通沙盒tsx初始化出现uv_os_get_passwd ENOMEM；主Agent经正常本机权限运行产品HTTP/services/build/完整tests通过，未使用施工方shim。该环境问题不作产品FAIL。未新测浏览器、跨平台、最低Node或真实AI；UI未变，不追加浏览器PASS。真实Provider36项仍需另行配置和实测，本批不批量清洗历史AI草稿。已存在的M05报告/状态工作区差异作为基线保留，未覆盖。子Agenttoken计量不可得。

本批取证/施工/验收及文档收尾的总耗时见证据汇总elapsedMs，各测试实际耗时分别保留。范围内工作已完成，停止于本批签收。
