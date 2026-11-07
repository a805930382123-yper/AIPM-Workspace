# NEWS01 本机公开来源验证（2026-11-07）

本记录仅为施工前来源探测，不是批次验收。使用 Node v25.2.1 实际网络，未使用真实模型、正式 workspace、用户配置或用户服务。沙箱内候选域名 DNS 为 ENOTFOUND；经批准只读公共 GET 在沙箱外执行。Windows 手动代理未启用，进程无代理环境变量；未修改系统代理。

| 来源 | 本机实际结果 | 字段及限制 |
|---|---|---|
| AIHOT selected 24h | `https://aihot.news/api/v1/items?mode=selected&window=24h&limit=20` HTTP 200，application/json；本次 15 条 | `id`, `title`, `summary`, `source.name`, `links.original`, `links.aihot`, `publishedAt`, `discoveredAt`, `category`；样例 2026-11-06。类别为 tip、ai-products、industry、paper、ai-models，不能当快消来源。摘要为来源提供的内容，不是本产品分析。 |
| Foodaily 快讯、文章 | `https://www.foodaily.com/newsflashes`、`https://www.foodaily.com/articles` HTTPS ECONNRESET；HTTP socket 失败 | 未取得列表或正文，不得标记成功。 |
| CCFA | `https://www.ccfa.org.cn/portal/cn/index.jsp` 及 `https://www.ccfa.org.cn/portal/cn/xiehui_list.jsp?pn=2&type=2` HTTPS ECONNRESET；HTTP socket 失败 | 未从首页验证导航或正文，不得接为已验证来源。 |
| 联商网 | 首页 HTTPS ECONNRESET / HTTP socket 失败；`http://www.linkshop.com/news/2026542831.shtml` socket 失败 | 未取得正文，不得标记成功。 |
| 中国经济网食品 | 首页实际链接 `http://www.ce.cn/cysc/sp/` HTTP 200，text/html；静态 HTML 可见文章标题、链接、摘要和日期 | 实际样例 [太古可口可乐中国战略](http://www.ce.cn/cysc/sp/info/202611/t20261106_3286365.shtml) HTTP 200，静态文章日期 2026-11-06 18:13，正文可读。属于替代食品品牌来源。 |
| 商务部渠道/零售 | `https://www.mofcom.gov.cn/` HTTP 200，text/html；首页静态“司局负责人发布”有相关链接 | [批发和零售业发展情况](https://www.mofcom.gov.cn/xwfb/sjfzrfb/art/2026/art_a848a93150ab4eb0a09a2bdd9b9999c2.html) HTTP 200，2026-10-26 11:50，`.art-con` 静态正文可读。对应列表 `https://www.mofcom.gov.cn/xwfb/sjfzrfb/index.html` 200 但文章列表由脚本生成，静态页面未取得列表。首页仅提供有限发现入口，样例不是当天新闻。 |

产品现有 `readPublicRawUrl` 实测对中国经济网样例与 AIHOT 第一条的 OpenClaw 原始链接都返回 `URL_FETCH_BLOCKED`：这台机器的 DNS 返回 198.18.1.x 透明网络地址，现有提取器将 198.18/15 作为非公网地址拒绝；普通 Node fetch 在同一网络却可读取部分站点。不得放宽通用 URL 安全检查来绕开此限制。若产品需要本环境可用，固定可信来源域名的专用读取路径及限制跳转范围是可评审的窄方案；网络失败仍需真实记录。不能把固定来源读取扩展成任意 URL 抓取，也不能据此声称全部来源可用。

探测命令：`node -e` 使用内置 `fetch`、12–15 秒超时与 `jsdom` 解析上述公开地址；`node --import tsx -e` 调用现有 `readPublicRawUrl`；`node:dns/promises.lookup(host,{all:true})` 检查返回地址。HTTP 状态、内容类型、样例日期、文章内容和提取器结果均为本机实测；未保存第三方长篇正文。

## 固定适配器复测（2026-11-07 12:53–12:56，上海）

执行 `node --import tsx -e` 调用 `readNewsSources`（沙箱外只读公共网络），中国经济网食品、商务部、AIHOT 均返回 `ok`。中国经济网解析 8 篇详情，包括 11-06 18:13 太古可口可乐；商务部解析 10-26 11:50 零售详情；AIHOT 返回 10 个摘要，原文未抓取。随后 `node --import tsx node_modules/.cache/news01-check/real.mts` 在隔离目录实际 ensure：2026-11-07 快消 5 条、AI 3 条均为 `source_only`，商务部旧样例按 72 小时窗口排除；providerFactory 计数 0。现有备份导出并恢复该目录后，新闻 JSON 字节一致。以上只证明该次运行，不保证未来来源继续可用或每天渠道有新条目。
