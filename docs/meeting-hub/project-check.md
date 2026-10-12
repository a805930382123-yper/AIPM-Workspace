# Meeting Hub：现有项目检查

日期：2026-10-11。性质：为增量规划做静态检查，不是新一轮运行验收。

本轮只检查现有项目、规划增量、划定批次；不施工，不安排后续施工或审查。没有启动产品、运行构建/测试、修改用户数据。方案见 [incremental-plan.md](incremental-plan.md)，批次见 [batch-boundaries.md](batch-boundaries.md)，用户提示词原件见 [requirements.md](requirements.md)。

## 1. 基线结论

项目适合在原工程内增加独立 Meeting 模块。现有 `Raw.sourceType = meeting` 只是原始资料分类，不是会议档案，也不代表已具有会议处理权限。

本次按 [第二次全审查基线](../reports/FULL2-20261010-baseline.json) 核对其中 72 个产品/README 文件，摘要均一致。现有代码仍是第二次全审查所检查的版本。这个核对不能证明运行正确，也不替代测试。

[最新状态](../status.md) 和 [第二次全审查报告](../reports/FULL2-20261010-acceptance.md) 仍记录整体 FAIL：

| 遗留事项 | 当前证据与影响 | 对本次规划的处理 |
|---|---|---|
| S-03 | 知识更新/综合共用输出函数未扫描已知凭证；综合路径曾实测凭证进入响应与草稿 | 保留原缺陷，不隐含纳入 Meeting 施工；不能声称原有 AI 已全部通过 |
| S-04 | Prompt/首次提取忽略长度小于 6 的已知凭证；此前有实际失败证据 | 同上；不是 Meeting 导致的新问题 |
| 真实 Provider | 上次 36 项真实 Provider 成功/质量场景 BLOCKED | 本轮未读取密钥配置或重新验证；不能沿用 fake 结果代签真实能力 |

历史 build、155/155 自动化测试及既定 HTTP 检查通过，均为旧报告证据，本轮未重新运行。Meeting 元数据和本地纪要功能不依赖 Provider，可独立增量；整体项目问题仍须分别保留。

## 2. 可复用与必须新增的部分

| 部位 | 已检查的实现 | 增量判断 |
|---|---|---|
| 工程 | React/Vite、Express/TypeScript、单用户 localhost、文件事实源 | 保持单仓库、同一进程和 `FMCG_DATA_DIR`；不引入数据库、账号或飞书服务 |
| 导航 | [App.tsx](../../app/App.tsx) 的 Page 联合类型和页面条件渲染 | 加一个 Meeting 页面入口即可，不引入新路由体系 |
| UI | [styles.css](../../app/styles.css) 及各页面表单、按钮、列表 | 复用样式和交互；目前没有可直接调用的独立会议表单/分类组件 |
| 存储 | [storage/files.ts](../../services/storage/files.ts) 的原子写、串行队列 | 可复用文件工具；损坏会议记录应明确报错，不能用忽略解析错误的列表策略隐藏资料 |
| 版本/冲突 | [prompt/store.ts](../../services/prompt/store.ts) 的单 JSON、版本与 revision | 参考模式，Meeting 自己保存记录；不把会议放进 PromptStore |
| Raw | [raw/store.ts](../../services/raw/store.ts) 的 UUID Markdown、来源元数据、正文 SHA-256 | 保持 Raw 不可变；新增窄的会议来源写入接口及服务端生成的来源标识 |
| 文本解析 | [raw/parse.ts](../../services/raw/parse.ts) 已有 Markdown 等解析 | 可复用纯文本解析；首版仅 `.md` 与粘贴，不顺带开放 DOCX/PDF |
| 原导入流程 | [raw-import.ts](../../server/raw-import.ts) 保存原文件并创建普通 Raw | 不能直接复用该编排；会议导入不得自动创建 Raw，也不能在拒绝权限后残留附件 |
| Markdown 阅读 | Raw/Wiki 页面主要使用转义后的 `<pre>`；package.json 无 Markdown 渲染器 | 新增受限 Markdown 展示；禁原始 HTML、危险链接及自动加载远程图片 |
| 链接验证 | [validation.ts](../../server/validation.ts) 的 Raw URL 可接受 HTTP | Meeting 要独立限定 HTTPS，不能直接照搬旧校验 |
| 备份 | [backup_workspace.ts](../../scripts/backup_workspace.ts) 仅允许 knowledge/prompts/drafts/state | 新增同级 meetings 数据目录时，必须同步备份和恢复白名单；不建设新备份平台 |
| 搜索/统计 | Raw/Wiki 和首页统计已有各自集合 | Meeting 只搜元数据；创建会议不应改变 Wiki/Raw 数量或知识日志 |

## 3. 权限的实际缺口

现有 Raw 没有会议档案 ID、保密等级或处理权限。现有服务允许合法 Raw 被用户选入提取、更新、综合、手动 Wiki，再进入 Audit/Prompt。只在 Meeting 页面隐藏按钮不足以保护新来源。

必须考虑的入口如下；这是影响面清单，不要求重写这些模块：

| 服务入口 | 需要防止的行为 |
|---|---|
| [llm/jobs.ts](../../services/llm/jobs.ts) | 直接用会议 Raw ID 创建/恢复提取任务并调用 Provider |
| [wiki/knowledge-workflows.ts](../../services/wiki/knowledge-workflows.ts) | 综合混入会议 Raw，或旧 Wiki 来源受限而只检查新输入 |
| [wiki/store.ts](../../services/wiki/store.ts) | 手动 Wiki 加入会议源，再删掉来源标记绕过限制 |
| [wiki/commits.ts](../../services/wiki/commits.ts) | 已有草稿确认、启动恢复绕过新检查 |
| [audit/service.ts](../../services/audit/service.ts) | 向 AI 发送受限 Wiki/Raw，或通过决议恢复继续写入 |
| [prompt-ai/service.ts](../../services/prompt-ai/service.ts) | 用所选 Wiki 或目标 Prompt 的关联 Wiki 间接发送会议材料 |
| [prompt/store.ts](../../services/prompt/store.ts) | 通过关联编辑丢掉来源后再次优化；应保留受限来源的判断依据 |

因此本计划选择“受限本地 Raw 登记”：Public/Internal 的获授权原件可登记，所有新 Meeting 来源均禁止 AI/Wiki 沉淀；Sensitive 暂不登记 Raw。这是用户提示词第八、十三节允许的首版收窄，不代表完整的知识库权限继承已实现。

已有无 Meeting 来源标识的历史 `sourceType=meeting` Raw 不自动改写、归档或重新判级。本模块也不能识别人为复制到无来源文本框的敏感内容，不能宣称内容级防泄漏或企业授权能力。

## 4. 结论

需要新增的是会议档案与权限模块、安全纪要阅读、受限 Raw 连接；主要复用点是现有文件工具、页面布局、文本解析和 Raw 事实源。最需要单独成批的是 Raw 连接：它涉及多个既有服务的拒绝路径，不应与纪要编辑、版本保存混在同一批。

本轮无实现完成项、无新 PASS；以下规划文件仅描述未来交付边界。
