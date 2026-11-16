# PIPE01 施工交接

基线 `23ad39b7311bada1ef9a4111417949d32812fcc4` 上的工作树。B 模式施工为 Sol High，规划和独立验收由 Astra Medium 承担。本报告记录工程自测。真实常驻触发、真实来源与 Provider、1440/390 浏览器截图、正式人审写入及远程 CI 由独立验收和主线程核验。

## 交付

- `news.daily` 默认上海时间 07:30、启用补跑。复用同一 NewsService 的当日缓存与来源配额，记录分栏健康、短缺及来源 HTTP 次数。任务自己的准备请求只抓取来源材料，既有每日资讯页面可继续使用原摘要分析设置，两者共享当日缓存。
- 收件箱按日保存资讯快照、预筛、用户选择与确认授权。批量预筛上限 10，失败批保留未预筛结果，继续下一批。预筛独立开关默认启用，关注主题和并发数采用 revision。低分按用户决定默认折叠。
- 单条和批量确认先持久化授权，后台经共用 NewsRawSave 串行保存。来源身份复用相同 Raw，保存失败可单独重试；整理复用 Wiki 锁、既有 ExtractionRunner 和人审事务。默认并发 2，设置范围 1–4。未开始的授权重启续排，启动后的中断需显式继续。
- 首页卡片呈现已抓取、待确认、排队/整理中、待审草稿、失败。已抓取进入包含已忽略条目的对应筛选。待审草稿进入首页既有审核列表。失败按保存收据读取异常、Raw 保存失败、整理失败或整理中断计数，预筛异常在未预筛条目和运行记录中显示。
- `app/App.tsx` 仅增加首页筛选与现有自动化页间的导航传参。新增独立的 news-relevance 合成回放及阈值，并接入现有 EVAL CLI 和 Windows Node 22/24 CI。历史 standard-extract 阈值与录制保留。

## HTTP 与独立验收入口

所有路由前缀为 `/api/automation`。写入沿既有 JSON、Origin 和 `X-FMCG-Automation-Token` 门禁，令牌来自 `GET /status`。候选 ID 用 URL 编码传输。

| 路由 | 契约 |
| --- | --- |
| GET `/candidates?date=YYYY-MM-DD` | 日期可省略，默认上海今日，返回 `date/dates/items/counts` |
| GET/PATCH `/pipeline/settings` | `revision`、`preScreenEnabled`、`topics`、`concurrency` |
| POST `/candidates/confirm` | `requestId` UUID、同日 `candidateIds`、`organize`、`mode`。在授权落盘后返回 202 |
| POST `/candidates/:id/disposition` | `{ action: 'ignore' | 'later' | 'restore' }` |
| POST `/candidates/:id/retry-save` | 空对象，以同一确认授权及保存收据重试 Raw |
| POST `/candidates/:id/retry-organize` | 空对象，以原 Raw 和既有作业检查点显式继续，返回 202 |
| GET `/runs?type=news.daily` 或 `/runs?type=pipeline.organize` | 运行历史，详情包含步骤、来源请求次数、模型次数和 Token、未知用量、候选与产物身份 |

隔离源码镜像为 `%TEMP%\aipm-pipe01-builder-be71d16ed0d446f980d3f33e3d516b7f\checkout`，内有独立依赖及构建目录。独验建议在同版本源上使用另一个 TEMP 数据根、配置路径和空闲端口运行 `npm start`。先通过 HTTP 把 `/schedules/news.daily` 计划改为上海时间 2 分钟后，等后台来源准备完成再首次打开浏览器首页。首页既有「每日资讯」组件挂载会调用同日缓存的 prepare 入口，提前打开会让手动页面请求先取得来源缓存。真实验收沿正常 TLS，无需改来源或 Provider 代码。

## 工程自测

