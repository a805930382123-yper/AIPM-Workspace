# LLM-Wiki 3-2 独立验收

施工前基线 `d4c62e3`。独立探针启动生产模式服务，使用系统临时目录、合成凭据、回环模拟 Provider 和随机端口；生产界面由 Edge 158.0.4370.45 驱动。后端禁止外部模型请求。下列模型结果用于核验调用、保存与展示。

## 检查点与人工审阅

| 独立样例 | 实际观测 |
|---|---|
| 两块 Raw 更换模型 | A 收到第 1、2 块，第 2 块返回 HTTP 400。改变来源标题后，续跑返回 409 `LLM_CHECKPOINT_INCOMPATIBLE`，两次物理请求的计数不变。恢复标题并换 B 后，同一任务只发送第 2 块、规划和维护，总计 5 次。B 的系统提示包含结构、编号与来源坐标衔接要求，正式 Raw 文件逐字节一致。Edge 人工审核显示“跨模型续跑”、A、B 及核对原文提示。 |
| 老检查点 | 删除新指纹和模型记录并按历史格式重签完整性。经原有输入校验，复用 1 个块。Edge 提示“沿用的 1 个旧块没有模型记录”，未给旧块推定模型身份。 |
| 三块 Raw 往返切换 | A 完成块 1，B 完成块 2，A 完成块 3、规划及维护。读取持久化草稿的 `model_switches`，依次是 A→B、B→A。 |
| 三页 PDF | 实际收到 A 第 1 页、A 第 2 页、B 第 2 页、B 第 3 页。首轮第 2 页返回无效 JSON，第 1 页未重发；B 收到衔接提示，任务累计 4 次调用、完成 3 页。下载的 1,429 字节 PDF 与上传文件完全一致。 |

施工中间版曾在保存最终检查点时报告 `STORAGE_SETTLEMENT_FAILED`。同一生产探针现获得 `completed`、`stage=done`、`recovery=null`，并在 Edge 打开该任务的草稿。此缺陷复验通过。

## 模型健康和离线工作

- 无配置时，填写有效问题后“提问”仍禁用，界面提示补齐 Provider。主端模拟 503、备端成功后，Prompt 业务请求返回 201，问答按钮可用；在“复核工作台 → 索引状态”读到主端 HTTP 503、备端模型名和近期备用成功记录。
- 随后双端均返回 503，问答按钮灰显并提示连接不可用。显式对备端执行一次重档连接测试后，按钮恢复。主动关闭双端后，界面提示模型已在本机配置中关闭。整条链实际发送主、备、主、备、备共 5 次；打开抽屉、刷新可用性和轮询均未触发额外模型调用。
- 无模型时，通过 Edge 搜索 Wiki、打开详情、编辑标题并保存，下载 Markdown 确认含新标题。在 Prompt 工作台填入变量“三号仓”、生成最终正文、点击复制，从系统剪贴板读回“请检查 三号仓 的订单”。这组操作的 Provider 调用数为 0。Wiki 列表筛选与 SQLite FTS 分别核验，后者见千页和冻结评测。

## 实际命令与仓外证据

运行 `node node_modules/vite/bin/vite.js build --logLevel error` 生成界面。对下表每个文件执行 `Get-Content -Raw -Encoding utf8 (Join-Path $env:TEMP $name) | node --import tsx --input-type=module -`，各探针退出 0。

| 探针 | 检验对象 |
|---|---|
| audit-batch32-checkpoint.mjs | 生产 Raw 续跑、指纹、请求计数及 Edge 标注 |
| audit-batch32-legacy.mjs | 缺少新字段的老检查点和人审提示 |
| audit-batch32-sequence.mjs | 草稿切换顺序 A→B→A |
| audit-batch32-pdf.mjs | 生产 PDF 续页、结构指令、原件校验 |
| audit-batch32.mjs | 生产 HTTP 路由、手动恢复及 Edge 离线操作 |

