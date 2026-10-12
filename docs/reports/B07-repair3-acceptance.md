# B07 第三次返修独立验收（2026-10-08）

**结论：PASS。F07-07 CLOSED，B07 累计 F07-01–F07-07 全部关闭，无待返修缺陷。**

当前 Codex 主 Agent 独立检查交付、运行构建与测试、操作真实浏览器并核对磁盘。验收方没有修改产品代码。原 [第二次返修 FAIL](B07-repair2-acceptance.md)、[第三次返修卡](B07-repair2-fix-card.md) 及全部历史证据原样保留。本次仅验收 B07；B08 未授权/未开始。B04–B06 的真实 Provider 成功与质量仍 BLOCKED，不因 B07 通过而关闭；B07 手动 Library 不依赖 LLM。

## 本轮实际证据

| 检查 | 结果与依据 |
|---|---|
| 交付范围 | 相比第二次返修，65 个产品文件中仅 `app/pages/PromptLibraryPage.tsx` 改动，其余 64 个产品文件（包括后端/存储）未变。施工报告 5 项文件 SHA 声明与实物一致。[交付核对](B07-repair3-acceptance-delivery.json) |
| 独立构建 | PASS，44 modules，1.03s。[日志](B07-repair3-acceptance-build.log) |
| 独立仓库测试 | 146/146 PASS，0 fail/skip，17.619s；包含新增同模板重选与在途读取测试。[日志](B07-repair3-acceptance-test.log) |
| 实际浏览器 | 9/9 检查 PASS，包括本轮缺陷关闭及 F07-04/05 关键回归。[逐项状态、真实回包及 DOM](B07-repair3-acceptance-browser.json) |
| 文件与重启 | PASS，同目录 API 重启 1 次。整个 prompts 集合/SHA 不变；甲/乙各 2 版，丁/戊/己各 1 版、独立 UUID；列表/分类/首页/统计有效数 5。Raw/Wiki/Index/Log 全程不变。[磁盘检查](B07-repair3-acceptance-browser-files.json) |
| 验收完整性 | 验收前后 65 产品文件集合/SHA、正式 workspace 全部 2 文件、84 份受保护历史文件均不变。[最终核对](B07-repair3-acceptance-final-integrity.json) |

浏览器运行在 TEMP 隔离库、独立端口、未配置 Provider。代理先请求真实产品 API，只延迟和释放真实响应，不制造状态或正文。实际 200/201/422 及请求 payload 可在 [运行与 held/released 记录](B07-repair3-acceptance-browser-runtime.json) 中核对。真实复制通过产品按钮写入剪贴板，再按 Ctrl+V 粘贴普通 textarea，逐字符比较；结束时恢复原剪贴板。

## F07-07 CLOSED

修复将 `selectId` 的重选重置与 `reloadToken` 增量绑定，详情/历史 effect 已依赖该 token；相同 ID 也会重新读取。原 selection 代次和 effect 清理继续阻止旧响应覆盖新上下文，修复没有仅隐藏加载提示。

| 必须关闭的行为 | 本轮实测 |
|---|---|
| 已读完整历史，再点击当前乙 | 两版重新显示；`F07-07-repeat-loaded-B` PASS |
| 乙→甲→重复甲 | 当前甲、两版正确；`F07-07-B-A-repeat-A` PASS |
| 首个历史读取在途时重复选择 | 作废的旧读取返回后没有填入历史；第二个真实读取释放后恢复两版；`F07-07-inflight-repeat-two-reads` PASS |
| 旧版/编辑页面重复点击当前模板 | 退出只读历史或未保存编辑，回到当前详情，恢复两版；整个乙 JSON 字节不变；`F07-07-history-editor-return-readonly` PASS |
| 已生成结果后重复选择 | 变量与最终正文清空，复制禁用，两版保留；整个甲 JSON 字节不变；`F07-07-generated-context-repeat-readonly-copy` PASS |
| 两模板切换、刷新及同目录重启 | 重启后乙→乙、甲→甲都恢复两版，正文、收藏、标签和 Wiki 关联回读正确；`F07-07-refresh-restart-repeat-A-B` PASS |

最终页面真实显示“版本历史 · 2”、第 2/1 版，无永久假加载：[截图](B07-repair3-acceptance-history-restored.png)。A37/A38、历史与切换门禁 E07-03/E07-11 及 R33/R39 手动历史子条件均满足。

在途读取的前两次控制尝试，持有相同 URL 的首响应时等待第二个 HTTP 事件，3 秒/12 秒未到达；日志显示首响应释放后第二请求才到达。有效第三次先释放旧响应、再扣住新读取，观察旧读取未填入历史，释放新读取后恢复。全部旧事件与说明保留；这两个控制等待不计产品 FAIL，也不声称浏览器同时发送了两个被持有的同 URL HTTP 请求。仓库受控测试另外覆盖两个待完成读取的代次保护。

## 关键回归

