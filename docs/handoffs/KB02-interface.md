# KB02最小接口与状态契约

2026-10-15主Agent冻结。新pipeline version为kb02-1，旧locator-v2输入/已存DraftRecord兼容，legacy结果不得冒充新流程取证。

## 1. 分块提取

沿用8000字符/400重叠与有界locator目录。模型仅收到必要元数据、当前locator的id/text，声明其是原始来源片段；不重复附同一块完整正文。

精简输出（所有字段必填、无额外字段）：

```json
{"version":1,"facts":[{"text":"主体、时间、口径明确的来源陈述","locatorIds":["c1-l001"]}],"questions":[{"text":"原文明确未确认的问题","locatorIds":["c1-l001"]}]}
```

facts/questions均可空，空业务块仍记录成功；整篇无事实返回明确EMPTY_RESULT。fact与question的ID由服务端在验证后分配（含chunk来源），模型不维护复杂页内引用。locator必须属于当前chunk且均真实存在；位置与quote仅由Raw派生。事实正文是模型陈述，需要语义验收，不能把quote存在当作陈述必真。问题引用证明未确认上下文；本轮不额外生成无来源推断。

完全相同text+精确证据区间可去重；不同区域/日期/口径/证据不做模糊合并。同一重叠位置可以共享一个稳定证据但所有事实映射保留。程序扫描原AI结构/派生quote/规范化记录的所有JSON键值凭证后才允许写checkpoint或给planner。

## 2. 整篇规划与组装

输入为所有已验证事实/问题的稳定ID与text及必要上下文；保留主体/日期/口径，不发送原文重复长段/全部Wiki。模型输出：

```json
{"version":1,"document":{"title":"来源标题","main_topic":"主主题","summary":"仅根据事实的概述"},"pages":[{"title":"知识主题","type":"metric","category":"metric","factIds":["f-c1-1"],"questionIds":["q-c1-1"]}]}
```

pages为1..50，每页至少1事实，旧可提取type/category枚举；fact IDs必须全量覆盖且每事实恰有一个主归属（首版暂不做跨主题复用）；question同样恰一次归属且必须有效；不允许规划丢弃事实或虚构ID。标题标准化去重；空主题/重复引用/跨Raw/多余字段/错误枚举拒绝整份规划，不截页假成功。对于超事实/输入字节限，显示缩短/分次整理，不偷偷截断。

同业务主题跨chunk合并，主体/时间条件保留在其事实中。十四区域指标允许按同一指标主题归组或有独立意义的区域主题；不得漏区域/把不同值调和、不要求固定页数。免责声明/排版/单个未知问题不单独成无业务页。

最小版第三阶段为程序确定性转成现有ExtractOutcome/DraftRecord：title/type/category与document来自已验证plan，source_facts/evidence绑定已验证事实；一行说明可由标题固定句式生成，ai_organized/ai_inferences/related_pages为空，open_questions由已归属问题生成；标明模板组装及本轮未生成推断。服务端生成id、来源、offset、provenance、状态与默认未选中。不能把空AI整理章节冒充已实现丰富写作器；用户可在现有审核编辑。后续duplicate/create/update/defer及确认事务继续原链。

## 3. 检查点与身份

放在state/extraction-checkpoints/<逻辑job UUID>.json或独立UUID目录，原子写入，schema严格版本化；不能在/api/drafts列表或正式Wiki暴露半成品。持久化成功块、稳定事实/问题/证据及coverage、成功plan、已完成draftId、attempt ledger与stage错误；不存原始Provider畸形响应、请求headers或配置凭证。预算见卡。断电/重启加载须检查内容结构/上限/hash/Raw实际SHA/规则+pipeline版本，逐条重新验证locator范围、派生证据、已知凭证与引用完整性；损坏可见fail closed，无静默跳过重建成功。

缓存身份绑定Raw ID+实际正文SHA、chunk参数、pipeline/rules版本、非敏感Provider端点身份+model。Key与可暴力猜测Key hash都不进入cache/API/backup；仅换Key但同端点/model可保留既有已验证结果，恢复必须用户显式触发，重新扫描当前已知秘密，新调用用当前Provider快照。模型/端点/规则变化则拒绝旧结果拼接，保留旧记录并提示显式重新生成。运行中始终持有启动Provider/规则快照，配置修改不串线。legacy没有checkpoint时按旧可见中断语义，明确新起一次，不能假称续跑。

同逻辑任务的attempt ledger外发前持久计数，恢复不清零；序列化/代次令牌确保双击、并发resume、cancel与晚到结果不创建第二任务或发布第二草稿。已验证缓存可保留取消前结果；取消回包后不再追加新的成功checkpoint，不再启动后续阶段；下次显式恢复重新校验。启动重启不做任何外部调用。draft创建/写入与checkpoint完成之间崩溃要通过jobId/draftId恢复既有active草稿，不重复生成。

## 4. 对外兼容与恢复操作

旧POST /api/raw/:id/extract {}继续支持，运行job/active draft复用原语义。对已失败/取消的新pipeline任务，该显式重试复用最新兼容checkpoint；无checkpoint新建；存在但不兼容/损坏时返回明确409及原因，不暗中丢掉进度。允许body {restart:true} 表示用户在错误提示后明确重新生成，旧证据保留，新逻辑job累计ledger单独记账；产品不能内部自动发restart规避调用上限。

job视图增加可选pipelineVersion/checkpoint summary：阶段（extracting/planning/assembling/done）、validatedChunks/totalChunks、可恢复标志/原因、累计attempts、reusedChunks。旧status running/completed/failed/cancelled不需扩枚举，stage可扩planning/assembling；completed仍代表完整可审核草稿成功。允许旧客户端省略新字段；原首页/任务轮询/Raw选择/navigation代次行为继续。

Raw错误/任务区显示真实已验证进度、可重试/继续、明确重新生成入口；浏览/刷新/恢复读取无Provider调用。草稿完整前不出现待确认成功态；恢复仍同Raw ID。中间检查点可列入现有state备份，但恢复后同样严格校验，不携带Key；不重构备份格式。
