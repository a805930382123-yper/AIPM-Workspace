# Batch 2A 独立验收

## 首轮

基线提交 `792bdba9114adced60f3d74b25b7df75334e79e5`。2A-3 首轮未通过，整批待返修。2A-1 和 2A-2 已分别签收，记录见 [2A-1](2A-1-review.md) 和 [2A-2](2A-2-review.md)。

- 独立执行 `node --import tsx tests/acceptance/wiki-review-2a3-edge.mjs`，退出 0。生产构建和真实 Edge 158.0.4370.33 下，从 Raw 页编辑正文能生成系统提醒，四标签单抽屉最多五项，方向键与 Escape、返回焦点、390 像素视口、详情冲突与重试、调整周期、暂缓、引用定位、受限页排除及 Lint 分项均通过。关闭开关后相关写入路由返回 404；删 SQLite 后重启，抽屉数据和文件字节一致。真实外部模型调用 0 次，测试使用一次合成回环响应。脚本 SHA-256 为 `6632a3c9b221e0049ae3bf65798df4ae84c6b1b82c7c095a120a3c7f7cf59b35`。
- 独立执行 `node --import tsx scripts/run-retrieval-eval.ts workspace <临时目录>/aipm-2a3-independent-retrieval.md --fts-repair`，退出 0。对照 1B 修复报告，逐题逐引擎删除耗时列后比较，50 行全部相同。SQLite 长页 9/9，B 类仍为 4/5。报告 SHA-256 为 `cdfd72e4d0894d206abeea6c7822088bbeecdbd5998e0fdf224906cf2a984004`。
- 独立运行上述 Edge 夹具的内存变体，命令为 `node --import tsx --input-type=module`。在引用确认成功、首次定位 200 后，尚未二次编辑任何正文时关闭服务，以禁用开关重启，请求同一定位 URL 实得 409。服务重新开启功能后继续正常。这使已有链接在回滚后无法使用。
- 在夹具再次修改关联 Raw 后，同一引用定位实际返回 409，但当前回答仍将版本 5 作为可确认版本返回。卡片按此字段显示确认按钮。向通用确认接口提交时只核对 Wiki 版本，Raw 编辑不会提升该版本。已经失效的回答依据仍能用来清除提醒。
- 两项缺陷对应代码的 SHA-256 分别为 `c71fd3bb6f476b855d6a3e80b9d6080609afd475324438a1ed6843f8dfb2a76e`（knowledge-answers.ts）及 `9aa99a577b317aff12d1aee032617332a0f7db98ed0928c76504a5e8f84be73f`（knowledge-api.ts）。原脚本涉及的既有链接在关闭开关时只展示了卡片，未尝试打开。本轮缺陷待复验。

## R1 独立复验

**本轮返修通过。** 禁用开关使链接失效、失效回答提供确认按钮两项均已关闭。对已渲染的旧按钮另行检查，其请求也会在写入前被拒绝。

- 运行 `node --import tsx tests/acceptance/wiki-review-2a3-edge.mjs`，退出 0。真实 Edge 点击引用确认后，关闭开关并重启，已有卡片可再次打开原 Wiki，引用接口返回原句，专用复核接口返回 404。再次开启，点击同一引用准确高亮含 emoji 的 UTF-16 原句。历史回答文件字节相同。
- 在浏览器保持旧按钮的情况下修改关联 Raw，等待新提醒出现，再点击确认。界面报告依据已变化，移除确认按钮但保留历史引文，旧定位返回 409，Wiki 文件字节相同。继续从详情暂缓、查看 Lint、重启并删除 SQLite 重建，四个队列结果及源文件字节均一致。一次回环合成回答，外部请求 0。
- 另用 `node --import tsx --input-type=module` 运行带独立断言的内存变体。在临时回答中去除可选 wikiRetrieval 字段，定位 200、当前卡片有正确操作版本；修改 Wiki 正文后定位 409、当前卡片无可操作版本；将该 Wiki 改为引用受限会议源后，读取当前回答和从旧卡片确认均返回 403。还直接断言 Raw 变更后当前回答移除可操作版本。首次变体在并行全量测试期间启动超时；加长夹具等待后所有断言通过，退出 0。
- R1 源码基线提交同首轮。验收时的 SHA-256 如下。

| 文件 | SHA-256 |
| --- | --- |
| server/knowledge-api.ts | `a8ac724edcaac779d482524f8f9d40248022c59c38924c5a2ff7de527f3f314e` |
| services/llm/knowledge-answers.ts | `d2dc705f13764d76975fef1e8299cd2f746f5f1c2e1c0a62ab023abc67088357` |
| services/wiki/store.ts | `18da9697ba5fb4983640ba368944f0ea8177c67249e1c12a87d25d22a4a4c2d8` |
| tests/acceptance/wiki-review-2a3-edge.mjs | `01b9888f6f649750f1935425e535acab2c9aaf9afd91f570f13d070161a50b6f` |

## 最终签收

**2A-3 阶段 PASS，Batch 2A 整批 PASS。** 2A-1 已验证四档时效计算与事件回放，2A-2 已验证 Raw 双触发、索引可见性及凭据隔离。本阶段以独立浏览器操作贯通触发、提醒与人工处理，并补验旧引用在两种开关状态下的使用、权限变更和回滚重建。

- R1 最终浏览器脚本 SHA-256 为 `3cd0e65557db596dcf3cc05ff31826187fe998bbfcd6e1b3cf7ac1845366067f`。按同一 Edge 命令再次执行，退出 0，历史回答文件 SHA-256 保持 `9f4ced979a0b60d07940d7d2b31bc9eabdd28a3d224929472371f5d1a8c0e2fd`。浏览器包含正反 Tab 键焦点检查。
- R1 再按首轮命令独立运行冻结 25 问，Legacy、FTS 两路共 50 条结果除耗时外全部一致。报告 SHA-256 为 `141c0015a1605c95b2399fc306be82e06c6f05c16f552c751b483eb337d6ee8e`。
- 核对施工全量执行日志，项目 Node 测试运行器加载 tsx 与 CSS stub 并执行 tests 下全套 test.ts / test.tsx，1,139/1,139 通过，失败、跳过、取消均为 0。日志 SHA-256 为 `cde24b85135c3dd504f6589da13190da08e6c06c1a8e8be2a5bff9eaf6e1a327`。首轮公共 API 导出回归已关闭。定向测试 45/45，生产构建、类型、格式、lint、guard 门禁见[施工记录](2A-3-builder.md)。独立运行 `git diff --check` 退出 0。
