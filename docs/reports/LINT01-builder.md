# LINT01 施工交接

施工基线 `6133a2477ca11ab3436cc9955dbec635f82c01e6`。按首轮独验发现完成空白引文返修，自查通过，已停写交独立复验。

## 同一快照对比

用 `node --import tsx --input-type=module` 调用 `WikiLint.inspect()`，按规则码、相对文件路径及行号逐条对照冻结基线。82 个数据文件的清单 SHA-256 在运行前后均为 `ebbe6e5f50f0408913fb660305d505ce31b8e2bde73510403966007a464c96ef`。两次返回的 `wikiFilesSha256` 均为 `e51c8da8cc65ece99fb86b7a49cf60d47e925ef685cd3a37fb68fb2586757e9f`。

`UNSOURCED_FACT` 从 22 页 123 条降为 6 页 25 条。其余十码始终为 0。98 条旧告警消失，新增 0 条。目标页第 60–91 行的 32 条均清除。

| 基线告警归因 | 数量 | 本轮结果 |
| --- | ---: | --- |
| 事实同行有引用，原文摘录跨行 | 48 | 有效引用按原始偏移和原文逐字核验，旧告警消失 |
| 事实末尾引用独立在下一行，原文摘录跨行 | 19 | 续行并入相邻事实，引用通过核验，旧告警消失 |
| 同一批续行在旧规则中使父条目另外被报 | 19 | 同一条事实按条目解析，重复告警消失 |
| 事实末尾的历史 ID 有对应书目坐标 | 12 | ID 明确对应当页有效 Raw 和有效区间，旧告警消失 |
| 只有历史 ID，页面未提供可定位的证据表 | 17 | 4 页，保留告警 |
| 有整页出处，事实条目没有逐条引用 | 8 | 2 页，保留告警 |

## 接口与规则

`GET /api/wiki-lint` 保留 `generatedAt`、`wikiFilesSha256`、`summary` 和 `findings`。单条问题的六项关联信息是规则码 `code`、页面 `objectId` 和 `pageTitle`、相对文件路径 `file`、行号 `location.line`、摘录 `location.text`、说明 `message`。新增 `location.scope` 区分页级和行级，`pageTitle` 补充页标题。`location.line` 自 1 起计。行级摘录是磁盘原行前 120 个 UTF-16 代码单元，包含原有缩进和列表符。页级保留原行号，摘录可缺省。目标缺页的 open Audit 仍返回 `OPEN_AUDIT`，页 ID 和标题为 `null`，路径指向 Audit JSON。

来源证据表支持完整原文和生成器现有的 90 字符加省略号格式。按存储的 Raw 区间核对跨行 Markdown、空行与截断边界。事实按列表及段落边界识别，紧邻的独立引用行和缩进续行归给所属条目，子列表条目分别检查，子标题内继续检查。同级或上级标题结束事实区。保留内联原文和坐标引用。书目兼容要求条目末尾 ID、来源证据表中的显式 Raw ID 和有效非空区间均能对应，重复 ID 指向冲突坐标时仍告警。

首轮独验发现，内联引文只含空格时曾因 Raw 里恰有相同空格而被接受。返修先检验引文含有非空白字符，并用保留首尾空格的原串匹配。带引号的行内坐标引文也逐字核对引号内的空格。合成 HTTP 回归同时覆盖有意义的原文空格、错误增添的空格，以及只定位到空白的内联、坐标、证据表和历史书目。

## 自查命令

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test --test-name-pattern 'LINT01 preserves' tests/audit.test.ts` | 返修前新增断言失败，复现了纯空格内联引文被接受，以及带引号的坐标引文首尾空格未逐字校验。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/audit.test.ts tests/wiki.test.ts tests/wiki-selection.test.tsx` | 25/25。包括生成器渲染后读取、精确与伪造多行摘录、越界、缺失与页外 Raw、列表续行与独立子项、标题分级、传统引用、冲突 ID 和真实回环 HTTP 200。HTTP 条目逐个比对磁盘原行，并验证页级问题与缺页 Audit。 |
| `npm.cmd run typecheck` | 退出 0。 |
| `node --input-type=module` 调用 Vite `build({ envDir: tmp, build: { outDir: tmpDist, emptyOutDir: false } })` | 退出 0，238 模块。构建输出和空环境目录位于新建 TEMP，保留已有包体积提示。 |
| `git diff --check -- services/audit/lint.ts app/api.ts tests/audit.test.ts` | 退出 0。 |

默认沙箱首次拦截随机回环端口连接和 Vite 的本地路径解析。上述 HTTP 与构建结果来自批准后的复跑。对共享冻结副本只读，HTTP 夹具和构建使用临时目录，模型调用为 0。冻结快照、定向回归、类型和构建结果均已在返修版本复跑，独立复验待主会话完成。

| 施工文件 | SHA-256 |
| --- | --- |
| `services/audit/lint.ts` | `a8de2b2b1318339eceef6a2c03a0de39256f93ef023801b0c21fde9ddc60ef07` |
| `app/api.ts` | `8f7a6d46caee8228096b6dd58a4f66b14243d3b546f9ecce7cc24c7b5aad8bf1` |
| `tests/audit.test.ts` | `1a8ff28fddcf86553d19356678ce56f906a02c9709719321a72876d94ef88a05` |
