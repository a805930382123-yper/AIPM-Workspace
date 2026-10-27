# R1618 F04 隔离入口续接施工诊断

2026-10-27。施工 Sol High `r1618_entry_finish`；基线沿当前卡 a6c1f6d1de7b97772cdf0ea1fcb91e7cc04b91be。仅接续 F04，施工不签独立验收。未使用 Git、未修改产品、未操作 Chrome；原 11 文件同 SHA 和旧工程矩阵由主 Agent 复用，本轮未重跑。

## 实际变更及当前结论

仅修改 `tests/acceptance/R1618-FIELDS-20261026-lab.mjs` 的 Vite 配置：

- `resolve.preserveSymlinks: true`：绕开 Vite Windows realpath 的 `net use` 探测；源码证明可绕过已观察的 EPERM 分支，但不是全部超时根因。
- `cacheDir: path.join(root, 'vite-cache')`：使用本 lab 自身 TEMP 缓存，避免配置变更时删除项目共享 `node_modules/.vite/deps` 失败。未删除共享缓存、未操作其他 5178 服务。
- `optimizeDeps.entries: ['tests/acceptance/R1618-FIELDS-20261026-browser.tsx']`：在前三次诊断交回后，经 Astra 独立认可与主 Agent 放行，限定扫描为实际隔离入口。最后一次验证证实扫描目标已纠正，但仍超时，不能称底层慢根因已关闭。

`envDir: root`、`configFile: false`、`provider = () => undefined` 保持。`browser.tsx` 未改；不预填字段、不审批候选。

**原 8 秒 smoke 仍未通过，当前无可交付 Chrome 的活动 URL。** 三处修改已完成语法自查，但不足以让入口在原时限可用，不能声称 F04 入口已修复或批次通过。提升权限后无 EPERM，仍卡在依赖扫描等待；最后一次定点验证后按主 Agent 门槛停止实验及写入，交 Astra 独立复审。

## 必要源码证据

只读检查安装版 `node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js`：

- 6917–6949：首次 `windowsSafeRealPathSync` 调用 `optimizeSafeRealPathSync`，其中异步 `exec("net use", callback)`。异步回调本身不构成“net use 等待导致模块超时”的证明。
- 16361：`getRealPath` 仅在 `!preserveSymlinks` 时调用 `safeRealpathSync`。包解析 6281 同样受该选项控制。
- 14218：未指定 `optimizeDeps.entries` 或 build input 时扫描 `**/*.html`；`appType: 'custom'` 不改变这段入口计算。
- 16108：`tryOptimizedResolve` 首先 `await depsOptimizer.scanProcessing`。浏览器入口含 React 裸导入，会经过优化依赖解析；扫描未完成可以阻塞其转换。

第3次提升权限实际日志确认扫描项目 `index.html`，没有扫描本次 custom HTML 引用的隔离 TSX 入口。此为已观察的加载顺序与范围问题；第4次已纠正目标但仍超时，为什么扫描/加载耗时仍未证实。第3次停止/取消后出现 `no dependencies found`，不能把该文本解读为一次正常完成的空依赖成功扫描。

## 实际命令和结果

四次命令均为：

```powershell
$env:DEBUG='vite:resolve,vite:transform,vite:deps,vite:load'
node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --smoke
```

每个 HTTP 请求保持原 `AbortSignal.timeout(8000)`，没有扩超时；以下运行顺序均经主 Agent 明确确认，后续修复基于新错误证据，不是无变化重启。

