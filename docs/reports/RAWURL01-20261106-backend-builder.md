# RAWURL01 后端施工交接（2026-11-06）

Sol High `/root/kb03_r1_builder`，B 模式。开工基线为 RAWUX01 通过版本及现有未提交工作树，HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b`。八个施工文件及六个开工 SHA 见 `RAWURL01-20261106-backend-fingerprints.json`。

原 `POST /api/raw/import` 同时支持现有 multipart 和 JSON `{metadata,body?}`。文件、非空粘贴正文、仅 URL 顺次决策。文件及正文支路的 URL 只是来源元数据，前两支零网页请求。原件按旧链保留，解析失败不回退，部分关联提交报告与恢复沿用既有合同。纯文本按实际收到的字符串入库。URL 只保存 Raw，成功时保留原链接、实际最终链接、抓取时间、解析器和正文 SHA。没有上传文件时不返回 `asset`。正文存储及后续 AI 整理仍是两次独立操作。普通粘贴 `POST /api/raw` 保持原合同，无法写入伪造抓取追溯字段。

仅 URL 时使用 Node 原生 HTTP(S)，默认端口 80/443，每跳解析并拒绝任一非公开地址，再以验证过的 IP 连接。重定向最多四跳，网络总体 12 秒，响应流 2 MiB，正文 500,000 字符。拒绝凭据 URL、内网地址、超时、异常状态、206 部分正文、非文本和不可靠编码。静态 HTML 用既有 jsdom 29.1.1 静态 DOM 解析，优先实际文章容器，脚本和子资源不加载，去除常见导航、表单和脚本内容。登录表单壳、验证或空 JS 壳提示改用文件或粘贴，失败路径不写 Raw。jsdom 仅由开发依赖改为运行依赖，锁定包数 418 和版本均保持，npm 生成的无关 peer 旗标修改已收回。

现 Node 代理启动可用。HTTPS CONNECT 绑定已验证 IP，TLS SNI 与 Host 使用原域名。HTTP forward proxy 的 absolute request target 同样为已验证 IP，Host 仍为原域名。部分 HTTP 代理按绝对 URI 重写 Host，依赖域名虚拟主机的站点可能需使用 HTTPS 地址、文件或粘贴。无需代理时直接连接验证过的 IP。没有远端登录 Cookie，不随请求发送网站凭据。Node 24.18 本地 mock 代理子进程记录了实际 absolute target、CONNECT IP 与 ClientHello SNI；代理未接触任何真实目标。

```powershell
node --import tsx --test tests/rawurl01-http.test.ts tests/import.test.ts
npx tsc -b
npm test
```

最终定向 24/24，0 失败、跳过、取消、todo，其中新五组与旧导入十九项。实际 localhost fixture 用真实 HTTP 302 到另一公开模拟域，验证原始/最终链接、解析实体、段落及正文 SHA，纯文本逐字符不改，子资源零请求。文件+正文+内网 URL 只写文件，正文+URL 零网页请求，伪 PDF 仍 415 且只保留原件。超时含迟到 DNS 零请求，拒绝混合 DNS、同主机跳转后变内网、IPv6 回环、环/超跳/超限/登录及空脚本页，失败无 Raw。首次定向 22/23，唯一失败是新 fixture 将原来 415 写作 422，按现行拒绝状态校准。

原始日志 `C:\Users\David.chen\AppData\Local\Temp\rawurl01-backend-6abf4d9e-8756-4ccb-8d32-16a6234cd7a2`。后端施工仅 TEMP 数据、本地 HTTP 和 fake DNS/代理。真实模型 0，真实模型配置读取 0，正式 workspace 读写 0。独立验收的唯一授权 IANA HTTPS smoke 另见独立证据，发生在最终选择文章容器优先及 206 拒绝的解析收尾之前，同 HTTPS 传输和 DNS pin 路径。施工未重试公网。UI 与构建由独立 UI 施工交接。

全量 `npm test` exit 0，754/754，0 失败/跳过/取消/todo，74.206 秒，`npm-test.txt`。此轮绑定最终前一版。最终仅调整 multipart 单字段字节边界并补同一路由测试，Busboy 达到阈值即标为截断，故以 `3 * MAX_BODY_CHARS + 1` 接收恰好 500,000 个三字节中文字符，原正文字符限制不变。最终版实际长中文 multipart 原样入库、零 URL 请求，相关定向 `targeted-final.txt` 24/24，`tsc-final.txt` 全 tsc exit 0。其余全量证据按相同文件复用。抓取、UI、浏览器流程均未受此变更影响。后端代码、测试与报告已停写。
