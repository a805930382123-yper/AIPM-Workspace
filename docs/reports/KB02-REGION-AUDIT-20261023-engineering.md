# KB02 REGION 独立工程验收

提交关联补注（主Agent）：本轮受测产品与测试提交为 `17121be7ec20f73b367750d281a4e1dd2c742a76`。下文基线及冻结为实测时标识，测试结果保持原文。

工程门槛通过。F-KB02-FIELDS-LONG-01真实语义修复仍待验证，KB02整体仍未通过；工程成功不能代替长文、短文和完整更新的真实验收。本轮Astra未施工产品/default tests，真实新增0，累计183/500、本阶段24上限，Prompt15/24；真实门禁保持关闭，等待主Agent另行放行。

基线HEAD `5be06023bb8200e82cb0131b0588601632c4e941`，施工前产品提交 `a836270f53f0fc5bb802695e3f4101cf182ee3b9`。本轮未提交产品绑定施工冻结[180文件清单](KB02-REGION-20261023-frozen.json)，该文件SHA256 `0ae132b7f6da31017f58326d1aaacc5b6692e3d10a28b12ba4e70ae639dd9d21`。最终提交由主Agent补关联。

## 实际差异与规范审查

独立读取实际diff：2产品只改KNOWLEDGE_PLANNING_INSTRUCTION和revision10→11；7既有测试仅迁移当前revision断言，旧revision夹具保留；新增归属测试和虚构fixture。build/expand/project、source/unit/schema、Provider、UI、持久协议、预算和重试逻辑无改动。指令明确主体优先、独立业务主题、不同主体同句不混合、同主体跨chunk允许合并、AI独立机制正例和单响应内自检，不固定14页或一主体一页，不做响应后搬移。

新增人工正对照实际调用完整runKnowledgePipeline并经严格schema；metric既是合法type也是当前合法category，不能仅因同值判非法。人工回应成功仅证明协议可表达，不证明模型会选择正确归属。原错误seq180在当前冻结规则下仍可机械接受，正是需保留的语义负例。

## 独立命令与结果

实际运行 `node tests/acceptance/KB02-REGION-AUDIT-20261023-run.mjs full`，2026-10-23T03:47:45Z开始。全部测试在新临时副本 `C:/Users/DAVID~1.CHE/AppData/Local/Temp/kb02-region-audit-LQ1i4f`，无正式workspace/.env.local；根package、lock、tsconfig、vite和index按冻结字节复制。副本运行前后expected清单无差异，完整命令及唯一时间戳日志见[独立执行结果](KB02-REGION-AUDIT-20261023-full-latest-run.json)。

| 实际检查 | 结果 |
|---|---|
| Node24.20.0 `--import tsx --import ./tests/support/css-stub.mjs --test` 全部53默认测试文件 | 393/393，0 fail/skip/cancel |
| `node node_modules/typescript/bin/tsc -b` | exit0 |
| `node node_modules/vite/bin/vite.js build` | exit0 |
| FINAL-REPAIR/SOURCE/EDGE/FIELDS历史独立boundary | 2/2、2/2、4/4、7/7 |
| Node24.19.0 SR01/存储八文件 | 51/51，0 skip |
| Node24.19.0 当前归属及受影响十二文件 | 114/114，0 skip |
| 本轮独立REGION boundary | 3/3，0 skip |
| `node --experimental-transform-types tests/acceptance/KB02-REGION-AUDIT-20261023-current-response-replay.mjs` | exit0；原seq180负例被当前规则机械接受，55unit/100ID，零网络 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-integrity.mjs`，工程前后 | exit0；3397保护项及正式workspace/config无变化，冻结180路径一致 |
| `git diff --check` | exit0；仅LF/CRLF提示 |

默认测试实测约73.4秒、tsc12.9秒、Vite8.3秒、旧Node SR01约29.3秒、旧Node相关约19.1秒；逐命令耗时已保存。未将Node24.19子集称为该运行时全默认实测。平台token计量不可得。

独立3项边界额外验证：真实历史revision10标识在Provider/保存/attempt变更前409拒绝并保整个内存checkpoint字节；新指令确实进入实际pipeline且合法business_process/ai_application不被强改，所有原ID保持；仅新instruction出现的已知秘密在调用和写入前拒绝。默认/历史回归覆盖显式restart、旧草稿读取、来源/预算/取消/恢复/字段与HTTP/更新契约。

本次原响应回归仅将旧提取检查点复制到内存并换当前rulesVersion，验证新system与旧wire不同而输入完全相同；不是生产绕过revision兼容门禁。原response仍组装15页，其业务语义仍错。结果见[current-response-replay.json](KB02-REGION-AUDIT-20261023-current-response-replay.json)，不得以其exit0签缺陷关闭。

## 证据限制与后续门禁

施工874文件对比当时只留计数/差异汇总，旧副本已清理，无法追溯重建当时所有文件hash；施工后补180清单不是历史复原。本报告通过结论来自新的独立冻结校验及独立副本测试，不借施工汇总代签。首次独立完整性命令在sandbox因报告写入EPERM失败，提升执行后成功；本轮runner全部测试首跑通过，无覆盖首败日志。实际根目录只读、报告仅本人前缀，产品/default tests未改。

真实门槛尚未运行：原短文→Chrome明确创建指标及人工备注→原106400字符长文→补充→原目标候选/预览双侧语义审核→明确确认/刷新持久回读与幂等。预计20次；每次外发事前计账，无自动重试，剩余4不自动使用。长文逐主体审核数值日期和未知/未来边界、全部ID/unit一次归属、独立主题依据；保留所有启发式issues并逐项写理由，禁止以固定页数或单一approved布尔值替代语义证据。