| 次序 / 配置 | sandbox_permissions / session | 实际结果 |
| --- | --- | --- |
| 1：仅 preserveSymlinks | use_default / 2935 | 14:21:51 配置变化触发重优化，删除项目共享 `.vite/deps` 的 rmdir EPERM，退出 1；未进入模块 HTTP 检查。TEMP `r1618-fields-lab-fx4Thu` 保留。 |
| 2：preserveSymlinks + TEMP cache | use_default / 49671 | shell 200，browser.tsx fs load 1277.87ms，无 transform 完成；06:24:17Z scan 日志 37561.83ms 后，Vite 内置 esbuild `ensureServiceIsRunning → context → prepareEsbuildOptimizerRun` spawn EPERM，退出 1。不是 net use 的 EPERM。 |
| 3：同版原 smoke | require_escalated / 7774 | shell 200，browser.tsx fs load 26.02ms；06:26:20.178Z 明确 `Crawling dependencies using entries: E:/AI/Work/AIPM Workspace/index.html`。随后原请求超时，close 等待取消扫描；06:26:40.381Z scan 22422.64ms，输出 `R1618 fields lab stopped` 和 TimeoutError，退出 1。无 EPERM；没有执行到 DraftReviewPage 单模块或 API smoke。 |
| 4：加隔离 TSX entries，最后一次定点验证 | require_escalated / 91777 | 06:30:36.371Z 扫描目标已为隔离 TSX，shell 200；browser fs load 21.86ms，DraftReviewPage/WikiPage/CSS fs load 约 5605ms。06:30:48.874Z React 三项依赖 resolve 约 9131ms，browser transform 12409.47ms。原请求已超时，finally close 后 scan 报 `server is being restarted or closed. Request is outdated`；停止日志和 TimeoutError，退出 1。无 EPERM；扫描目标纠正未使原时限 smoke 通过。 |

语法自查：`node --check tests/acceptance/R1618-FIELDS-20261026-lab.mjs`，退出 0。

只读进程核验均使用 `require_escalated`，避免把默认沙箱空输出视为停服证据：

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq 5176 }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Select-Object ProcessId,ParentProcessId,CommandLine
```

启动前成功退出 0，5176 无监听，Node 清单无本卡 lab，仅其他工具及 5178 服务。结束后命令成功退出 0，5176 / 64797 / 64571 无监听，按 `*R1618-FIELDS-20261026-lab.mjs*` 过滤无进程。未关闭其他任务服务。

## 隔离实物及版本

最后一次 TEMP root（保留，不活动）：`C:/Users/David.chen/AppData/Local/Temp/r1618-fields-lab-B1Ga0o`。

- manifest：该目录 `active-lab.json`；原 fixture：`r1618-lab.json`。
- 原 session 91777 已退出 1；manifest 中 `http://127.0.0.1:5176/r1618-fields?draftId=6e2bd446-79f9-4011-87ae-2a8a19f1827f` 和 API `http://127.0.0.1:65113` 仅为失败运行记录，**当前不可用**。最后一次提升权限只读核验命令退出 0，5176 / 65113 无监听，lab 进程匹配为空。
- 上一次 TEMP root `C:/Users/David.chen/AppData/Local/Temp/r1618-fields-lab-HeHgdf`（session 7774，API 64797）保留，服务已停。
- 另一次保留 root：`C:/Users/David.chen/AppData/Local/Temp/r1618-fields-lab-3G72cv`（session 49671，API 64571）。
- 最终 lab SHA256：`AE9341E108CD559700EA72072C9718C39734DADDDE67077C814334478C64E2FF`。第2/3次受测 SHA 为 `CFDC24232C02C71933DF0CCDBBA5FBE45183DB37FCD28A7CB2C2C2B15F35AFFD`；第1次中间版本仅有 preserveSymlinks，未单独冻结 SHA。最终版 `node --check` 再次退出 0。
- browser.tsx SHA256（未变）：`CFB4424620555BF8E38C94FFC1A3ED468C7D5CD4639CC3AE27D3747CDB100D84`。

新建 TEMP 下无项目实际配置读取入口，Provider 保持 undefined，无真实模型调用。manifest 的历史 `configReads: 0` 是静态元数据，不将它作为实际零读取的证明；上轮默认 envDir 可能读项目配置的偏差保留。

## 遗留与交接

F04 浏览器编辑→刷新→审后修改→重审→正式保存回读仍 NOT_RUN；人工工程能力旧服务证据不替代这项实测。R16/R18 自动质量和全产品/B09仍不签通过。

前三次诊断后的 entries 候选已获 Astra 独立认可，并完成唯一一次定点验证，仍失败。最终日志将等待定位在扫描/React依赖解析一带，且显示文件 load 数秒；底层延迟原因未证，不归因产品、不猜测其他配置。关闭过程引发的 `request outdated` 是超时后取消时序，不能作为模板字段产品缺陷。当前封存阻塞交主 Agent / Astra 决定后续，不再自动改参数、启动或扩超时。

施工交接后停写；由主 Agent / Astra 独立判断实际差异与后续范围。