主 Agent 运行冻结 25 问，一跳开关各 50 行，非耗时字段均与 3-1 一致。千页 6,000 块，重建 2,629.48 ms；SQLite FTS 平均 13.94 ms、P95 28.91 ms，历史扫描平均 603.00 ms、P95 744.32 ms。

## 冻结版本与独立复验（2026-11-28）

产品提交 `ceff6cc58fb1278da10232ccb59a21b1132f8524`，父提交 `d4c62e33d5fdafca5cfd66b71439d1da28161892`。独立验收逐项核对首轮冻结树 `1ee7d65f77921d3bc0ba86a11941f45e0147cbfa` 的 48 项差异。22 个前端文件对应模型可用状态、AI 操作入口、健康抽屉与人工审阅标注，2 个服务入口接入状态和诊断，12 个服务模块负责检查点、来源、草稿与路由健康，8 个测试和 4 份任务或交付记录覆盖上述行为。48 项均归属 3-2。

首轮全仓 1,154/1,156。FE01 发现前端公共 API 多导出一个函数，RUN01 发现无模型配置时自检误报已配置。用 `git diff 1ee7d65 6c54243` 核对返修仅涉及三个文件。状态抽屉直接读取相同的路由，公共 API 恢复原有 130 个导出；自检改为检查加载结果中的实际路由配置。用 `git show -s --format='%H %T %P' HEAD` 核实产品提交对应最终树 `6c5424368818a305bb00cea4dca1e87f2c5b8cb6`。

| 独立复验实际命令（Node v24.22.1） | 结果 |
|---|---|
| 首轮树：`node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=2 tests/kb03-deep.test.ts tests/pdf01-http.test.ts tests/pdf02-http.test.ts tests/provider01-entry.test.ts tests/provider-router.test.ts` | 52/52，0 跳过。覆盖标准与深度 Raw、新旧检查点、两条 PDF 链、生产 HTTP 主备与手动恢复。 |
| 最终树：`node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=2 tests/fe01-api-barrel.test.ts tests/run01-api.test.ts tests/provider01-entry.test.ts` | 8/8，0 跳过。公共 API、无配置自检和真实路由健康接口复验通过。 |
| 最终树：`node --import tsx --input-type=module -`，以 JSDOM 挂载 WikiModelStatus，点击“刷新状态”，记录 fetch 并断言 DOM | 显示主端已关闭、备端未配置。模拟返回的 HTTP 503 刷新后更新为 502。挂载与刷新各发一次只读 GET /api/llm/routing。 |

上文 Edge、冻结 25 问及千页基准为此前实测，本轮复用。首轮冻结时两个施工报告所列的 10 项 SHA-256 全部匹配；独立报告之后改动的文件仅为兼容测试及施工说明。返修三文件未改动检查点、离线业务或检索引擎，受影响的自检、抽屉和路由接口在最终树单独复验。旧 Edge 临时探针已无法从本机临时目录取回，本轮 UI 复验使用 JSDOM。

最终树全仓门禁复用主 Agent 的同版运行记录。六项依次为 `typecheck`、`format:check`、`lint`、`guard`、全仓测试和 `build`，均退出 0。lint 0 错误、769 条警告（3-1 为 761 条），guard 检查 6,267 份、0 违规。六并发全仓 1,156/1,156，0 跳过和取消，耗时 110.57 秒；生产构建成功，保留包体积提示。

产品提交的 GitHub Actions 两个作业均完成并通过。[工作流 46030737982](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46030737982) · [Node 24.x](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46030737982/job/140613571029) · [Node 22.x](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/46030737982/job/140613571428)

**本轮缺陷复验 PASS。** 存储结算缺陷已由生产探针验证关闭。首轮全仓发现的公共 API 导出与无配置自检回归均在最终产品树通过独立复验。

**3-2 整体独立验收 PASS。** 跨模型续跑和草稿来源、模型健康与手动恢复、离线操作、冻结检索评测、千页基准及同版全仓门禁均有对应证据。签发范围为 3-2 任务卡。
