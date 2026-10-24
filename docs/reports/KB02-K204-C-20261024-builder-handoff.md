# K204 阶段 C 施工交接

施工、自查及冻结完成，交 Astra 独立工程复审。**真实调用0，知识226/500、Prompt15/24保持。** Sol没有读取真实.env、配置探测、实际Provider外发或创建真实C会话/release。阶段C真实质量与Chrome全过程未测；不签C或KB02通过，原自动主题FAIL保留。

基线 `a9479b3348de605383811f4508d36cd7d45baeb2`、产品60f83ad；[C卡](../handoffs/KB02-K204-C-20261024-task.md) SHA `66127c6c699602945dbdcf959fddca233cf4074a0f9c07c6927c3a79f70de7f2`。只新增C施工前缀四模块及证据，没有改产品、依赖、rules、配置、正式workspace、旧A/B/BR/PREP冻结或其他Agent/外部AGENTS/.agents/AGENT-ROUTER文件，未执行Git。

## 最小实现和冻结

core由已审B发送器窄复制，固定C、227–241、最多15；前14次只许生产提取，第15次只许规划，并核实际checkpoint已有14个完整块。保持实际生产Provider/wire、输入/冻结/release核验、pending/fsync后发送、秘密扫描和网络守卫。新增本轮所需在途≤2守卫和实测计数，失败后禁止新发送，在途结果仍按原序号持久保存。

server使用现行ExtractionRunner/Raw/Draft/Wiki/提交逻辑，独立root与空checkpoint，候选完成必须检查job.status。实际生产KnowledgeRoutes提供duplicates及create/defer，update决策/模型更新/综合/其它未授权写路由拒绝，避免B曾漏接非模型路由。没有复刻简化UI或返回假空候选。cli沿既有prepare/serve/bindings/arm/status/export/stop，Vite沿BR的envFile/configFile关闭、显式空闲端口与strictPort。

**生产配置允许最多2，当前冻结pipeline for/await实际正常并发1。** 没有修改产品并行化。两在途只在独立fake守卫探针模拟，不冒称正常生产双并发。真实最多15只是用户范围，工程PASS后还须主Agent独立C release和Chrome显式触发一次。

[freeze.json](KB02-K204-C-20261024-freeze.json) **213项**，SHA **`1cc61bd3c7278f785e82b811d27e86e15dc01aae1058885fb5b0f10921e8a745`**。覆盖新C四模块/卡、BR207冻结及原BR freeze；实际复用PREP support、产品、规则、fixture/spec均在内。全部文件开测前与最终回读均无漂移。

| 模块 | SHA256 |
|---|---|
| cli | `2ed3c04fd49754cea9fa0d272e48d3984333e3b8fa66e3562b6c36f7a15e2061` |
| core | `9304c0e42135f01b83809e9b5edb36d287271acf98a1dbd7549af7508174ae2f` |
| selftest | `d88e1766e1d5db9f7c96f804367bdf2b7afbe5562601dc03c8f7d74e4c44311a` |
| server | `08cdb01d390d0b888dd721c045c2e211360d8c38d06f78e7e4bc60aaa6724e8f` |

## 实测命令、计数和限制

