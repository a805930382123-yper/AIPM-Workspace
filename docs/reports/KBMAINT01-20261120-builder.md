# KBMAINT01 施工报告

基于 `44f2eea93729177916a661af6636cf74c8ea19f6` 的工作树实现任务卡 K1–K6。施工交付为工作树，提交标识由主线程在提交后记录。

## 交付内容

- 周计划沿用每日计划的上海时区游标，按周一至周日配置。在当前时刻命中计划点时，计划编辑和首次启用计算下周。离线恢复只补最近一个消费窗口，旧计划的配置和 revision 继续可读。
- 每日 08:00 的结构巡检调用 `WikiLint.inspect()`，保存行级问题、确定性指纹和与最近一次成功可读快照的差异。首次运行建立基线。保留近 90 天与最新 200 份快照的并集，损坏快照单列读取问题。快照随原备份语义导出、恢复。
- 每周一 08:30 的主动巡检逐页检查来源，排序后选取主题页。候选与相关扩展共用完整 Wiki 页数组的 8 页、48,000 JSON 字符限额。跳过原因留在本机，模型请求仅携带实读页及本次依据。已完成和部分完成的检查进入成功运行摘要，已失败且已落盘的检查可从该失败运行打开。待核数读取当前检查状态。
- 自动化和首页接入巡检摘要，运行详情能看结构差异和发现。知识库视图直接打开结构检查或所指定的主动检查记录，并继续沿用原文引用和人工审阅入口。
- 为精确记录跳转，增加 `WikiPage.tsx` 与 `WikiInspectionPanel.tsx` 接线。`server/knowledge-api.ts` 接收已初始化的同一个检查服务。三者均经主线程批准纳入范围。`provider.ts` 的已取消信号预检亦经批准，防止计量持久化期间取消后仍发出请求。

## 施工验证

| 命令或证据 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kbmaint01.test.ts tests/run01-core.test.ts tests/run01-api.test.ts tests/run01-ui.test.tsx tests/lw03-core.test.ts tests/audit.test.ts tests/uifix04-ui.test.tsx tests/homeui01-ui.test.tsx` | 45/45 通过，其中本批 9 项。使用临时数据根和随机本机回环端口。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/run01-ui.test.tsx tests/uifix04-ui.test.tsx tests/homeui01-ui.test.tsx tests/wiki-selection.test.tsx` | 17/17 通过 |
| 隔离 Vite 生产构建和 Edge 自查 | 构建 249 模块，保留已有体积警告。1440×900 和 390×844 均无控制台错误或横向溢出。验证周计划、两类立即运行、差异与检查结果、历史记录精确跳转、首页提示及空态。接口使用确定性回放数据。10 张截图和结果位于 `%TEMP%/kbmaint01-ui-Y0bC0d/`。 |
| `git diff --check`（本批已跟踪文件） | 通过 |

测试用真实 Lint 规则产生增一、消一、不变一。分别比对每次巡检前后的正式 Wiki 文件 SHA，恢复出的快照与导出前逐字节一致。模拟最新快照和检查记录损坏后，健康摘要回退到上一份成功且可读的产物。Fake Provider 测试校验实收请求排除会议受限、缺底源、Source 和超长主题。精确引用、派生快照后的来源版本变化、已处理发现复用、失败、取消、计量后发请求前的取消也已覆盖。成功检查的 fixture 用量为 1 次请求、59 输入 Token、22 输出 Token、0 次未知用量。自动化上下文正式页写入返回 403，检查期间正式页哈希和草稿目录清单一致。

本地施工环境的首次 HTTP 验证遇到沙箱回环连接拒绝，切换已获批的隔离回环测试后通过。施工测试中的派生优先级夹具先把八个对照主题创建于上次检查之后，按更新时间排序时排在变更来源页之前。按测试预期重建时间顺序后，派生页居首，变更来源也进入实读范围，精确证据校验通过。

施工过程使用合成数据和 fake Provider。隔离真实 Provider、完整回归及回放、真实产品浏览器独立验收和两档远程 CI 由对应验收环节记录。
