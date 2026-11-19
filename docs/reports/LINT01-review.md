# LINT01 独立验收

**局部修复 PASS。** 首轮发现，当 Raw 本身含连续空格时，只含这两个空格的内联引文也能消除告警。返修后回放同一反例，告警正确保留。另用显式坐标分别验证原样前导空格及伪造的首尾空格，前者通过、后者告警。

**批次整体 PASS。** 冻结基线在 22 页报告 123 条 `UNSOURCED_FACT`，最终在 6 页保留 25 条。按文件、规则、行号比对，消失 98 条，新增 0 条，其余十码均为 0。目标页第 60–91 行共 32 条全部消失。82 个正式数据文件与冻结副本在独验前后逐文件 SHA-256 相同。

## 基线逐项归因

独验直接读取磁盘上的事实行、证据表、所列 Raw 及其区间，逐个重建完整或 90 个 UTF-16 代码单元加省略号的生成器引文，再与新旧问题键对照。历史书目单独检查条目 ID、登记 ID、当页 Raw 与区间中的非空白正文。各行分类互斥。

| 基线问题 | 逐项数 | 结果 |
| --- | ---: | --- |
| 条目同行有证据引用，显示引文跨行 | 48 | 原文精确匹配，全部清除 |
| 独立续行上的证据引用，显示引文跨行 | 19 | 原文精确匹配，全部清除。与上行共 67 条 |
| 上述 19 个引用续行各自所属的父条目 | 19 | 条目与引用已关联，重复告警清除 |
| 条目末尾历史 ID 与散文书目中的 Raw、区间显式对应 | 12 | 独立读取 12 个实际引用并核验后全部清除 |
| 来源节只有整篇文献与 Raw，缺条目 ID 的区间映射 | 17 | 分布于 4 页，保留 |
| 有散文书目和区间，但条目没有引用 ID | 8 | 分布于 2 页，保留 |

保留的 25 条表明现有字段无法逐条定位。归因只涉及引用的可定位性。剩余键按 `file|code|line` 排序后以 LF 连接的 SHA-256 为 `1f9864bb8ccaf4c8145ca572025254730ae1309eb6a67e01e4d1d0d13a686058`。

## 验证记录

| 实际命令或操作 | 结果 |
| --- | --- |
| `node --import tsx --input-type=module` 独立读取冻结副本并调用 WikiLint.inspect，按磁盘原行重新核对每个结果 | 最终 25 条的页 ID、标题、相对文件、行号、含缩进的原行前 120 个代码单元及说明全部吻合。原、新 Wiki 指纹均为 `e51c8da8cc65ece99fb86b7a49cf60d47e925ef685cd3a37fb68fb2586757e9f` |
| `node --import tsx --input-type=module` 在新建 TEMP 使用真实 RawStore、WikiStore 和 Audit 路由，GET 随机回环端口的 /api/wiki-lint | HTTP 200，独立构造的 18/18 个预期成立。完整引文通过；引文中增删空行、伪造字串、尾缀均告警。裸 ID 坐标的异源、缺源、越界、错 ID、歧义、无条目引用均告警。另验父子独立、续行、两级子标题、同级结束和空格返修 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/audit.test.ts tests/wiki.test.ts tests/wiki-selection.test.tsx` | 终版 25/25。含 11 码、生成器、合法截断与伪造、页级问题、失去目标 Wiki 的 Audit、CRLF、长行与回环 API。缺页 Audit 保留旧码及相对 Audit 路径，页 ID/标题为空，scope 为 page |
| `npm.cmd run typecheck` | 终版退出 0 |
| `node --input-type=module` 调用 Vite build，envDir 及 outDir 均在新建 TEMP | 238 模块，退出 0，保留已有包体积提示。本项在空白引文返修前实测；返修仅改服务端 Lint 与测试，前端输入及类型契约一致 |

沙箱初次阻止回环连接和 Vite 路径解析，均以获准的本地运行复核。没有调用远程模型。冻结基线 JSON 指纹为 `a0cc377131a7698bda6bc93707bbabe544675eb4dab82153faf6afbfd0cbd2cf`。独验以排序的「相对路径、空格、文件 SHA-256」逐行连接计算的 82 文件指纹为 `0f41f7034a1d451610301b185dc2e39ad39b00dfc56c8113276afa5c8c617acb`，前后相同。

## 验收版本

检验基线提交为 `6133a2477ca11ab3436cc9955dbec635f82c01e6`。工程提交为 `5ddf358af1b69235a81e343fe64a6537321caaa9`，通过 `git diff --exit-code 5ddf358 -- services/audit/lint.ts app/api.ts tests/audit.test.ts` 确认三份实测文件与该提交一致。验收与施工由不同实例完成。

| 文件 | 最终 SHA-256 |
| --- | --- |
| services/audit/lint.ts | `a8de2b2b1318339eceef6a2c03a0de39256f93ef023801b0c21fde9ddc60ef07` |
| app/api.ts | `8f7a6d46caee8228096b6dd58a4f66b14243d3b546f9ecce7cc24c7b5aad8bf1` |
| tests/audit.test.ts | `1a8ff28fddcf86553d19356678ce56f906a02c9709719321a72876d94ef88a05` |
