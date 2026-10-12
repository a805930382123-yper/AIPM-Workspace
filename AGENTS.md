# FMCG AI PM Workspace

开发采用逐批交付。先读 `docs/status.md`，再读当前 `docs/batches/Bxx.md`；只读取任务所需模块。完整需求是 `docs/product-spec.md`，有歧义时按章节查询，不在每轮复制全文。

- 工程边界与存储约定：`docs/architecture.md`。
- 模型、职责、升级、交接与验收门禁：`docs/coordination.md`。
- 验收依据：`docs/acceptance.md`，按本批 ID 阅读。
- 主 Agent 决定范围与接口；施工 Agent 改产品代码；验收 Agent 独立检验并写报告。
- 每批只交付当前任务卡；PASS 后才可推进已获用户授权的下一批。当前授权范围以用户最新指令和 docs/status.md 为准。
- Raw 正文不可由 AI 改写。AI 输出只进入草稿；正式 Wiki/Prompt 写入由用户明确操作触发。
- 事实、整理、推断和待确认问题分别存储。失败不得伪装成功；未实测不得标 PASS。
- 产品运行独立于 Codex、Agent CLI、Obsidian。开发协作 Agent 不进入产品运行时。
- 本地数据与密钥不提交。修改已有文件前先检查；多人共享工作区时遵守任务卡的文件所有权。