Node **v25.2.1** / Windows：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-C-20261024-cli.mjs selftest
```

最终 [selftest-06-26-24-284Z](KB02-K204-C-20261024-selftest-2026-10-24T06-26-24-284Z.json)：**exit0，15组**，UTC06:26:24.286–06:26:37.391，13.105秒；正常空checkpoint **15fake**，全套独立fixture共 **23fake**，真实始终0。原始 [06-26-08-533Z失败](KB02-K204-C-20261024-selftest-2026-10-24T06-26-08-533Z.json)保留：沙箱localhost EACCES、0fake/0real，之后自动审批允许同字节本机隔离重测；没有为此改代码或断言。没有本轮实现失败或重试真实请求。

| 验收ID | 施工自查实际证据 |
|---|---|
| C-E01 | 原106400字符/293828字节/SHA及生产14块/spec冻结检查；空job且没有checkpoint目录起跑。GET/未release/错阶段、flag/env、错session/input/card/freeze/release SHA均拒绝，loader/send0。 |
| C-E02 | 生产正常14提取+1规划、227–241唯一pending序号、每send前落账。checkpoint14块/15 attempts/plan完整，正常maxInFlightObserved1。重复点击恰202+409、重复进程拒绝；额外提取/其它Raw/update/synthesis/prompt和完成后Provider拒绝。 |
| C-E03 | 第3块HTTP成功但产品schema失败，仅3次无第4块/规划；未知来源和假秘密首次即stop。账本失败0send、响应落盘失败1次占额；pending227重启stop/config0/send0。独立两个已在途请求，首个HTTP503时两次227/228均计账、第二个结果保留，后续complete拒绝，实际guard并发2。 |
| C-E04 | 实际DraftReviewPage/jsdom/localhost覆盖全部实际页面加载查询、保存查询、确认前查询。模拟queries失败时全页已审仍无正式写；恢复后defer/create清全审、update decision拒绝，全部14页明确审查后正式创建、刷新服务回读。真实相似候选从刚创建的Wiki返回score≥0.35，非假数组。原同confirm reused:true且root全文件SHA不变，模型计数仍15。 |
| C-E05 | 逐Raw14区域核各自月份/100/11–24及对应百分比/未知负责人/未来AI，非本区域文字不能串页。全部实际unit/member ID与checkpoint原ID集合相同且唯一，Raw全对象不变。fake这次产生14页/42unit/81member，只是此次合成输出，不固定真实数量，不用旧55/101作门槛。 |
| C-E06 | 假秘密只hash/withheld，安全导出无假秘密、private排除；精确网络守卫、本机redirect/二次options/custom dispatcher拒绝，实际未登记sink命中0。213源码/依赖最终无漂移，旧资产未改。 |

组件记录210次duplicates调用，包括模拟失败及React effect产生的重复查询；这个数量只是本次观察，不是验收阈值。正常加载、保存、确认前查询的必经行为才是覆盖依据。正常全页fake确认创建Source+14页共15正式记录，仅隔离fake root，不是实际用户知识。

本次不重跑445/build、旧A/B整链、真实质量或语义实验。生产60秒单次/600秒总限/2MiB保持；旧已审Provider超时/截断处理及关服取消分支保留，本轮没有重复60秒超时等待或C独立截断探针，不能称这些本轮再次实测。首失败不继续和响应持久化分支有本轮窄证据。wrapper/in-flight计数与sink是限定过程证据，不宣称全进程网络遥测。

最终 [API/UI smoke](KB02-K204-C-20261024-fake-app-smoke.json)：独立API61837/UI61840、实际Vite HTML和转换 `/app/main.tsx` 200，UI代理的 `/api/health` 与 `/api/raw` 200。envFile/configFile关闭、strictPort；仅GET，configReads0/sent0/账本空。只是HTTP配对检查，不冒称Chrome。随后执行 `stop fake` 成功，父服务exit0；全部自查服务/最终fake API/UI已关闭，隔离root与失败证据保留。当前无C服务交接。

## 真实入口供主Agent工程签收后使用

命令与B等价，**prepare不带real参数**（卡中的示意命名未作为新flag实现）：

```powershell
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs prepare
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs serve
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs status
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs bindings C
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs arm C <release绝对路径> <该文件精确SHA256>
```

prepare仅验证全冻结，wx创建新 `.scratch-KB02-K204-C-20261024-*` session与固定long Raw，写 `KB02-K204-C-20261024-session.json` 和 `release-C-template.json`，后者released:false；不读取真实配置/发请求，不覆盖既有真实session。serve只重用该manifest，输出独立API/UI并保存本轮lab.json，不自动提取或恢复；活进程server.lock拒绝第二服务，崩溃running/pending会永久stop。GET/刷新/重开0调用。UI禁读env。

bindings原样输出实际rawId及SHA，不猜ID。唯一C release如下：

```json
{
  "sessionId": "prepare生成的id",
  "stage": "C",
  "released": true,
  "issuedAt": "ISO时间",
  "allowedSequences": [227,228,229,230,231,232,233,234,235,236,237,238,239,240,241],
  "maxCalls": 15,
  "cardSha256": "66127c6c699602945dbdcf959fddca233cf4074a0f9c07c6927c3a79f70de7f2",
  "adapterFreezeSha256": "1cc61bd3c7278f785e82b811d27e86e15dc01aae1058885fb5b0f10921e8a745",
  "previousEvidence": {
    "path": "docs/reports/KB02-K204-C-AUDIT-20261024-engineering.json",
    "sha256": "该独立JSON精确SHA256"
  },
  "bindings": {"rawId": "bindings实际输出", "rawSha256": "a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7"}
}
```

独立JSON须本轮C-AUDIT前缀、stage:"engineering"且pass:true，任何版本漂移在配置加载之前拒绝。arm只消费一次release、不发送。随后主Agent在Chrome固定Raw点“生成草稿”一次；最多15次、无重试/诊断余量，不逐send额外人工批准。14提取成功且产品解析/checkpoint通过后才允许规划。先独立检查原始候选事实/质量，再由主Agent明确HUMAN纠正（若需）与全页审查/选择/确认；selftest自动操作仅fake，不能审真实候选。

```powershell
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs export
node --import tsx tests/acceptance/KB02-K204-C-20261024-cli.mjs stop
```

安全export要求本进程已持有当前已知secret扫描上下文；重启后尚无该上下文时拒绝导出，不为导出加载配置。请求仅无header body/hash/实际持久Raw/job/checkpoint与release绑定，private响应不导出。首次有效配置身份hash在忽略session固定，后续漂移停止；secret回显只安全摘要，FAIL不伪装成功。

首失败立即停止，不修产品、不重抽/续发或追加规划；已在途仍占额并保留结果。停止服务在运行态先stop/cancel，不能等待中补规划。旧A/B/BR权限与预算不能启动本C；本C也不能update/synthesis或其它功能。

工程签收、真实输出质量和Chrome全过程待Astra/主Agent；本轮施工自查不能代签C或KB02。全批结论需独立结合A/B/C/HUMAN/既有acceptance裁定，原自动主题FAIL继续分别记录。子Agent token计量不可得。

本报告落盘后停止C施工源码和报告写入，交Astra独立复审。
