# WORKAUTO01 施工报告

基于 `1ba43c2d9443a3ca8aec33fe74014e47db7b6f68` 的工作树完成 W1–W6。规划和独立验收按 B 模式执行。Sol High 审查冻结计划及可测性后施工，W5 由同型号施工子 Agent 实现并自查。

## 交付内容

- `work.reminders` 每 60 分钟扫描，默认启用。按上海自然日区分当前到期和逾期，到期优先于久未推进。新资料按最近完成轮的实际来源计算，包含明确继承的来源。首轮分析前，所有已关联且可选的 Raw 均可触发提醒。
- 提醒中心保存已读、延后、自动消解和投递状态。设置版本使用 revision 并发校验。先持久化投递尝试，再调用 Windows，重启能保留上次未确认的结果和去重依据。默认上限 3，设置允许 1–10，超过上限时最后一条用于汇总。
- 适配器只接收标题、提醒类型和简短计数，转义 XML 并限制单段 120 字符。PowerShell 调用使用本机 Start 菜单中的 Windows PowerShell 应用标识。投递受理、禁用、超时和失败分别记录。Windows 测试、CI 与其他平台默认走安全适配器，定向验证注入假通知器。
- 自动化页可查看提醒、已读、延后、打开事项、修改设置及发送固定文案的测试通知。首页到期卡补充久未推进和新资料汇总。产品事项跳转聚焦本轮资料区域，保留用户手动选择及确认。
- 经主线程批准，`services/work-items/store.ts` 和 `services/work-items/analysis-runs.ts` 增加复用既有校验的容错扫描入口。`app/pages/WorkAnalysisPanel.tsx` 复用已有本轮资料焦点。其余修改在任务卡文件清单内。

## 施工验证

| 命令或证据 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=4 tests/workauto01.test.ts tests/work01-http.test.ts tests/work-delete.test.ts tests/kbmaint01.test.ts tests/run01-api.test.ts tests/run01-ui.test.tsx tests/lifeos-l3-home-ui.test.tsx tests/uifix04-ui.test.tsx tests/homeui01-ui.test.tsx` | Windows Node 22.23.5，30/30 通过，其中本批 8 项。 |
| `git diff --check`（本批已跟踪文件） | 通过 |
| 隔离 Vite 构建与 Edge 界面自查 | 249 模块，保留已有体积警告。1440×900 和 390×844 的控制台错误、横向溢出和分析 POST 均为 0。验证已读、延后、通知设置、固定测试结果、首页入口和资料聚焦。截屏与结果位于 `%TEMP%/workauto01-ui-i3w13e/`。接口采用合成响应。 |

定向测试使用真实磁盘存储和随机本机端口。用假时钟验证上海日期、静默起止、延后恢复、消解、保留期限和去重。事项、分析和 Raw 文件 SHA-256 在扫描前后一致。恢复出的提醒文件与备份前逐字节一致。注入的假通知验证标题转义、正文隔离、失败、超时和中断保留，所有扫描实际模型调用 0。

施工使用隔离数据、合成来源和假通知。真实 Windows 系统通知、连接实际隔离服务的双尺寸浏览器、全量回归与回放、远程 Node 22/24 CI 由相应验收环节记录。

## W3 WinRT 返修

独验首轮发现 PowerShell 5.1 读取 `ToastNotifier.Setting` 返回空值，直接调用 `.ToString()` 在 `Show` 前失败，HRESULT 为 `0x80131501`。适配器改用可接收空值的字符串转换。只有 WinRT 返回明确的禁用枚举时才提前结束。空值继续尝试 `Show`，失败仍记录 HRESULT。

施工预检执行适配器生成的 PowerShell 命令，将 `Show` 替换为只读探针。实际 `Setting=[]` 成功构造 Toast 并到达调用点，探针退出 0。模拟 `DisabledForUser` 提前退出 2，适配器返回对应禁用原因。预检发送 0 条系统通知。

Windows Node 22.23.5 执行 `node --import tsx --test --test-name-pattern WKA-03 tests/workauto01.test.ts`，两条用例均通过，分别覆盖假通知抛错或超时后的安全降级，以及落盘投递记录中断后同窗口去重。`npm run typecheck` 和该文件的 `git diff --check` 通过。
