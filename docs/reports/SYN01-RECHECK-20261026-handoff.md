# SYN01-RECHECK 新243入口交接

2026-10-26，Sol High。完成新入口施工/必要自查，现停写交Astra独立工程审查；真实放行、Chrome和Git归主Agent。HEAD `1944a3053df9b966f9cd39b273deec76b4e60f63`；产品仍 `d0553163a09f3ac5f4681430e398e7ef2b2d934a`，knowledge-workflows.ts SHA256 `b3269a215ed042b6822a2b77320d3cd2be60d0c40797b7cce50794e8047efbc9`。真实0、配置读取0、知识242/500、Prompt15/24。未签发真实release，未准备真实会话。

仅新增4个RECHECK工具及本轮报告。复用旧REAL机制与PREP固定fixture/冻结函数，复制适配为新目录、新控制路径 `/__syn01-recheck`、新243账本和v1 fake；旧源码/响应/242控制文件全部不改。新session只允许sequence243/maxCalls1/knowledgeBefore242/prompt15，拒绝旧根目录；每次完整v1请求的Raw ID、标题、正文SHA均核对本次固定双Raw。真实分支继续沿既有配置读取/Provider适配，**仅在唯一release匹配且attempt-243以wx+fsync预占后**才读配置并请求；失败/未知也占243，重启不能重试。导出保留原稿及脱敏请求/响应，真实重启丢失秘密上下文时拒绝导出私有响应，不为导出重新读配置。

## 新增自查及冻结

实际命令（Node v24.20.0，Windows，本机服务需要当前宿主允许localhost/子进程的执行权限）：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-RECHECK-20261026-cli.mjs smoke
```

最终exit0，37.649秒（报告03:12:35.617Z至03:13:13.266Z）。[终次JSON](SYN01-RECHECK-20261026-smoke-1792984355628.json) SHA256 `1fbbb2ab6c33f1fae32977a5e30b258374f205d654d8f98cd7d7b3d0c7bd765d`。只有1次内存fake，无配置/真实调用；4个顺序检查组：

- 新冻结与实际Vite main/App/proxy，未arm生成拒绝且零调用，匹配release绑定。
- 实际App从固定Raw选择→新v1综合→明确审查/保存/确认→Wiki，读schema/references/export，Raw文件前后相同；第二次生成拒绝。候选证据保持原存储结构，响应为合成fixture，不能代签真实语义。
- 完成后的attempt243跨服务重建保留，零重派/配置读取。
- 另一个新fake会话只构造标SYNTHETIC的持久pending/failed状态，未调用Provider；两种状态重建Engine都拒绝重派。没有删除或重写真实/旧账本。

首跑因既有5173占用，在生成前失败，保留[失败JSON](SYN01-RECHECK-20261026-smoke-1792984056576.json)。Vite把port0回落到默认5173且原strictPort=true；只在新server改为自动寻找可用端口，并加listen失败时vite.close。首跑自有进程session79496已Ctrl+C结束exit1；旧5173服务不动。终次在5174成功，session16569 exit0。WikiPage/AuditPanel有异步React act提示，无断言失败；自有Vite/API/DOM均已关闭。隔离fake数据保留在gitignore的RECHECK scratch根作为证据，不是待执行真实会话。

终次108项冻结aggregate **`5c5d46175823a03b1be133a1a15889e2518360c827d53a029d6b4e925a335724`**，运行前后相同。包括产品/规则/依赖/实际入口、既有PREP依赖/fixture、新4工具、只读复用的FIX fake helper及本轮任务卡。卡SHA `abfe051dd4a1a570a80ef51b00289bf3099789fb6e57bb352a1fda38524efb16`。报告/主状态不进入源码冻结，Astra的AUDIT前缀也不改变本冻结。

| tests/acceptance/新增文件 | SHA256 |
|---|---|
| SYN01-RECHECK-20261026-core.mjs | fe797148bdcca4e110038ad1c72458307f56f1ef0e47f6e5a02018a02224abdb |
| SYN01-RECHECK-20261026-server.mjs | 25d0a04956d70a5597d95c8be6f64f03dd04a9217f1e2f25ca06ef2b0f21d985 |
| SYN01-RECHECK-20261026-cli.mjs | 83d56815b1d53424e9c9b08b2f907ed3fee36d717009fe80a68ca8170f17bd87 |
| SYN01-RECHECK-20261026-smoke.mjs | 9da2a14754bc2ace452552457643b528e94148b61da609d74a923fb411c58519 |

`git diff --check` exit0，`git diff --exit-code -- services app server rules` exit0；旧REAL四工具diff也为空。未重跑旧13/33/3、tsc、445或Vite全构建，未做浏览器探测。外部AGENTS/.agents/AGENT-ROUTER、Astra卡、主状态和其它协作内容未改。

## 主Agent最短操作及放行条件

先等Astra独立工程通过；核上面产品与108项冻结无漂移，Chrome已可用，再执行以下命令。prepare/serve不会自动读配置或外发；Vite为configFile:false/envFile:false，仅代理本会话API。所有返回路径使用实际输出，不能用smoke的fake manifest/root。

```powershell
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs prepare
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs serve <prepare返回manifest>
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs bindings <serve返回controlFile>
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs status <controlFile>
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs arm <controlFile> <主Agent新releaseFile> <实际文件SHA256>
# Chrome仅一次：serve返回url→Raw→多来源综合→固定双Raw→生成
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs export <controlFile>
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs status <controlFile>
node --import tsx tests/acceptance/SYN01-RECHECK-20261026-cli.mjs stop <controlFile>
```

新release必须由主Agent在上述条件满足后写入；`bindings`整对象原样复制实际输出，不手写Raw/冻结摘要：

```json
{"released":true,"issuedBy":"main","issuedAt":"实际ISO时间","mode":"real","sessionId":"prepare返回ID","sequence":243,"maxCalls":1,"bindings":{"samples":[],"freezeSha256":"实际值","cardSha256":"实际值"}}
```

arm前status应无attempt，knowledgeUsed242、configReads0；固定双Raw正文/标题/hash与既有fixture相同。真实生成开始即先落不可变pending；有attempt无论result为completed/failed/缺失都视为243已消耗，不能重新prepare绕过预算或删除attempt重试。不使用旧242入口，不能因失败重新签release。

Chrome生成后先export保留response与candidate-original，不编辑覆盖原稿证据。按本卡逐项核共同100、双方20%/30%、未知负责人/采样日、未来AI、每条引用和语义。失败立即保留证据并stop；结构/引用/质量失败不能人工补字段冒称原稿通过。原稿允许继续时才逐项查看、明确审查/保存/确认，刷新回读两Source/综合页及来源/日志、Raw不变；人工修改与原稿结论分列。最后export/status、stop并关闭自有Chrome标签，知识上限243/500、Prompt15/24。

独立者只跑新smoke并写自有前缀：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --input-type=module -e "const {smoke}=await import('./tests/acceptance/SYN01-RECHECK-20261026-smoke.mjs'); await smoke({reportPrefix:'SYN01-RECHECK-AUDIT-20261026-'});"
```

真实配置/私有响应不上传。源码冻结或固定输入漂移时拒绝，不为通过而改旧证据；需新方案时回主Agent。当前仅**新增工程施工/自查完成，待独立审查**；真实新协议原稿、人审保存回读尚未执行，SYN01整体/全产品结论保持。必要检查已满足，Sol停写，不继续矩阵或真实操作。
