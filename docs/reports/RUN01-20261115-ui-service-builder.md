# RUN01 自动化界面与 Windows 常驻施工记录

施工为 Sol High，基线提交 `b1695fb366e0957cb3fb38a9d6c6f0fb3c774bf7` 加当前工作树。提交、推送和批次裁决由主线程处理。

## 已交付

- 侧栏「自动化」和首页状态卡接入受保护的 Automation API。页面显示工作进程、全局状态、最近 24 小时失败数和上海时间的下次运行。全局暂停与恢复均先确认。计划表单支持启停、固定间隔、每天定时和补跑，服务端冲突时保留输入。
- 运行历史按任务、状态与条数筛选。详情展示触发、状态、步骤、错误、用量和产物，可取消活动运行。读取错误与历史损坏原因在对应区域显示。
- Windows 脚本支持 `TaskName`、`Port`、`DataDir`、`UseProxy`、`NodePath` 和 `ConfigFile` 配置，安装前显示配置并等待确认。启动动作以当前用户登录触发，隐藏运行，等待子进程退出并传递退出码。代理复用现有启动脚本。状态检查将计划任务的 Node 命令标识与实例锁和本机健康检查对应。卸载先停任务的启动器，再按归属停止代理包装进程和 Node，最后移除任务。后台日志保留 14 个自然日，内容为启动、持续运行、退出和重试状态。

## 施工检查

