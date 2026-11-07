# WORK04A 独立验收

本轮实现与缺陷关闭 **PASS**，WORK04 A 的 W04-A1～A3 工程整体验收 **PASS**，无待返修。WORK04 整批未完成：B 事项推进建议延期、未施工未验收；真实模型复核质量 `NOT_RUN`，本轮真实调用 **0**。

按[冻结任务卡](../handoffs/WORK04-20261107-task.md)执行，评分 0/2/2/0＝4，因历史快照再次发送按 B 路由。用户已批准的独立 GPT-6.1 Sol High 配置实际用于规划兼验收 `/root/work04a_plan_review` 与施工 `/root/work04a_builder`。验收实例在施工停写后读实际差异、复核结果和截图，未改产品。

| 验收项 | 独立实测结果 |
|---|---|
| W04-A1 | Chrome 1440px 和 390px：打开 v2 承接轮预览、展开原文和原承接、跳到原草稿，预览调用 0。明确点击后恰好 1 次复核：fake 实际收 `input`/`output` 两个顶层字段，与该轮原出站请求及原草稿深比较相同；后来保存的口径、替换过的当前 Raw、未选材料和未保存编辑均未混入。展示支持、不支持、证据不足并定位原文；只有 v1 全 supported 对照显示「模型未发现依据问题」。重读和重复无参请求不再发送；保留 WORK03P 标签、短摘要带入、人工编辑保存及来源回读。原运行 SHA、Raw 和复核时人工字段未改变。 |
| W04-A2 | 实际 HTTP 拒绝未知、跨事项、未完成、替换正文、无效重试、缺失或受限的本轮和承接来源、凭证及超限请求，无新增外发。13 次本地 fake 失败验证 Provider 错误、凭证回显、8 类结构/引文错误、非法 JSON、截断与响应上限，均保留失败且无结果。快速失败无参复读、并发挂起和陈旧重试不重发；有效重试每次只发 1 次并保留旧记录。损坏复核单独不可用，原草稿及其他轮仍可读；拒绝新发。真进程停止/重启，Chrome 从运行中变为中断，自动发送 0，显式重试后成功。递归备份恢复后逐字节核对原运行与该组全部失败和后续尝试。 |
| W04-A3 | 用真实 `server/index.ts` 子进程、隔离配置文件和本机 `/v1/chat/completions`，分析使用 `original-model`，同一进程改配置后复核实际命中 `current-review-model`。未配置或配置非法时启动失败，GET 与人工保存仍可用。对照实际请求和服务接线，未采用注入 Provider 的假路由。 |

实际命令：

- 独立 `node --import tsx tests/acceptance/work04a-review.mjs` 退出 0，7 组断言完成。20 次本机 fake（2 次用于建立历史分析、18 次用于复核），fake fixture 错误 0；Chrome `156.0.8078.80` 页面异常 0，宽窄无横向溢出；同脚本以空 `envDir` 构建 231 模块，保留既有 Vite 包体积提示。默认沙箱首次尝试在健康检查前因回环 `EACCES` 停止，未产生产品结论；获准隔离回环后完整执行。刻意重启隔离 API 时浏览器轮询出现两条代理连接错误，对应中断实验。
- 复用[施工交接](WORK04A-20261107-builder.md)同产品 SHA 的 `node ../../typescript/bin/tsc --noEmit --pretty false`（`node_modules/.cache/work04a-builder-source`，退出 0；七份既有受损测试仅在副本补 HEAD 原文）及 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/work01-http.test.ts tests/app-navigation.test.tsx tests/lifeos-l3-home-ui.test.tsx`（4/4）。独立复核范围内 `git diff --check` 退出 0。
- [可复跑脚本](../../tests/acceptance/work04a-review.mjs)、[计数和请求摘要](WORK04A-20261107-review-evidence/summary.json)、[桌面预览](WORK04A-20261107-review-evidence/v2-preview-1440.png)、[窄屏预览](WORK04A-20261107-review-evidence/v2-preview-390.png)、[桌面结果](WORK04A-20261107-review-evidence/v2-result-1440.png)、[窄屏结果](WORK04A-20261107-review-evidence/v2-result-390.png)。截图已目检。完整合成请求及本机运行记录保留在忽略目录 `node_modules/.cache/work04a-review/run-wim1Og`。正式资料、用户配置和用户服务未使用；阻断了并行 NEWS01 的浏览器采集请求。验收关闭自有 Chrome、fake、Vite 和 API。

开工提交 `0daba4b8e445be6fd37765cc80e82c6dcdec5cf8`；独验签收时 HEAD `d0a35cb9041f3d17265fbebef566ec7dfa69e78d` 仅纳入同期 NEWS01 两个提交。WORK04 A 产品当时为未提交工作树，主线程统一记录最终交付提交。以下 7 个受验文件在独验前后相同，且与施工交接一致：

| 文件 | SHA-256 |
|---|---|
| `services/work-items/analysis-runs.ts` | `C282C0C5620DC91BF962C44E79BAE8E27738837A4845DE0E06B43582B17AA0B4` |
| `services/work-items/basis-review.ts` | `94E50278149C44DBC04FC149DEC16126B6940AC8D746CB0F08FDF06642A673BB` |
| `services/work-items/types.ts` | `18E9C9658FC071A1A151EB89D25C742C4DA190F1C3CE3CCBE13FE484E3BE596E` |
| `server/work-items-api.ts` | `9830C962CA5456DF35A981473A2FD72D95EFA8354D9B22C35EBC33571E5E9C84` |
| `app/api.ts` | `70DABEF5D22B0EA6C5ABEF2A605CB315B05096BE78B00DADBC864B4523C0C1B0` |
| `app/pages/WorkAnalysisPanel.tsx` | `23302AD71B660CE4F314BC0F144629EC3C0B626B6ED792CF62FB05FA58DB79AD` |
| `app/styles.css` | `23C744F7DBA568F19B928FE1E6F43EA5BD00D9B7DBF0D7AAC26BEC062E3B5EC2` |

后续仅在用户明确同意目标轮次可重复发送并指定真实模型调用预算后，验证真实依据判断；合成结果不作为真实语义质量证据。B 与 WORK05 保持延期。

主线程交付产品提交：be41f5a。提交包括上述受验产品、冻结卡及验收证据，未纳入其他未提交工作或本地业务资料。
