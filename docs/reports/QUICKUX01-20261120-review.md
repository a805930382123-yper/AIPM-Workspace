# QUICKUX01 独立验收（2026-11-20）

**最终裁决：本轮施工 Q1-01～Q1-04 通过，QUICKUX01 整批通过。** EVAL01 单独修复提交为 `0f38a8ce14100909bf79171fa857e364d3497aac`，其父提交为 `61a1fd6`。加入该修复后的独立全量测试为 974/974，失败、跳过和取消均为 0。真实 Edge 的桌面与手机视口均验证遮罩关闭时焦点回到触发按钮。

## EVAL01 单独返修与最终复验

仅 `tests/eval01-live.test.ts` 发生变更。独验在未叠加 QUICKUX01 的干净基线运行 `node --import tsx --test tests/eval01-live.test.ts`，工作树交接版（SHA-256 `23a891a71d61a7af48b982d1bee8b4d620a49f388bf6b5ad347f7499b95f74f0`）2/2 通过。直接读回上述提交中的 LF 文件再运行也是 2/2。两版本仅有两处行尾差异。测试用临时源码算出指纹并仅替换临时 runner 的常量；故意改变一份临时服务文件的内容后，恢复入口返回 `Product fingerprint mismatch`，伪造 Fetch 调用计数为 0。正常恢复和一次性许可分支均通过，记录的调用由测试桩提供。生产 runner 的 Git blob 与规划基线同为 `3cddbf992f52961235b0bb88fede75aee5e4b9a1`。

在原始 LF 基线的独立快照中，仅叠加 EVAL01 测试修复和本批白名单。逐一对照交接表，工作树和快照的八个文件全部匹配原验收 SHA-256。Node 22.23.5 的 `npm test` 退出 0，974/974 通过，日志为快照下 `final-repaired-full.log`。QU1-05 转为通过。其余验收沿用下列相同产品字节的 38/38 定向测试、类型检查、生产构建与双视口真实操作。提交推送与远端 CI 由主线程核验。

## 首轮历史裁决

首轮施工 Q1-01～Q1-04 通过，整批因全量测试 973/974 暂未通过。当时唯一失败为 EVAL01，干净基线可复现。下文保留该轮实际观察及修前、修后浏览器证据。

## 版本与范围

规划基线为 main 的 `61a1fd6c74de7eb0dd116d7b52bd70c55c646844`。施工者停写后，独验以 `git -c core.autocrlf=false archive 61a1fd6` 生成源码快照，仅叠加任务卡允许的七个产品文件、一个测试文件与独验脚本。八项 SHA-256 逐项匹配[最终施工交接表](QUICKUX01-20261120-builder.md)。返修后 QuickCaptureDialog 为 `e9fa9be8355368bc775addcb65accc9f7074eec435d2e3a3e76dffa227d02b3c`，定向测试为 `ecc482489e497015e4040ee028f208ba761cdb565459c1ce1d27043a6d5599a8`，独验脚本为 `270c457d627e87d6e66668516bfd8c235441c32bfb4b0d016cdc4611623fc5bb`。独验时本批尚未提交。并行提交 `7f61462` 在 app、tests、services、scripts/eval 与规划基线之间无差异。

真实服务使用随机环回端口、TEMP 合成数据、空模型配置和今日资讯缓存。Edge 请求限定本机预览地址，服务端外部 Fetch 在发出前拦截。最终浏览器两端外部请求均为零。真实速记保存经过本地 API。网页抓取通过浏览器路由断言请求体并返回合成失败和成功响应，未连接外部网页或模型。正式数据、正式配置及用户服务未参与。

## 首轮验收结果

