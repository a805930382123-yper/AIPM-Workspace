# F04 首次模块计时施工交接

范围：仅 `tests/acceptance/R1618-FIELDS-20261026-lab.mjs` 新增 `--measure-startup`，并经主 Agent 批准启用 `server.watch.usePolling: true` 绕过本机原生 watcher 崩溃；产品与 browser.tsx 未改。用户 2026-10-27 最新要求覆盖旧 8 秒限制。基线按主 Agent 交接为 b70a2f1；本施工不执行 Git。

计时定义：每个 HTTP 请求发出前记录 UTC 开始时间及单调时钟，到响应 `end`（正文完整读取）记录完成时间、耗时、状态及字节数。使用 Node `http.get`、`timeout: 0`，不设置准备/请求时限，不采用 fetch 隐含超时。顺序仅页面壳、browser.tsx、DraftReviewPage.tsx、WikiPage.tsx 各一次；成功记录保存在 TEMP `startup-timings.json`。测量结束不主动关闭服务。HTTP 正文完成不等于浏览器依赖图完成、UI 就绪或功能通过。

实际命令：

```powershell
node --check tests/acceptance/R1618-FIELDS-20261026-lab.mjs
node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --measure-startup
```

语法检查退出 0。5176 启动前无监听；启动使用 require_escalated，避免已知 spawn EPERM。首次误用 `node --experimental-strip-types ... --measure-startup` 在 TS 参数属性导入处退出 1，未启动服务、未进入模块计时，已纠正为上述项目既有 tsx 命令。

运行 session 7454，TEMP `C:/Users/DAVID~1.CHE/AppData/Local/Temp/r1618-fields-lab-W84axH`，API `http://127.0.0.1:52628`，页面 `http://127.0.0.1:5176/r1618-fields?draftId=3f9273d0-b756-4d0c-923b-e3377cd780e0`。

| 请求 | UTC 开始 | UTC 完整结束 | 实际结果 |
| --- | --- | --- | --- |
| 页面壳 | 2026-10-27T07:37:31.897Z | 2026-10-27T07:37:39.061Z | HTTP 200，497 字节，7164.10 ms |
| browser.tsx | 2026-10-27T07:37:39.147Z | 未取得完整响应 | read ECONNRESET |
| DraftReviewPage.tsx / WikiPage.tsx | 未执行 | 未执行 | 前一请求失败后停止计时 |

随后进程退出 1，尾日志为 `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72`。故本次为 Node 原生文件监视断言崩溃，不能把 ECONNRESET 称作编译超时或编译完成。5176 已无监听，上述 URL 当前不可用；并非脚本测完主动 stop。主 Agent 已即时获告。

本版 lab SHA256 `87D4540FC371C557AA1D13B56C22AD96ABC88A4F7146EA0916FEA374A4687A3C`；browser.tsx 保持 `CFB4424620555BF8E38C94FFC1A3ED468C7D5CD4639CC3AE27D3747CDB100D84`。Provider undefined、envDir TEMP、preserveSymlinks、TEMP cache 及明确 optimizeDeps entries 均保持。未读取实际配置；meta configReads:0 不是整轮历史审计证明。未真实调用，不重跑旧工程矩阵。

## 最终保留服务及实测

主 Agent 批准仅 lab 启用 polling watcher 后，再次 `node --check ...` 退出 0；按原 `node --import tsx ... --measure-startup` 提升权限启动一次新 TEMP。最终 lab SHA256 `93ECD26190924ED4CBE1E0F6E1B32903253038A14786A8920392B5999E5EEFAB`。

| 请求 | UTC 开始 | UTC 完整结束 | 毫秒 / HTTP / 字节 |
| --- | --- | --- | --- |
| 页面壳 | 2026-10-27T07:41:44.348Z | 2026-10-27T07:41:50.966Z | 6617.66 / 200 / 497 |
| browser.tsx | 2026-10-27T07:41:50.984Z | 2026-10-27T07:42:19.764Z | 28779.94 / 200 / 9943 |
| DraftReviewPage.tsx | 2026-10-27T07:42:22.964Z | 2026-10-27T07:42:24.281Z | 1317.21 / 200 / 189794 |
| WikiPage.tsx | 2026-10-27T07:42:28.652Z | 2026-10-27T07:42:29.271Z | 618.28 / 200 / 231786 |

服务 session **95707**，API **53098**，TEMP `C:/Users/DAVID~1.CHE/AppData/Local/Temp/r1618-fields-lab-5tiTzY`，原始计时证据为该目录 `startup-timings.json`。页面 **http://127.0.0.1:5176/r1618-fields?draftId=028e1066-717a-4db6-a613-25eacd8ccaf0**。本报告写入时同一服务保留，未重启、未主动停止，不碰 5178 其他服务。已在四请求全部完成后通知主 Agent 进入 Chrome，计时阶段主 Agent 未导航同模块。

本次完成四入口完整响应测量，无准备时间上限；28.780 秒 browser 响应说明旧 8 秒取消不能据以认定编译不完成，但本轮 polling 环境不同，不能据此断言旧运行唯一根因。HTTP 模块响应不包含浏览器完整依赖图执行、渲染或功能验收。实际 Chrome 闭环交主 Agent，F04/整批由 Astra 独立裁决。本施工至此停写 lab，服务留用。

## 服务清理

主 Agent 完成 Chrome 并导出证据、关闭标签后，按其指令向自有 session 95707 发送 Ctrl+C，session 返回退出码 1（中断退出）。2026-10-27T08:21:11.6951896Z 提升权限只读核验退出 0：本卡 5176 / 53098 无监听；匹配 `*R1618-FIELDS-20261026-lab.mjs*` 的 Node 进程为空。普通沙箱首次进程查询曾拒绝访问，该次空数组不作为进程关闭证据；上述提升权限复核已确认。仅关闭本次自有服务，未操作其他服务；TEMP 夹具与计时证据保留。此后停止写入。
