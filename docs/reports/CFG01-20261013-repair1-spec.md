# CFG01 第一轮返修独立 Spec 复验：FAIL

实际签收日期：2026-10-14（Asia/Shanghai）。文件前缀 `20261013` 保留开工日期。原 `CFG01-20261013-spec.md` FAIL 报告未修改。

依据：完整 CFG01 任务卡、`CFG01-20261013-repair1.md` 的 FCFG01–08、原 Spec 失败证据。比较范围仍为指定 11 个配置/设置页文件；获准的 `services/llm/provider.ts` 使用 `git diff --no-index docs/reports/CFG01-20261013-original-provider.ts services/llm/provider.ts` 精确比较，未把上一批 SEC 增量混入 CFG01。

版本：`docs/reports/CFG01-20261013-frozen.json`，`at=2026-10-13T16:03:32.07Z`。复验结束时指定 11 文件及 provider.ts 共 12 个 SHA-256 均匹配冻结。

**Spec FAIL：原主要场景已有修复，但 FCFG03、FCFG05、FCFG07 各仍有未闭合行为。** 本轴仅新增本报告；没有修改产品、测试、实际 `.env.local`、正式 workspace 或旧证据。

## 逐根因复验

| 根因 | 本轴结果 | 实际证据与限制 |
|---|---|---|
| FCFG01 配置读错阻断手动应用 | CLOSED | 配置路径在启动前就是目录（EISDIR），真实隔离服务成功启动；health/stats/raw/wiki/prompts 均 200，config GET 明确 500。恢复有效夹具文件后，固定连接 test 为 200 |
| FCFG02 环境覆盖漏本机旧 Key | 原复现 CLOSED | env 仅覆盖 Key，模型/地址含本机旧 Key 时摘要不泄漏、configured=false；Provider secrets 现在包含已知凭证集合。但编码检查共用逻辑仍有 FCFG07 的绕过，不能代签全部凭证边界 |
| FCFG03 保存/读取凭证一致性 | OPEN | 引号/反斜线新 Key 保持一致，实际 HTTP fake 收到相同 Authorization；制表符 Key、引号模型及旧手工双引号反斜线配置仍改变，见 R1-SP01 |
| FCFG04 外部编辑被覆盖 | CLOSED | 在 .tmp 写入前实际注入完整外部配置，save 返回 CONFIG_REVISION_CONFLICT，外部注释/配置保留，零 .tmp 残留。代码已基于同一旧字节快照并在 rename 前复核；不宣称原生文件系统 CAS |
| FCFG05 迟到/dirty 保护 | OPEN | 原 GET1 迟到回退和 reload 中编辑覆盖均不再发生；初始读取中编辑会令页面一直读取中且无法保存，见 R1-SP02 |
| FCFG06 错误响应体预算 | CLOSED | 无 Content-Length 的 401 流超过 4096 字节预算，返回 LLM_RESPONSE_TOO_LARGE 并 cancel；不再读完整 65536 字节错误体 |
| FCFG07 URL规范化/编码凭证 | OPEN | 空 `?`/`#` 均拒绝；混合大小写百分号编码及一个非法 escape 能绕过，见 R1-SP03 |
| FCFG08 窄屏设置入口 | 静态符合，实际浏览器由主 Agent 负责 | b04.css:27–30 用更高 specificity 覆写 max760 sidebar-bottom 隐藏，仅隐藏 caption/local-state；本轴不把 CSS 静态检查签成 390 宽实际布局 PASS |

## R1-SP01：P2，往返编码仍会改变已接受的值或旧配置

关联 FCFG03。位置：`services/llm/config-manager.ts:44,48,78`；`services/llm/config.ts:30–31,54–66`。

实际三例：

1. 新 Key 为包含真实制表符的 `a\tb`（这里 `\t` 表示一个 tab）。当前 validateApiKey 接受这个非空单行值；save 返回 configured=true，但 JSON.stringify 写成反斜线 t，reader 仅解 `\"` 与 `\\`，读回不是原 Key。可以选择明确拒绝控制字符，但不能成功保存另一份凭证。
2. 模型为带两端引号的 `"model-fixture"`。validateModel 接受；model 裸写后 reader 剥掉引号，save 返回模型 `model-fixture`。未按输入保存，也没有明确拒绝。
3. 旧手工双引号配置的 Key 内含两个连续反斜线：旧 reader 仅移除外围引号，保留两个反斜线；新 reader 额外反转义，变成一个。返修卡要求保留旧手工带引号 dotenv 兼容。本例没有调用旧产品，仅按保留的原 reader 规则与新 parseLocalEnvText 直接比较；新行为实际已运行。

探针输出（只输出夹具结果，不输出实际凭证）：

```json
{"probe":"key-roundtrip","label":"quoted","saveSucceeded":true,"keyPreserved":true}
{"probe":"key-roundtrip","label":"backslash","saveSucceeded":true,"keyPreserved":true}
{"probe":"key-roundtrip","label":"tab","saveSucceeded":true,"keyPreserved":false}
{"probe":"quoted-model-roundtrip","saveSucceeded":true,"modelPreserved":false,"actualModel":"model-fixture"}
{"probe":"legacy-quoted-backslash","unchanged":false}
```

