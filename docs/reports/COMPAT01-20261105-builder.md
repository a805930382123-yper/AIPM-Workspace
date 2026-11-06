# COMPAT01 施工交接（2026-11-06）

Sol High `/root/compat_builder` 负责后端、测试适配和全量自查，Sol High `/root/compat_ui` 负责 UI 及实际浏览器自查。main / HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b` 加冻结工作树。**施工自查通过，批次结论交 Astra 独立裁决。产品、测试和脚本已停写。**

## 全量对照与逐项证据

| 版本 | 测试数 | 通过 | 失败 | 跳过 / 取消 / todo | 证据 |
| --- | ---: | ---: | ---: | --- | --- |
| LW03 历史报告 | 734 | 652 | 82 | 以历史报告为准 | [LW03 施工归因](LW03-20261105-builder.md) |
| COMPAT01 修复前 | 735 | 654 | 81 | 0 / 0 / 0 | [原始日志](COMPAT01-20261105-builder-evidence/npm-test-baseline.txt)、[运行记录](COMPAT01-20261105-builder-evidence/npm-test-baseline.json) |
| COMPAT01 施工冻结 | 738 | 738 | 0 | 0 / 0 / 0 | [原始日志](COMPAT01-20261105-builder-evidence/npm-test-final.txt)、[运行记录](COMPAT01-20261105-builder-evidence/npm-test-final.json) |

修复前 81 项覆盖历史表中相同的 25 个文件。逐文件唯一差值为 `kb03-quality-migration.test.ts` 从 5 个历史失败降到 4 个，历史表归因为旧 R8 prepare 入口预期，当前未复现该项。旧逐条 TEMP 日志在前一设备路径，本机不可用，无法确认两个起点之间新增的单项测试名称或逐项进行历史版本复跑。最终相对本轮起点新增 3 项，分别是标准提取最后一槽与两槽的分支增量、维护阶段非法 JSON 后原任务续跑、当前维护摘要及编辑清审批。默认发现命令与保护用例均保留。

[81 条失败闭环](COMPAT01-20261105-builder-evidence/failure-mapping.json) 记录原名称、位置、错误签名、合同、根因和最终通过行，81 条均匹配到冻结全量日志。其中 `kb02-human-ui` 与若干当前预算标题更新，映射同时保留原名称。

## 实际修复

- **确认兼容。** `WikiCommitService.confirm` 仍先核未知页与标准空选。已确认 Raw 存在可比完成事务时，异 key 不同有效选集恢复 `409 CONFIRM_PAYLOAD_CHANGED`。同 key 不同载荷继续 `IDEMPOTENCY_KEY_MISMATCH`，同载荷跨 key 复用。无可比事务的旧状态继续 `DRAFT_ALREADY_COMMITTED`。定向比较正式文件、日志和事务数量，覆盖拒绝前后不写。公开 HTTP 实测暂缓项先拒绝未审核提交，经当前 revision 审核可用新 key 续批，完整结束后不同载荷仍拒绝。问答和检查走既有分支。
- **深度原句保留。** 补齐旧调用数后，两条 KB03 测试显示两个不同来源说明原句共享 `c1-l001` 的粗区间，旧去重只保留第一句正文。归并内存键增加 exact prose，沿用原 `sourceBoundary` 数据结构。两组继续核每句原文、定位范围、角色和原因。LW01 复测同句同源同位置同类别合并理由，异位置与异类别保留，重复执行稳定，历史形状可读。过去已经缺少原句的持久笔记原字节保留，重跑或恢复仍受现有深度检查点校验。证据见 [缺陷复现](COMPAT01-20261105-builder-evidence/kb-followup.txt) 和 [修复后定向日志](COMPAT01-20261105-builder-evidence/lw-regression.txt)。
- **SSR 与焦点。** 弹层 hook 在 effect 内获取所属文档及打开前焦点。Raw 标题框改用 hook 的初始焦点标记，确保捕获触发按钮后再聚焦输入。原三个 SSR 断言原样通过。真实 Chrome 检查初始焦点、Tab 循环、Escape 原行为、关闭及重开后的焦点恢复。界面测试迁移到实际首页行动入口、Raw 整理入口及逐项审核。详见 [UI 独立施工记录](COMPAT01-20261105-ui-builder.md)。
- **现行测试合同。** 规则版本仍明确断言 19，历史不兼容检查点断言原字节和零调用。标准 N+2、深度 N+5，fake 增加真实结构的维护阶段回复。标准单块 6 次上限保留。剩两槽时第 5 次规划和第 6 次维护完成同任务，剩一槽时第 6 次规划成功后维护失败，完成块和计划可读，普通重试未外发、仍无草稿。取消、恢复、部分提交、冻结载荷、证据位置和 Raw SHA 的原性质保留。
- **维护人工审核与旧形状。** 公共 HTTP 逐项接受和批准，编辑令批准失效，旧摘要和未批准写入均被拒绝。仅旧 Source 原字节复用及旧人工合并专门构造历史非维护草稿并实际逐页审核。现行 Source 复用保留 ID、来源、原正文和登记信息，只追加被确认的新链接，暂缓不落盘且重复确认不追加。该历史合并验证覆盖旧草稿路径。
- **离线质量与类型。** `offlineMaintenance` 默认 `false`，只有离线 `fakeCase` 打开。`KB03-R5-20261030-real.mjs` 仅 `fake(root)` 两行改为预留及检查六阶段，`run`、`prepare`、真实账本和 30/20/15 原政策字节保持。离线历史消耗、连续预留、零自动重试及失败停止继续验证。全量类型检查仅需删除 `lw02-review-copy.tsx` 未使用的 React 导入。

## 施工实测命令

| 命令 | 结果 |
| --- | --- |
| `npm test`，保持原 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/*.test.ts tests/*.test.tsx` | 基线 exit 1，41.427 秒。冻结 exit 0，32.331 秒，738/738。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/llm-http.test.ts tests/kb03-structured-note.test.ts tests/kb03-confirm.test.ts` | exit 0，47/47。实际 HTTP、旧/新摘要、错误码、正式写入及恢复。[日志](COMPAT01-20261105-builder-evidence/commit-http-final.txt) |
| `node --import tsx --import ./tests/support/css-stub.mjs --test` 加 [LW 回归记录](COMPAT01-20261105-builder-evidence/lw-regression.json) 内列明的 13 个文件 | exit 0，62/62。含深度原句、LW01/LW02/LW03、来源过期/权限及密钥回归。[日志](COMPAT01-20261105-builder-evidence/lw-regression.txt) |
| `npx tsc -b` | exit 0，完整配置、无诊断。[日志](COMPAT01-20261105-builder-evidence/tsc-final.txt) |
| `node --input-type=module -` 调用 `vite.build({ configFile: false, envDir, plugins: [react()], build: { outDir, emptyOutDir: false } })` | exit 0，226 模块，空临时 envDir 和临时输出。已有产物体积警告。[构建日志](COMPAT01-20261105-builder-evidence/build.txt)、[参数与结果](COMPAT01-20261105-builder-evidence/build.json) |
| `node tests/acceptance/compat01-ui-browser.mjs` | UI 施工者实际 Chrome 与完整 App/API、本地 fake，自查退出 0，6 张截图，预期 409、无 pageerror。见 [UI 报告](COMPAT01-20261105-ui-builder.md)。 |
| `git -c core.safecrlf=false diff --check` | exit 0。 |

默认运行前核对 107 个发现文件、HTTP 子进程、代理探针和传递质量工具。各次使用全新 TEMP 数据根和空配置文件。清除继承的 `FMCG_LLM_*`、代理变量及 `NODE_OPTIONS` 后显式传 `FMCG_DATA_DIR` 和 `FMCG_LLM_CONFIG_FILE`。HTTP 单测另建其专用目录，B04 既有证据输出已在本批开工前落 TEMP。适配器测试发到本地 HTTP fake 或被同进程替身捕获。Windows 代理测试仅运行离线探针。首次 npm 末尾保留原版本提示，后续显式启用 npm offline 并禁用更新提示。真实 Provider 调用与费用 0，正式 workspace 和真实配置/凭据未读取或写入。测试子进程和 UI 施工的自有进程均退出，证据保留。

## 冻结与交接

[前后文件 SHA256](COMPAT01-20261105-builder-fingerprints.json) 对照 5,412 份开工指纹。5,380 份未变化，32 份为本批批准范围变化，0 移除。4,114 份历史报告及截图全部原 SHA。新增 4 个代码文件为两份测试辅助与两份 UI 隔离入口。真实模型语义与真实 Provider 仍为 NOT_RUN，旧质量结论保持历史状态。本次未提交、推送或部署。
