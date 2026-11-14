# PDF01 第二轮后端施工交接

基线 `b4eb4418cc0254ee27d72a0565edcd5ff80b08ae` 加 R1 未提交文件。后端产品及测试已停写，交 Astra 独立验收。[13 个后端文件指纹](PDF01-R2-20261110-backend-fingerprints.json)

## 实现

- Raw PDF 子路径支持查看整理状态、按页范围启动或继续、取消和生成知识草稿。范围内 R1 页理解必须已保存。整理按范围独立保存检查点，重启仅显示中断，显式继续才发送未完成批次。生成草稿、GET、审核和正式确认不请求模型。
- 清理以稳定的原文字层和页图解读单元为输入。每批最多 4 个相邻页、48 个单元，单元 JSON 预算 32 KiB。模型必须给每个单元唯一处置和理由。可合并相同非表格内容并保留全部页证据。不同数字、表格行及脚注不会作为纯重复吞掉。主题索引每批最多 16 个新标题，读取最多 50 个已归主题的标题，事实正文只在本机按主题拼装。
- 续表对已有明确竖线列分隔的材料采用实际表头和行。兼容的新增列并入同一表，旧页没有该列的单元格标为「该页未列」。列口径不同分表，列数不明的行保留原文并标为待核。表注和每行有原页链接。自然语言材料保留原句和引用，结构不足时无法还原原表。50 主题及每候选 100,000 字符沿用现有容量，超限提示缩小页范围。
- PDF 草稿走现有 Raw 成果审核和正式事务，编辑更新摘要。正式主题和 Source 冻结 Raw、asset 摘要、页码、R1 结果摘要及稳定单元 ID；原文字层带真实 offset，图像衍生证据无 offset。正式阅读显示图像 AI 衍生标识和原页链接。人工编辑去掉链接时，仅补缺的来源区，保留原人工正文。正式主题的手工编辑保留 PDF 派生元数据和对应 Raw 来源。既有主题更新保留原正文；目标版本变化时本次确认停止，可结束原草稿后从同一已清理范围重新生成并重新审核。

## 实际验证

- `node --import tsx --test --test-concurrency=2 tests/pdf02-http.test.ts tests/pdf01-http.test.ts tests/import.test.ts tests/kb03-confirm.test.ts tests/rawux01-http.test.ts tests/lw01-maintenance.test.ts` 通过 58/58，耗时 38.60 秒。新增 7 条测试通过真实 `server/index.ts` 子进程、隔离 TEMP 配置及本机 fake HTTP Provider。前次默认并行组合为 57/58，首个子进程超过原 5 秒测试启动等待；最终夹具等候上限调为 15 秒。
- 62 页混合合成 PDF 执行 62 次 R1 图文理解、16 次清理、1 次主题索引，共 79 次本机 fake HTTP。310 个不同单元全部保留。实测最大清理 user JSON 2,353 字节、索引 82 字节。索引仅有两个标题，无事实正文。末页 `p62-content-5` 进入草稿，明确选择后从正式 Wiki 读回。原件逐字节一致。
- 跨批续表实测共享表头、既有行、无表头的续页行、显式扩列、不同单位的新表、不匹配列数的待核行和各自原页链接。另测序言实质内容保留、纯宣传跳过理由、重复结论的两个原页链接、不同口径的新增数字及陌生主题留在草稿未写入。
- 实际终止整理中的 Node 子进程后，新进程保持一批已完成、四次已尝试，读取和启动外发 0 次。换 Provider 身份拒续，重复启动无额外请求，取消后迟到响应未落盘。第 6 页 R1 失败时，可明确整理前 5 页，整份请求拒绝且列缺页。
- 错误归并、遗漏单元、模型伪造定位字段、已知秘密输入输出、Meeting 来源、R1 摘要变化和 asset 字节篡改均测试拒绝。草稿编辑使旧摘要失效；人工选择前 Wiki 不变，确认重放复用同一事务。正式日志路径故障后实际重启，原事务恢复且模型计数不增。手工编辑不能移除已写 PDF 底层来源。
- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf02-http.test.ts` 退出 0。施工范围 `git diff --check` 退出 0。
- 全仓 `npx tsc -b --pretty false` 退出 1，复现既有 7 个文件的 9 条损坏诊断。下列文件均有 `TS1490`，其中后两项另有 `TS1128`。本轮按任务卡跑定向回归，未运行完整 `npm test`。

`tests/acceptance/AUTO01-review-actions.test.ts`、`tests/kb03-review-ui.test.tsx`、`tests/lw01-raw-ui.test.tsx`、`tests/rawzh01-http.test.ts`、`tests/rawzh01-ui.test.tsx`、`tests/support/compat01-maintenance-reply.ts`、`tests/ui-b04.test.tsx`。

日志留在 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\pdf02-backend-55c2221d-edc4-4d95-b956-299a8228577d`。最终日志为 `combined-final.txt`、`tsc-scoped-final.txt`、`tsc-full.txt`。另有初版和中间失败原始日志。

本报告覆盖后端工程结果。浏览器和空 envDir 构建由独立 UI 施工及验收提供。模型处理质量仍待真实验证。本轮未读取用户配置、未操作正式资料或用户服务、未提交。
