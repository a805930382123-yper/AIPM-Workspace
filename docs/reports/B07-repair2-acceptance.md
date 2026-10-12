# B07 第二次返修独立验收（2026-10-07）

**结论：FAIL。此次返修的 F07-04、F07-05 CLOSED，原六项已全部关闭；回归发现新缺陷 F07-07 / P2 / OPEN：重复点击已选中的模板，会清空历史列表并永久显示“正在读取版本”。**

当前第三次返修范围见 [F07-07 返修卡](B07-repair2-fix-card.md)。原 [首次返修 FAIL](B07-repair1-acceptance.md)、[第二次返修卡](B07-repair1-fix-card.md) 与证据全部保留。验收没有修改产品代码，没有启动 B08。B04–B06 的真实 Provider 阻塞另行保留；B07 手工能力不依赖产品 Key，本轮失败来自 UI 实际行为。

## 交付、检查与证据

| 检查 | 本轮实际结果 |
|---|---|
| 交付范围 | 65 个产品文件中仅 `app/pages/PromptLibraryPage.tsx` SHA 改动；后端/存储及其余 64 个产品文件与首次返修实测版本一致。施工报告列出的 5 个产品/测试文件 SHA 均与实物一致。[交付核对](B07-repair2-acceptance-delivery.json) |
| 独立构建 | PASS，44 modules，Vite 1.69s。[日志](B07-repair2-acceptance-build.log) |
| 独立仓库测试 | 144/144 PASS，0 fail/skip，17.257s。[日志](B07-repair2-acceptance-test.log) |
| 实际浏览器 | 15 项有效观察：13 PASS、2 FAIL（两个 FAIL 是同一 F07-07）；另保留 1 项 INVALID_EXPECTATION，不计产品失败。[JSON](B07-repair2-acceptance-browser.json) |
| 数据与重启 | PASS。同目录 API 重启前后整个 prompts 文件集合/SHA 不变；甲 3 版、乙 2 版，丁/戊/己/辛/壬/失败重试记录各仅 1 版；失败庚 404；有效数与首页/分类总数均 8。Raw/Wiki/Index/Log 全部 SHA 与 Prompt 操作前一致。[文件证据](B07-repair2-acceptance-browser-files.json) |
| 完整性 | 65 产品文件验收期间集合/SHA 不变，正式 workspace 全部 2 文件不变，60 份受保护历史文件不变。[最终核对](B07-repair2-acceptance-final-integrity.json) |

真实浏览器在 TEMP 隔离数据上点击产品按钮。代理先请求真实产品 API，仅扣住并释放既有响应，不伪造状态或正文；本轮新增记录实际请求 payload，可逐项核对 UUID 与 baseVersion。[运行记录及 held/released 事件](B07-repair2-acceptance-browser-runtime.json)。500 是隔离库最终 rename 的真实 EIO；解除故障后真实重试成功。409 是独立 API 模拟另一窗口先保存甲 v3 后，浏览器仍用 v2 baseVersion 提交产生的真实冲突；[并发写入记录](B07-repair2-acceptance-concurrent.json)。

**明确复用而非重跑**：后端与存储未改，按第二次返修卡复用上一轮 [独立 HTTP 11/11](B07-repair1-acceptance-http.json)、[损坏记录 4/4＋重启](B07-repair1-acceptance-damaged.json)，以及既有删除、Markdown 实际下载、Wiki 删除后失效关联等证据。本轮没有重复整套独立 HTTP、损坏矩阵、浏览器下载或 B06 完整 HTTP；本轮仓库测试与此次真实浏览器的产品 API 请求是新运行证据，计数不混用。

## F07-04 CLOSED

- 原复现重新实测：甲当前版缺变量，持有真实 render 422；打开同模板第 1 版后释放。历史页无旧错误/缺值状态，返回当前没有回灌。实时缺值提示仍正确存在，复制仍禁用。[无旧错误历史页截图](B07-repair2-acceptance-history-clean.png)。
- 真实 render 200 在历史页中释放后，不显示旧结果；返回当前仍没有旧 preview/可复制正文。
- 历史→返回当前→启动新 render，先释放旧 render 200：新 render 的编辑/复制仍禁用；再释放新 render：显示新客户/新流程结果，操作恢复。这验证旧 finally 不误解锁新操作。
- 真实 render 422 后新建并输入丁，释放旧错误：丁的输入保留，无串错。代码中 openVersion、backToCurrent、startEdit 的 render 代次变化已核对；仓库相关受控测试通过。

以上分别对应浏览器 `F07-04-history-late-422`、`return-no-stale-error`、`success-history-return-busy`、`new-context-render`、`render-new-form-422`、`history-late-200-only`，均 PASS。原跨模板永久禁用原因此前已关闭，此次主残留也关闭。

