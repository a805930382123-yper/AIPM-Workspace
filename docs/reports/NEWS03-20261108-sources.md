# NEWS03 官方来源实测

实测时间：2026-11-08 13:52–13:55（上海时间）；Node v25.2.1。仅访问公开页面与 PDF，未登录、未使用正式数据或服务。以下是本机 Node fetch 的结果，不是网页搜索结果，也不保证未来可达。

## Worldpanel by Numerator

- 发现入口：<https://worldpanelbynumerator.com/language/chinese-simplified>，HTTP 200；列表包含文章标题、日期及指向 `/insights/` 的链接，可持续发现新文章。
- <https://worldpanelbynumerator.com/insights/china-fmcg-retail-market-q3-2026>，HTTP 200；列表发布日期 November 3, 2026。中文 HTML 有实质分析，涉及 2026 年前三季度城镇快消、品类、线上线下渠道及自有品牌，例如销售额同比 0.1%、线上渠道 8.9%。正文数据时期与发布日期分别记录。
- <https://worldpanelbynumerator.com/insights/china-shopper-report-2026-vol-1-cn>，HTTP 200；列表日期 June 23, 2026，文中联合报告发布为 6 月 16 日；正文有 2025 年及 2026 年一季度快消数据与渠道分析。HTML 可直接读，无需登录；报告下载链接指向微信页面，未测试下载。

## NIQ

- 发现入口：<https://nielseniq.cn/global/zh/insights/consumer-packaged-goods/>，HTTP 200；列表卡片含标题、日期和文章链接，但也混有非快消相关项目，需筛选。
- 饮料报告由列表实际卡片链接至 <https://nielseniq.cn/global/zh/insights/analysis/2026/beverage-innovation-trends-and-growth-implications/>，HTTP 200，卡片日期 October 11, 2026。页面本身无实质分析，不能将短简介充作报告。
- 该页“获取报告”实际指向 <https://nielseniq.cn/wp-content/uploads/sites/9/2026/10/Beverage-Innovation-Trends-and-Growth-Implications.pdf>；Node HTTP 200、4,063,047 字节、14 页，无登录。现有 `pdfjs-dist` 实测前 8 页可抽取中文正文，题为《重塑增长动能 饮料创新趋势与增长启示》，包含 2017–2025、2026 上半年及截至 2026 年 7 月的数据。PDF 字体和图表布局导致抽取文本有断词、空格及部分图表信息可能不完整，须作为来源摘录而非完整报告。
- 月报样本 <https://nielseniq.cn/global/zh/insights/analysis/2026/niq-retail-market-monthly-report-august/> 的 HTML 仅下载提示，不能视为正文；并非所有列表项均保证有直接可读 PDF。报告可能要求扫码或注册，未绕过门槛。

## 其他候选及范围

- KPMG 消费与零售列表及便利店报告 HTML 均 HTTP 200；HTML 样本仅简短介绍。公开便利店 PDF HTTP 200，响应 `content-length` 3,830,890，42 页；现有 pdfjs 前 6 页可抽中文。首轮验证脚本最后误用 `doc.destroy()` 而退出非零，页数及正文已在错误前实际输出；销毁应使用 loading task 的 `destroy()`。本批不接入。
- Bain 英文中国购物者报告 HTML HTTP 200，含大量分析及 `article:published_time`；`bain.cn` TLS 连接失败。消费品行业列表可读但样本未发现该中国报告。本批不接入。

## 实际操作

使用 PowerShell 管道 `@'…'@ | node --input-type=module`，Node 内以 `fetch(url, { signal: AbortSignal.timeout(15000 或 20000) })` 获取公开资源，用现有 `jsdom` 读取链接及 HTML 文本；PDF 用 `pdfjs-dist/legacy/build/pdf.mjs` 的 `getDocument({data: Uint8Array, useSystemFonts: true})` 和逐页 `getTextContent()`。NIQ 验证脚本正常退出，PDF 大小在交给 pdfjs 之前记录（该库会转移数组所有权）。未安装依赖、未使用付费模型，未启动产品或触碰正式配置及数据。网络结果为一次采样，并非持续可用承诺。
