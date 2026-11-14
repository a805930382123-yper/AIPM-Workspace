# PDF01 真实清理返修施工交接

基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0` 加既有 PDF01 未提交文件。施工与本机 fake 检查完成，交 Astra 独立验收。真实续测另有释放门。

- PDF 清理与主题索引使用现 Provider 的严格结构化输出。只有适配器确实启用 strict 时，才把可选的 wire null 解码为缺省字段。随后继续执行业务形状、处置字段、全覆盖、重复内容、表格及主题索引的校验。
- 错误保留原失败码，并附阶段、静态 schema 字段路径和原因。未声明属性只报告所在对象，不回显属性名。响应值和凭证不进入诊断。此前真实响应正文未保留，具体坏字段未知。
- GET 在发现旧快照仍活动、进程任务已退出时，重读同范围的持久状态。实际失败、完成或取消可见，真正中断仍提示显式继续。业务检查点保持 version 1。已保存决策仍用原业务语义，未完成批显式续跑。

## 实际验证

- `node --import tsx --test tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` 通过 11/11，含真实 adapter 经本机 HTTP 的两阶段 strict wire、可选 null、普通文本兼容、缺字段和坏动作、未知属性脱敏、索引重复或遗漏、可控 GET 竞态、PDF02 公开 HTTP 和恢复。新增专项 4，既有回归 7。
- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` 退出 0，无诊断。因无输出，Tee 未生成文件。
- Vite `build({configFile:false,root:process.cwd(),envDir:<空TEMP目录>,plugins:[react()],build:{outDir:<TEMP输出>,emptyOutDir:false}})` 退出 0，233 模块，只有已有体积提示。施工范围 `git diff --check` 退出 0。
- 全仓存在 7 个旧损坏测试文件，上一轮 `tsc -b` 有 9 条诊断。此次验证范围是产品入口及受影响测试，未重跑全仓。[上一轮全仓诊断](PDF01-R2-20261110-backend-builder.md)

测试原始日志 `combined.txt` 和 `build.txt` 位于 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf-cleanup-structured-ff2c8d17-58a8-4df5-be4f-fa383a457702`。

| 冻结文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `0050bb50215f83e012a0292047b7e61f25f6ff1326af76b18bd59b82ceba6238` |
| `tests/pdf-cleanup-structured.test.ts` | `e94f1dd6601adc1e38975c53c3e7a4af488708ada668261e67d97981dfd8e1f5` |

## 同账续测准备

原 TEMP 根 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a` 保留旧工具、release、锁、R1 和原 7 次账本。另存 `r2-initial-failure-preserved.json`，SHA 与原失败检查点一致。新工具使用原 Raw 和检查点，只调用 R2，所有请求先记账并禁止重定向。每次失败停。未建真实 release 或真实锁。

- `node --check <TEMP>/pdf-real-repair.mjs` 及 `node --import tsx <TEMP>/pdf-real-repair.mjs prepare <repo>` 通过。
- `node --import tsx <TEMP>/pdf-real-repair.mjs fake <repo>` 在副本中从 8 到 12 完成四个清理批和一个索引批，生成草稿，正式 Wiki 0。日志 `repair-fake-bF4D79`。
- `fake <repo> budget` 预检余量不足，0 新增，日志 `repair-fake-VxdveN`。`fake <repo> hardcap` 在 12 后拒第 13 次，日志 `repair-fake-ENfDlL`。`fake <repo> failure` 第 8 次坏结构后停并返回 `$.decisions[0].reason`，日志 `repair-fake-NnnRCQ`。负例各退出 1。四个副本均核对旧账本前缀逐字节一致。
- `pdf-real-repair.mjs` SHA-256 `a27d9e449fd8e0a604e13d2ff2898ab1b01b7b947e1f15dc0cf5e6c5050f2cfe`。`freeze-repair.json` SHA-256 `c3706a5eddbf5a34797d79a228709812ca3a3703222fcf2dbcf2812d1b2ba236`。真实续测初始账本 SHA-256 `a2b51fd1cc4db0af621e63ab893aace1f843705242e4bbb7a0140e2db3981bd2`。

真实最少还需 5 次，正好等于余量。若实际索引需要第二批，发送边界会拒绝额外请求。施工与 fake 验证期间真实请求、用户配置读取和正式资料操作均为 0。未提交。
