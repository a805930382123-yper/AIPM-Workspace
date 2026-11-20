# WORKAUTO01 独立验收（2026-11-21）

**局部结果**　通过。WKA-05 的 PowerShell 空值缺陷已修复。新 TEMP 数据根上的固定测试通知和四项合并的汇总通知均获得 Windows WinRT 受理。WKA-01–06 的验证均已完成。

**整批结果**　通过。WKA-01–07 均满足任务卡要求。初验基于 `1ba43c2d9443a3ca8aec33fe74014e47db7b6f68` 上冻结的差异，最终工程提交为 `5202f862bda6bd9cdf0627e29c8d4fea7c172c08`。Astra Medium 规划与独验，Sol High 施工，实例分离。

| 项目 | 实测结果 |
|---|---|
| 分类、来源与零业务写入 | 上海自然日的今日/逾期判定、严格超过久未推进阈值、到期优先、有新 Raw 的产品事项、最近已完成分析与继承来源通过。真实服务扫描四个合成事项，两个到期、一项久未推进、一项新资料。读取期间四个事项文件和一个 Raw 的 SHA-256 全部一致，外发请求及模型请求均为 0。 |
| 去重、状态与时段 | 定向假时钟覆盖跨午夜免打扰、跨日去重、已读不反弹、延后到期恢复、条件消解、30 天清理、开关/全局暂停及汇总上限。真实服务上限设为 1 后，四项只触发一次汇总尝试，同日复扫没有新 ID 和 PowerShell 进程。真实机时区为 China Standard Time，首轮 UTC 11 月 20 日 16:52 对应上海 11 月 21 日 00:52，两者按上海当日归类。 |
| 隐私、异常及存储 | 假 notifier 验证 XML 和长度边界、正文哨兵未进入通知、超时及抛错仍完成落盘、中断不重复投递。坏事项和分析文件单条隔离，备份恢复提醒文件逐字节一致。独立服务错误 token 与跨域 Origin 均得 403，过期设置 revision 得 409。 |
| 真实系统通知 | 首轮固定测试通知和真实扫描的汇总各启动一个 powershell.exe，均退出 1，系统接口返回 HRESULT 0x80131501。站内记录 failed，运行账本成功完成扫描。无发送探针显示 CreateToastNotifier 返回 ToastNotifier，含 Show 方法与 Setting 属性；PowerShell 5.1 在本机会话读取 Setting 时得到空值，在调用 ToString 时抛 RuntimeException，未执行 Show。本轮证据不能归类为系统通知禁用。 |
| 真实生产 UI | Edge 157.0.4341.60，1440×900 和 390×844 两个独立 TEMP。均操作首页汇总、活动列表、已读、延后、设置免打扰为 23:00–06:00、打开客户事项、前往产品事项分析。焦点落在资料选择区的 LEGEND“本轮资料”，Raw 未预选，分析 POST 为 0。无水平溢出，页面及控制台错误为 0。每种尺寸保存 4 张截图。 |

## 验证命令

以下 `node` 为项目 Node.js 22.23.5。真实服务使用动态回环端口、临时数据根、空 Provider 配置及单独的生产构建，测试期间子进程所有外发 fetch 均被记录和阻止。

- `node --import tsx --test tests/workauto01.test.ts` 通过 8/8。涵盖 WKA-01–04 的扫描、时间边界、来源判断、投递、备份与恢复及写接口。
- `node --import tsx tests/acceptance/workauto01-review-browser.mjs` 退出 0。两种尺寸均从产品实际界面操作。
- `node --import tsx tests/acceptance/workauto01-review-winrt.mjs` 首轮退出 1。宿主实发条件启用，记录系统子进程退出码、应用交付状态及业务 SHA。首轮留档的 PowerShell 权限诊断未调用 Show。

[双尺寸浏览器证据及截图](WORKAUTO01-20261121-review-evidence/) · [首轮真实通知记录](WORKAUTO01-20261121-review-evidence/winrt-initial.json)

## WinRT 返修复验

在新 TEMP 数据根用相同 Node 22 命令重新执行 WinRT 验收，退出 0。修后适配器文件 SHA-256 为 `c61739218ba5af982233cde24f2da78e314d3f9b3ccbb3122fdc658311a5bd56`。程序将空 Setting 安全转换为字符串，只在 Windows 明确返回禁用枚举时提前结束。固定非业务测试通知和扫描运行 `86ef7713-2808-4f69-8375-40ab980a0c17` 的合并通知均成功执行 Show，两次 powershell.exe 分别退出 0，测试 API 返回 delivered，4 个事项的桌面状态均为 delivered。同日再次扫描保留原提醒，并未产生第三个 PowerShell 调用。四个事项和一个 Raw 的文件哈希清单在扫描前后一致，外发与模型请求为 0。以上证据确认 WinRT 接受投递，未做系统横幅的人工目视确认。[修后真实通知记录与哈希](WORKAUTO01-20261121-review-evidence/winrt-final.json)

## WKA-07 修后全量验证

采用主线程在修后工程提交 `5202f862bda6bd9cdf0627e29c8d4fea7c172c08` 上取得的证据。隔离四核、项目 Node 22 下，`npm run check` 退出 0，类型检查、991/991 项测试与生产构建全部通过。`npm run eval -- --chain standard-extract --recording live-20261115-baseline` 回放通过 8/8，事实 21/21；`npm run eval -- --chain news-relevance --recording synthetic-v1` 回放通过 12/12。回放模型请求为 0。

工程提交的 Windows Node 22、24 两档最终均成功。首轮 Node 22 的既有 F04-08 并发用例预期 404、实际返回 409；相同 SHA 单独重跑失败作业后通过。该现象与上批记录一致，本批未修改相关处理。[工程 CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44778814872) · [Windows 作业一](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44778814872/job/136439085235) · [Windows 作业二](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44778814872/job/136439087626)
