# QAUI03 独立验收 · 2026-11-18

**本轮缺陷通过。** 跨视图打开 Wiki 后，知识总览显示对应文章，详情获得焦点。主动检查还会滚动并高亮经 API 核对的原句。切回问答和主动检查时，原问题、结果和勾选状态均可继续使用。

**批次整体通过。** 独立实例对冻结交付重新运行两套真实 Edge 操作，并逐项核对展示、导航与保存。生产服务和配置未参与验收。

## 独立实测

| 操作 | 观察结果 |
|---|---|
| 首次进入知识库，依次点击五个标签，使用方向键，再从首页打开功能 | 默认知识总览，始终只有一个选中标签及可见面板。首页 Raw、Lint 和最近知识入口均打开指定内容。子面板无旧关闭按钮，390px 下五个视图均无页面水平溢出。 |
| 从检查结果、Lint 和问答引用打开 Wiki，从问答打开 Raw | Wiki 跳到正确详情，主动检查高亮文本等于返回的证据。Raw 定位到匹配原句及起止位置。手动创建可从 Lint 单独进入，显式保存返回 HTTP 201，首页可重新打开新页面。 |
| Ctrl+Enter 提问，观察等待、完成、失败与重试，展开实读明细 | 加载时禁用重复提交；完成显示调用次数及独立来源数量。实读明细展示 Wiki、Raw 原文区间和必要性。失败后仍能看到旧答，显式重试恢复。 |
| 载入受控的八场景答复，切换 1440px 和 390px，再载入包含不完整建议的答复 | 表单、状态、结果纵向排列。来源事实和建议标签被清理，建议导语、首句含义及后续动作分别显示。卡片桌面双列、手机单列。缺失正文的编号条目回退为普通文本，引用仍可见。公共角标取卡片引用交集，独有角标只在对应卡片出现，跨分组情形亦通过。 |
| 全部预览、真实鼠标跨卡拖选、点公共及独有角标、生成维护草稿 | 全部预览等于原始规范正文，选段逐字匹配，段落 ID 和引用归属正确。两类角标均将焦点移到对应依据。隔离 HTTP 保存返回 200 及草稿 ID，页面提示正式知识尚未改变。 |

截图来自本次独立会话，展示合成问答数据。[桌面回答](QAUI03-evidence/answer-1440.png) · [手机回答](QAUI03-evidence/answer-390.png)

## 命令与版本

实现提交为 `2ab578d30755eddb70ba144a58027798ad8eea26`。独验完成后，针对下表十个文件执行 `git diff 2ab578d --exit-code -- <十个路径>`，退出 0。

- `git rev-parse HEAD` 得到施工基线 `f518f6682d034f58b213f1e322be2e04d9d23bb7`。验收对象为该基线上的工作树。逐项用 `Get-FileHash` 对照工作树、C 盘源副本及施工清单，十项 SHA-256 全部一致。产品变更限于五个前端文件。
- 在核验副本先后运行 `node --import tsx scripts/lw03-isolated.ts`、`node --import tsx tests/acceptance/qaui03-navigation.mjs <lw03-session>` 及 `node --import tsx scripts/lw02-isolated.ts`、`node --import tsx tests/acceptance/qaui02-browser.mjs <lw02-session>`。两个独立 TEMP 数据根分别为 `lw03-browser-hZK8BB`、`lw02-browser-og8Bfa`，会话参数均为对应根下的 `isolated-session.json`。Node 22.23.5，真实 Edge，回环 HTTP，fake-only，未连接正式模型。两个脚本均退出 0，均断言无页面运行时错误，服务已结束。
- 沙箱内首次启动 Edge 时命名管道关闭，浏览器操作尚未执行。获准在沙箱外使用全新临时浏览器配置后，两套脚本完整执行。
- 独立运行 `npm.cmd run typecheck`，退出 0。同指纹施工定向回归 41/41 与构建复用施工记录。八场景排版使用受控当前答复，导航、引用校验和维护草稿保存使用真实隔离 API。

| 文件 | 已核对 SHA-256 前 16 位 |
|---|---|
| app/components/WikiInspectionPanel.tsx | 490AE1B438294D5E |
| app/components/WikiQuestionPanel.tsx | FDD3A0F200889986 |
| app/components/wiki-answer-display.ts | 13F02AACAA55C24B |
| app/pages/WikiPage.tsx | F0065DC2EFEE70C0 |
| app/wiki.css | 3228C727774E4397 |
| scripts/lw03-isolated.ts | C8D2FB00BE6947BA |
| tests/acceptance/qaui02-browser.mjs | D0DB20903187E640 |
| tests/acceptance/qaui03-navigation.mjs | 79F0F457363A7749 |
| tests/lw03-ui.test.tsx | D2AF15857AE9473D |
| tests/wiki-selection.test.tsx | F0A187B57715F29E |