关闭标准：定义明确、可区分旧格式的序列化/解析约定；对接受的 Key/模型保证无损，或写前明确拒绝且文件不变；保留返修卡承诺的旧手工配置行为。不得通过宽松解析把原始凭证悄悄变换。

## R1-SP02：P2，初始加载中的编辑使配置永远没有加载完成

关联 FCFG05。位置：`app/pages/SettingsPage.tsx:22–24,80–82`。

复现：初始 config GET 待决；输入框仍可编辑，用户输入 `typed-before-first-response`，sequence++。随后初始请求成功返回完整摘要，但 generation 不同导致连 setConfig 都跳过。输入得到保留，config 却永久为 null；页面仍显示“读取中…”，保存按钮 disabled，没有其它自动请求。必须额外点击重新读取，而这个没有新编辑阻隔的 reload 会把既有输入覆盖成服务端值。

jsdom 实际输出：

```json
{"probe":"initial-late-after-reload","staleBlocked":true}
{"probe":"edit-during-reload","editPreserved":true}
{"probe":"edit-before-first-response","editPreserved":true,"stillReading":true,"saveDisabled":true}
```

关闭标准：初始 loading 中明确禁编辑，或将安全摘要/revision 获取与表单 dirty 保护分开；不覆盖新输入的同时也必须完成加载、给出可操作状态。测试需检查摘要、按钮和 loading 状态，不能只检查 input 保留。

## R1-SP03：P1，混合百分号编码可把已知 Key 保存到可读 URL

关联 FCFG07，也影响 FCFG02 共用检查。位置：`services/llm/config-manager.ts:72–75,84`；`services/llm/config.ts:71,83`；`server/index.ts:43,80–81`。

实际复现：空配置 manager 首次保存，虚构 `apiKey='a/b'`，`baseUrl='https://example.test/a%2fb/%zz'`，普通模型。save 成功、configured=true，摘要 baseUrl 保留 `a%2fb`。这是 Key 的可解码表示，既已进入可读摘要，也符合 Provider 构造的相同检查而可进入外发路径；本轴没有向该外部地址发请求。

原因：decodeURIComponent 遇任意非法 `%zz` 后放弃整个字符串；后备 encodeURIComponent 检查生成大写 `%2F`，与输入小写 `%2f` 大小写敏感比较，故两条检查均漏掉凭证。Node URL 接受并保留这个字符串。

实际输出：

```json
{"probe":"known-key-mixed-percent-url","result":"saved","configured":true,"encodedKeyInSummary":true}
```

关闭标准：明确拒绝非法 percent escape，或稳健检查可解码部分并规范百分号编码大小写；保存、摘要、运行 Provider 三处均须一致，使用新/旧/环境短 Key 集合覆盖本例，不把编码凭证变成可读字段或外发路径。

## 其它保护复核

精确 provider diff 仅见 readCapped 的取消/无 body 处理、httpError 改为 capped read、knownSecrets 集合；既有 assertNoKnownSecret 深度 JSON 键/值检查未删改。独立运行短 Key `xy` 的嵌套 JSON 键/值两例，2/2 均拒绝。

request snapshot 仍由 AsyncLocalStorage 保存请求 Provider；七个现有 AI POST 入口（Raw、更新、综合、Audit、Brief/生成/优化三路）均在 middleware 路径清单内。ExtractionRunner 仍把启动时 Provider 作为 run 参数持有，没有全局 currentProvider 交换。连接 test 显式 await providerFactory；固定 system/user、15000ms、4096 字节参数以及 JSON 解析后凭证检查保留。代码静态复核不代签旧任务隔离的主 Agent 实际并发 HTTP 证据。

真实隔离启动/恢复探针：

```json
{"probe":"startup-EISDIR-manual-availability","statuses":{"/api/health":200,"/api/stats":200,"/api/raw":200,"/api/wiki":200,"/api/prompts":200,"/api/llm/config":500}}
{"probe":"recover-config-fixed-test-auth","status":200,"calls":1,"authPreserved":true,"fixedUser":true,"fixedSystem":true}
```

错误预算探针实际输出 consumed=16384、cancelled=true、LLM_RESPONSE_TOO_LARGE；流 pull 允许预取，因此 consumed 不是返回/解码字节数，不能声称恰好只从来源读取 4096 字节。与初始读取完整流相比，此次明确早停/取消，符合修复目标。

## 执行与限制

本次 16 个命名探针结果组中，11 组满足对应定点预期，5 组复现上述三根因的剩余失败；这是探针组数，不是完整验收矩阵或测试用例总数。manager/adapter 探针使用 native TypeScript transform；UI 使用获允许的 tsx/jsdom 隔离执行；手动功能使用实际 server/index.ts 及 localhost HTTP fake。全部虚构夹具仅位于系统临时根/内存，全部隔离服务关闭、临时根删除。

本轴没有重复主 Agent 的 build、完整 tests、HTTP/edges/component、实际浏览器或 SEC 回归，不签真实 Provider 成功/质量、其它 OS/最低 Node、36 项真实 AI。原失败报告保留；此报告只对应上述返修冻结，不能用于签收之后的代码。
