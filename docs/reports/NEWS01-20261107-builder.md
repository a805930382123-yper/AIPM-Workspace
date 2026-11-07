# NEWS01 施工交接（2026-11-07）

本轮施工完成并停写，等待独立验收；不以施工自查代替整批 PASS。产品基线 `1f9ca7798df269bab84868a18d3ef8b28e3e94a2`；源码未提交。施工实例 `/root/news01_builder`，按主 Agent 分配 Terra High；最终独立结论由 `/root/news01_review` 给出。真实模型质量及 5–8 分钟 AI 分析版阅读质量 NOT_RUN，真实付费模型请求 0。

实现 `state/news` 两栏按上海日期缓存、running 预写、同栏去重、失败手动重试、重启中断、独立合并、历史与失败旧期回退；固定 CE 食品、商务部首页零售动态和 AIHOT 来源，限制来源读取位置、跳转、体积与时限。默认来源摘录、AI 分析关闭；显式开关才可取得 Provider 快照。首页触发，新闻页展示真实日期、来源、摘要性质与未分析状态。快消 72 小时、AI 24 小时，历史七日同栏链接去重。正文摘录默认 280 字可展开；未变更通用 Raw URL 防护。

## 自查与边界

- `node --import tsx --test tests/news01.test.ts`：沙箱内回环被拒后，在提权隔离回环和 `node_modules/.cache/news01-check` 数据目录执行 4/4。覆盖并发 ensure 两来源各一次、双栏合并、默认 factory 0、七日重复和过期排除、fake 未知 ID 不得成功、失败重试与重启 running 不自动重发、Origin:null 在调用前拒绝、无效日期 400、坏 JSON 原样保留、空/无效/未知 ID/超额 fake 不为成功、超大 JSON 原样保留。该测试不替代独验，未覆盖全部故障、视觉或整体验收项。
- `npx tsc -p node_modules/.cache/news01-check/typecopy/tsconfig.json --pretty false`：完整类型检查通过。副本复制产品/测试源码并仅在副本中将七个本机既有受损测试恢复为 HEAD 内容；原测试未修改。初次直接 tsc 因七个历史受损文件失败，已明确区分。
- `node node_modules/.cache/news01-check/build.mjs`：空 envDir、隔离输出，提权运行，Vite 231 模块构建通过；有既有 chunk 大小提示。
- `node --import tsx node_modules/.cache/news01-check/real.mts`：只读公开来源、隔离目录、无 Provider。中国经济网、商务部、AIHOT 均读取成功；快消 5、AI 3 均 `source_only`，零售旧样例被排除，factory 0；实际备份和恢复后的新闻 JSON 字节一致。来源样例、网络限制见 [来源记录](NEWS01-20261107-sources.md)。
- 真实浏览器宽窄视口、独立真实 HTTP/故障矩阵、旧备份兼容及完整历史回归由独验执行；本施工自查未实测这些项目。未读取正式 workspace、配置密钥、使用用户服务或提交；隔离网络访问未调用模型。

## 待验文件 SHA-256

| 文件 | SHA-256 |
|---|---|
| services/news/types.ts | 1D7A4F7D28740D3B469B61FCB9AF1DFA5C2FCD7F75C60FEF07CFFA515F4613EA |
| services/news/sources.ts | ECE295A16F311A3C01EF29BC2C5D6C0F21F43974FFBE7670FE9698774247CA3A |
| services/news/service.ts | 531BACFE05A81DDFD533A07B830ADD09DCA712391DF38D66097EC518A4A5A771 |
| server/news-api.ts | A98DA517F86B27BA37D299E7F1BF661AF7960C966CF4C53999C60E74921B6FFB |
| server/index.ts | BD6FDF56BFE3EA9B913B6D9C71BF332A34613222611CF79BB21F8EBAF6A018E2 |
| app/App.tsx | FF10C0EB598DDB67B40B8AF47D702BAE05A2E6DD3A8542D178A3095F597BD69B |
| app/pages/HomePage.tsx | 6B628CD861164070456479F5302CB23DC5C0ECEBD315D5E9384E82D0357609A8 |
| app/pages/NewsPage.tsx | 13B6636B968B251453643CBBA351BA346E7DE802275D9ACD5D00796D7AD42253 |
| app/news.css | 79817F4199E628275B01EC846240748A3B50B7804A9C41EB54D812D128E19A2E |
| tests/news01.test.ts | 8F9B94C9566AEB2E3E62B2F824D0B30E39B074C30B4BE212950F714A2FE1444B |