- **F07-04 保持 CLOSED**：甲缺变量时实际 render 422 延迟，在第 1 版历史中释放，历史不显示旧错误。旧 render 200 延迟后从历史重选当前、启动新 render：旧响应不覆盖新客户/新流程，不解锁新生成；新响应完成才显示新结果并恢复操作。对应 `F07-04-late-422-history-regression`、`F07-04-late-200-busy-history-regression` PASS。
- **F07-05 保持 CLOSED**：丁 201 在途→戊 201 在途→释放丁→新建己 201→先完成己、再释放戊。三张新表单 requestId/记录 UUID 各不同，没有 409，迟到戊不清空己详情，磁盘各一版。`F07-05-three-overlapping-creates-regression` PASS。
- **F07-02 保持 CLOSED**：实际生成、按钮复制和普通目标粘贴保留前后空格/换行、重复中文变量替换结果；重选后旧 preview 清空且复制禁用。甲完整 JSON 未变。本轮不重复上轮 `$&`/`$1`/值内变量字面值矩阵，复用既有实测和不变后端证据。

## 完整 B07 门禁与复用边界

本轮是唯一 UI 改动的定向复验，不把历史计数冒称为新执行。后端/存储与其余 64 产品文件未变，明确复用 [首次返修独立 HTTP 11/11](B07-repair1-acceptance-http.json)、[四类损坏记录与重启](B07-repair1-acceptance-damaged.json)，以及 [首次返修报告](B07-repair1-acceptance.md) / [第二次返修报告](B07-repair2-acceptance.md) 中真实删除、Markdown 下载、Wiki 失效关联、搜索、真实 EIO 稳定重试、迟到失败及真实 409 的通过证据。本轮没有重新运行完整 HTTP、损坏矩阵、下载、显式删 Wiki 或 B06 完整 HTTP；本轮 146 项仓库测试和 9 项浏览器观察分别计数。

| 冻结场景 | 最终裁决及依据 |
|---|---|
| E07-01 记录/校验 | PASS：既有独立 HTTP/实物校验；本轮新建与元数据/正文回读 |
| E07-02 列表 | PASS：既有中文组合筛选与旧查询保护；本轮列表/分类/首页/统计 5 条一致 |
| E07-03 版本 | PASS：既有版本全字段/无效保存回归；本轮甲乙旧版、重选、重启与磁盘不变 |
| E07-04 冲突/重试 | PASS：既有独立 HTTP、真实 409/EIO/幂等；本轮三个新建身份与迟到回包回归 |
| E07-05 变量 | PASS：既有中文/重复/字面替换矩阵；本轮实际填值、缺值 422、模板不变 |
| E07-06 实际复制 | PASS：本轮真实按钮→普通 textarea 粘贴逐字符一致；原复制失败证据与仓库回归保留 |
| E07-07 删除 | PASS：既有实际删除/回收/重启/不改知识；后端/存储不变 |
| E07-08 松耦合 | PASS：既有显式隔离 Wiki 删除后的失效关联；本轮整个 knowledge 不变 |
| E07-09 导出 | PASS：既有实际下载/独立文件读取与特殊围栏正文；相关代码未变 |
| E07-10 错误/磁盘 | PASS：既有真实写入故障、损坏记录矩阵/恢复；本轮持久化与完整性 |
| E07-11 UI切换 | PASS：旧六项已关闭，F07-07 本轮关闭；F07-04/05 实际异步回归通过 |
| E07-12 无LLM/回归 | PASS：本轮全部 UI 在无 Provider 隔离实例完成；原 Raw/Wiki/Audit 入口/B06 证据与当前仓库回归保留 |

验收映射：**A37–A43/A59、R33/R40 PASS**；R34 的 manual 完整字段与 R39 手动版本子条件 PASS，AI 来源/Optimizer 仍属 B08；A57/A61 只推进已实现手动部分，不把跨批整项签 PASS。

| 缺陷 | 最终状态 |
|---|---|
| F07-01 损坏记录计数 | CLOSED，首次返修独立关闭，存储未改 |
| F07-02 变量变更后旧复制 | CLOSED，首次返修关闭，本轮复制/重选回归通过 |
| F07-03 历史串页 | CLOSED，首次返修关闭，本轮历史/代次回归通过 |
| F07-04 render 切页与旧响应 | CLOSED，第二次返修关闭，本轮 200/422/busy 回归通过 |
| F07-05 重叠新建身份 | CLOSED，第二次返修关闭，本轮三次新建回归通过 |
| F07-06 旧搜索覆盖新条件 | CLOSED，首次返修关闭，相关实现不变，仓库回归通过 |
| F07-07 当前模板重选历史不可读 | CLOSED，第三次返修独立复验通过 |

## 收尾

测试可能覆盖的两份 B04 自测输出已在运行前备份，新产物另存本轮 `B07-repair3-acceptance-generated-*`，之后恢复原件；84 份历史保护文件最终一致。自有隔离 API/UI/proxy/fake 全部关闭，两个自建标签关闭，原剪贴板恢复。隔离 fixtures 和新证据保留；正式数据未参与测试。B07 已满足门禁，当前仅完成验收；B08 等待用户授权，B04–B06 外部阻塞继续保留。
