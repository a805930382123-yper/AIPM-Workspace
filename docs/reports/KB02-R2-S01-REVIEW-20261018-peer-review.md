# KB02-R2 S01 独立限定审查

2026-10-18。Standards **PASS**，本次受控 Spec **PASS**；未发现本限定范围内需要返修的缺陷。此结论仅覆盖 S01 及下述指定回归，不是 KB02 整批质量签收。验收者未修改产品或默认测试，未执行真实 Provider 调用，未运行完整 suite/build/实际浏览器。

## 范围与静态检查

依据 AGENTS.md、当前 status、coordination、KB02-R2 当前任务卡、架构存储边界、S01 原返修卡、施工交接/精确 scope，以及 code-review 技能，分别检查规范与行为。

检查 services/llm/jobs.ts、checkpoints.ts、knowledge-extraction.ts 及新增 tests/kb02-planning-budget.test.ts；这四个文件的 SHA256 均与施工 scope 冻结一致，见 [audit](KB02-R2-S01-REVIEW-20261018-peer-audit.json)。未将旧 git HEAD 的累计共享变更归为本轮；本审查按 S01 冻结实物和明确修复点评估。

- jobs.ts:152–153：先校验 planningRetry 的完整成功块、兼容检查点、覆盖失败和诊断资格，再以前置 attempts >= limit 抛 JobError/409；其后的 checkpoint save、job update/insert、raw-state set 与后台 runKnowledge 均不执行。此前只读验证也没有状态写入。拒绝不会重置次数、创建替代 job、改写 Raw 或补齐覆盖 ID。
- checkpoints.ts:11 的共享公式为 min(128, 2*chunkCount+4)。jobs.ts:178–179 实际 beforeCall 防线继续存在，耗尽仍抛429；knowledge-extraction.ts:47 的恢复校验用同助手，超上限拒坏而等于上限仍允许读回原诊断。三处不再各自复制公式。
- startQueue 保留串行启动，成功块仍复用；规划反馈仅由显式 planningRetry 参数进入，普通继续不带反馈。S01 未引入正式 Wiki/Prompt 写入或产品运行时 Agent 依赖。
- 新默认测试有两项有效行为断言：自然失败至6次后连续拒绝与三文件哈希一致、显式restart；以及最后一次可用预算同job成功且只提取一次、累计计数和原成功块不变。此子审查仅静态检查默认测试，由主审负责完整执行。

## 实际独立执行

复制三个 builder 脚本为 tests/acceptance/kb02-r2-s01-review-20261018-peer-{standards-probes,http,security}.mjs，只替换报告前缀。独立 audit 对替换反向还原后逐字符比较，三者完全相同；没有删除、skip、放宽断言或净化秘密输入。

| 检查 | 结果与证据 |
|---|---|
| S01 正常 HTTP 自然耗尽和重复拒绝 | [standards-probes](KB02-R2-S01-REVIEW-20261018-peer-standards-probes.json)：一块2事实，提取+首次规划共2调用，再4次显式失败规划至6；连续3次立即409/LLM_ATTEMPT_LIMIT，每次Provider增量0，checkpoint/job/raw-state SHA256完全相同，完整cp/job对象、missing f-c1-2、attempts=6和成功块保留。未手改检查点。 |
| S02 取消后的迟到规划 | 同报告：到达显式带反馈的规划调用后取消，释放迟到成功响应，cancelled，plan未落盘、草稿0、Raw为unprocessed。 |
| HTTP 4项 | [HTTP最终有效结果](KB02-R2-S01-REVIEW-20261018-peer-http-initial.json)：4/4，普通继续无反馈、有余量只规划、进程重启/双请求同job、完成后拒规划、含当前秘密坏cp/旧pipeline拒绝且旧字节保留、显式restart、旧sequence39/40仅离线覆盖重放、候选到显式更新预览确认和幂等重放/双来源/人工备注保留。 |
| 安全与Meeting 28项 | [security](KB02-R2-S01-REVIEW-20261018-peer-security.json)：28/28，长短虚构凭证在提取/规划/更新阶段的值、键、转义、嵌套键拒绝，公开响应/日志/隔离持久化无秘密，资产不变及调用计数核对；正常更新对照；Meeting提取/综合403、Provider增量0。 |

执行命令均为 `node --import tsx tests/acceptance/kb02-r2-s01-review-20261018-peer-<kind>.mjs`。三个首跑均默认 sandbox，在临时隔离 wiki 初始化 rename 遇 EPERM，业务断言未运行。按 require_escalated 工具审批，以同一测试命令复跑均 exit0；没有改工作目录、环境、产品、依赖或ACL以绕过审批。首次日志分别为 peer-standards-initial.log、peer-http-initial.log、peer-security-initial.log；首跑 JSON 保存为 peer-standards-probes-initial.json、peer-http-sandbox-initial.json、peer-security-initial.json（均在本报告目录，同一完整报告前缀）。最终日志对应 peer-standards-final.log、peer-http-final.log、peer-security-final.log。HTTP脚本默认输出名含 initial，表中的该文件为复跑通过证据，真正首次失败已另存 sandbox-initial，避免混淆。

所有三个脚本 finally 均调用 h.close；最终 Standards/HTTP closed=true，安全两套 services.closed=true。该关闭函数等待自有API子进程退出、关闭fake全部连接并等待fake监听关闭，随后进程正常退出。没有停止用户服务。

## 边界与交接

真实质量、完整suite/build与实际浏览器由主审执行，本文不代签。此子审查真实外发0；原PA01独立PASS保留，已记录4项旧历史摘要异常未恢复或归因，未修改旧报告/旧脚本。不提交、部署、推进其他批次。全范围冻结/正式数据保护以主审完整性审计为准。
