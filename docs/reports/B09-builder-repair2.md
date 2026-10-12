# B09 F09-04 施工返修报告

日期：2026-10-08。施工模型按主 Agent指定保持 GPT-6 Luna High。任务依据：[F09-04 最小返修卡](B09-stale-wiki-fix-card.md)。

## 变更

失效的 Home 最近 Wiki 明确目标曾被 `WikiPage` 的延迟列表刷新逻辑回退为第一条 Wiki，造成错误详情和导出链接展示。仅修改 `app/pages/WikiPage.tsx`：显式打开的 ID 不在列表时保留该请求目标，不以首条 Wiki 覆盖；错误由对应对象请求呈现。显式打开标记在用户开始创建、手动选择 Wiki、保存成功、删除，以及修改搜索/分类筛选时清除，使用户进入普通列表或主动筛选后仍可选择有效页面。F09-03 的 `app/App.tsx` 未修改。

## 检查结果

| 检查 | 结果 | 实测 |
|---|---|---|
| TypeScript | PASS | `npx tsc -b` 退出码 0，5.547 秒。 |
| Production build（普通沙盒） | 环境未完成 | `npm run build` 退出码 1；Vite `realpath app/main.tsx` 返回 `EPERM`，33 ms。保留原环境错误，无产品绕过。 |
| Production build（提升环境） | PASS | 同命令退出码 0，4.625 秒总耗时；Vite 45 modules，934 ms。 |
| F09-04 真实浏览器定向复验 | NOT_RUN（交主 Agent） | 施工方没有运行浏览器。待核对：删除对象及旧新建历史入口不泄漏其它 Wiki 正文/导出链接；有效非首项目标、泛列表和手动选择；F09-03 计数保持。 |
| CLI、HTTP、完整测试套件 | NOT_RUN | 本次仅有 Wiki 选择回退修复，按任务要求不重跑无关 CLI/HTTP/全量测试。沿用主 Agent此前已报告的相关有效证据，不把它们当成本次 F09-04 复验。 |
| 真实 Provider 成功/质量 | BLOCKED | 产品 Provider 未配置；fake 机械链路不证明真实模型成功或质量。 |

## 交付状态

`docs/delivery.md` 与 `docs/delivery-matrix.md` 将 F09-04 记为已施工、待主 Agent独立复验。A63/R42 的失效 Wiki 边界复验仍待完成；R31 与 F09-03 保持 PASS/CLOSED；真实 Provider 仍 BLOCKED。主 Agent最终浏览器与文档验收报告由主 Agent更新。

本报告未修改旧任务卡、旧施工/验收报告、测试或验收证据。完成本报告后施工方冻结本批产品文件；待独立复验如发现问题，由主 Agent按新返修指令安排。

## SHA-256

| 文件 | SHA-256 |
|---|---|
| `app/pages/WikiPage.tsx` | `4CC3F0970C1A156D7F12DD05E6C85D19718EC9E163A61A05536277E20D5B3585` |
| `app/App.tsx`（未变） | `3A025339194EA9F5DC262141F4E75A8505C29295D3C093B2BEF34151EEB36904` |
| `docs/delivery.md` | `3E83B8F20AA5BFF1AE2F7F37594A4202C0744F84A3AE4E43B94E1CE2B14848C3` |
| `docs/delivery-matrix.md` | `671EF8BE7F5E735382595FDCFB6D6BBE8D77BF29AD8BB0A5E82C2D88FEE76097` |
| `README.md`（未变） | `8C4089279A41AE2412FC6A93A7FA6FE8BDCB8051E6B1D8BAA1A3C5281AE8493E` |

交付矩阵行数复核：109（A01–A63、R01–R46）。
