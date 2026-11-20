# KBMAINT01 独立验收（2026-11-20）

**局部结果**　K1–K6 的本地功能、真实模型巡检、错误记账及数据边界通过。首轮网络错误与追加一次的成功记录分别保留。

**整批结果**　通过。KBM-01–06 均有验收证据。工程提交 `d147607b26aaf3b7a34b9b02fb6dbc8126540549` 的 Windows Node 22/24 远程 CI 最终均为 `completed/success`。[GitHub Actions 运行 44760624330](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44760624330)

Astra Medium 规划及验收，Sol High 施工，实际验收实例与施工实例分离。初验基于 `44f2eea93729177916a661af6636cf74c8ea19f6` 上冻结的工程差异。真实模型补验直接使用工程提交 `d147607b26aaf3b7a34b9b02fb6dbc8126540549`。

| 验收项 | 结果与独立证据 |
|---|---|
| KBM-01 | 旧配置迁移、开关、跨周补跑、暂停和严格未来触发时间通过。独立逐日法比对 7 个星期值、跨年和闰年边界，检验 3 周积压只保留最近窗口。 |
| KBM-02 | 实际 Lint 第二轮新增 1、消除 1，旧指纹稳定，模型调用 0；坏快照独立报错并回退。独立构造超过 200 份快照，验证按 90 天与 200 份并集保留。浏览器验收导出的 4 份快照恢复后逐字节一致。 |
| KBM-03 | 8 页与完整页数组 48,000 字符边界、派生来源变化优先级、相同优先级稳定排序均通过。受限、缺底源和超限内容没有出现在请求中，空库零请求，缺模型按失败记账；取消传播、记录完整性及正式写入 403 通过。 |
| KBM-04 | Node 22.23.5 补验通过。真实模型读取 4 篇合成页，生成重复、冲突各一项，4 条引用逐字匹配实读正文，双尺寸浏览器均可回跳。输入 1,493、输出 816 token，未知用量 0。前后 Wiki、Raw 和草稿 SHA-256 清单一致，新增草稿 0。首轮 Node 25 的失败及补验证据详见下文。 |
| KBM-05 | 真实 Edge 157，生产构建，1440×900 与 390×844。两尺寸下分别保存周四 10:10、周日 12:12，立即运行两类任务、打开差异和检查详情、从摘要及首页打开两个知识库视图。两次合成 Provider 检查均从浏览器点开依据，证据接口返回 200。10 张截图检查无水平溢出，控制台和页面错误为 0。 |
| K6 文档 | 核对 README 和架构中的上海时间、部署和停机、两项默认任务、费用及人工审核边界。 |

## 实际命令

- `node --import tsx --test tests/acceptance/kbmaint01-review-core.mjs`，3/3。
- `node --import tsx --test tests/kbmaint01.test.ts`，9/9。首次沙箱执行的回环请求遭 EACCES，获准在沙箱外以相同命令完成。
- `node --import tsx tests/acceptance/kbmaint01-review-browser.mjs`，真实 Edge 和本机合成 Provider 通过。Vite 在沙箱内 realpath 遇到 EPERM；上述结果在获准的沙箱外执行取得。
- `node --import tsx tests/acceptance/kbmaint01-review-browser.mjs --real`，在沙箱外完成一次真实调用尝试后以退出码 1 结束。服务只可发送四篇夹具的知识检查请求，其他计划已停用。没有重发请求。
- `node tests/acceptance/kbmaint01-review-connectivity.mjs <本次真实运行的TEMP目录>`，原夹具仅启用本地只读 GET，禁用应用的全部外发。公开设置摘要显示已配置；随后单独检查公开 Provider 主机，DNS、TCP/443、TLS 握手通过。后续连通测试不能确定原请求失败的具体原因。

[浏览器结果、账本和截图](KBMAINT01-20261120-review-evidence/) · [真实调用账本](KBMAINT01-20261120-review-evidence/real-result.json) · [无模型调用的连接诊断](KBMAINT01-20261120-review-evidence/network-diagnosis.json)

## 工程版本与本地全量验证

工程提交为 `d147607b26aaf3b7a34b9b02fb6dbc8126540549`。主线程将本批冻结的源码和测试叠加到 TEMP 中独立检出的基线，使用 Node 22.23.5 和空 Provider 配置完成以下检查。

- `npm run check` 在四核进程中退出 0，类型检查、983/983 项测试及生产构建通过。默认 14 核的两次运行均为 982/983，唯一失败为既有 E04-07 重启恢复用例。新进程在读取旧实例锁 PID 时被拒绝；相同代码单项复测 1/1 通过。另一个独立副本中八文件并发 57/57、四次并行重启 4/4 通过。模拟 PID 复用可重现该堆栈，原两次失败的具体触发原因未能证实。
- `npm run eval -- --chain standard-extract --recording live-20261115-baseline` 回放 8/8，事实 21/21；`npm run eval -- --chain news-relevance --recording synthetic-v1` 回放 12/12。两项均未发送模型请求。

远程首轮 Windows Node 24 通过。Node 22 的既有 F04-08 删除与提取并发用例预期 404，实际返回 409。主线程核对相关 `jobs.ts`、`source-policy.ts` 与基线一致。相同工程提交下，Node 22 重跑通过，F04-08 的间歇失败仍保留记录，本批未修改该行为。[Windows Node 22 作业](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44760624330/job/136375787191) · [Windows Node 24 作业](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/44760624330/job/136375790835)

验收命令使用当前 PATH 的 Node.js v25.2.1。主线程另用项目 Node.js 22.23.5 对同一主机发送不带凭据的 HEAD /v1/models，返回 HTTP 401，说明该次独立探测已到达 HTTP 层。两次操作的时间、请求及运行时不同。为后续获准的补验，脚本已加入仅保留 HTTP 状态或预定义网络异常代码的记录逻辑，经 node --check 检查；原真实运行没有保留 cause.code，不能用后来的探测反推。此脚本调整没有触发真实请求。

## KBM-04 真实模型补验

此前的 Node 25 运行 `02a2a6e5-db04-40e7-90ab-e3af7a077ec5`、检查 `c755e8b4-bba6-4ead-bff4-31b0f24d4f22` 记为 `LLM_NETWORK_ERROR`，一次请求的 token 用量未知。用户另行授权使用项目 Node 22 追加一次调用，重建相同四篇合成主题及各自的 Raw，并继续由隔离服务加载配置。

执行 `& 'C:/Users/80593/AppData/Local/AIPM-tools/node-v22.23.5-win-x64/node.exe' --import tsx tests/acceptance/kbmaint01-review-browser.mjs --real`，退出 0。实际外发一次，HTTP 200。运行 `61fe2f13-83ce-48bf-80b2-1404241d1bb9` 标记成功，检查 `d1faedd3-494d-4664-b8e1-e6019e902dc3` 标记完成。两份材料对同一季度上海直营店的期末目标分别记为 80 家和 110 家，模型保留双方原文作为冲突待核；两份门店盘点材料中的重复规则另列一项。对四条引用逐一复算原页对应版本的正文切片，全部等于保存的 quote。

真实 Edge 在 1440×900、390×844 均打开此次检查并点击依据，两次证据接口均返回 200。同一真实记录供两种尺寸复用，控制台和页面错误均为 0。[Node 22 运行账本与截图](KBMAINT01-20261120-review-evidence/real-node22/) · [逐条引文与位置](KBMAINT01-20261120-review-evidence/real-node22/inspection-summary.json) · [HTTP 分类](KBMAINT01-20261120-review-evidence/real-node22/provider-transport.json)
