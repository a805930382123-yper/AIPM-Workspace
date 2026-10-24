# K204 阶段 B 施工交接

施工完成，交 Astra 独立工程复审。真实调用 **0**，知识累计 **224/500**、Prompt **15/24** 不变；没有创建真实 session、有效真实 release、读取真实 `.env` 或向 Provider 外发。阶段 B 真实质量未测，KB02 仍 BLOCKED，C 未授权。基线 HEAD `d2176eca0632e69a9b082acbb80a1ec0523bdc56`，产品 `60f83ad`，卡 SHA `252f13c7e63306967e326b1b1736d8ab0b5ac9e50bfd479c38a87b7a6d5b0b0a`。

## 实际变更与冻结

仅新增 B 施工前缀四模块及自查/交接证据：core 窄复制 A 已审的持久锁、release、生产 Provider/wire、记账和网络限制，固定 B/225–226；server 复用生产 Raw/Draft/Wiki/ExtractionRunner/confirm 路由，移除 A2/A3 目标和 update/synthesis 接线；cli 保留 prepare/serve/bindings/arm/status/export/stop；selftest 注入本机合成配置。没有修改旧 A/PREP 文件、产品、依赖、rules、配置、正式 workspace、外部 AGENTS/.agents/AGENT-ROUTER 或其他 Agent 文件。

[源码冻结](KB02-K204-B-20261024-freeze.json) SHA **`12dad741181e7e74a95d58d2f49a24774343c6f11903b1083d7bbb4d4f6f2463`**，202 项：包含 A 冻结的 192 项及新 B 源码、复用 PREP support、卡/fixture/spec 等实际依赖。全部逐项核验通过，冻结前后无漂移。freeze 的 `BUILDER_SELFTEST_PENDING` 是开测前写入的状态，实际后续自查结果由下方带相同 freeze SHA 的报告给出；它不表示独立工程批准。

| 模块 | SHA256 |
|---|---|
| cli | `e508d5d4182ef68486dee19e9f8b03500d0242083eb8dc7ce8ab585430d7cae4` |
| core | `b2efbc9610d16189e908be29b37d744e680f1ad590250564374c5ff52d3590f7` |
| selftest | `16c2801d9a765bd212eb38c56fec53cb08e0aa3473221fc49fead59c12514e3b` |
| server | `e85849d0b5757e766a9195c6b1c801935788db4d9f1f4de5737d788e51ee2fc9` |

prepare 验全冻结后创建独立 session、134 字固定 Raw 及 released:false 模板，0配置读取/0发送。serve、GET、刷新、重开不自动启动；只允许固定 B Raw 首次提取，两个发送均走当前生产 OpenAiCompatibleProvider，name/model/cacheIdentity/secrets 透传。实际 send 前重核 release/冻结/Raw/config identity/生产 wire，先保存无 header 的 body/hash 和持久 Raw/job/checkpoint，再 fsync 唯一 pending，最后发送。动态规划由真实提取结果构建。上限2、序号225/226、顺序提取→规划，无第三次、B1 或 update。

schema/来源/截断/秘密回显/存储/超时等错误永久 stop；完成需检查产品 job.status。pending 重启停止，不自动恢复；停服在途先 stop/cancel。已知秘密响应仅保留安全 hash/withheld，可导出的安全摘要不含秘密，private 响应只在忽略的隔离 root。网络守卫保留精确 Provider 目标及登记 localhost、redirect/二次 options/custom transport 拒绝；wrapper 计数不等于全进程网络遥测。

## 实测与首失败记录

