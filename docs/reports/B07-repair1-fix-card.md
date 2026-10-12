# B07 第二次返修卡（2026-10-07）

首次返修独立复验仍 **FAIL**；[报告](B07-repair1-acceptance.md)。F07-01/02/03/06 已 CLOSED，本卡仅剩 F07-04/05。冻结范围仍是 [B07 交接](../handoffs/B07-deepseek-prompt.md)，B08 不施工，B04–B06 真实 Provider 阻塞不变。原返修卡/原报告是历史证据，不覆盖。

## F07-04 / P2 / OPEN：查看历史时作废旧变量生成请求

- 文件：`app/pages/PromptLibraryPage.tsx`，`openVersion` 348–367、`doRender` 283–307、返回当前视图的状态处理。
- 最小复现：甲当前版缺变量 → 点击生成并延迟真实 422 → 点击甲第 1 版，历史 200 已展示 → 释放 422。顶部生成错误串入历史页；返回当前后旧缺值状态保留。[截图](B07-repair1-acceptance-render-error-history.png)，浏览器 JSON `F07-04-render-error-history`。
- 根因：打开历史只作废 historyRequest/释放 busy，没有作废 renderRequest；同模板 selectionVersion 未变，旧 render 成功/失败仍能写入。
- 修复要求：历史/当前/编辑视图切换采用明确有效操作身份；退出生成上下文时旧成功、错误、缺值与复制结果都失效。保留已有 busy 令牌所有权，旧 finally 不能解锁新请求。不要只隐藏旧错误提示。
- 独立关闭标准：同模板 render 200 和 422 各自延迟，打开历史/返回当前/进入新建后释放；旧结果和错误不出现，新上下文操作正常；若又启动新操作，旧 finally 不误解锁。原跨甲乙及变量变化/真实复制场景继续通过。

## F07-05 / P1 / OPEN：并发新建的 requestId 与清理身份隔离

- 文件：同文件 `startCreate` 170–182、`save` 199–243，尤其 finally 241 的共享 `inflightRequestId.current = null`。
- 最小复现：丁新建提交，延迟真实 201；另开新表单戊提交，延迟另一个真实 201；只释放丁（戊仍在途）；另开己表单保存。实际 409 `REQUEST_ID_CONFLICT` 指向戊，而己从未保存。[截图](B07-repair1-acceptance-create-requestid-overlap.png)，浏览器 JSON 同名 FAIL 与 runtime create-D/E/F 事件。
- 根因：丁 finally 清掉戊占用标记，startCreate 将已提交的戊 requestId 当成可用重试 id 继续复用。
- 修复要求：每个新表单/session 分配自己的创建身份；旧请求只能释放自己拥有的占用，不能清理后一个请求的状态。同一表单失败重试仍保持稳定 requestId；开始另一张新表单使用新 UUID。已保存但 UI 忽略的记录正常出现在列表，不能重复提交或清掉新输入。
- 独立关闭标准：上述至少三表单、两个重叠提交按指定顺序释放，丁/戊/己均可各保存一个独立 UUID 和第 1 版；成功/失败/409 的迟到 finally 不清新 session 身份或消息。重复点击/真实失败重试原幂等契约继续通过，原 PUT 迟到保留新表单及 409 保留编辑输入仍通过。

## 交付门禁

- 施工仅修当前两个原因并增加覆盖真实时序的自测，不改独立验收脚本/原断言/历史证据，不改 Raw/Wiki，也不扩展 B08。编写新施工报告 `docs/reports/B07-repair2-build.md`，列文件 SHA、每项自测、未测项和清理记录。
- 保留原 142 项测试；执行 build/test。运行 test 前保护 B04 两份会被覆盖的历史自测输出，另存本轮并恢复原件。
- 产品仅 UI 改动且存储/backend SHA 保持本轮一致时，后续复验可复用本轮独立 HTTP 与损坏记录证据，重点实际浏览器验证两个残留及回归；不得说未重复的测试已经重新运行。
- 验收方独立关闭两项并裁决门禁；施工自测不代签 CLOSED/PASS。全部数据隔离，不提交本地数据与密钥。