## F07-05 CLOSED

- 原丁/戊/己时序重新实测：丁 201 扣住→戊 201 扣住→只释放丁，戊仍在途→另开己保存 201→释放戊。三次 requestId 和记录 UUID 各不相同；己未收到 409，当前详情保持己，丁/戊/己均正常入列表且各仅第 1 版。[截图](B07-repair2-acceptance-three-creates.png)。
- 同一新建表单真实 rename EIO 500，输入保留；解除故障后重试，两次 payload 的 requestId 完全一致，201 成功，只有一条记录/一版。
- 迟到失败的清理实测：庚 500 扣住→辛 201 扣住→只释放庚→另开壬保存 201→释放辛。旧错误不串入辛/壬，辛 busy 不被解锁，三个 requestId 不同，庚没有落盘，辛/壬各一次成功。
- 迟到更新 409 后新建并输入名称/正文，释放冲突：新输入保留，不显示旧冲突。仓库原 PUT 迟到保留新表单与 409 保留编辑输入回归通过。

对应浏览器 `three-overlapping-forms`、`real-failure-stable-retry`、`late-failure-overlap-identity`、`late-real-409-new-form` 均 PASS。代码的占用集合 add/delete 只操作本请求 UUID，原共享清理原因已关闭。

## 回归与 F07-07 / P2 / OPEN

F07-02 实际变量生成→复制→粘贴普通 textarea 逐字符通过：`$&`、`$1`、值内 `{{业务流程}}` 保持字面内容，不递归；修改客户后旧复制立即禁用，重新生成粘贴为“华南最新客户”。整个甲 JSON 在填写、生成、复制前后字节不变。[普通粘贴截图](B07-repair2-acceptance-paste.png)。F07-06 真实旧中文查询响应后到，仍保留最新甲结果，清空恢复八条。

**F07-07 最小复现无需代理、无需重启、无需故障**：

1. 选择乙，再选择甲，等待甲历史第 3/2/1 版全部显示。
2. 再点击列表中已经选中的甲。
3. 历史列表变成 0，显示“正在读取版本…”。首次发现后等待历史按钮超过 4 秒仍不存在；再做上述乙→甲→甲复现，稍后最终观察仍为 0。切乙再回甲可恢复，但再次点甲仍清空。

影响：普通重复选择令版本历史不可用，不能直接查看旧版；提示持续假加载。数据没有丢失：公开 API 与实物仍有完整三版，这不抵消 UI 历史能力失效。命中冻结 E07-03/E07-11、R33 版本能力与 R39 的 B07 手工历史子条件。

代码根因在 `PromptLibraryPage.tsx:96–107`：`selectId` 无条件增加 selectionVersion 并 `setVersions([])`，却只 `setSelectedId(id)`；读取详情/历史的 effect（150–161）仅依赖 selectedId/reloadToken。相同 id 不变，reloadToken 也不变，清空后没有重新触发读取；若已有请求仍在途中，其旧选择代次也会被作废。需要让同 id 的选择行为与重新加载触发一致，不能仅隐藏“正在读取”。

证据：浏览器 `UI-restart-persistence` 是首次发现（其中重复点了自动选中的甲），`F07-07-reselect-current-loses-history` 有恢复前三版、再次清空以及之后仍为 0 的完整状态。[截图](B07-repair2-acceptance-reselect-history-missing.png)。两条 FAIL 属同一问题，不算两个缺陷。这个原因在本轮被发现，不声称是此次两处修复新引入，也不撤销已经通过的 F07-04/05。

## 验收操作记录与收尾

验收脚本首次预期单行变量 input 能保留 fill 中换行，但浏览器实际去掉换行，逐字符预期不适用，原记录保留为 INVALID_EXPECTATION；按可见合法输入“铺货 回访”重新通过真实复制/粘贴。没有删除原证据，也没有将该脚本预期错误列为产品缺陷。另有初始 Windows 路径斜杠比较错误，统一分隔符后重新运行交付核对通过。

8 条有效 Prompt 的落盘/重启检查 PASS，与历史 UI 失效分别裁决。正式数据未参与测试。仓库 test 改写的两份 B04 证据已先备份，另存本轮 `B07-repair2-acceptance-generated-*` 后恢复历史原件。此前 60 份保护文件最终逐字节一致。自有 API/UI/proxy/fake 和两个自建标签均已关闭，浏览器原剪贴板文本恢复；TEMP fixtures 与证据保留。

**本轮止于 B07。F07-01–06 CLOSED，F07-07 OPEN；修复新缺陷并独立复验后才可签 B07 PASS。B08 未授权/未开始。**
