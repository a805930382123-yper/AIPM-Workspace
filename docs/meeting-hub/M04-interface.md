# M04 本机 Raw 登记与来源限制交接

2026-10-12，第一轮返修后阶段 **PASS**。GPT-6 Luna High施工，主Agent冻结后独立验收。见[任务卡](../batches/M04.md)、[本轮报告](../reports/M04-repair1-20261012-acceptance.md)。M01–M03既有接口继续有效，下列内容替代其中“Raw尚未开放”的历史描述。M05未授权；原全项目S-03/S-04及真实Provider阻塞保留。

## 能力与持久化

`canRegisterRaw`需Public/Internal、本地归档、独立`raw_transfer_authorized`；Internal还须满足既有本地保存规则。授予Raw权限使用`confirm_raw_transfer:true`，登记仍需另外选择纪要版本并确认。Sensitive/Restricted不开放，`canUseAi`始终false。纪要导入本身不自动创建Raw。

Raw登记读取选定版本的`imported_minutes`，不使用编辑后的工作副本，不trim或改写原件。Raw位于`knowledge/raw/meetings/<raw_id>.md`；原件SHA-256与Raw正文UTF-8摘要一致。专用桥持久化以下六个origin字段，普通创建/文件导入接口不能指定origin或固定Raw ID：

```json
{"kind":"meeting","meeting_id":"<uuid>","import_id":"<uuid>","original_sha256":"<64hex>","registered_confidentiality":"Public","processing_policy":"meeting_local_only"}
```

`registered_confidentiality`记录实际登记时等级；来源固定本机专用，解除展示关联、删除会议或改变普通字段都不解除限制。没有批量迁移旧Raw；普通`sourceType:meeting`但无新origin的历史资料继续按旧流程处理。

Meeting仍为schema1单JSON事实源。`raw_links`收据包含request/import/Raw ID、原件SHA、created_at、status、request_fingerprint、raw_title、source_name、tags；新收据另含`request_fingerprint_version:2`。linked/unlinked必须有真实`registered_at`；failed含受控error code/at。raw_deleted允许没有registered_at，因为中断登记后删除真实Raw不等于已完成登记，不伪造时间。

`raw_source_id`仅投影当前active版本的有效linked Raw。重导入新版本时重算，未登记则null；清空纪要后active和投影均null，历史收据、真实Raw与限制仍保留。派生Raw标题取会议标题前195个JavaScript字符再加“ 原始纪要”，总长不超过200；source_name与原件正文不截断。该限长不是Unicode字素截断保证。

## 登记、重试与恢复

| 方法/路径 | 输入与行为 |
|---|---|
| POST `/api/meetings/:id/raw-links` | `{baseRevision,requestId,import_id,confirm:true}`；创建真实Raw201，同操作复用真实Raw200；返回Meeting详情、capabilities、raw_id、reused |
| DELETE `/api/meetings/:id/raw-links/:rawId` | `{baseRevision,confirm:true}`；只解除展示关联并增加revision，不删除Raw、不解除来源限制 |
| DELETE `/api/meetings/:id` | 既有`baseRevision/confirm`；有纪要另需`confirmLocalMinutes:true`，有非raw_deleted收据另需`confirmRawReferences:true`；删除档案及其本地版本，保留Raw |

初次登记必须匹配当前revision。新v2业务指纹只含固定`import_id/confirm:true`，不含可变并发revision；重试不能换import或省略确认。现代收据哈希必须精确匹配，未知版本拒绝读盘。无版本字段的旧收据按严格schema及持久request/import/确认语义兼容：旧算法未保存原baseRevision，无法还原它，因此不枚举修订号、不宣称重新验证旧哈希的原输入。64hex格式、当前授权、原件摘要和真实Raw核查继续适用；这是本机文件兼容，不能当成防本地磁盘篡改保证。

登记串行化，阶段为pending会议收据→固定ID Raw→linked会议收据。Raw落盘失败保留failed，显式同ID重试；Raw已写但linked提交失败保留pending，重启对账可继续。恢复重查当前策略、原件、已有Raw ID的来源/正文/元数据；不一致冲突，不能覆盖现存Raw。linked重放也重新读取真实Raw：缺失/来源或内容不符返回409 `RAW_LINK_INTEGRITY_ERROR`，不假报成功或补建已删Raw。unlinked/raw_deleted旧操作返回409 `RAW_LINK_NOT_ACTIVE`。

启动对账处理pending，failed保留供明确重试；linked/unlinked的Raw缺失会标raw_deleted。通过已有Raw删除入口删除部分登记Raw时，pending/failed/linked/unlinked均能转为可读的raw_deleted，保持真实时间语义。Raw删除仍遵守既有Wiki/任务引用保护。

失败可能返回403 `RAW_NOT_AUTHORIZED/CONFIRMATION_REQUIRED/RAW_REGISTRATION_NOT_AUTHORIZED`、409 `REVISION_CONFLICT/IDEMPOTENCY_CONFLICT/RAW_IMPORT_ALREADY_REGISTERED/RAW_LINK_NOT_ACTIVE/RAW_LINK_INTEGRITY_ERROR/CORRUPT_MEETING`或受控500存储错误；不得把部分成功当完整成功。

## 来源门禁与界面

`services/meeting/source-policy.ts`区分普通无origin、新Meeting origin、非法origin和缺失记录。Meeting Raw、非法origin、声明来源但实际缺失/不可读的Raw均拒绝；旧记录缺少origin不是自动受限理由。门禁覆盖提取、混合综合、更新目标旧来源、手动Wiki、新旧草稿确认/恢复、Audit提议/决议及Prompt关联背景/确认。不能通过提交空sources/relatedWiki洗掉已有受限来源；恢复阶段即使原件SHA匹配也必须检查。受限恢复将manifest标conflict，不写Wiki/Index/Log或AI草稿，不到Provider。

Prompt Library原有失效Wiki ID兼容不等于放行真实Wiki的缺失Raw来源。普通无Meeting origin资料的旧流程保留；真实外部Provider质量未在本轮签收。

Raw登记区在`app/MeetingRawLinks.tsx`。同会议更新同步revision/import选择，保留恢复请求；pending/failed可明确使用同一请求恢复。最新meeting ID ref和独立`raw:<uuid>`父key隔离普通切会及history后退的迟到响应，不与Minutes兄弟key重复。删除档案独立显示Raw数量、保留与来源限制确认；取消不提交。

Raw页面能阅读origin与原文，会议档案删除后限制仍有效。当前App的跨页面Raw列表缓存需页面刷新才读到新登记记录；M05应检查自动刷新/缓存同步。这不改变服务端持久化和本轮8项返修闭环。

## 备份与边界

现有knowledge/meetings白名单覆盖Raw、origin、收据、纪要版本。实际CLI新归档导出/恢复后字节SHA一致，服务读回关系成立；旧无meetings归档、恶意路径/SHA、Windows junction、非空目标和源保护已复验。原M03大归档解码算法本轮未变，既有大文件证据是历史，不倒称本轮重跑。

本轮仅Windows/Node25.2.1；没有正式数据迁移、部署、真实客户资料导入、会议AI开放、其它OS或最低Node补签。阶段PASS不改变原全项目FAIL。M05须另行授权。
