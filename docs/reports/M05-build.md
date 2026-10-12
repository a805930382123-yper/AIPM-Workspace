# M05 施工构建记录

日期：2026-10-12。施工范围：App 的 Raw 缓存刷新、会议 Raw 定位入口、显式 Raw 目标选择行为，以及 Meeting Hub 使用说明。独立验收由主 Agent 执行；本文件不表示 M05 已 PASS。

## 变更

- Meeting Raw 登记成功后，会议详情照常刷新，同时刷新 App 共享的 Raw 列表、处理状态和首页统计。失败路径不触发共享缓存刷新；会议切换迟到保护仍由 `MeetingRawLinks` 的 meeting ID 所有权检查负责。
- 进入 Raw 页面时重新读取服务端 Raw 与统计。会议记录的“查看 Raw”传递真实 Raw ID；目标不存在或连接失败时，App 持续保存显式目标意图，重连和同页后台刷新仍查同一 ID，不静默显示另一条 Raw。用户改选、普通导航或删除会清除该意图，恢复正常列表选择。等待刷新时用户新选择优先于旧请求；延迟到达的后台任务轮询也读取当前选择，不会用旧闭包把用户带回旧 Raw。Home、Wiki、Draft 和 Meeting 的回跳都传递具体 Raw ID。只有 `linked` 状态提供入口。
- 新增 `tests/meeting-integration-m05.test.tsx`，覆盖登记成功刷新、登记失败不刷新以及已关联 Raw 的 ID 导航；同时复跑既有迟到会议响应组件场景。
- 新增 `tests/app-m05-raw-navigation.test.tsx`，使用实际 App 组件和 mock HTTP 覆盖缺失的指定 Raw、刷新等待期间用户改选、后台任务轮询结束后的当前选择，以及 Home 最近 Raw 对较旧 ID 的定位。
- 新增 `docs/meeting-hub/M05-usage.md`，说明策略、原件/工作副本、Raw 关系、本机路径、备份与限制。
- 文案区分登记取消/写入前拒绝与跨文件部分成功：Raw 已写入但关联收据未完成时按真实 Raw 计数，并使用同请求恢复。

## 验证

- `npm run build`：PASS。TypeScript 与 Vite 构建通过；Vite 提示主 JavaScript chunk 为 531.77 kB（gzip 158.37 kB），高于默认 500 kB 提示阈值。该构建警告不影响构建退出状态。
- 定向测试：PASS，8/8。命令：`node --import "data:text/javascript,import os from 'node:os';os.userInfo=()=>({username:'runner',uid:-1,gid:-1,shell:null,homedir:'C:/Users/80593'});" --import tsx --import ./tests/support/css-stub.mjs --test tests/app-m05-raw-navigation.test.tsx tests/meeting-integration-m05.test.tsx`。覆盖目标缺失、目标读取失败后重连、刷新期间用户改选、后台任务轮询结算后保留用户当前选择、Home 旧 Raw 定位、删除后首条真实剩余 Raw 选择，以及 Meeting Raw 登记成功刷新/失败不刷新。既有 M04 Raw UI 的重试/冲突和迟到响应隔离为上一轮 2/2 证据。
- 测试宿主的原生 `os.userInfo()` 抛出 `uv_os_get_passwd ENOMEM`，导致直接启动 `tsx` 失败。定向测试命令通过仅针对该 Node 进程的 data URL preload 提供 `userInfo()` 返回值后通过；产品代码和系统环境未修改。完整 `npm test` 未运行，以避免覆盖既有 B04 施工证据。
- 本地浏览器、完整 Meeting HTTP/备份/跨批回归、文件保护和服务清理由主 Agent 独立验收；本报告不签认这些项目。

## 已知边界

真实 Provider 未配置/未调用；Meeting 来源 AI 仍关闭。旧 S-03/S-04 和项目级真实 AI 验收状态保持原记录。当前产品构建只在 Windows / Node v25.2.1 环境执行。
