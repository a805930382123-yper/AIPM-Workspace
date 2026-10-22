# CFG01 第一轮返修独立 Standards 复验

实际复验日期：2026-10-14（Asia/Shanghai）；文件前缀保留开工日期 20261013。结论：**FAIL，1 个 P2 序列化根因仍未完整关闭**。原 `CFG01-20261013-standards.md` 和初始冻结记录保留，本报告不改写原失败事实。

## 输入与交付版本

依据：本项目 AGENTS、CFG01 原任务卡、`docs/reports/CFG01-20261013-repair1.md`、既已读取的 architecture/coordination 及 code-review 技能 Standards 轴。主 Agent 另行完成 Spec、完整测试、SEC 回归和浏览器验收，本 reviewer 不代签其证据。

比较仍为 `git diff HEAD -- .env.example app/api.ts app/b04.css app/pages/SettingsPage.tsx server/index.ts server/llm-api.ts services/llm/config.ts`，并全文读取新 config-manager、llm-config-api、provider-config 两个测试文件。新增获准 Provider 范围使用 `git diff --no-index docs/reports/CFG01-20261013-original-provider.ts services/llm/provider.ts` 精确比较；该命令退出码 1 表示存在差异。没有把 HEAD 中此前 SEC 批次的 Provider 差异归入 CFG01。

12 个目标文件（原 11 个加 Provider）均匹配 `CFG01-20261013-frozen.json`，冻结时间 `2026-10-13T16:03:32.07Z`。只新增本报告；未改产品、正式 workspace、真实 `.env.local`、旧脚本/报告，未运行完整 tests/build。

## 原 Standards 问题复验

| 原问题 / 返修卡 | 本轴结果 | 独立证据 |
|---|---|---|
| CFG01-S01 / FCFG01：读盘故障阻断手动功能 | CLOSED | startup 不再解析 Provider；配置快照中间件限于启动 AI 的路由。实际隔离产品在 config 路径为目录、真实 EISDIR 状态下成功启动；health/stats/Raw/Wiki/Prompt GET 全为 200，配置 GET 为明确 500。 |
| CFG01-S02 / FCFG02：环境覆盖后本机旧 Key 摘要泄漏 | CLOSED（原实证） | manager 从本机字节解析本机 Key，与环境及 effective Key 合并到摘要检查；运行 Provider 也接收 knownSecrets。重跑原模块场景，environmentLocked=true，containsInactiveKnownKey=false。 |
| CFG01-S03 / FCFG03：首尾引号 Key 改变 | 原引号/反斜线场景通过；根因仍 OPEN | 首尾引号及反斜线组合的 Key save/read 回读一致；但同一新 writer/reader 对允许的内部 Tab Key 仍改变，另允许的引号模型 ID 同样被改变，详见下项。 |

模块探针使用临时合成 Key、独立临时配置，仅输出布尔结果，未输出凭证内容、未调用真实 Provider；命令约 0.528 秒。实际产品 HTTP 探针使用独立临时 data/config、随机本机端口，约 1.075 秒；子进程和临时目录已清理。

## Actionable finding

### CFG01-RS01 [P2] 允许值的 writer/reader 编码仍不一致，保存成功后悄悄改变 Key 或模型

位置：`services/llm/config-manager.ts:78`；关联 `services/llm/config.ts:30–31`、`:65–67`、`config-manager.ts:44`、`:48`。

新的 `encodeValue()` 只对 Key 用 `JSON.stringify()`，而 parser 只解码双引号和反斜线转义。当前 `validateApiKey()` 允许内部 Tab；该单行输入保存成 JSON 的字面 `\t` 后，parser 不恢复 Tab，改变实际鉴权字符串。独立模块复验：`keyAccepted=true`、`configured=true`，但 `keyUnchanged=false`。这不满足 FCFG03“引号、反斜线等单行字符”必须无损或明确拒绝且不写的关闭标准。

同一持久化契约对模型也不一致：`validateModel()` 接受首尾引号的非空单行模型 ID，writer 裸写该字段，parser 将首尾引号当 dotenv 包装去掉。独立模块复验：`configured=true`、`modelUnchanged=false`。模型 ID 是 Provider 的 opaque 标识，保存成功不应隐式替换成另一个 ID。

两个场景均使用临时配置和合成值；没有真实 Provider 调用或真实鉴权成功的主张。最小修复可以明确拒绝无法无损表示的字符/模型形式并保持原文件，也可以使用一致的编码/解码方案；需保留旧手工 dotenv 引号兼容并覆盖允许输入的保存、保留 Key、回读一致性。此项是一个共享序列化根因，无须重写六条业务算法。

## 新增差异审查与限制

静态检查：FCFG04 使用同一 revision 字节快照，临时文件完成后 rename 前复核外部文件，冲突保留外部字节并清理临时文件；没有宣称无协作 writer 的文件系统原生 CAS。FCFG05 初始/reload 与输入编辑统一 sequence，卸载失效旧请求；FCFG07 检查规范化前后及 URL 编码的已知 Key、显式拒绝原输入空 query/hash；FCFG08 局部窄屏样式保留 Settings 入口。相关真实并发、浏览器和故障注入由主 Agent 实测，本轴只作静态结论。

Provider 精确 CFG01 diff 限于已批准增强：非 2xx 错误体改用 readCapped，成功和失败都受同一输出预算；声明超预算或流读超预算取消响应；secrets 合并 effective/knownSecrets，既有 SEC 非空凭证门禁和脱敏逻辑未被删除。未发现该最小差异另一个可行动 Standards 问题；不以静态阅读代签所有 HTTP 错误体、超时或六链安全回归。

复验运行环境为本机 Node v25.2.1，使用 `--experimental-transform-types`；最低 Node、其他 OS、完整 build/tests 和实际浏览器未在本 reviewer 执行。真实 Provider 成功/语义质量及 36 项真实 AI 仍 BLOCKED。子 Agent token 实数不可得。FCFG03 的允许值序列化仍须关闭后才能由主 Agent判断本批是否 PASS，本报告不授权推进下一批。