Node **v25.2.1**，Windows。本次只运行必要 B 定向验证，没有跑445/build或A整链。

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-B-20261024-cli.mjs selftest
```

最终 [selftest-2026-10-24T05-19-54-773Z.json](KB02-K204-B-20261024-selftest-2026-10-24T05-19-54-773Z.json)：exit0，17组，UTC05:19:54.776–05:20:02.728，约7.95秒。正常链2fake，全套独立 fixture 共10fake；真实始终0。

- B-E01：启动/GET/缺失与错误 release、错stage/Raw、篡改卡/冻结/绑定、retry/restart、单flag与env绕过均拒绝；对应 loader/send/账本0。
- B-E02：正常生产链恰225/226且send前pending，重复点击恰202+409、重复进程拒绝，第三次/其它Raw/update/synthesis/C/B1拒绝。Raw、5个原unit及其member/record/evidence全对象保全。
- B-E03：提取/规划schema、未知来源、截断、假秘密均stop；账本失败0send、响应落盘失败1次占额；pending225恢复stop/config0/send0；在途关闭只有1fake，无规划。
- B-E04：本机未登记sink命中0，redirect、http URL二次options、fetch dispatcher拒绝；假秘密不进入导出，私有响应排除；202冻结项前后相同。生产timeout限制保持，未重新耗时模拟60秒超时；该未变发送分支与A已审timeout机制对应，不能称本轮重跑超时探针。
- B-E05：未审confirm零正式写；编辑后清审/旧revision拒绝；全页重新审后创建Source+1 concept，重开服务和独立store回读一致。重复同confirm返回reused:true且隔离root逐文件SHA不变，模型计数仍2。这里的自动审查调用只针对fake，不用于真实候选。

首失败均保留，没有删报告或改产品过测：

| UTC | 记录与处理 |
|---|---|
| 05:18:05 | 沙箱 localhost connect EACCES，0fake；同字节本机隔离运行获自动审批后重测。 |
| 05:18:13 | 测试内部动态回引正在顶层await的CLI，形成互等，仍pending/0fake；中断自有进程，改为独立子进程检查flag/env，见selftest-harness-first-failure.json。 |
| 05:19:13 | 自查误把草稿重复确认预期成HTTP200；实际生产接口成功包括reused均201，修断言为201，继续核reused和全文件不变。 |
| 05:19:31 | 自查误预期秘密事件后安全摘要export必须409；实际只导出hash/withheld，修为检查200摘要无假秘密、标记private排除，未放宽秘密门禁。 |
| 05:19:54 | 最终同冻结字节17组通过。 |

## 供主 Agent / Astra 使用的准确接口

工程PASS后，主 Agent 才运行真实准备和服务（Sol未运行这些真实入口）：

```powershell
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs prepare
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs serve
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs status
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs bindings B
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs arm B <release绝对路径> <release精确SHA256>
```

prepare 的 session/模板采用 wx，不覆盖既有真实会话。bindings 原样输出 `{"rawId":"实际id","rawSha256":"d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515"}`。唯一真实release为：

```json
{
  "sessionId": "prepare生成的id",
  "stage": "B",
  "released": true,
  "issuedAt": "ISO时间",
  "allowedSequences": [225, 226],
  "maxCalls": 2,
  "cardSha256": "252f13c7e63306967e326b1b1736d8ab0b5ac9e50bfd479c38a87b7a6d5b0b0a",
  "adapterFreezeSha256": "12dad741181e7e74a95d58d2f49a24774343c6f11903b1083d7bbb4d4f6f2463",
  "previousEvidence": {
    "path": "docs/reports/KB02-K204-B-AUDIT-20261024-engineering.json",
    "sha256": "本轮独立工程JSON精确SHA256"
  },
  "bindings": {"rawId": "bindings实际输出", "rawSha256": "d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515"}
}
```

独立JSON须处于B-AUDIT前缀、内容stage:"engineering"且pass:true。arm不发送；随后主Agent在真实Chrome固定Raw点击生成草稿一次，生产链在同一release内完成最多225/226，不增设逐send人工放行。真实候选审查/修改/选择/确认须主Agent显式操作；不使用selftest脚本代审。

```powershell
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs export
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs stop
```

export只在本进程具有当前secret扫描上下文后允许真实导出；重启未加载配置时拒绝导出，不为导出读取真实配置。状态、Raw、草稿和Wiki回读仍可用。private响应不进入报告。根目录与会话保留用于审查，失败不重跑真实请求。

## 最终 fake 服务交接及限制

最终字节 fake API **http://127.0.0.1:55515**，UI **http://127.0.0.1:55516**；root `.scratch-KB02-K204-B-20261024-FdUPhu`，session `a01368f7-1e0c-4d4d-9676-e21a979433c0`，PID3684/Vite35916，见 [fake-lab.json](KB02-K204-B-20261024-fake-lab.json)。仅合成arm B，未提取；configReads0/send0。主Agent接管此服务，Sol冻结后不自动关闭它；自查全部fixture服务已关闭，首次互等进程已中断。

```powershell
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs status fake
node --import tsx tests/acceptance/KB02-K204-B-20261024-cli.mjs stop fake
```

[fake-app-smoke](KB02-K204-B-20261024-fake-app-smoke.json)核实际Vite HTML及转换的 `/app/main.tsx` 均200，API状态0配置/0send；这是HTTP入口检查，未做Chrome或jsdom页面操作。初次smoke命令误写src入口，按index.html修正后通过，产品无修改。独立验收可在此服务浏览；真正质量验收由主Agent使用新的真实会话。

剩余：接线待Astra独立工程裁定；实际Provider可用性、原始B候选质量及真实Chrome全过程未测。自动主题历史FAIL继续保留，不凭fake或人工整理称模型修复。无批次最终验收声明、不推进C、不执行Git提交；由主Agent统一保护/秘密扫描/提交同步。子Agent token计量不可得。

交接后停止本轮施工源码及报告写入，等待Astra复审。
