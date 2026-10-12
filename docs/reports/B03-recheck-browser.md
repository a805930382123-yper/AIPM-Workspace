# B03 返修独立浏览器复验（2026-10-05）

结论：**10/10 场景 PASS**。主 Agent 实际操作 Codex 内置浏览器，使用真实文件选择与用户界面提交；没有模拟网络响应、替换产品模块或直接调用 React 状态。另以公开 HTTP 和磁盘核验持久化结果 **5/5 PASS**。产品冻结指纹25项保持不变。

## 环境与证据

- UI `http://127.0.0.1:5185/`，API `http://127.0.0.1:4325/`；Node v25.2.1 / Windows。全部数据在 `docs/reports/fixtures/B03-recheck-browser-20261005/`，与正式 `workspace/` 隔离；所有删除与故障注入仅操作本轮生成的测试资料。
- DOM 差分实录：[B03-recheck-browser-dom.json](B03-recheck-browser-dom.json)；少数重复观察只返回无变化，部分提交面板全文由截图保留。真实文件、标签与正文：[B03-recheck-browser-persistence.json](B03-recheck-browser-persistence.json)。后者含核验后的完整 Raw/asset/stats。
- 文件选择使用实际 `.md/.txt/.docx/.pdf` fixture，前端超限使用真实 20MiB+1 字节文件。部分提交使用实际目录占位导致关联记录读取/写入失败，未用 mock。
- 故障记录：[B03-recheck-browser-fault.json](B03-recheck-browser-fault.json)；脚本：[b03-recheck-browser-fault.mjs](../../tests/acceptance/b03-recheck-browser-fault.mjs)、[b03-recheck-browser-verify.mjs](../../tests/acceptance/b03-recheck-browser-verify.mjs)。各次服务日志与进程记录在 `docs/reports/runtime/B03-recheck-browser-*`。

## 逐项结果

| 场景 | 实际操作和断言 | 结果 |
|---|---|---|
| U01 F03-03 未编辑标签 | 粘贴创建 `[渠道,库存]`；重导入只修改标题/正文，标签预填顿号分隔且提示2项；保存后仍是两个标签，公开HTTP数组精确相等，新ID且旧正文/哈希不变 | PASS |
| U02 F03-03 编辑标签 | 重导入时输入 `渠道,库存、动销；SKU`，保存/回读精确数组 `[渠道,库存,动销,SKU]`，新ID | PASS |
| U03 F03-04 结果关闭 | 真实PDF上传；成功面板出现时背景列表已由3变4；点击面板「关闭」后切首页，Raw统计4，无刷新 | PASS |
| U04 F03-04 继续导入 | 真实Markdown上传，背景列表5；点击「继续导入下一条」，表单重置且已创建资料仍在列表，随后上传TXT | PASS |
| U05 F03-04 右上关闭 | 真实TXT上传后点击右上「关闭」，切首页Raw6、周新增6，无刷新 | PASS |
| U06 F03-04 查看 | 真实DOCX上传后「查看这条资料」，列表7且选中该记录，原件信息与中文正文展示正确 | PASS |
| U07 补齐最终删除 | 选择本轮生成的TXT，检查无正式Wiki引用后点击「确认删除」；列表与首页从7变6，API404；asset为detached且原件字节仍与fixture相等，恢复/刷新后未出现已删除Raw | PASS |
| U08 补齐前端超限 | 选择20MiB+1文件，立即显示FILE_TOO_LARGE；点击提交仍显示「超过20MiB上限，未上传」；前后全部Raw/asset/stats相同，Raw6、asset4，无成功面板 | PASS |
| U09 F03-01 部分提交 | API冷启动后上传真实PDF，监听新asset JSON并移动备份、同名建目录；资产初始状态stored，产品显示「部分提交：正文已入库，原件关联待恢复」及IMPORT_LINK_PENDING/两个真实ID/原因/勿重复导入/重启恢复；列表及首页Raw7，可查看已创建Raw，不显示成功 | PASS |
| U10 F03-01 恢复后浏览器 | 恢复JSON、同目录重启API后刷新页面；仍7条，仅同一RawID/assetID，显示原件格式/字节/SHA与提取说明。公开HTTP严格核对parsed、rawId/parser/note/format及原件字节、Raw内容不变 | PASS |

U08依据为真实界面提示及服务器持久化数据前后相等；未捕获逐请求网络跟踪，不声称已从 Network 日志证明零请求。U09的错误码与部分提交信息来自实际界面；独立后端报告另有精确500响应证据。不得把这两处证据方式混同。

## 关键标识与数据不变

- 原始双标签Raw `793e6204-0d89-46ce-a575-cb74747c0c2e`，正文精确为 `  原始标签复验正文\n保持原文。\n`，SHA `de8641ad4cfe4f5fbca60314b655524f505ed2233afb491b92593d6ddeb363cc`；重导入新记录保留两个标签。
- 部分提交Raw `e8330b7f-0dd3-409d-84f4-7f7e0b6c6d19`；asset `72741c6f-d598-4574-8bf8-d31036d65527`；PDF40990字节，原件SHA `525ccaf7185a9b65c074916720fe8cd265b518fe7dd1506bde23d51c8307a8e1`。恢复前后全部Raw字段/正文及统计相同，恢复自身未新建Raw。
- 初次持久化核验出现验收工具的时间表示差异：PowerShell把 `.380Z` 序列化成 `.38Z`；核验脚本仅将importedAt格式归一成ISO毫秒后逐字段比较，其余值严格相等。该差异未归为产品缺陷。独立后端重启试验另以Raw文件SHA严格证明磁盘内容不变。
- 页面刷新后浏览器错误/警告日志为空；故障期的预期错误不以此日志查询替代。浏览器操作中的精确文本定位超时已通过新DOM确认实际部分提交面板存在，不是产品失败。

## 截图

即时同步：[B03-recheck-immediate-stats.jpg](B03-recheck-immediate-stats.jpg)；标签：[B03-recheck-tags.jpg](B03-recheck-tags.jpg)；超限：[B03-recheck-oversize.jpg](B03-recheck-oversize.jpg)；部分提交：[B03-recheck-partial-submit.jpg](B03-recheck-partial-submit.jpg)；恢复：[B03-recheck-restored.jpg](B03-recheck-restored.jpg)。

主Agent另独立运行 `npm.cmd test` **46/46 PASS**、`npm.cmd run build` **PASS（36 modules，index-CQkk3eQh.js）**，简要记录为 [B03-recheck-main-checks.json](B03-recheck-main-checks.json)。构建沿用已确认的沙箱realpath限制，以审批通过的隔离外执行完成，未误报BLOCKED。

隔离API/UI服务均已按PID与命令行核对关闭，临时浏览器页已关闭，见 [清理记录](runtime/B03-recheck-browser-cleanup.json)。首次Stop-Process后立即CIM查询先于退出完成，随后有界等待确认已停止；没有关闭正式服务。

本轮没有修改产品代码，没有污染正式工作区；旧FAIL报告及旧截图保持历史原样。Node最低版本环境与B04的AI处理状态未测，不能扩展本轮PASS范围。
