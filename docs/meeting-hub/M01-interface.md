# M01 接口交接

范围：会议元数据、目录、策略与文件持久化；阶段结论以 [独立报告](../reports/M01-acceptance.md) 为准。M02 页面尚未施工，纪要/Raw/AI 能力未交付。

## HTTP

所有写请求 JSON。错误 `{error:{code,message,details?}}`。以服务端响应 revision 作为下次 baseRevision，不自行增加或重试过期更新。409 时重新读取并让用户处理冲突；不自动覆盖。

| 入口 | 请求 / 响应 |
|---|---|
| GET `/api/meeting-catalog` | `{schema_version:1,revision,types,tags}`；条目 `{id,name,active}` |
| POST `/api/meeting-catalog/types`、`/tags` | `{baseRevision,name}`；200 返回完整目录 |
| PATCH `/api/meeting-catalog/types/:id`、`/tags/:id` | `{baseRevision,name?,active?}`；200 完整目录；无物理删除 |
| POST `/api/meetings` | `{requestId,title,meeting_date,meeting_type,...可选元数据,confidentiality?}`；201 新建，200 原请求复用；flat 详情加 `reused` |
| GET `/api/meetings` | `{items}` 元数据摘要；不含 imports、active_import_id、raw_links、raw_source_id、creation |
| GET `/api/meetings/:id` | flat 详情加 `capabilities`；不存在404 |
| PATCH `/api/meetings/:id` | `{baseRevision,...元数据}`；200 flat 详情；策略/正文/ID/服务器字段拒绝 |
| PATCH `/api/meetings/:id/policy` | 独立策略请求，见下节；200 flat 详情 |
| DELETE `/api/meetings/:id` | `{baseRevision,confirm:true}`；200 `{deleted:true,meeting_id}`；无确认403，过期409 |

可选元数据：meeting_time、tags、customer、project、description、recording_url、minutes_url。日期真实 YYYY-MM-DD，时间 HH:mm；meeting_type/tags 是目录 UUID，非名称。标题最多200字符且必填；客户/项目各200，描述2000，两链接各2048；标签最多100且不重复。可选空文本/链接正规化 null，tags 缺省[]。HTTPS 链接禁止凭证与控制字符，不抓取或加载链接。

目录名称去首尾空白，1–100字符，无控制字符；NFKC/大小写归一去重。每类最多500条。八个初始类型只在首次初始化种入，之后允许改名和停用；ID不变，旧引用可读/保留，不能新选停用项。M02 展示应按 ID 关联最新名称，不能把名称当主键。

## 独立策略操作

```json
{
  "baseRevision": 1,
  "confidentiality": "Sensitive",
  "storage_mode": "local_archive",
  "local_storage_authorized": true,
  "confirm_local_storage": true
}
```

允许字段只有 baseRevision、confidentiality、storage_mode、local_storage_authorized、raw_transfer_authorized、external_ai_authorized、confirm_local_storage、confirm_raw_transfer、confirm_restricted_metadata_clear。确认字段仅作用于本次操作，不持久化。

默认 Sensitive/cloud_index/三个授权false。等级 Public/Internal/Sensitive/Restricted 只能保持或升高；模式 cloud_index/local_archive。Public 可直接切本地；Internal/Sensitive 开本地、从false授予本地权或提高等级仍保留本地，须本次专门确认与授权。撤销后不能保留无授权的本地模式，应同时显式切 cloud。Public/Internal 本地策略可独立确认 Raw 授权；Sensitive/Restricted 拒绝。升等级或切 cloud 清 Raw 授权。external_ai_authorized=true 永远403。

Restricted 只存非敏感代称、日期时间、类型及安全字段；标签/客户/项目/描述/两链接必须为空，cloud且三个授权false。转换需要清字段而未确认时409，details只列 metadata_to_clear 字段名与副本数量。用户预览、确认后发送 confirm_restricted_metadata_clear:true；不要以初次尝试409显示成功。已经 Restricted 也不能打开本地或 Raw。代称是否包含商业敏感语义需用户判断，不能自动替用户改写。

capabilities 的 canImportMinutes/canRegisterRaw/canUseAi 均 false，含 importReason/rawReason/aiReason。M02 不显示未交付上传/登记/AI 按钮，不通过旧 Raw API 代替。M03/M04 尚未装配路由。

## 持久化与恢复

`<FMCG_DATA_DIR>/meetings/catalog.json` 与 `meetings/records/<server-uuid>.json`；schema_version=1。详情带服务端 created_at/updated_at/policy_updated_at、revision，未来 imports/raw_links=[]，active_import_id/raw_source_id=null。本批读取严格要求这些占位为空；M03/M04 实施工时必须一起扩展类型、读盘校验与独立验收，不能只新增路由或写字段。

creation 仅内部使用 `{requestId,inputSha256}`，不进入HTTP。SHA-256来自规范化原始输入的键排序序列化；相同 requestId/规范输入复用当前同一记录，不受之后编辑、类型改名/停用影响；异输入409。用户编辑和策略清字段不会将原始私密输入隐藏留存在幂等记录里。

同进程串行变更，单文件临时写入+rename 原子提交。损坏对象/未知持久字段/不合法策略或引用/目录缺失但已有记录409并保留现场；符号链接或junction不跟随。文件写失败5xx不推进revision。新代码可恢复包含 meetings 的v1备份，旧无meetings备份启动时初始化空目录；旧程序不保证识别新备份。正式运行不依赖施工 harness 或模型。

M01没有本地正文或 Raw 写入。未来本地副本/来源存在时的撤权、删除、恢复必须由 M03/M04 补齐实际检查；本文件不证明尚未实现的跨文件链路。
