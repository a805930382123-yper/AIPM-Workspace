# B01 独立验收报告

验收日期：2026-10-03；执行者：acceptance_monitor（GPT-6.1 Sol High）。范围仅为 B01：本地骨架、Raw 文本、持久化与首页统计。没有修改产品代码。

最终结论：**B01 PASS。独立 API/文件7组与桌面浏览器场景 B01-08 全部通过，B01-01–08 合计8/8 PASS。** 冷启动、新标签页与重启后长文复验没有复现首次 Hook 错误；该瞬态记录保留为风险，不声称通过产品代码修复根治。尚未验收的功能不因本批成功而获得 PASS。

## 冻结版本与执行环境

- 版本以 `B01-api-evidence.json` 的 `version` 中 6 个 SHA-256 指纹为准；执行前后相同，无并发源码变化。
- 命令：`node tests/acceptance/b01-http.mjs`，Windows / Node / 实际本地 HTTP 服务；没有产品 LLM 调用或 mock AI。
- 数据：`C:\Users\80593\AppData\Local\Temp\fmcg-b01-acceptance-jZKRdR`，测试结束保留可复查；主 API 4317 与用户 `workspace/` 未被脚本修改。
- 实测记录区间：`2026-10-03T06:17:17.856Z` 至 `06:17:19.275Z`（脚本主体约 1.4 秒）；提升工具调用墙钟约 6.8 秒。子 Agent token 计量不可得。
- 首次普通沙箱调用：服务已打印隔离端口监听，但健康检查不可达而超时，后续项未运行。相同脚本提升执行后全部通过；此差异归为本机沙箱/loopback 限制，不判产品 FAIL。最终 JSON 保存成功运行的证据。
- 收到浏览器记录后再比对：JSON中全部6个指纹仍与最终代码一致；stats代码已包含 `index.md` 排除及本周 `[start,end)`，无需重跑已通过场景。浏览器版本 `app/main.tsx` SHA-256=`5642624b524341e6c8d65a04ec418d4b1e50acef61a674db56e06a9d495d070b`；当前测试文件 SHA-256=`7525c333ec11da7ef97e95f426318280825ec9333dd06654998a6d66c29722ef`。

## 实际运行结果

| 证据场景 | 结果 | 可复查事实 |
|---|---|---|
| B01-01 初始化/health/空统计 | PASS | 全新隔离数据根创建，8 来源所需目录存在，列表为空，六统计均为0。 |
| B01-02 10万字符与 Markdown 边界 | PASS | 100,000 字符/299,898 UTF-8字节，含前后空白、CRLF/LF、正文 `---`、类似 YAML、emoji；POST/GET/磁盘正文逐字符相同。正文 SHA-256=`f059515354822d1731cf43ced9cbe24f6be7f7722caf80686302cd893d3c21dc`。含路径/HTML/换行的标题只入元数据，UUID v4 落盘，客户端 path 字段不入文件。 |
| B01-03 8来源与元数据 | PASS | wechat/article→articles，report→reports，company/customer/meeting/note/other 按约定目录；可空作者/原日期/URL有效，来源名/类型/标签可读。 |
| B01-04 错误请求不落盘 | PASS | 空/空白标题与正文、无效类型/URL/tags 返回400；500,001字符与超3MB请求返回413；非法JSON400、不存在ID404；错误均有 code/message，前后9个正式文件集合一致。 |
| B01-05 真实写入失败 | PASS | 在隔离数据根把 notes 目录临时替换为文件，触发真实 ENOTDIR；API返回500/INTERNAL_ERROR，不成功、不新增正式/临时资产；恢复目录后新请求201成功。 |
| B01-06 重启与资产不变 | PASS | 停独立服务、同目录换端口重启，10条列表记录与所有文件 SHA-256 不变，10万正文仍相同；无可用 PUT 更新正文路径。统计 Raw=10、本周新增=10，其余对象为0。 |
| B01-07 上海周界 | PASS | 实际 HTTP 统计4条隔离记录：上海周日23:59:59排除；周一00:00与00:00:01计入；下周周一00:00排除；Raw=4、本周新增=2、weekStartsOn=2026-09-28。 |
| B01-08 桌面 UI/刷新/统计/导航 | PASS | 主 Agent真实 UI 长文导入/刷新/统计/导航已通过；清本项目 Vite缓存并重启后，当前页reload及全新标签页正常，新tab error日志为空，重启后原100,007字符正文exact匹配且末尾空格保留。 |

证据文件：`docs/reports/B01-api-evidence.json`；可重跑脚本：`tests/acceptance/b01-http.mjs`。原始测试目录保留正文和 Markdown；JSON仅含摘要、计数、路径与错误证据，没有重复输出长文。

## 主 Agent提供的真实浏览器证据

来源为主聊天浏览器工具实际操作、1366×900桌面工具图像及主 Agent交接记录；截图落盘遭 Cua FS EPERM，本报告没有声称存在本地截图文件。主 Agent与验收 Agent分工独立，验收 Agent没有控制共享浏览器。