验证数据、配置和 dist 位于 TEMP，未读写正式 workspace、未重启 4317、未安装自启。施工真实来源、真实模型请求均为 0。当前工作树的其他任务修改和旧报告保留。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 初轮产品接口及 UI 均通过 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/run01-core.test.ts tests/run01-api.test.ts tests/news01.test.ts tests/news02.test.ts` | 23/23 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/pipe01.test.ts tests/pipe01-ui.test.tsx` | 假时钟、HTTP 门禁、关闭和无 Provider 时零请求、严格 Schema、持久 disposition、逐字来源相同、并发、部分失败、重启、真实 runner 对接假 Provider、jsdom 确认和折叠 |
| `npm run eval -- --chain news-relevance --recording synthetic-v1` | 合成录制 12/12，结构、分数、类别、模式及依据阈值均达 1.0 |
| `npm run eval -- --chain standard-extract --recording live-20261115-baseline` | Git 镜像复用冻结录制，8/8，事实 21/21 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/pipe01.test.ts tests/pipe01-ui.test.tsx tests/run01-core.test.ts tests/run01-api.test.ts tests/run01-ui.test.tsx` | 账本读写返修后 22/22，失败、跳过 0 |

真实 ExtractionRunner 加本地假 Provider 的单条标准整理产生 3 次已知模型请求、输入 300、输出 600、未知 0，自动化 ledger 与 fake 对账一致。另有一笔预筛请求，分属 `news.daily`。原文相同，草稿出现在既有首页 action，自动化阶段 Wiki 与 Prompt 正式记录保持原状。正式写入继续在独验中通过浏览器人审核对。

首次完整 `npm run check` 在归档镜像测试 909/913，出现两个 EVAL01 镜像问题和两项全并行下调度断言失败。镜像规则文件受本机 autocrlf 设置被转成 CRLF，变更既有规则指纹，且归档无 Git HEAD。此轮证据保留在同级 `check.log`。最终镜像从指定提交本地克隆、以 checkout 配置禁用 autocrlf，并覆盖施工文件。

Git 镜像返修前完整检查 912/913，两项 EVAL01 和全部 PIPE01 通过，RUN01 计量假 Provider 期望 6 次尝试实际 4 次。隔离诊断以 12 个 Node 子进程并发执行 `node --import tsx --test --test-name-pattern "RUN01 meters|RUN01 schedule" tests/run01-core.test.ts`。仅在诊断镜像输出账本底层异常。旧实现 8/12 个子进程失败，观察到 11 次账本文件原子替换的 Windows `EPERM rename`。账本读轮询与每次 Provider 调用前后持久化会接触同一文件，落盘异常可在请求发出前结束步骤。诊断副本将读与原子替换放进同一串行队列后，相同压力 12/12 进程和 24/24 测试通过，未出现 `EPERM`，日志分别为 `ledger-probes.log` 和 `ledger-probes-serialized.log`。正式修复也将初始化读取和保留清理中的读删纳入该队列，保留读盘校验及现有原子重试。

返修后默认 16 CPU 完整检查 909/913。PIPE01 9/9 和原 RUN01 调度、用量测试已通过。剩余四项在本机并行夹具中分别表现为两个 Provider 测试进程未在约 10 秒内就绪、RUN01 API 挑选的 50998 被同一轮 RawURL 假代理占用。RUN01 日志记录该端口的 `EADDRINUSE`，RawURL 代理收到本应发往 RUN01 API 的同端口 `/api/health` 探针。完整日志为 `repaired-check.log`。这些端口与用户 4317 服务无关。对 `tests/provider01-entry.test.ts tests/rawurl01-http.test.ts tests/run01-api.test.ts` 定向复测 12/12，日志为 `fixture-regressions.log`。

最终在同一文件指纹的 Git 镜像，以 Node 24.18.0 执行原命令 `npm run check`。仅限制本次 PowerShell 验证进程树的 CPU affinity，Node `os.availableParallelism()` 实测为 6，测试、命令和超时均保持原样。严格类型检查通过，913/913 测试通过，失败、取消、跳过均为 0。生产构建 235 模块成功，Vite 提示单个压缩前 JS chunk 超过 500 kB。完整日志为 `six-cpu-check.log`。施工结论为范围内实现及本机隔离验证完成，待真实独验和远端 CI 裁决。

## 交付文件指纹

SHA-256 以工作树原字节计算。下表包含施工和测试文件，未纳入其他线程维护的任务卡、状态和验收证据。

| 文件 | SHA-256 |
| --- | --- |
| `.github/workflows/ci.yml` | `a277477cf9929a57c038a4999a543bb18ea785caaca126cbba730540ec7f8fbb` |
| `README.md` | `7efaf7430400e8ae23d793771b4453eb923fe5c2fcd8e5b807697e0db848453e` |
| `docs/architecture.md` | `6e4e64d8bf1ca51b7085f533294169b70ffd40f9c2447d792b33a1372ff6f33a` |
| `app/App.tsx` | `3adbed2214fb1849e23e7a3a079792339b032d926c1af70260c918a50b32581e` |
| `app/api.ts` | `fcc67987056c04257f773de0031480607bd9725c7e259ee89271d6fa30fb2004` |
| `app/automation.css` | `811a0ac947ed6d3909a4ca35aa28f2b018f84acbb271dfca18f1e4b71d2d9dc7` |
| `app/pages/AutomationPage.tsx` | `ee2a978953399c4230d68a1a8270d689230a14733990c8e9bf2073db3491a3c1` |
| `app/pages/HomePage.tsx` | `1c5df1efc11e608c18b54a45eddd147b9472eb3d0a8d583eac49beae77de50cd` |
| `server/automation-api.ts` | `82c3008ed3e2c1a115595c903c93243ebd3a71b565627fef6d8db07beed1dcd0` |
| `server/index.ts` | `991e405e0ac99318c3acdc42f4a48a6358e6c1595c5992792ff3cf67da3f153e` |
| `services/automation/context.ts` | `9d48a6fca301ee143aabfe77472cd07c71520a9ffe528e0c3335e0047850d8ac` |
| `services/automation/ledger.ts` | `15b7886c040800148b3eb3a1448254e0919ba68dca8318aeb34e0279749b1fc8` |
| `services/automation/scheduler.ts` | `7711f45a1045d261f1a94ba6643324d2b81e24953ed2d389fd07722c2c062893` |
| `services/automation/types.ts` | `bb9f069c229a28abc220f6cc207c383569d5ec4830f720db180de59a0a72728d` |
| `services/automation/pipeline/service.ts` | `be74b6554817a9fa7e2356d9282f677ef1e9c7595b82460b05e15a2bfea069e5` |
| `services/automation/pipeline/screen.ts` | `83bdad9cc9064a7c18db5570d062bee27bbe1d5fbc133c6393187dbca2e6bd65` |
| `services/automation/tasks/news-daily.ts` | `334cfe25165081c315c3bdbeadb159a361c3cb2010c37e2da404c77e0669ed7d` |
| `services/news/additional-research.ts` | `f7297e53b91ece77ab52a28d6cf032da7bd7f527ac00a13c8f1a7711cdad79c7` |
| `services/news/new-research.ts` | `08e89344e820ce1e0d20ce68e8d05181f84af39df943ff25bdc82968041d1f54` |
| `services/news/raw-save.ts` | `754e14d07af4721e4226e7fe754869a6c706c41e728605102d392f787aaa4ad7` |
| `services/news/research-sources.ts` | `ed09ba0651b64008cc717189f45ea060b4508cf3269f897ddacd8a726f63fab2` |
| `services/news/service.ts` | `eb4cbd251e74dce2d36f20189c571417f94b7ac9ce940d7d073d1aa12f7d51e5` |
| `services/news/sources.ts` | `7dfaa8bc2befc2f01261b2275bd7d1d7483495b4fc004f1ad4834461bd04ce00` |
| `evals/cases/news-relevance/synthetic-v1.json` | `19cbcfb560165a694e2aa9cb0324ae8c0e7d7ea159e49e15c0e6cb48e1ba1b80` |
| `evals/cases/news-relevance/thresholds.json` | `83eca58bd61851d34c0e7475db9c74d01b9a96b9233c5f753a56e607241482db` |
| `scripts/eval/news-relevance.mjs` | `c13b4fe81e66055c0bd0d79c841a2b5915c0dfa650dd977571836caba05c816b` |
| `scripts/eval/run.mjs` | `d9d0434c8def8bee0db40240c80aa93a9a6fbe3d571b973746347222806d74ba` |
| `tests/pipe01.test.ts` | `749694463b0356dc1910205f721c9a369af1ef28e7923a5539b84f8b1b6627cf` |
| `tests/pipe01-ui.test.tsx` | `c085a0e71de93dca67e9b70ff53a9f379930f2ee97231edc6ba95d97eb026ead` |
