# B09 F09-03 施工返修记录

日期：2026-10-08。依据 `docs/reports/B09-audit-count-fix-card.md` 修复首页 Open Audit 计数在提交 Audit 后未刷新的缺陷。仅改 `app/App.tsx`、`app/pages/WikiPage.tsx` 和 B09 交付文档；后端/存储协议、测试文件、历史报告、正式 workspace 与密钥均未改。产品代码现已再次冻结，等待主 Agent针对性桌面复验。

## 修复

根因是 AuditPanel 创建成功后未调用全局 `onChanged`；决议路径虽已有回调，却在当前 Audit 选择代次失效时先返回，可能漏掉全局统计刷新。App 返回首页也没有主动重读统计。此次修复：

- Audit `POST /api/audits` 成功后立即请求全局统计刷新；即使用户在请求途中切换 Wiki，已提交 Audit 的统计变更仍会刷新。
- Audit resolve 成功后，在检查当前详情选择代次之前请求全局刷新。accepted、partial、rejected、deferred 均走同一成功路径；本地详情更新仍受原 `selectionVersion` / `activeAuditId` 门禁保护。
- 导航回首页时重新加载 Raw、统计与处理状态。
- `App.refresh` 增加单调请求代次；只接受最后启动的刷新结果，避免较早响应较晚返回后覆盖新统计。

没有强制全页 reload、写入固定计数或更改 Audit/Wiki 数据协议。真实浏览器重测 create→Home Open 1、deferred 仍为 1、accepted/rejected 后为 0，以及刷新/重启保持一致，由主 Agent执行。

## 构建检查

| 命令 | 结果 |
|---|---|
| `npx tsc -b` | PASS，退出码 0，5,011 ms |
| 沙盒 `npm run build` | Vite 因 `EPERM realpath app/main.tsx` 失败，退出码 1，5,532 ms；TypeScript 阶段已完成 |
| 提升环境 `npm run build` | PASS，退出码 0，4,408 ms；Vite 转换 45 modules，打包 934 ms |
| 相关浏览器/HTTP检查 | 待主 Agent针对性复验；按返修卡未重跑完整 tests、备份 CLI 或无关 HTTP |

构建产生的 `dist/` 被 `.gitignore` 忽略。真实 Provider 成功与质量继续 BLOCKED。之前首版 152/152 tests 和 39 项浏览器记录仍作为首版冻结期间的独立证据，不表示 F09-03 修复版已通过浏览器验收。

## 最终 SHA-256

| 路径 | SHA-256 |
|---|---|
| `app/App.tsx` | `3A025339194EA9F5DC262141F4E75A8505C29295D3C093B2BEF34151EEB36904` |
| `app/pages/WikiPage.tsx` | `169B944A6DA3A0033FCC3F0FA65A39E0931E253C101557FF07A35179234E5203` |
| `docs/delivery.md` | `95E7DAED26C4EB9336C5CBDBC892D91C3465399D6F9ADBDA4A8E5666AACBD2EF` |
| `docs/delivery-matrix.md` | `D8F7F93C262C1481BA134157FEB0B8017AF4F721F7971892A5B1D0CEC5C968F8` |
| `README.md`（未改） | `8C4089279A41AE2412FC6A93A7FA6FE8BDCB8051E6B1D8BAA1A3C5281AE8493E` |

矩阵仍包含原 109 个 A01–A63 / R01–R46 ID；R31 标为针对性复验待做，A63/R42 保留首版 fake 机械链路结果但明确 F09-03 未闭环。施工 Agent不据首版浏览器结果补签修复版 PASS。
