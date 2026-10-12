# B09 施工记录

日期：2026-10-08。本文为施工方报告，不是独立验收。产品代码已冻结，主 Agent 可按冻结任务独立验收；施工后续仅写交付文档与本报告。

## 交付内容

- 首页六项实时统计、五个快捷入口、最近 Raw/Wiki 按 ID 定位。最近 Wiki 使用显式初始目标属性，并在异步列表返回时检查当前目标，避免打开非首项后被首项覆盖。删除的最近 Wiki 显示失效提示；演示 Raw/Wiki 记录可见“演示数据”标记。
- 设置页只在用户点击时导入 1 Raw、5 Wiki、4 Prompt；清单在 `state/demo-manifest.json`，显式携带版本、稳定 ID 和逐项状态。GET `/api/demo` 不自动导入，实际不存在、已删除、冲突和演示条目分别报告。重复/并发导入不覆盖编辑，不复活已删除条目；导入写盘失败保留非完成状态与可重试清单。示例任务标明演示数据，只预填 Generator。
- 离线 CLI `scripts/backup_workspace.ts` 仅归档 `knowledge/`、`prompts/`、`drafts/`、`state/`；使用 JSON、相对路径、长度、SHA-256 和 Base64。拒绝不存在源根、符号链接/特殊文件、白名单外路径、非规范/别名/冲突路径、错误格式/版本/Base64/SHA/长度、容量超限、互相包含的路径及非空恢复目标。restore 先校验全部文件，再临时写入并提交不存在或空目标；提交时重新检查已暂存空目录，并仅用 `rmdir` 移除确认空目录。入口以 `fileURLToPath(import.meta.url)` 解析，可直接从含空格路径运行。
- README 已修正 B08/B09 功能状态并记录运行、数据目录、Provider、演示导入和备份恢复。`docs/open-source-reuse.md` 列明逐文件本地映射及许可边界。`docs/delivery.md` 记录使用说明、实测与限制；`docs/delivery-matrix.md` 含完整 109 项 A01–A63/R01–R46 施工状态。真实 Provider 和浏览器证据未冒充 PASS。

## 接口与格式

`GET /api/demo` 返回 `{version:1,imported:boolean,items:[{key,type,id,title,status}],exampleTask:{title,task}}`。`status` 仅为 `present`（记录实际存在且 `isDemo:true`）、`deleted`、`missing` 或 `conflict`。首次 GET 不创建 manifest。

`POST /api/demo/import` 只接受 `{confirm:true}`；返回 `{version,created,reused,deleted,missing,conflicts,complete}`。条目引用包含稳定 `key/type/id`；冲突含 `key/id/reason`。`complete` 还要求 `missing`、`conflicts` 为空且 manifest 条目均已完成或已删除。Manifest 格式为 `fmcg-demo-manifest` v1，路径 `state/demo-manifest.json`，记录 `createdAt` 与每项 `pending/created/deleted` 状态。

归档格式为 `{format:'fmcg-workspace-backup',version:1,createdAt,files:[{path,size,sha256,base64}]}`。命令：

```powershell
node --import tsx scripts/backup_workspace.ts export --data-root <root> --output <file>
node --import tsx scripts/backup_workspace.ts restore --input <file> --data-root <new-root>
```

上限为单文件 64 MiB、总量 256 MiB、20,000 文件。归档不包含源码、依赖、环境配置、密钥或验收报告。

## 施工实测