- 页面 `http://127.0.0.1:5173/` 初始首页 Raw=0。
- 通过 UI 表单保存《验收数据（非业务资料）｜10万字符长文》，sourceName=`B01 浏览器验收`，author=`测试`，tags=`验收/演示数据`；正文100,007字符，含中文、换行、正文`---`与首尾空格。
- 真实保存成功 ID=`ce81e5e6-f4dc-4114-84e8-0d20bde286d2`。页面 reload 后首页 Raw=1、本周新增=1，其余四统计为0。
- 再点击 Raw 读取原记录；`getByText(b01Body,{exact:true}).evaluate` 核对正文完整匹配、长度100,007、首尾空白保留。
- 五项导航齐全，三个未来模块 disabled 并标“后续”；当前操作无故障。
- 首次瞬态记录：`dev.logs` 在 `2026-10-03T06:16:58.525Z` 出现 `Invalid hook call/useState null`。builder核对单份 `react@19.3.0/react-dom@19.3.0`，无重复依赖树；错误时间与 Vite首次优化 `react-dom/client` 后reload重合。这支持“首次优化瞬态”的判断，但尚未证明永久根因。
- 冷启动复验：builder校验路径后只清本项目 `node_modules/.vite`，停止旧dev再启动，产品源码未变。主 Agent对原tab reload正常，日志无新增error（只有上述旧记录）。
- 全新tab复验：直接打开正常首页，点击Raw并通过exact `getByText(b01Body)`确认服务重启后100,007字符及末尾空格完整；新tab `dev.logs(error)=[]`。因此本批当前运行门槛满足，保留首次优化时可能短暂reload的已知风险，后续若复发以新证据立缺陷。
- 验收资料清理完成：主 Agent核对来源、ID和绝对路径后，仅将本轮自建ID `ce81e5e6-f4dc-4114-84e8-0d20bde286d2` 移至 `docs/reports/fixtures/B01-browser-long-raw.md`；前后文件SHA-256一致为 `28320fad813e1edd26e0916e0fb411cffff327202cad7bbd5b0d44570be87594`。验收 Agent独立核对归档文件摘要相同。正式Raw文件数0，没有删除或移动用户资料。
- 最终服务恢复：旧前台dev会话关闭后，主 Agent以隐藏 `Start-Process` 恢复相同 npm/concurrently 启动脚本，PID记录在 `docs/reports/runtime/dev.pid`，产品源码未变。新浏览器tab实际访问5173成功，首页六统计全0、最近导入为空、console errors为空；页面已作为交付打开并恢复默认viewport。本项为恢复/清理确认，未重复完整功能测试，B01 PASS保持不变。

## 原文 ID 判定

| ID | DOC | RUN | 说明 |
|---|---|---|---|
| A01 初始化 | PASS | PASS | 空目录真实启动与重启。 |
| A02 创建 Raw | PASS | PASS | API/文件与主 Agent真实 UI 提交均已通过。 |
| A03 粘贴长文章 | PASS | PASS | 独立100,000字符API/文件逐字核对与100,007字符浏览器粘贴/阅读均通过。 |
| A07 Raw刷新后存在 | PASS | PASS | 真实浏览器刷新回读与独立服务同目录重启均通过。 |
| A06 AI不能修改Raw | NOT_RUN | NOT_RUN | B01无产品AI路径，读取/重启不改原文已 PASS；真实AI回归留B04。 |
| A61 无LLM手动能力 | NOT_RUN | NOT_RUN | 无LLM的Raw后端链路已 PASS；Wiki/Prompt手动能力留后续。 |
| A63 桌面核心流程 | NOT_RUN | NOT_RUN | 仅B01原始资料子链路；四条完整主线留B09。 |
| R08/R10 Raw字段/导入 | NOT_RUN | NOT_RUN | 文本、来源与落盘子证据已 PASS；文件上传与删除等不属B01。 |
| R31 首页计数/入口 | NOT_RUN | NOT_RUN | HTTP六统计、周界和浏览器导入后计数已 PASS；完整五入口留后续。 |

表中子证据只说明已实现范围，整项未完成仍为 NOT_RUN。其他 A/R ID 均保持原计划 NOT_RUN，无 LLM、Wiki/Prompt、上传、搜索、Audit、Lint 或导出 PASS 声明。

## 自检结果复核与遗留

builder 首次报告 `npm run build` PASS、单测5/5 PASS；主 Agent随后交接最终单测6/6 PASS；已核对施工报告与生成的 `dist/index.html`/assets存在。这些为施工证据，独立运行证据以上表为准；最终再比对运行源码与app指纹未变，没有重复已通过的构建/单测/API检查。当前可复现产品缺陷0；首次优化Hook瞬态作为1项已知风险保留，冷启动与新tab实测未复发。无模型升级触发。B01批准完成，本轮不推进 B02。
