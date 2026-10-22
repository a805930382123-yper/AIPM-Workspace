# Q01 施工校准与首败保留

仅本地fake、隔离虚构资料、旧脱敏响应离线读取；真实新增0。以下首败均保留，最终结果只引用最后冻结版本。

1. 最初直接运行 `node --import tsx --test tests/kb02-extraction-contract.test.ts tests/kb02-r2.test.ts tests/kb02-planning-budget.test.ts`：18项2通过16失败。新增fixture漏传chunkText必需参数，报maxRawChars undefined；旧存储回归同时在沙箱临时目录原子rename报EPERM。补齐fixture分块参数，使用未改产品的FROZEN_BUDGETS。该次输出见本聊天工具记录，不伪称有独立完整日志。
2. [targeted-1](KB02-R2-Q01-20261018-builder-targeted-1.json)及同名log：修正fixture后的同范围21项5通过16失败，均为沙箱rename失败。按工具审批同命令复跑得到[targeted-2](KB02-R2-Q01-20261018-builder-targeted-2.json)：20/21。
3. targeted-2唯一业务断言失败来自本次新增测试误将整个outcome（包括精确locator证据quote）当作业务事实栏。原有locator可跨多个atom，合法业务事实所在原文连续片段可以同时包含声明；本轮不改变定位协议。将新增断言校准为document、source_facts、open_questions、ai_organized、ai_inferences均不含声明，并保留planner完全不含声明、checkpoint有独立sourceNotes及证据精确对应原文的断言。原有断言未删除或弱化。[targeted-3](KB02-R2-Q01-20261018-builder-targeted-3.json)21/21。
4. standards/http/security命令均先在默认沙箱执行；服务初始化rename EPERM导致业务未进入。保留[standards-sandbox](KB02-R2-Q01-20261018-builder-standards-probes-sandbox.json)、[http-sandbox](KB02-R2-Q01-20261018-builder-http-sandbox.json)、[security-sandbox](KB02-R2-Q01-20261018-builder-security-sandbox.json)。前两项完整启动错误在工具记录，security报告含完整错误。随后各自同命令获工具审批后通过2/2、4/4、28/28。没有更换工作目录、改ACL或产品来绕过审批。
5. [fullsuite-command-1](KB02-R2-Q01-20261018-builder-fullsuite-command-1.json)及同名log：默认沙箱创建临时副本node_modules junction被EPERM拒绝。审批后同命令进入完整suite；[pre-migration完整结果](KB02-R2-Q01-20261018-builder-tests-writable-copy-pre-migration.json)258/259、0skip，唯一失败是旧tests/llm.test.ts明确要求revision 3，新代码已升级4。保留[pre-migration冻结](KB02-R2-Q01-20261018-builder-pre-migration-frozen.json)及完整log，只把该一行严格正则版本3迁移为4，前缀和12位hash约束不变。产品字节没有再次变化。
6. 重新冻结后[fullsuite-command-3](KB02-R2-Q01-20261018-builder-fullsuite-command-3.json)完整259/259、0skip。[build-sandbox](KB02-R2-Q01-20261018-builder-build-sandbox.json)：tsc通过，Vite在沙箱下无法沿临时副本junction解析react/jsx-runtime，保留[vite-sandbox](KB02-R2-Q01-20261018-builder-vite-sandbox.log)。工具审批同命令复跑[build-command-2](KB02-R2-Q01-20261018-builder-build-command-2.json)，同冻结tsc和Vite均通过。

所有权限请求均由真实默认失败触发，无自动审批拒绝；没有生产操作、真实Provider请求或为测试更改实际配置。最终日志中的React既有受控/非受控警告没有造成测试失败，本轮未扩大到UI整治。