## 独验返修 FNEWS-01～03

- 读取状态遇 503 后可点击“重新读取状态”；该操作只 GET，不重生成，读回 running 后继续轮询。首页恢复焦点/可见时 GET 服务端日期，只有与当前显示日期不同时执行 ensure；新闻历史页不触发该行为。
- fake 返回 `finishReason: length` 即使正文恰好是合法 JSON 也判失败，不写成 ready。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01-ui.test.tsx`：1/1，覆盖 503、点击恢复、轮询完成、同日 focus 无 ensure、跨日 focus 一次 ensure。
- `node --import tsx --test tests/news01.test.ts`：5/5，新增截断响应断言。`npx tsc -p node_modules/.cache/news01-check/tsconfig.json --pretty false` 通过；`node node_modules/.cache/news01-check/build.mjs` 空 envDir 隔离构建 231 模块通过。以上为施工自查，实际浏览器复验由独验者执行。
- 以下 SHA 替换上表对应旧版本：`app/pages/NewsPage.tsx` 76227D00DB9D3CD7515915CB31E4C692BE034040C8E9D2271E2D320E54ABB8CD；`services/news/service.ts` 9D05EBEAFC85291016786AC5B6F92F778E43DC0B4A41F0D8C648DDFE20AA4372；`tests/news01.test.ts` 6A9F8B9E5F7C153257B6DCFA1391EAD6EE9DF0DE826A3E9469A1ECA61E6CB1AF；新增 `tests/news01-ui.test.tsx` 274F87497CD994AC5BA711E88C858755DE0D1E8429771D4A97378D9ECC485CE1。其余文件 SHA 不变。已停写等待独验。

## 内容相关性窄修

固定来源适配器以标题和列表摘要筛选食品品牌、零售渠道/门店、AI 产品/模型/工具；剔除纯农业收购丰收、纯融资估值及芯片贸易政治，资本新闻仅在标题明确含产品变化时可保留。关键词为明确的启发式规则，可能漏掉无相关术语的新闻；不足如实显示。新增 `tests/news01-sources.test.ts`，覆盖品牌、咖啡、零售、图像模型、ChatGPT 表格分析正例及秋粮、公司财报、融资、芯片贸易反例；`node --import tsx --test tests/news01-sources.test.ts` 1/1，应用/服务 tsc 通过。独验反馈的 ChatGPT 工具误排已补充，并增加“发布融资消息”反例。

`node --import tsx node_modules/.cache/news01-check/real.mts` 于 2026-11-07 13:18 上海时间复读公开源：快消 2 条（太古可口可乐、咖啡），AI 2 条（图像生成编辑、Meta 模型上线），无秋粮、纯融资和芯片贸易条目；factory 0，隔离备份恢复一致。未修改用户状态；已保存当日旧记录不会强制重发。实际截图自查受阻：CUA 报 Browser is not available，独验者进行浏览器截图复验。

最终 `services/news/sources.ts` SHA-256 `91136F1CB66D750BC3D7B223E777E4880E1CED34C90340072B45AC0E82DBA29C`；新增 `tests/news01-sources.test.ts` SHA-256 `107AE4AB1BED009D8394188807DCD79103897BCC8E53EF696A62699C9C9B091D`。其余上轮文件不变；已停写。
