# NEWS09-FIX 独立验收

**PwC 真实正文阻塞已关闭，默认启用验收 PASS。NEWS09 冻结范围整体 PASS。CCFA 连通原因已查证，接入仍受站方过期证书阻塞。**

2026-11-12。评分 0/2/1/0＝3，A 标准。Astra Medium 规划，Terra High news07_build 施工，Sol High news07_review 诊断、预审与独立验收。受验基线 `d677b6d5740be198997f363ffb3dbd59306e4c5c`。[冻结卡](../handoffs/NEWS09-FIX-20261112-task.md) · [诊断](NEWS09-FIX-20261112-diagnosis.md) · [施工交接](NEWS09-FIX-20261112-builder.md)

## 同轮真实动态链

施工在生产限额下执行一次动态发现，开启 PwC 作为受控验收参数。独验核对原始账本及三份快照的字节数、SHA256、状态与耗时。

| 实际 PwC 请求 | HTTP | 响应头 | 完成 | 正文字节 |
|---|---:|---:|---:|---:|
| 消费市场目录 | 200 | 1337ms | 1785ms | 178,798 |
| 目录发现的报告详情 | 200 | 637ms | 770ms | 144,522 |
| 详情链接的公开 PDF | 200 | 238ms | 8228ms | 2,400,087 |

当前目录的官方卡片给出 2025 年 12 月，详情页链接到完整 PDF。独立 PDF.js 核验 40 个物理页，第 6 页的 395 字符摘录来自该页，含中国消费者的食品选择数据。期刊保留 `2025-12`，页面显示月份精度，数据期字段留空。真实链三次均有终态，无额外 PwC 请求，已超 365 日的目录候选在详情前排除。[PwC 官方目录](https://www.pwccn.com/zh/industries/retail-and-consumer.html) · [报告详情](https://www.pwccn.com/zh/industries/retail-and-consumer/publications/voice-of-consumers-china-report-dec2025.html) · [公开 PDF](https://www.pwccn.com/zh/retail-and-consumer/voice-of-consumers-china-report-dec2025.pdf)

最终交付将 PwC 切为默认启用。用上述同轮真实快照离线走 `readNewsSources` 和 `NewsService.ensure`，无显式启用参数，取得同标题、原文、月份及页码。重复 ensure 和新建服务实例均增加请求 0。同一期刊按原日期保存 Raw，复存同 ID，Raw 正文、`2025-12`、来源 PDF 及第 6 页保留，期刊字节一致。独验新增外发和模型调用 0。现有期刊按原记录读取，后续期刊生成可使用 PwC。

## 边界与剩余事项

独立回归 50/50。PDF 和 HTML 读取分别在约 12,063ms、12,002ms 取消，均无自动重试。10 MiB 上限、错误响应类型、跨站重定向拒绝、月精度过滤及多源限额通过。诊断两次直接读取分别用时 3335ms、6932ms，完整链 PDF 用时 8228ms。保留生产 12 秒预算及原限制。

CCFA 原首批只要求验证。本轮严格 TLS 实测 `www.ccfa.org.cn` 与 `ccfa.org.cn` 均报 `CERT_HAS_EXPIRED`，叶证书有效期截至 2026-08-10 UTC。三个诊断握手未发送 HTTP 正文，施工及独验未重试。站方更新证书后方能再核验公开目录和正文，当前接入 BLOCKED。[CCFA 官网](https://www.ccfa.org.cn/portal/cn/index.jsp)

统计局的真实目录、原文及独验结果沿用 NEWS09。NewsPage、选条与 Raw 链路文件指纹一致，复用 NEWS09 的 Edge 1440px 和 390px、原期刊与月精度展示证据。本次实测运行于隔离数据目录，正式数据未使用。其他来源没有在本批启用或验证。[NEWS09 原独验](NEWS09-20261112-review.md)

## 命令和指纹

| 实际命令 | 结果 |
|---|---|
| `node --import tsx tests/acceptance/news09-fix-live.mts` | 施工实采 3 次、全部 HTTP 200、完整 PDF。独验核对原始账本及快照 |
| `node --import tsx tests/acceptance/news09-fix-review.mjs` | 独立退出 0，实际 PDF 页核对和默认生产入口、同日缓存及 Raw 逐字 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news07-builder.test.ts tests/news08-builder.test.ts tests/news08-ui.test.tsx tests/news09-builder.test.ts tests/acceptance/news09-review-core.mjs tests/acceptance/news09-fix-bounds.test.ts` | 独立 50/50 |
| `node node_modules/typescript/bin/tsc -p node_modules/.cache/news09-review/browser-y4zOMT/tsconfig.json --pretty false` | 独立新闻范围退出 0。施工同版产品类型检查及 233 模块空 envDir 构建通过，详施工报告 |

账本和原响应保留在本地忽略目录 `node_modules/.cache/news09-fix-live-OxChUt`。`events.jsonl` SHA256 `607611B909D500B88CAEBCB3E8B5C9A3D518271FDC92530E09372DCE4FCC5F01`，`result.json` SHA256 `89A18FF4A07183DC5262ADF3FB9743594784BC54FE0E27783D3B41EFAE086084`。

| 文件 | 最终受验 SHA256 |
|---|---|
| services/news/additional-research.ts | 1A1EF81A03E8A43D518CF374646ABFDD0F833D6C663789A02A75206A026AC61A |
| services/news/research-sources.ts | 36F85C7F43C5D644B486BAEBE3C6C0FA531B677FFCE77711DB7DC097F40B9B26 |
| services/news/service.ts | CC3F0FAB789DF57ACA27685BF348E65E51BCB3A64E4DAE83BD41B817EA4051E0 |
| app/pages/NewsPage.tsx | 9E67FF390AEC0F0F3803B56994AD25B174C13E57482A2D1F80D52752EF8DCFBD |
| tests/acceptance/news09-fix-bounds.test.ts | D810F42A19E08587EF21295A2B8265D37C924C00342C58A2F5A48B7508857FB0 |
| tests/acceptance/news09-fix-review.mjs | 147AE3A03C19CAD824EC4CF478DDCD82BBCCA7303B8B03B4309ABAB0199DCBE6 |
