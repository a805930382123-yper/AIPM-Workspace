# M05 集成交接

2026-10-12，M05本机阶段PASS，M01–M05本机建设完成。本批只补跨页集成、选择隔离与交付说明；验收结果见[M05独立报告](../reports/M05-20261012-acceptance.md)，范围见[任务卡](../batches/M05.md)，完整需求映射见[MH01–MH48](../reports/M05-20261012-spec-matrix.md)。服务端策略、HTTP、原件和Raw收据仍沿用[M04接口](M04-interface.md)。原全项目FAIL及真实AI阻塞保留。

## 跨页刷新与真实关联

MeetingPage接收可选`onRawChanged:()=>Promise<void>`和`onOpenRaw:(id:string)=>void`，转给MeetingRawLinks。登记成功后先刷新会议详情，再刷新App共享Raw/统计/处理状态；写入前失败不调用成功刷新。进入Raw/首页也重新读取真实服务端数据。取消/拒绝不伪造计数；Raw已写而linked提交失败的部分成功，以实际Raw及pending/failed状态为准，可同请求恢复，不能当成零副作用。

只有linked收据显示“查看 Raw”，传固定真实Raw ID；unlinked/raw_deleted不提供失效入口。当前原文与工作副本、历史版本不混用。Raw列表/首页无需reload即可读到新增Raw，M04原缓存同步待办已处理。

App明确区分普通导航与指定Raw目标。Home/Wiki/Draft/Meeting的具体Raw回跳都保留ID；目标消失显示“所选 Raw 不存在或已删除”，不展示另一条原文。指定目标意图持续到重连及同页后台刷新，用户改选、普通导航和正常删除明确改变意图。

刷新世代隔离旧列表回包，选择世代隔离请求等待期间的新选择。无参后台回调还必须读取当前选择，避免任务轮询旧render闭包取回过去ID；不能只用请求开始时的世代快照解决过时闭包。普通列表无目标/删除选中项时，默认展示真实剩余资料；不得通过始终留空或禁用轮询掩盖问题。

RawPage在明确ID不存在时展示可读缺失状态；无明确ID才采用真实首项。新Meeting来源的AI/Wiki/Prompt背景限制不变，解除关联和删除会议不解除来源限制；普通旧资料及原提取任务仍正常运行。

## 使用与验收边界

实际本机使用说明见[M05-usage](M05-usage.md)。默认workspace或FMCG_DATA_DIR；meetings目录、纪要JSON、Raw原件及现有备份白名单未变。完整本地场景已纳入独立HTTP、原件SHA、实际重启、CLI导出恢复、删除及受限入口验证；浏览器覆盖桌面与390×844基本窄屏。

本批不新增模型、会议AI、播放器、云部署或会议演示灌入，不改正式数据，不修旧S-03/S-04，不补签真实Provider36项。MH36/MH37的本机机械兼容与旧安全FAIL/真实AI BLOCKED分列；Meeting Hub本地阶段结论不能替代全产品验收。
## 2026-10-30 本地纪要文件接口

`POST /api/meetings/:id/minutes/import` 的 multipart `file` 支持 DOCX、带文字层 PDF、严格 UTF-8 MD/TXT，最大 2 MiB；旧 DOC 需另存 DOCX。策略预检与提交时复核沿用原约束。MD/TXT 保留 BOM 和换行；DOCX/PDF 的提取正文与文件字节分开存储，`original_sha256` 为正文摘要、`file_sha256` 为原文件摘要。新文件原件与版本一并保存在会议 JSON；旧版本无附件字段仍可读取。响应不包含原文件 Base64；`GET /api/meetings/:id/minutes/:importId/file` 以附件下载原文件，旧版本无原文件返回 404。上传不会自动登记 Raw 或调用 AI。