在项目根目录分别使用 Node `v22.23.5` 和 `v24.22.1` 执行下列专项测试，透明命令启动版均为 4 通过、0 失败。输出保存在被忽略的 `.scratch-run01-evidence/ui-service-command-node22.log` 和 `.scratch-run01-evidence/ui-service-command-node24.log`。

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --test tests/run01-ui.test.tsx tests/run01-service.test.ts
node ./node_modules/typescript/bin/tsc -b --pretty false
git diff --check -- README.md app/App.tsx app/api.ts app/pages/HomePage.tsx
```

Node 22 初版严格类型检查退出 0。最终 5 个 PowerShell 文件均通过语法解析。受控注册夹具检查当前用户登录触发、InteractiveToken、Limited、原生重启计数 0、隐藏动作和显式退出码传递。真实 WinPS 5.1 使用透明命令从带空格、中文和单引号的临时目录运行直连和代理分支，检查连续失败时恰好启动四次、最终传递退出码 7，以及失败后下一次退出 0 时结束。夹具通过临时副本缩短重试等待。日志清除过期文件、保留其他文件，过滤模拟密钥和正文。界面测试覆盖确认前零写、暂停与恢复令牌、409 输入保留、重读后保存、立即运行、取消、状态筛选和首页时间及入口。

初次注册夹具中，任务计划模块自动加载覆盖了模拟函数，登记了指向临时目录的 `AIPM-RUN01 Fixture`。任务未启动。检查动作目录归属后已移除，并确认查不到该任务。最终夹具仅对临时副本替换唯一注册调用。施工检查没有启动正式工作台或用户自启任务，没有读取项目 `.env.local` 或实际工作区数据，也没有请求模型。

## 独验返修

独验实际启动的 Node 命令行在进程标记后存在尾随空格，原 WMI 筛选遗漏该 PID，状态查询与卸载都受影响。现在 WMI 初筛候选，再核对 Node 路径和末尾独立的完整标记，允许尾随空白。Windows 实进程回归覆盖同一命令行含两个标记时，仅识别末尾标记。Node 22 和 Node 24 最终专项均通过。

首次全量检查的两个服务夹具只报告空退出状态，原断言遗漏子进程 `error` 和 `signal`，该次具体错误无法追溯。后续强制超时探针报告 `ETIMEDOUT` 和 `SIGTERM`，按单次随机标记停止 1 个匹配进程，复查为 0，探针文件和临时目录均已清理。证据见 `.scratch-run01-evidence/ui-service-timeout-probe.log`。再一次全量检查确认注册及 CIM 夹具 15.421 秒触发 `ETIMEDOUT`。考虑到有限重启夹具还需顺序启动多轮真实子进程，将两处测试等待预算设为 30 秒，并附阶段、退出码、错误和信号。生产重试间隔固定 60 秒。

原生计划任务在测试环境中已配置 1 分钟、最多 3 次重启。独验强停 Node 后观察到退出码 -1，任务返回 Ready，在观察窗口内未再次启动。用户随后明确批准改为启动器内重试，固定间隔 1 分钟，最多 3 次，停用原生重启避免叠加。生产启动器在每次启动到退出期间独占处理该子进程，非零退出和启动异常使用剩余次数，退出 0 结束本次任务。每次登录或手动触发是一次独立任务运行。

原生重启版本的另一次卸载探针因启动前置故障以结果 1 结束，具体内部错误未记录。有限重启初版的 Retry 探针再次未创建数据目录。该次 Windows PowerShell 动作确已启动，事件 400 记录完整 Settings，事件 4104 记录装载 `task-settings.ps1`。

同解释器、工作目录、Settings 和完整前置脚本的直接对照中，`-File` 加隐藏参数约 33 秒退出且无阶段记录。清子进程模块路径后重现。保留隐藏参数改为透明 `-Command`，退出 0/7 的对照分别在 598/550ms 完成全部五阶段，并传回准确退出码。最终登记动作采用这个入口。安装和任务归属判断共享动作的精确前后缀，解码前验证标准 Base64。保留现有代理分支。详细同 PID 事件、原始探针及计时记录在 `.scratch-run01-evidence/ui-service-startup-diagnosis/`。

全量日志另显示注册夹具尚未启动 PowerShell，立即覆写复制出的脚本时触发 EBUSY。两个夹具先在内存变换内容，再一次写入临时脚本。新版真实计划任务启动、重启和卸载由独立实测裁决。

## 验收交接

本次界面和脚本施工专项通过。RUN01-06 的隔离计划任务登录配置、健康状态、连续两轮按计划触发、强停后的任务重启和卸载，以及 RUN01-07 的 1440/390 真实浏览器交互由独立验收执行。本报告记录施工结果，批次结论由独立验收给出。

## 文件指纹

以下为交接工作树 SHA-256。

| 文件 | SHA-256 |
| --- | --- |
| `app/App.tsx` | `be49979aa53b07641560259e300ce6aaf0698ed8d5550529d9bf1a4d84130e0f` |
| `app/api.ts` | `71e0a4b04079e678c34d14b958b4434a40c71c938ec543becc6b90805ce48173` |
| `app/automation.css` | `513b3a69a850f8b33a9cbdefb9a1d0af29fe62108849026945c1d07252d25a8e` |
| `app/pages/AutomationPage.tsx` | `827b69b212442859729ed2f5e64bcb03d3a3802c1df9019f22840527989d7cd5` |
| `app/pages/HomePage.tsx` | `4b2e5b3abd1b9b0be119796be8cf78c8a03caa5f6fc06de400ec975c5372f1d3` |
| `README.md` | `9c7735691aaa0e02f3da52389702af5e6ba17caa102baf3ac94e48e8c5d9291d` |
| `tests/run01-ui.test.tsx` | `2eb848764ecf145dbe316231aaac4776a049a402679dfbcdc33155bef4354ee2` |
| `tests/run01-service.test.ts` | `ef2e87ba8cbfc35cc7f973f28b1210ab9c3f4005011408d8c091c8d1c8578a00` |
| `scripts/service/install-autostart.ps1` | `6edb3fa39ef25f0f010b11276dc42160a23ee8a8217e1ddd8c7935a909fed8eb` |
| `scripts/service/run-autostart.ps1` | `dbae8a93116820d08c63c65d88cdbebcfab12702a9990170385a4121a26246bd` |
| `scripts/service/status-autostart.ps1` | `c3eed0191939a4fc0eaca70adfc732fd9505f48757f6c7dd835153d291a17f94` |
| `scripts/service/task-settings.ps1` | `eaf92fc63324ebc0ceb27a2550f76c177df4b3f499e308e9024b80f5f3712159` |
| `scripts/service/uninstall-autostart.ps1` | `ee6bbb96620dfb1b55a7242a0d98530b1581c2fdb671455ee0e2ee745f106e2f` |
