# LLM-Wiki 2A-1 独立验收

2026-11-26，基线 `649184935cab69b444bdddde89b3d64f55afcd60`。受检工作区对应施工记录首轮冻结清单，Node 24.18.0。使用系统临时目录和不存在的模型配置文件，清除继承的模型及向量服务变量。正式数据未参与。

## 首轮结论

2A-1 暂未通过。首次施工已有日期规则、Markdown 兼容处理、SQL 升级与重建实现。提醒状态覆盖历史操作后，队列对同一日期的求值会改变。整批 2A 尚未验收，2A-2 的正式事件及 API 和 2A-3 的 UI 不在本轮范围。

## 阻塞反例

通过 `node --import tsx --input-type=module -e` 调用实际 `ReviewTriggerStore` 与 `evaluateFreshness`。合成概念页核验日为 2026-01-01。写入 3 月 1 日的 new_source 和 3 月 3 日的暂缓，求值 3 月 15 日得到 priority 50、snoozed true。继续写入 4 月 1 日的同类事件和 4 月 3 日的暂缓，重新读取磁盘并求值同一个 3 月 15 日，得到 priority 0、snoozed false。两项三月记录均被覆盖。若仅写入事件，同一常青页会从三月的历史队列消失。

建议保留事件和暂缓的有效日期，按查询日选取已发生的记录。同页同类同日去重。回归需包含后来的同类操作、历史日重放、跨日解除暂缓与重新打开状态文件。

## 实现核对

日期解码保留未加引号 YAML 时间戳的原字面量，再严格验证日历日期。SQLite 的 NULL 表示未设置，显式 null 和 0 投影为常青。手工更新保留已有元数据，HTTP 常规编辑按原白名单取值。核验状态只读取人工日期。增量写、升级和全量重建共用页面投影，v1 的列和视图在事务中升级。排序在作用域过滤后取前五。施工记录含 Step 0 勘察。

## 实际回归命令

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-freshness.test.ts tests/search-sqlite-index.test.ts tests/search-embeddings.test.ts tests/wiki.test.ts` 共 36 项，35 通过，1 项既有隔离哨兵超时取消（30 秒），无断言失败。覆盖 v1 升级向量和 UTF-16 引文、旧页 mtime、删库后同日队列、未知字段、增量增删和状态文件损坏保护。
- `node --import tsx --import ./tests/support/css-stub.mjs --test --test-name-pattern="ordinary direct HTTP tests send no request" tests/search-embeddings.test.ts` 单独重跑超时项，1/1 通过，测试用时 23.1 秒。

## R1 独立复验（最终）

**首轮缺陷已关闭，2A-1 阶段 PASS。** 在同一份 Markdown 上按 3 月、4 月、2 月、3 月顺序写入同类提醒与暂缓，再新建存储实例重读，核验 6 个历史日期。3 月 15 日仍为 50 分且暂缓有效，4 月 2 日解除，4 月 3 日重新暂缓，5 月 3 日解除。重复输入未增加日期。整批 2A 尚未验收；后续 2A-2、2A-3 待授权。

- `node --import tsx --input-type=module` 从标准输入执行独立断言，六个日期全部通过。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-freshness.test.ts tests/search-sqlite-index.test.ts tests/wiki.test.ts` 21/21 通过。包含从 v1 单日期状态读取、追加事件后迁移到 v2、删库重建后回放相同历史队列。v1 能转入文件已有的日期，先前被覆盖的记录无法还原。
- 基线沿用 `649184935cab69b444bdddde89b3d64f55afcd60`。R1 独立计算的 SHA-256 如下，其余产品和测试文件沿用首轮冻结清单。

```text
46fa96591d25b80977109102f86c7a7bf51f10ba60b361d090eb696d988cdc0d services/wiki/freshness.ts
2308a45a69f54788823b6e9f247d320db89bc013532d7c274fba1f6fb85d5f1e services/wiki/review-triggers.ts
f6013a2905a1b8a32dabda706a35a8ff7b437eaa26f6a86f64bb3443530d0138 tests/wiki-freshness.test.ts
```
