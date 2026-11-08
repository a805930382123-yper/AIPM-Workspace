# NEWS02 施工交接

施工基线 HEAD `643e9f2b0b6565a80b141a35593fb35d13628189`；任务卡 `9809C91495846445DDEB7844C1DF6A7888314F7440EE5F1753206B67DD24C058`。施工者按卡实现后停写，不提交；独立验收尚未执行。

资讯采用确定性筛选、窗口/实用性/日期排序和规范 URL、完整标题去重。主动保存从期刊读取摘录，以固定 Raw ID 与独立 pending/linked 收据实现同 URL 幂等；正文严格为摘录，来源名称、标签和提取说明标明材料等级；分析未进入 Raw。页面显示保存状态并手动进入 Raw。旧审核、Wiki、Provider 未修改。

## 自查

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news02.test.ts tests/news01.test.ts tests/news01-ui.test.tsx`：9/9 通过。专项覆盖固定例、HTTP拒绝、并发/重启同ID、原文、删除、pending缺失及损坏；未覆盖全部验收矩阵。
- `npx tsc -b --pretty false`：被七份历史二进制损坏测试阻断；将 app/server/services/tests/scripts 复制到 `node_modules/.cache/news02-tsc`，仅在副本用 `git show HEAD:<path>` 替换七份后，`npx tsc -p node_modules/.cache/news02-tsc/tsconfig.json --pretty false` 通过。原件未动。
- `node --import tsx node_modules/.cache/news02-build.mts`：配置空 envDir，Vite 231 模块构建通过，既有大包提示。
- `impeccable.cmd detect`：退出 0，无输出。真实宽窄屏与原审核全链交独验；施工未作浏览器判定。
- 本机 Node `readNewsSources` 于 2026-11-08 12:43 上海时间只读一次：商务部、中国经济网均 ok，返回 10/26 批零和 11/06 可口可乐、咖啡；AIHOT 合法 empty。本次是来源适配器结果，不是窗口筛选后的最终期刊数量；当日不足不补齐。无 Provider 真实调用、无正式数据或用户服务验证。

## 最终文件 SHA-256

```text
9AEC842F9B1368C0E0C9524F86E8F6EEB2D02C7D5D38F61CC4A4CD0B13CFCA92 services/news/sources.ts
472FF94F8FE442CB76090EF8FEE60C40C160450E0D3183144B10B35CCD403B80 services/news/service.ts
B4DDD24A484C417F3AAC9C72CE41261443B9332ADDD656CE267098938D24C414 services/news/raw-save.ts
DAB3137EFB57B1B43A22F009451484997A151EF4F3F0135455DD398D5422DEB0 services/raw/store.ts
2ED8E8F099162B9CE12D11C0AF96FB8F8C905CC876E0AB28915478765D1901D9 server/news-api.ts
2ECA18FB00464C55429BA444541316CB010EC469D56C3C1A4E0833CEF31A5DF1 server/index.ts
089178109145E3B7EE0C7E753F95D34D77DD31C090C6295621A198C51FE59F27 app/pages/NewsPage.tsx
EC0C32D30247B22685EDF753F94045518A8B0004DB0B9ED9C36AFBEB68731124 app/App.tsx
E20FEFE3D97C76DAC14443937DCE3152B43542DBCC49EA986D54BA0E0961E242 app/news.css
F399F2B2AB8FE1FB75DB770D8A8FC9AB5DF9A975ED46EF5D6763FB191C59E751 tests/news02.test.ts
```

真实浏览器、全故障注入、备份往返及原审核链为独验待测；以上自查不等于 NEWS02 整体验收通过。真实模型质量 NOT_RUN。施工停写，待独验。

## 独验返修交接

针对 FNEWS02-01，资本类资讯须同时有明确产品变化信号，纯融资发布及大模型公司发布融资消息不入选，真正推出智能体功能兼融资保留。针对 FNEWS02-02，StrictMode 重复执行 effect 时恢复存活标记，保存成功正常解除忙态并显示查看 Raw。保存状态读取失败增加重读按钮，成功后清除错误；保留按日期隔离响应。

最终运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01-sources.test.ts tests/news02.test.ts tests/news02-ui.test.tsx`：5/5 通过，其中既有未跟踪的 news01-sources 测试未改；新增 StrictMode UI 测试覆盖保存、查看和读取失败重试。隔离副本 `npx tsc -p node_modules/.cache/news02-tsc/tsconfig.json --pretty false` 通过；空 envDir Vite 构建 231 模块通过；`impeccable.cmd detect` 无输出、退出 0。真实浏览器复验及批次结论由独验负责，未用真实模型。

新增文件 SHA-256：`6F9C92030B71F20D2C37E65DDF2273E1F09622951D208EE92E42AF01FB1E9F8B tests/news02-ui.test.tsx`。上表已更新返修文件 SHA，其余文件不变。施工再次停写。

## FNEWS02-03 返修交接

保存 POST 成功后无论资讯页是否仍挂载均刷新共享 Raw/统计；局部状态仍仅在挂载时更新，不主动导航。规范 URL 等前序键相同时，按任务卡依次比较 sourceId、itemId、原 URL、完整标题和 excerpt。

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/news02.test.ts tests/news02-ui.test.tsx`：6/6 通过；包括挂起 POST 后离页、完成后调用共享刷新且不导航，以及反转来源顺序稳定选相同候选。隔离副本 tsc 和空 envDir 231 模块构建通过，`impeccable.cmd detect` 退出 0 无输出。表中与上次新增 UI 测试指纹已更新。真实浏览器复验由独验执行；施工再次停写。

独验补充的快消排序反例已处理：新增/更新加入明确变化信号；NEWS02 定向测试更新为 7/7，含超市新增/更新饮料补货规则优先于普通零售条目。隔离 tsc 通过。最终指纹见上表。施工停写。
