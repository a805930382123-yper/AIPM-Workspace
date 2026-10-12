# M03 纪要归档交接

2026-10-12，阶段 **PASS**。GPT-6 Luna High施工和返修，主Agent独立验收。[任务卡](../batches/M03.md)、[验收报告](../reports/M03-acceptance.md)。M01/M02接口继续有效；本文件补充M03最终实现。M04/M05未授权，Raw登记、会议AI能力仍关闭。原全项目FAIL独立保留。

## 存储与读取

事实源仍为`meetings/records/<uuid>.json`，`schema_version:1`。兼容旧空`imports`、无`minute_requests`文件。普通元数据PATCH不接受纪要字段。

每个`imports`版本含`import_id`、`imported_at`、`imported_minutes`原件、`editable_minutes`工作副本、`original_filename`（粘贴为null）、`original_sha256`；上传另含`file_sha256`。原件不trim、不剥BOM、不改CRLF/尾空格。SHA-256为原件UTF-8文本摘要；合法UTF-8上传的文件字节摘要一致。只有最新`active_import_id`的工作副本可编辑，再导入保留旧原件和旧工作副本。

`minute_requests`仅存`{requestId,inputSha256,importId,deleted}`，没有正文。清空后保留删除墓碑，旧请求不能重新生成正文。列表不返回正文/版本/账本/文件名。详情返回版本和能力；当前普通详情/元数据/策略响应会带无正文纪要账本，创建摘要不返回，三个纪要写入响应另剔除账本。客户端不展示或依赖账本；后续接口收敛不可改变落盘幂等规则。损坏、重复ID、摘要不符、错误active、非法策略/正文组合拒绝读取，保留原文件。

原件（上传或粘贴）最大2MiB和500000 JavaScript字符；工作副本最大500000字符；单个实际序列化JSON（含缩进和换行）最大32MiB，读盘先检查文件大小。至多1000个版本、10000条纪要请求记录；这些是额外上限，32MiB可能更早达到。超限返回413，不截断、不删除历史。空白正文、NUL、不合法Unicode拒绝；文件只接受UTF-8 `.md`，扩展名不区分大小写。没有PDF/DOCX和自动浏览器草稿。

## 能力与HTTP

`canImportMinutes`：Public+local_archive允许；Internal/Sensitive还需独立`local_storage_authorized`；Restricted始终拒绝。`canRegisterRaw`、`canUseAi`始终false。策略授予仍使用M01独立确认规则。

纪要路由在全局JSON解析器之前装配。导入和工作副本写入先查策略再解析正文；上传只使用有界内存，无附件临时落盘。提交串行化，再检查revision及实际策略。JSON导入/编辑解析限3MiB，清空请求限32KiB。multipart限单file、3字段、4parts、每字段1024字节。

| 方法/路径 | 输入 | 成功与拒绝 |
|---|---|---|
| POST `/api/meetings/:id/minutes/import` | JSON `{baseRevision,requestId,text,confirmReimport?}`；或multipart `file`和`baseRevision/requestId/confirmReimport` | 新版本201，返回Meeting详情、`imported`和`reused:false`；同输入同ID重试200/`reused:true` |
| PATCH `/api/meetings/:id/minutes/:importId` | `{baseRevision,editable_minutes}` | 当前工作副本更新并增加revision；原件不变，历史副本409 |
| DELETE `/api/meetings/:id/minutes` | `{baseRevision,confirm:true}` | 所有本地原件/工作副本清空，active=null；元数据/HTTPS保留，返回新详情 |
| DELETE `/api/meetings/:id` | 原M01字段；有纪要时另加`confirmLocalMinutes:true` | 删除档案和全部版本；缺额外确认409，未勾选UI禁用提交 |

未知字段拒绝；multipart确认字段是`"true"`或`"false"`。首次导入不需重导入确认；已有版本必须明确`confirmReimport:true`，否则409。重试摘要覆盖文本、文件名和文件摘要；同ID不同输入409。成功重试可跨旧revision返回同一版本；正文已清空的旧ID返回409。API权限前置仍适用于重试。

常见错误：403 `MINUTES_NOT_AUTHORIZED/CONFIRMATION_REQUIRED`；409 `REVISION_CONFLICT/IDEMPOTENCY_CONFLICT/MINUTES_REQUEST_DELETED/REIMPORT_CONFIRMATION_REQUIRED/MINUTES_VERSION_READ_ONLY/LOCAL_COPIES_PENDING/MEETING_HAS_LOCAL_MINUTES`；413 `MINUTES_TOO_LARGE/MEETING_JSON_TOO_LARGE/MINUTES_VERSION_LIMIT/MINUTES_REQUEST_LIMIT`；415非法格式/编码；500实际存储失败。错误只输出受控code/message/details，不回显正文、文件内容、底层堆栈。不同竞态可能先触发revision冲突，客户端按实际错误重载检查。

有本地版本时切cloud、撤权或升Restricted返回409和`details.localCopies`（版本数）；不能隐式删除或隐藏正文。先由用户清空，再明确修改策略。取消不发写请求。

## 界面与安全阅读

详情按基本信息、飞书来源、本地纪要、安全状态排列。纪要独立组件`app/MeetingMinutes.tsx`，API类型在`app/api.ts`，样式局限会议区域。支持粘贴/上传、确认新增版本、工作副本编辑保存取消、历史只读、查看原文、明确清空、带正文档案删除。失败保留当前可恢复输入；409提供重载并保留工作草稿；重复提交锁、稳定requestId、组件卸载/世代与父组件key隔离迟到结果。正文不进localStorage/IndexedDB。

`react-markdown@10.1.0`配`skipHtml`，无`rehype-raw`/`dangerouslySetInnerHTML`。支持标题、列表、引用、代码；图片呈文字标记，无img或自动抓取。只输出合法HTTPS外链，用户点击新标签，`rel="noopener noreferrer"`；javascript/data链接和HTML不执行。原件入口用纯文本`pre`。

## 备份及后续边界

现有备份meetings白名单覆盖全部原件、工作副本、版本和内部账本；新旧归档均可恢复。M03修复了旧base64校验正则在大文件下栈溢出，改为线性字母/填充检查，保留规范重新编码、字节长度、SHA、路径、白名单、单文件/总量限制和目标保护。实际接近32MiB会议记录的45,399,486字节归档已导出、恢复并经产品服务读回。

M03操作不创建Raw，不调用Provider，不修改knowledge/prompts/drafts/state。M04需另行获授权，补来源和处理限制后才能打开Raw能力；不能只根据已有Raw授权布尔值开放登记。M05未开始。正式数据未迁移，未部署；Windows/Node25.2.1已测，其它OS/最低Node及真实AI不代签。
