# B07 首次返修独立验收（2026-10-07）

**结论：FAIL。F07-01、02、03、06 CLOSED；F07-04、05 部分修复，仍 OPEN。**

用户要求检查外部施工方完成的 B07 返修。验收方只写独立检查脚本、证据、报告与工程状态，没有修改产品代码，没有开始 B08。冻结契约沿用 [B07 交接](../handoffs/B07-deepseek-prompt.md)、[原返修卡](B07-fix-card.md)，当前剩余施工范围见 [本轮返修卡](B07-repair1-fix-card.md)。旧 FAIL 报告和原始证据保留。

## 实际验证与边界

| 检查 | 本轮结果与证据 |
|---|---|
| 交付核对 | 65 个原产品文件中只有 `app/pages/PromptLibraryPage.tsx`、`services/prompt/store.ts` 改动；施工报告列出的 5 个产品/测试文件 SHA 均匹配实物。[核对 JSON](B07-repair1-acceptance-delivery-checks.json) |
| 独立构建 | PASS，44 modules，921ms。[日志](B07-repair1-acceptance-build.log) |
| 仓库测试 | 142/142 PASS，0 fail/skip，16.390 秒。[日志](B07-repair1-acceptance-test.log)。包含施工方新增的受控异步测试；这些通过不代替实际浏览器裁决。 |
| 独立公开 HTTP | 11/11 PASS，重新运行原独立脚本并使用本轮前缀保存结果；完整元数据、版本/旧快照、乐观锁并发、幂等/冲突、真实 EIO 原子性、筛选、变量一次替换/只读、Wiki 解耦、导出、删除/重启与损坏有效数。[JSON](B07-repair1-acceptance-http.json) |
| 追加损坏记录检查 | 4/4 PASS：缺字段、文件名与内部 id 不同、current.id 不同、非法 JSON。详情/历史/导出返回明确 `CORRUPT_PROMPT`，列表统计排除，实物不改；同目录重启正常记录仍可读。[JSON](B07-repair1-acceptance-damaged.json) |
| 实际浏览器 | 19 项记录：17 PASS、2 FAIL（包含一个仅记录编辑禁用边界的探测，不是 19 个需求条目）。新建/编辑/收藏、真实复制并粘贴到普通文本目标、变量变化、历史跨模板/版本乱序/真实错误、操作令牌、迟到保存、新建 requestId、旧查询、标签收藏筛选、下载、删除与刷新/重启。[JSON](B07-repair1-acceptance-browser.json) |
| 文件与持久化 | 两次同目录 API 重启；第二次前后整个 prompts 文件集合/SHA 不变，甲乙各 3 个完整版本、收藏与标签保持；删除丙后 API 404，有效数 4（甲、乙、丁、戊）；Raw/Wiki/Index/Log 全部 SHA 与创建 Prompt 前一致。[JSON](B07-repair1-acceptance-browser-files.json) |

浏览器代理只延迟产品已经生成的真实响应，不替换状态码/正文。实际 422 来自缺少变量，500 来自保留后恢复的隔离损坏记录，409 来自产品真实 requestId 冲突。浏览器延迟事件及服务关闭记录在 [runtime JSON](B07-repair1-acceptance-browser-runtime.json)。实际下载已另存为 [Markdown](B07-repair1-acceptance-browser-export.md)，独立读取确认当前场景、原样正文（包括前后空白和换行）。

本轮未重复 B06 完整 HTTP、真实 Provider 成功/质量或全部网络错误矩阵。除上述 2 个产品文件外，其余产品 SHA 与前轮一致，使用本轮仓库回归及既有 B06 有效证据；未将旧运行计为本轮运行。B07 手工能力无需 Key，本轮 FAIL 是实现残留；B04–B06 真实 Provider BLOCKED 继续保留。

## 六项逐项裁决

