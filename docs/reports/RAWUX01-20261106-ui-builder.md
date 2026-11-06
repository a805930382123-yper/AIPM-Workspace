# RAWUX01 UI 施工交接（2026-11-06）

Sol High UI 施工实例 `/root/kb03_r1_planner/lw03_ui` 已停写，交 Astra 独立复审。以冻结任务卡和 COMPAT01 工作树为基线，实际变更按 14 文件 SHA 核对。HEAD 基准 `275067c7d120b15051dedc3981b49c64a05c3f9b`，本轮未新增提交。

Raw 的标准、旧深度和现维护草稿共用整理成果页。主题清单默认显示标题、操作、简短成果与选择，完整正文、来源证据和高级编辑按需展开。整体检查区持续显示选择数量和来源笔记，只有一个正式确认动作。旧来源问题标注、字段和合并编辑保留在高级区。原有旧审批字段可留在历史记录，成果页不发送逐页或笔记审批。问答与检查继续原审核页面。

选择提交绑定服务端当前 `outcomeDigest`、revision 与所选页。旧暂缓可重新选择，旧更新决定可继续更新或明确改为独立主题。深度零主题明确仅提交来源笔记。保存失败保留输入，已有提交失败展示实际落盘数，继续使用冻结选集。正式写入结果可直接打开 Wiki。旧调用次数停止状态说明已适配显式继续。

## 实测记录

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb02-human-ui.test.tsx tests/kb03-confirm-ui.test.tsx tests/kb03-review-ui.test.tsx tests/r12-question-ui.test.tsx tests/r13-merge-ui.test.tsx`，9/9。适配 Raw 新语义，保留真实保存、可选问题标注、合并、原文定位、明确确认和原文不变断言。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb02-storage-ui.test.tsx`，5/5。全量首跑一项等旧审核文案，修复仅改真实成果页就绪及空选按钮定位。同任务 ID、恢复路径、累计模型次数、单草稿和空选门禁断言保持。
- `npx tsc -b --pretty false` 退出 0。空 envDir 隔离 Vite 构建 227 模块，保留现有 bundle 体积提示。所改已跟踪文件 `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check` 通过，14 文件行末空格检查为 0。全量默认测试由原后端 Sol 合并跑并交 Astra。
- `node tests/acceptance/rawux01-builder-browser.mjs C:/Users/DAVID~1.CHE/AppData/Local/Temp/rawux01-ui-ktUxy5/isolated-session.json` 退出 0。完整 App、实际 Chrome、正式业务 API 和 TEMP 合成数据。旧标准引用展开后原句精确高亮，旧标准和 32 单元/10 已选/2 旧审批/无笔记审批的旧深度均一次确认，零主题仅写来源笔记。新粘贴导入、进度、假 Provider 维护失败及显式继续、新维护 2 选 1、保存 503 保留编辑再成功、真实索引阶段故障 500 后同 key 继续 201、正式 Wiki 读回均通过。只写本次选项，Raw SHA 保持，浏览器页面错误和旧审批请求均为 0。
- `RAWUX01-20261106-evidence/builder-browser.json` 含最终 13 图。已打开核对实际截图，包含十主题精简布局、滚动确认区、原文定位、失败恢复和 Wiki 正文。原长图保存在 `builder-first-attempt-deep-ten.png`，首轮 JSON/失败截图另存。脚本准备曾错误等导入结果按钮，而应用保存后直接定位 Raw。编辑框使用实际 DOM 重新定位，准备问题均已修复。初版紧凑摘要出现标题重复，最终改用首个来源事实回退并用同 SHA 重跑截图。

## 隔离复现

在项目根执行 `node --import tsx scripts/rawux01-isolated.ts`，每次新建 TEMP 根、空 Vite envDir 和 TEMP 构建目录。输出及根下 `isolated-session.json` 含 `pid/url/api/root/envDir/outDir/fixtures`，fixture 键为 `standard/deep/sourceOnly/oldStandard/oldDeep/oldSourceOnly`。服务只连接本地假 Provider。脚本清除继承的 Provider/key 环境变量，产品配置加载器未连接。浏览器脚本使用本机 Chrome 与 `--no-proxy-server`。

只在合成服务提供 `POST /__control/delay {ms}`、`/fail-provider {stage}`、`/fail-save {}`、`/fail-commit {}`、`/recover {}`，以及 `GET /__control/counters`、`/requests`。最后一个自有服务 PID 38932 已停止，TEMP 证据保留。真实 Provider、配置与正式 workspace 访问均为 0。整批七类验收及真实模型质量由各自证据决定，本报告只签施工自查。