| 命令 / 检查 | 结果 | 实测数据 |
|---|---|---|
| `node --import tsx scripts/b09_selfcheck.ts` | PASS，退出码 0 | 约 1.31 秒。未自动 seed、一次注入 Raw 写入错误后重试、并发导入、1/5/4 数量、编辑保留、删除不复活、二进制/JSON 恢复、空/恶意目标拒绝、不存在源根拒绝均通过；4 文件。 |
| 实际 CLI `export` | PASS，退出码 0 | 267 ms；含空格的源路径；归档 2 文件 / 22 字节。 |
| 实际 CLI `restore` | PASS，退出码 0 | 193 ms；恢复 2 文件 / 22 字节。二进制 SHA-256 源与恢复均为 `0150A92BB1212CD00516B65FDE0704614760000963874FCBB11EAA734EE87809`。临时 fixture 与归档已移除。 |
| `npx tsc -b` | PASS，退出码 0 | 4,637 ms；在最后一次 Wiki 精确定位改动后运行。 |
| `npm run build` | 最终冻结版本未由施工 Agent复跑 | 此沙盒此前 Vite `realpath app/main.tsx` 报 `EPERM`；主 Agent报告的提升环境 build PASS 属于先前探针，不能替代本冻结版本构建。 |
| `npm test` | NOT_RUN 完整套件 / 施工尝试被中断，退出码 1 | 已知沙盒中 B04 HTTP 启动场景约 13.1 秒超时，runner 随后长时间未结束，施工方中断自有 runner。`docs/reports/B09-builder-npm-test.log` 是部分日志，含失败尾部而非完整套件结果；不能作为测试通过或产品回归结论。未再次无限重跑。 |
| 桌面浏览器四条链路、视觉与重启交互 | NOT_RUN | 本施工 Agent没有真实浏览器操作证据，由主 Agent补测。 |
| 真实产品 Provider 调用和质量 | BLOCKED | 当前产品 Provider 未配置；不使用 fake 补签。 |

## 证据完整性和产物摘要

以下 SHA-256 为本报告形成时记录的关键交付摘要：

| 文件 | SHA-256 |
|---|---|
| `services/demo/service.ts` | `55C8177AEE5D2FD12C65CE5CD45201B8CD19F7EDBD12184EDBFEC82EBB9A6318` |
| `scripts/backup_workspace.ts` | `EE5AA0666F6F822C10C6E745D4CC363A53E56F4C02221276D8E093FF7220B464` |
| `scripts/b09_selfcheck.ts` | `C8201D1805C382F84645516BF815A88F514F1AB16D7D45C6F4DA39569822FB22` |
| `app/App.tsx` | `C5205937FE872E614354E5DFFD4893CAF209F3CC9C3DEFE64E4CCD7D1D24CC8D` |
| `app/pages/WikiPage.tsx` | `D179FBE2DFE875B33FFAC02E25F40D0104A9B5A93F9700C04B5C9B8BD673AD1A` |
| `docs/delivery-matrix.md` | `E45FA02C4BE3BFA7D67A55338C0783F7BBA24076F5B5BC98C3E947844513E854` |
| `docs/delivery.md` | `A94623D087536D48E0CECC06D85EF3DA8F6EECB767CE70FB20993A987B0E774E` |

冻结基线副本 `docs/reports/B09-acceptance-baseline/B04-http-evidence.json` 和 `B04-repair3-merge-payload.json` 分别为 1,786 / 10,003 字节，基线 SHA 分别为 `2B28D35E2B73A5A7AED00CD048DE5032D2FC1C74758A372FEA617EB380B89BCD` 和 `F3A425DD5E9CB8A72CE28F4A257A938199E495950D1E4C1FD607A023CCFE36AF`。施工过程中曾将两份工作路径原件从冻结基线恢复并核验相同。随后共享工作区中再次观察到工作路径 SHA 改变；已通知主 Agent，施工方没有继续改写该两文件，需由主 Agent按其独立验收/保护脚本确定当前生成物并恢复原件。施工新增/拷贝证据均以 `B09-builder-` 开头；`B09-builder-b04-http-diagnostic.log` 是一次未匹配测试的无效探针，不作为验收证据。

子 Agent 平台没有暴露 token 用量，本轮 token 记录不可得。跨平台 CLI、Windows junction 注入、late-file 并发注入以及实际用户数据量级未由施工自测；主 Agent独立测试或后续测试补足。

## 冻结后主 Agent 独立测试更新

主 Agent于冻结后报告：最终构建 PASS（1.03 秒），`npm test` 152/152 PASS（17.369 秒），B09 demo HTTP 7/7，归档全资产以及 18 个恶意归档/联接/非空目标场景 PASS，late-file 恢复竞态和导出前后改动检测 PASS；同时 B08 HTTP 15/15、B07 HTTP 11/11、损坏记录 4 类 + restart PASS。两条初始 fixture 预期不适用（自动演示 Wiki header、回收 Prompt 版本 API 404）；主 Agent保留原观察并修正 fixture 后将其归为无效预期，而非产品失败。此段是主 Agent口头交付的独立实测摘要，详细证明和最终门禁状态以主 Agent独立验收报告为准。
