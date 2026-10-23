# K204-PREP 独立审查：P04网络守卫可绕过

2026-10-23，Astra medium独立验收子Agent。当前准备工具 **FAIL（P04）**；KB02整体仍 **BLOCKED / 真实质量NOT_RUN**。这是新验收工具的防外发边界缺陷，不是产品功能回归，也没有实际真实外发。正式独立完整链暂缓至修复冻结后，不为已知失败版本重复整套。

受查HEAD `5de67e33e19d4dce3ca650c8c5ee9f1c472970ba`，产品 `60f83adba102d887fcd925df13a8021ff7669de1`；Sol冻结文件 SHA `36edb7ad8d449ca3a2a26c9a95eb35838bff399575d1823946b77754d20bd403`，19项aggregate `20608caf17180b3b0ed9d8dd1f0e58998c39212b3147b1b28c2cb964a07db52b`。该标识来自交接，后续收尾还须逐文件核验。

## 实测复现

独立脚本 [network.mjs](../../tests/acceptance/KB02-K204-PREP-AUDIT-20261023-network.mjs) 只创建两个127.0.0.1服务器A/B，将A登记到allowlist，B不登记。

1. `fetch(A + '/redirect')`：A返回302指向B。守卫只查起始URL，原fetch默认跟随重定向；B收到1次，返回200。
2. `http.request(A + '/original', {port: B.port, path:'/override-target'})`：守卫仅查args[0]，原Node客户端以第二参数覆盖端口；B收到1次，返回200。
3. 两次守卫仍报告`externalSent:0, blocked:0, localRequests:2`。externalSent是初始化后未由真实传输更新的常量，不能当作独立外发计量。

实际命令：`node --import tsx tests/acceptance/KB02-K204-PREP-AUDIT-20261023-network.mjs permitted`，Node v25.2.1，获自动审批后仅localhost连接，**exit1，redirectHits=1、overrideHits=1**。证据：[network-permitted.json](KB02-K204-PREP-AUDIT-20261023-network-permitted.json)。服务器均finally关闭，真实Provider调用0，外部主机连接0，知识219/500不变。

首沙箱运行遭本机connect EACCES、fetch failed，B未收到请求；初版独立探针仅按hits=0写pass=true，判据不足，原 [network.json](KB02-K204-PREP-AUDIT-20261023-network.json) 原样保留且本报告**明确否定其PASS效力**。它只能说明沙箱阻止本机连接，不能证明应用守卫工作。随后收紧探针且获准本地运行，确定应用自身绕过。没有改产品或Sol资产来复现。

## 最小返修建议（交主Agent派Sol）

- 仅修改Sol所有权的support网络守卫和相关离线验证/新交接证据，不改卡/spec/产品/历史报告。
- fetch保证不能自动跟随重定向到未登记目标；可以强制`redirect:'error'`，且调用方init不能覆盖，或逐跳检查。回归使用本地注册A→未注册B，B必须0命中。
- http.request/get必须校验最终有效连接目标，或明确拒绝所有会覆盖连接目标的重载参数；至少覆盖本例第二参数port/host/hostname/protocol，审视自定义agent/createConnection/socketPath等旁路。不以仅检查args[0]满足接口保证。
- 报告区分“调用前拒绝/登记的请求尝试”与“实际传输计量”；不要把未计量的externalSent常量作为零外发证据。范围内可依据无真实transport的静态闭包与本地服务器观测交叉证明，不宣称能约束任意恶意代码。
- 原12项模拟/22fake保持。新增两条本地绕过负例及允许localhost正常请求正例，防止通过全部网络禁用来蒙混过关；环境EACCES列BLOCKED，不算守卫PASS。
- Sol修复自查后重新冻结停写，再由Astra独立复跑两条负例及最终完整入口。此前整链22fake是历史工具版本证据，不自动覆盖最终返修版。

准备中所有真实approved仍false；此返修不授权创建真实执行入口、Provider探测或新增真实调用。