| 验收项 | 独立验证结果 |
| --- | --- |
| QU1-01 | 通过。真实七主题草稿验证五类筛选、关键词、空态、清除筛选及视图外选集。桌面实际测得两张主题卡同排，筛选工具位于首个通栏。定向测试覆盖五个被检索字段。 |
| QU1-02 | 通过。已选卡忽略后取消选择并折叠；监听到的网络请求为 0。返回 Raw 后重新进入同一草稿，忽略态保留。全选跳过已入库、已忽略卡片，筛选内全选与取消保留其他勾选项，恢复后未自动勾选。定向测试覆盖跨草稿与存储损坏、不可用和入库清理。 |
| QU1-03 | 通过。两个视口各以 Ctrl+Enter 速记，真实 POST 返回 201，核对原样正文、Unicode 自动标题及默认来源。单行 URL 可带入链接模式，默认不翻译；400 后标题、URL 和标签保留并可重试。成功态可继续、打开 Raw 或关闭。 |
| QU1-04 | 返修后通过。首页和顶栏入口、Alt+N、输入框及已有弹窗的快捷键保护均验证。真实 Raw 统计刷新、留在首页以及打开指定 Raw 均通过。 |
| QU1-05 | 未通过。定向 38/38、类型检查与生产构建通过；隔离全量唯一失败为下述 EVAL01。 |
| QU1-06 | 通过。真实 Edge 157.0.4341.60，1440×900 和 390×844 两种视口完成同一整条路径，pageErrors 为空。捕获、忽略、主题审核三张截图的文档宽度各与对应视口宽度相等，弹窗在视口之内。 |

## 返修前后证据

修前组件 SHA-256 为 `9ae27fdcf37440aa40b76babcd67a37894c315be4fdbfa6379f31113df7675de`。点击顶栏后通过遮罩关闭，在 1440 与 390 宽度均将焦点移至 BODY；同期首页 Escape 关闭可正常恢复。同一浏览器脚本复测最终组件，两个视口均复原到顶栏 BUTTON，完整链路退出 0。下列目录各含两种尺寸的 `quick-capture`、`dismissed-topic`、`topic-review` 六张 PNG 及 `evidence.json`。截图保存在验收机器的 TEMP。

- 修前证据为 `%TEMP%/qu01-browser-evidence-bdf45/quickux01-browser-y4lwOS/`。
- 最终证据为 `%TEMP%/qu01-lf-browser-bdf45/quickux01-browser-pxXS2U/`。390 速记与主题审核截图 SHA-256 分别为 `f9f333695f4a3a81da8a6ce294ab9ed9ece86e9a3049b595646595f20e950233`、`abdec4c311ae0da4e70b07540aac86fa74acd798d41caddb191a2c8e6f000ed9`。

## 实际命令与结果

在独立快照运行，Node 22.23.5。生产构建转换 249 个模块，Vite 提示主包超过 500 kB。运行日志保存在本机被 Git 忽略的 `.scratch-quickux01-review-lf-bdf45/` 目录。

```powershell
npm run typecheck
node --import tsx --import ./tests/support/css-stub.mjs --test --test-reporter=tap tests/quickux01-ui.test.tsx tests/homeui01-ui.test.tsx tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/rawurl01-ui.test.tsx tests/uifix01-ui.test.tsx tests/uifix02-ui.test.tsx tests/uifix03-ui.test.tsx tests/uifix04-ui.test.tsx
npm run build
node --import tsx tests/acceptance/quickux01-review-browser.mjs
npm test
```

前四项退出 0。全量退出 1，跳过 0、取消 0。首次 TEMP 源码在全量执行期间缺失；后续普通 Windows 归档将部分固定摘要输入转换为 CRLF。最终归档采用 CI 的 LF 设置，直接比较规则文件和测试样本的 Git blob 确认字节一致，上述裁决仅使用有效运行。

## 已关闭的首轮全量测试阻塞

`tests/eval01-live.test.ts:44` 的隔离恢复用例预期回放拒绝损坏的响应，实际先由 `scripts/eval/run.mjs:88` 抛出 `Product fingerprint mismatch`。未叠加本批改动的 61a1fd6 基线在独立目录运行同一用例也出现完全相同的错误，单项 0/1。

```powershell
node --import tsx --test --test-name-pattern="isolated resume preflight" tests/eval01-live.test.ts
```

门禁期望值为 `20d80ac6f25b61d97862ff926823dd716649771d9ab962c61407f24e3ae93602`。按恢复脚本的目录列表、排序和行尾归一化算法，直接读取基线提交的 services/llm、services/wiki、services/storage 共 39 个 Git blob，所得为 `7219a090cd65c1a4813e25bc06a2fc9f7ba21d96d791aff5e986a47469276a4c`。本批没有修改这些服务或冻结的恢复契约。建议另行确认 EVAL01 既有恢复契约的维护方式，在该门禁恢复后重跑全量，再判定整批及交付状态。
