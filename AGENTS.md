# FMCG AI PM Workspace

开发采用逐批交付。先读 `docs/agent-quickstart.md` 与 `docs/status.md` 顶部「当前状态摘要」，再按摘要指向读取当前任务卡（`docs/handoffs/`）及对应路线图（`docs/batches/`）；只读取任务所需模块。完整需求是 `docs/product-spec.md`，有歧义时按章节查询，不在每轮复制全文。

- 工程边界与存储约定：`docs/architecture.md`。
- Agent 调度入口、交接与项目验收门禁：`docs/coordination.md`。
- 验收依据：`docs/acceptance.md`，按本批 ID 阅读。
- 证据存放、仓库体积门禁与测试临时目录约定：`docs/evidence-policy.md`、`docs/testing.md`。
- 主 Agent 决定范围与接口；施工 Agent 改产品代码；验收 Agent 独立检验并写报告。
- 每批只交付当前任务卡；PASS 后才可推进已获用户授权的下一批。当前授权范围以用户最新指令和 docs/status.md 为准。
- Raw 正文不可由 AI 改写。AI 输出只进入草稿；正式 Wiki/Prompt 写入由用户明确操作触发。
- 事实、整理、推断和待确认问题分别存储。失败不得伪装成功；未实测不得标 PASS。
- 产品运行独立于 Codex、Agent CLI、Obsidian。开发协作 Agent 不进入产品运行时。
- 本地数据与密钥不提交。修改已有文件前先检查；多人共享工作区时遵守任务卡的文件所有权。

## Agent Router 入口

在本项目办理状态检查、恢复进度或已授权批次时，使用 Codex 用户级 `$agent-router`。按[项目协作规则](docs/coordination.md#agent-router-现行规则)定位并读取当前安装版本，再结合项目任务卡执行。状态检查走[只读预检](docs/coordination.md#项目状态预检)，执行入口以用户明确授权的目标和范围为准。

## 独立验收结论与证据

每轮主 Agent 独立验收时，必须区分：

1. 本轮施工范围内的缺陷是否修复成功；
2. 当前批次整体是否满足验收标准。

两者必须分别给出结论和证据。若本轮缺陷已关闭但批次仍存在阻塞，应明确记录剩余阻塞原因及下一步建议，不得将局部修复成功视为批次整体验收通过。

每轮验收报告应附实际测试命令、结果摘要以及对应的代码提交标识。

## GitHub 同步（用户于 2026-10-22 授权）

- 项目仓库：https://github.com/a805930382123-yper/AIPM-Workspace 。`origin` 使用此仓库的 HTTPS Git 地址。
- 每次完成用户授权的项目修改并运行必要检查后，由主 Agent 检查差异、提交并推送当前分支；此授权持续有效，无需逐次询问。施工/验收 Agent 交接后由主 Agent 统一提交，不提交其他正在进行的任务内容。
- 上述持续同步授权不适用于项目状态预检；预检不得触发拉取、合并、重置、清理、提交或推送。用户明确限定只读或禁止同步的任务也遵守该限制，发现未同步内容仅报告。
- 本机启用 `.githooks/post-commit`，每次提交后自动向指定 `origin` 推送当前分支。新克隆按 `docs/github-sync.md` 启用。
- 不强制推送、不覆盖远程历史；网络、认证或远程冲突导致同步失败时如实报告，保留本地提交，解决后重试推送。未验证远程提交一致前不得声称同步成功。
- `.env.local`、`workspace/`、依赖、构建目录及临时数据不上传。GitHub 同步不改变当前批次授权或验收结论。
