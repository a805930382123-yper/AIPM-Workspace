# SYN01-VERIFY 244入口施工交接

2026-10-26，Sol High。按Astra冻结卡完成V01–V02施工/自查，现冻结停写，待Astra独立工程验收。HEAD `fcd0e23953e872d3f2bf733ef6d71617b7c98045`；产品SHA仍 `eab0d663fb83835474f65fbaecd26df1a503d773dd26f2a7138c8dc7635a2032`。真实0、实际配置读取0、知识243/500、Prompt15/24；未准备真实会话或签真实release。

只新增VERIFY四工具及本轮报告。core/server/cli对RECHECK的差异经一次离线逐字规范化assert验证：**仅命名前缀、私有控制路径、243→244序号、242→243起账替换**。预占wx+fsync、配置读取顺序、秘密保护/导出、固定输入与生产API路由均无机制变化，旧文件/242/243账本、产品、配置不改。新入口固定sequence244/maxCalls1/knowledgeBefore243，未建设245/246调度，不把本轮最多3次授权变成自动重试。

## 最小自查与受测冻结

实际命令（Node v24.20.0，Windows；本机服务/tsx子进程用现有执行权限）：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-VERIFY-20261026-cli.mjs smoke
```

唯一新增smoke **exit0**，报告时间08:15:25.422Z→08:17:59.722Z，154.300秒；[JSON](SYN01-VERIFY-20261026-smoke-1793002525434.json) SHA256 `31e49d1e3371da8ae71b65342c06d0a157cd35292332c2c7a0017fb0d1554fa8`。2个顺序检查组：

1. 当前产品/本卡/新入口冻结，旧RECHECK根前缀拒绝，244起243固定，未arm生成拒绝且0调用，匹配唯一fake release；实际Vite main/App与API代理可读。
2. 实际App选固定双Raw→当前SEM提示/v1生成→已有attempt拒第二次→明确审查/保存→GET候选及export。仅1次内存fake，configReads0；候选仍pending_confirmation、approval1，正式Wiki0、确认按钮可用，Raw文件未变。没有重复正式确认/重启/故障矩阵。

completed/pending/failed及重启不重派沿用RECHECK独立有效证据及本轮精确源码等价结果；不冒称本轮重跑。此次Vite自动避开现有5173用5174，未触碰已有服务；自有Vite/API/DOM全部关闭，process session90784 exit0。隔离fake数据保留gitignore的VERIFY scratch根作证据，不能当真实会话执行。

108项新冻结aggregate **`0abd0b2cf140a3a0f0c8e44daa23346ae420373a18cc5e83a387822f5bf51a3f`**，运行前后一致，包含当前产品、PREP依赖/原fixture、只读FIX fake helper、本轮四工具及卡。任务卡SHA `51cff955a0eef264f1cf87fa819877d5c4e804a726583c0d0f7aba024ee54d3b`。

| tests/acceptance/文件 | SHA256 |
|---|---|
| SYN01-VERIFY-20261026-core.mjs | 8dffc2430ee3028cd429728cc377c31a81de3d361a2398259c8ebe9e46eeecb1 |
| SYN01-VERIFY-20261026-server.mjs | ba6995fa30d9e610a7f8569b95f5773bb47fb04b43deb5b62f50248380fd83b3 |
| SYN01-VERIFY-20261026-cli.mjs | 4f2752321c2b52ac8cb1d4147d64d053fdf7ec9a022ab460501c1fdaca720888 |
| SYN01-VERIFY-20261026-smoke.mjs | e7f6189fd50c9d7347fc464aa71dba11291f277aa7f4c34603b363e33efef39c |

`git diff --exit-code -- services app server rules`及`git diff --check` exit0。未跑tsc、SEM、旧2/13/33/3、全量或Vite构建，未改主状态/Git；外部AGENTS/.agents/AGENT-ROUTER修改保留。本轮没有产品失败或测试返工。

## 主Agent最短CLI及释放条件

Astra独立工程通过、Chrome可用后，核本卡/产品/108冻结及固定双Raw，再由主Agent新prepare/serve；两步均不读实际配置或自动外发。使用实际返回的manifest/control/url，不能使用上面的fake根。

```powershell
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs prepare
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs serve <新manifest>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs bindings <controlFile>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs status <controlFile>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs arm <controlFile> <主Agent新releaseFile> <实际SHA256>
# Chrome使用serve返回url，固定双Raw只单击一次生成
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs export <controlFile>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs status <controlFile>
node --import tsx tests/acceptance/SYN01-VERIFY-20261026-cli.mjs stop <controlFile>
```

arm前status应knowledgeUsed243、configReads0、attempt=null；固定Raw及freeze匹配。主Agent唯一release结构，bindings整对象精确复制该会话实际输出：

```json
{"released":true,"issuedBy":"main","issuedAt":"实际ISO时间","mode":"real","sessionId":"新prepare返回ID","sequence":244,"maxCalls":1,"bindings":{"samples":[],"freezeSha256":"实际值","cardSha256":"实际值"}}
```

attempt244先落不可变pending后才读配置/请求，失败/未知也计244；不能删账本或重建会话绕过预算。原稿生成后立即export保留原response/candidate-original并交Astra裁定；completed只代表合法候选，不代表质量通过。结构/来源/语义失败都停止；若核心语义再失败，必须转策略/需求审视，不能用245/246反复加提示抽签。245/246只保留授权余量，没有本轮当前执行目的/预签release。

只有原稿质量通过才Chrome明确审查、保存、正式确认及刷新回读两Source/综合页、来源/日志与Raw不变；原稿与人工编辑分列。保存故障不靠重新生成解决。最后export/status/stop并关闭自有标签；最高累计246不是必须用完，首成功闭环即结束。

独立只复跑新精简smoke并写自有前缀：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --input-type=module -e "const {smoke}=await import('./tests/acceptance/SYN01-VERIFY-20261026-smoke.mjs'); await smoke({reportPrefix:'SYN01-VERIFY-AUDIT-20261026-'});"
```

当前仅入口工程施工自查完成；真实V03–V05未执行，旧243语义FAIL、SYN01/全产品未通过保持。Sol停写交Astra，由主Agent放行真实/Chrome/状态/Git，不自行宣布批次通过。
