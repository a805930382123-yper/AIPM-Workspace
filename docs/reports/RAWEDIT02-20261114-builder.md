# RAWEDIT02 人工编辑 Raw 原文施工报告

2026-11-14。Sol High 施工。交付版本为 HEAD `8264aba50b58be6c415be0124499a8977f3197fb` 加工作树，以 [最终 SHA-256 清单](RAWEDIT02-20261114-builder-evidence/final-sha.json) 为准。施工自查完成，Astra 独立验收接手。

## 交付

- Raw 详情提供「编辑原文」和「查看原文修改历史」。取消零写入，保存失败保留输入。409 可读取最新正文并核对后重试。保存响应立即更新父缓存，即使随后资料列表读取失败也会显示新正文。
- `PATCH /api/raw/:id/body` 只接受正文、预期正文 SHA-256 和预期修订号。既有 Raw 的初始修订号视为 0。服务端先把完整旧 Markdown 原字节归档到 `knowledge/raw/history/<id>/<revision>.md`，再原子替换正文文件。已有相同归档可重试，内容不同的归档拒绝覆盖。无变化直接返回当前版本。
- 编辑、删除、提取启动、PDF 处理启动和 Wiki 确认共用现有 Wiki 写锁。正在提取、正在进行 PDF 页理解或清理、尚待完成的确认操作会阻止编辑。会议登记 Raw 指引用户到会议档案编辑工作副本。普通旧 meeting 分类可以修改。
- PDF 人工修改只影响提取文字。旧逐页文字位置、理解、清理和按页草稿确认失效，包括人工改回完全相同的正文后。原件继续用已有校验绑定的原件入口打开。结束失效草稿后可显式按当前文字整理。
- 旧普通草稿、提取检查点、译文和问答原句继续由正文 SHA-256 核验。旧整理草稿原句跳转使用草稿生成时的 SHA，避免相同位置恰好出现相同原句时误标。失效的暂缓草稿仍能显式结束，恢复正常正文整理入口。已有正式 Wiki 不会在保存原文时变化。

## 验证

| 证据 | 实测结果 |
| --- | --- |
| [真实 HTTP 命令与 stdout](RAWEDIT02-20261114-builder-evidence/http.stdout.log)、[HTTP JSON](RAWEDIT02-20261114-builder-evidence/http-result.json) | 7/7。逐字持久化、完整快照和稳定元数据，409/ABA，注入和限长，真实快照写失败、历史碰撞，原件和旧派生、旧问答引文，正在运行的提取/PDF 理解、取消后保存 |
| [真实 Chrome 命令与 stdout](RAWEDIT02-20261114-builder-evidence/browser.stdout.log)、[浏览器 JSON](RAWEDIT02-20261114-builder-evidence/browser-result.json) | 6/6。取消零写入、503 保输入、成功响应后 GET 503 仍显示新正文、刷新和历史、真实 409 核对重试、旧草稿无法入库或误标原句、暂缓草稿可明确结束、PDF 原件、译文和两类会议 |
| [空 envDir 构建 stdout](RAWEDIT02-20261114-builder-evidence/browser.stdout.log) | Chrome 脚本内 `configFile:false`、显式空 `envDir`、233 模块，退出 0。Vite 提示产物 chunk 大于 500 kB，PDF.js 提示样本字体配置 |
| [严格 TypeScript 命令与 stdout](RAWEDIT02-20261114-builder-evidence/tsc.log) | 产品入口与导入图、Vite 配置和既有 RAWEDIT01 UI 类型检查，退出 0 |
| [既有定点回归 stdout](RAWEDIT02-20261114-builder-evidence/regression.targeted.stdout.log) | 50/50，含 RAWEDIT01 3 项、PDF02 HTTP 8 项、Raw、完整性、PDF UI、维护、会议来源和导航 |

已查看四张最终截图。[编辑](RAWEDIT02-20261114-builder-evidence/01-original-editor.png)、[原文历史](RAWEDIT02-20261114-builder-evidence/02-original-history.png)、[版本冲突核对](RAWEDIT02-20261114-builder-evidence/03-conflict-preserves-text.png)、[PDF 原件区分](RAWEDIT02-20261114-builder-evidence/04-pdf-original-remains-readable.png)。

本轮记录的两个 Chrome 首跑失败来自脚本。首页新闻请求已被隔离代理拦截，但首跑计入了取消编辑的写请求断言。第二次对带「重新连接」按钮的全局提示使用了全字符串匹配。更正脚本后最终运行通过，前两次 stdout 保留。首次 HTTP 在受限沙箱内未能从父进程连接已经监听的回环服务，退出前已清理。使用允许本机回环的权限后通过。

已知 `tests/lw01-raw-ui.test.tsx` 的首字符损坏未纳入。本轮探索回归中另发现 `tests/rawzh01-ui.test.tsx` 第 1 行第 0 列同样有 `Unexpected "�"`，对应日志 [初次回归](RAWEDIT02-20261114-builder-evidence/regression.stdout.log) 保留，两个文件均未编辑。全仓测试未执行。独立 HTTP 对 PDF 原件公开接口做字节比对，TXT 对本机保留文件做字节比对。新场景对正在运行的提取和 PDF 页理解做了公开 HTTP 拒绝与取消复验，正在清理的 PDF 和未完成确认使用相同写锁与现有状态检查，未为这两个分支另做故障注入。

最终 HTTP 自有脚本 PID 29032、API PID 15192、回环 53656，API、fake 与预留端口均关闭。最终 Chrome 自有脚本 PID 25540、API PID 16116、回环 API 53700 和 UI 53831，浏览器、UI、API 都关闭。Chrome 记录外网请求 0 和未处理页面错误 0。HTTP fake 的 2 次请求来自测试显式启动的提取和 PDF 页理解，用于维持在途状态。保存原文没有请求模型。正式 workspace、真实配置、62 页 38 主题草稿和用户现有端口均未参与。本轮未提交、推送或部署。