| 缺陷 | 本轮状态 | 依据 |
|---|---|---|
| F07-01 损坏记录有效数 | CLOSED | 本轮独立 HTTP 附加原场景及四类损坏文件均通过；受控错误、文件身份、数量与不改盘一致。 |
| F07-02 旧变量结果可复制 | CLOSED | 修改变量立即禁用旧复制；重新生成后实际粘贴逐字符为最新内容；含 `$&`、`$1`、`{{业务流程}}` 的值保持一次字面替换；render 期间改值不恢复旧结果，填值/复制前后整个模板 JSON 字节不变。版本/id/输入签名有效性亦经代码核对。 |
| F07-03 历史串页 | CLOSED | 甲/乙双向延迟成功、同模板两个版本乱序、真实历史 500 后开始新建均不污染新选择；新请求有历史代次守卫。 |
| F07-04 render 切页锁死 | PARTIAL / OPEN | 原跨模板成功/失败后禁用与旧 finally 解锁新请求场景通过；同模板打开历史没有作废旧 render，真实 422 污染历史页面。 |
| F07-05 迟到保存清新表单 | PARTIAL / OPEN | 原 PUT 迟到后新表单输入保留，丙可实际保存成独立 UUID；仓库测试迟到 409 保留新输入通过。但重叠新建清理共享占用标记，第三张新表单复用戊 requestId，真实保存 409。 |
| F07-06 旧查询覆盖筛选 | CLOSED | 实际旧中文查询 200 后到不替换最新甲结果，清空恢复；标签/收藏筛选与全库分类数量通过。仓库受控分类乱序及筛选中新建输入保留通过；条件引用和列表代次守卫经核对。未冒称浏览器重跑全部旧错误分支。 |

## F07-04 残留：旧 render 错误显示在历史只读页

实际步骤：选甲当前第 3 版，不填写变量，点击“生成最终正文”；持有真实 POST `/render` 422。点击甲“第 1 版”，真实 GET 200 返回历史只读页后，释放旧 422。历史正文/版本仍正确，但顶部出现“还有未填写的变量：客户名称、业务流程。请填写后再生成最终正文。”；返回当前后旧缺变量状态亦保留。这是旧操作污染当前视图，不是用户在历史页点击了生成。

代码原因：`PromptLibraryPage.tsx:348` 的 `openVersion` 释放 busy 并增加 historyRequest，但不增加 renderRequest，也不改变 selectionVersion。`doRender` 的 catch（303–306）只检查后两者，错误因此仍被接受。旧成功同样没有失效，应一起保护；不能只隐藏错误条。

证据：浏览器 `F07-04-render-error-history`、真实 status 422 事件，以及 [截图](B07-repair1-acceptance-render-error-history.png)。残留优先级 P2（原 P1 永久锁死已修复），关闭标准见新返修卡。

## F07-05 残留：旧 create 清掉新请求占用，新表单 requestId 冲突

实际步骤：新建丁并提交，持有真实 201；点击新建，填写戊并提交，持有另一个真实 201；仅释放丁，戊仍在途；点击新建并填写己，保存。己实际收到 409 `REQUEST_ID_CONFLICT`，details.id 指向已落盘的戊 UUID `4aa58372-464d-47a3-8649-eee66530ac99`。新表单人工输入保留，但正常的新建不能保存。丁、戊分别只落盘一个版本；己没有被错误写入或伪装成功。

代码原因：`save` finally（241）对任意旧 create 无条件将单个 `inflightRequestId.current` 清空。丁完成会清掉戊的占用标记，`startCreate`（181–182）无法辨认当前 requestId 已被戊使用，继续复用。这是新表单/在途操作身份不隔离，仍落在原 F07-05 关闭标准内。后端拒绝冲突本身正确。

证据：浏览器 `F07-05-create-request-id-overlap`；runtime 的 create-D/E/F held/released 真实 201/201/409；[截图](B07-repair1-acceptance-create-requestid-overlap.png)。残留 P1（新建保存被阻断）。修复需保留同一表单失败重试的幂等身份，同时保证每个新表单拥有独立身份。

## 完整性与收尾

65 个产品文件在验收期间集合/SHA 不变；正式 workspace 全部 2 个文件集合/SHA 不变。8 份受保护历史报告/证据与归档逐字节一致；`npm test` 会改写的 B04 两份输出已保存为本轮 `B07-repair1-acceptance-generated-*`，然后恢复历史原件。见 [最终核对](B07-repair1-acceptance-final-integrity.json)。

独立 HTTP、损坏记录与浏览器测试均使用 TEMP 隔离库，fixture 保留。自有 API/UI/proxy/fake 已关闭，两个自建标签已关闭，原浏览器剪贴板文本已恢复。浏览器导出首次等待较久、刷新后先进入首页导致一次 locator 未命中属于验收操作记录；随后按实际导航进入 Library 并验证成功，没有将其记录成产品缺陷。

**本轮停止在 B07；剩余两项独立关闭之前不能签 B07 PASS。**
