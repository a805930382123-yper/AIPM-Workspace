# NEWS09-FIX 来源连通诊断

PwC 两次取得完整 PDF，耗时 **3.335 秒和 6.932 秒**。保留当前生产 12 秒预算，完成一次产品动态目录、报告页、PDF 正文链验证后再启用。CCFA 的两个官方域名均在严格 TLS 校验中报证书过期，接入仍受站方证书更新阻塞。

2026-11-12，Sol High news07_review 独立诊断。产品基线 `d677b6d5740be198997f363ffb3dbd59306e4c5c`。本次修改为诊断脚本和报告，正式 workspace 与产品模型未使用。[前次验收](NEWS09-20261112-review.md) · [诊断后冻结任务卡](../handoffs/NEWS09-FIX-20261112-task.md)

## PwC

| 设置 | HTTP | 响应头 | 首正文 | 完整结束 | 大小 |
|---|---|---:|---:|---:|---:|
| 诊断 60 秒总上限 | 200 | 890ms | 898ms | 3335ms | 2,400,087 字节 |
| 原生产 12 秒总上限 | 200 | 1644ms | 1659ms | 6932ms | 2,400,087 字节 |

两次均为直接 Node HTTPS 流式读取，10 MiB 上限，响应为 `application/pdf`，有声明长度和最终 PDF 结束标记。进度落本地 JSONL，异常分支同样即时落账本。两次 SHA256 均为 `60D413237288AAB359F00A93453FDB1750B3E1A2847DF09A9C2DD03B3C8F91A0`。对照前次 HTTP 200 后 12,015ms 正文超时，本次证实同一链路有耗时波动。原因细分到服务端、CDN 或传输网络仍缺证据，现有结果不足以支持延长超时或增加自动重试。[PwC 官方 PDF](https://www.pwccn.com/zh/retail-and-consumer/voice-of-consumers-china-report-dec2025.pdf)

首条真实 PDF 与前轮实际目录和报告页快照经当前适配器离线回放，目录动态命中官方报告页，报告页链接指向本次 PDF。40 个物理页中选出第 6 页，395 字符正文与该页提取文本逐字相符。该页讨论中国消费者购买健康食品和可持续食品的意愿，并比较中国内地与全球受访者的食品选择因素。适配器保留官方发布日期精度 `2025-12`，独立数据期留空。回放外发 0，完整动态链的当轮产品联机证据仍待后续施工。回放还遇到一个目录内 2024 年旧报告候选，未发送该详情请求。[PwC 消费市场目录](https://www.pwccn.com/zh/industries/retail-and-consumer.html) · [官方报告页](https://www.pwccn.com/zh/industries/retail-and-consumer/publications/voice-of-consumers-china-report-dec2025.html)

## CCFA

| 检查 | 观测 |
|---|---|
| Node 严格 TLS，`www.ccfa.org.cn` | `CERT_HAS_EXPIRED`，221ms |
| OpenSSL 读取同域公开证书链并校验主机名 | 校验码 10，372ms。叶证书 `CN=www.ccfa.org.cn`，签发者 DigiCert Encryption Everywhere DV TLS CA - G2。有效期 2026-05-13 00:00:00 至 2026-08-10 23:59:59 UTC。SAN 含 `www.ccfa.org.cn` 和 `ccfa.org.cn` |
| Node 严格 TLS，证书 SAN 中的 `ccfa.org.cn` | `CERT_HAS_EXPIRED`，335ms |

叶证书 SHA256 指纹 `CD:2A:C0:8D:0E:53:9D:D5:C1:8B:1E:A6:56:BC:E7:E8:48:D0:0D:4F:4B:08:F4:E0:BC:B5:48:F0:6B:B5:33:94`。OpenSSL 诊断只交换 TLS 证书，校验结果记录为失败。三个检查均无 HTTP 正文。Windows 时区为中国标准时间，系统 UTC 与宿主时钟以及 PwC 的 HTTP Date 在秒级吻合，证书已过期约三个月。Node 的代理和自定义 CA 环境项均未配置，WinHTTP 报直接访问。WinINET 代理开关开启，PAC 未设置，Node 与 OpenSSL 实际路径均观测到同一证书过期结论。没有可用官方替代入口证据。[CCFA 官网](https://www.ccfa.org.cn/portal/cn/index.jsp)

## 实际命令与账本

| 命令 | 本地证据目录，位于 `node_modules/.cache/news09-fix-diagnosis` |
|---|---|
| `node tests/acceptance/news09-fix-diagnosis.mjs pwc` | `pwc-YqxdtU`，完整 PDF 和 `events.jsonl` |
| `node tests/acceptance/news09-fix-diagnosis.mjs pwc --product-timeout` | `pwc-8dlmlu`，完整 PDF 和 `events.jsonl` |
| `node --import tsx tests/acceptance/news09-fix-diagnosis.mjs pwc-replay node_modules/.cache/news09-fix-diagnosis/pwc-YqxdtU/report.pdf` | `pwc-replay-ViAwKm`，正文定位和摘录 SHA256 `C8EBE3FE9F83B1EF6DDA68870637AFF79632B8F10561337A296493499FBD1F51` |
| `node tests/acceptance/news09-fix-diagnosis.mjs ccfa-strict` | `ccfa-strict-Dy5heO` |
| `node tests/acceptance/news09-fix-diagnosis.mjs ccfa-tls` | `ccfa-tls-YVs3R7` |
| `node tests/acceptance/news09-fix-diagnosis.mjs ccfa-strict ccfa.org.cn` | `ccfa-strict-BgIGIp` |

诊断共 2 个 PwC GET 和 3 个 CCFA TLS 握手。代码路径保留 HTTPS、允许路径、大小和响应类型限制。诊断脚本最终 SHA256 为 `DA71D6002FE767328A71D9E0BBE1790E99E743207ABF01AA5DB3E8F18CCEC71C`。真实 PDF 与网络账本保留在本地忽略目录。
