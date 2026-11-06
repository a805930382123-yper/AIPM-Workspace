# RAWURL01 独立验收

本轮导入缺陷及范围内返修PASS；RAWURL01工程整体PASS。Astra规划/独验，Sol后端kb03_r1_builder及UI lw03_ui施工；B评分0/2/2/1=5。HEAD275067c7d120b15051dedc3981b49c64a05c3f9b加未提交工作树，最终后端8+UI7文件SHA独立核15/15一致，无提交推送。

## 实际行为

文件不再必填。服务端与UI按文件>非空正文>仅URL，文件存在即不读网页；文件失败不回退。正文保持原样。仅URL真实获取HTTP(S)静态HTML/纯文本→解析→Raw，原URL、最终URL、抓取时间及正文SHA可追溯，没有伪造asset，也没有自动模型请求。标题/来源可从页面/host回退。原文件原件保留/解析失败/部分提交路径仍在。

Node原生请求固定已校验公网IP，逐跳核协议/DNS；4跳、12秒、2MiB响应、500000字符正文限制。已有代理启动复用native globalAgent，HTTPS固定IP CONNECT并保留原SNI，HTTP代理absolute IP目的地。jsdom关闭脚本/子资源执行，静态正文解析不构成登录或浏览器爬虫。不可读登录/JS-only/部分响应/不支持内容明确失败并保留输入，提示上传或粘贴。HTTP代理若重写Host导致虚拟主机不可读须用HTTPS/上传/粘贴，不声称所有站点支持。

## 独立工程与浏览器

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawurl01-http.test.ts tests/rawurl01-ui.test.tsx`：8/8、7850.7705ms。最终multipart边界修复后再次独立`node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawurl01-http.test.ts`：5/5、3305.3626ms。涵盖实际本地HTTP跳转正文落盘、file/paste零抓取、native代理子进程HTTP/CONNECT、保留地址/混合DNS/重定向DNS变化、循环/超跳/超时/体积/不可读内容，以及空标题来源URL、失败输入保留、跨tab文件优先。5组中包含500000中文multipart真实边界断言。

独立fresh完整App：`node --import tsx scripts/rawurl01-isolated.ts`，TEMP rawurl01-ui-3Rsnro、PID35512/API50585；configFile:false/空envDir，227模块build通过。`node tests/acceptance/rawurl01-independent-browser.mjs <root>/isolated-session.json` exit0；驱动复用施工操作脚本但独立fresh根与review证据，不冒称独立重造驱动。

实际Chrome8图：URL-only读取/两跳/原文来源读回、JS-only422保输入、粘贴原样、file+坏URL跨tab可见且0fetch、无效文件编码原件保留无URL回退、空输入提示。review-browser.json success=true，pageErrors/externalBrowserRequests/extractions均空，服务fixture请求仅/entry、/article、/script-only，Provider0。已亲看独立来源读回与文件跨tab图、施工失败图，文案显示静态网页正文而非内部parser标识。

- [网页读回与来源](RAWURL01-20261106-evidence/review-url-saved-source.png)
- [文件跨tab优先](RAWURL01-20261106-evidence/review-file-priority-across-tabs.png)
- [不可读保留输入](RAWURL01-20261106-evidence/review-url-failure-keeps-input.png)
- [完整浏览器证据](RAWURL01-20261106-evidence/review-browser.json)

## 一次真实公网验证

主审明确授权的一次非模型公网请求：经现`scripts/start_with_proxy.ps1 --import tsx --input-type=module -e ...`调用readPublicRawUrl，目标https://www.iana.org/help/example-domains。成功10704ms、标题Example Domains、url_html_text、781字符，正文SHA256 `03f2acda918992f221124c73883dcb91b7cd8a13729e114237320d7d0ce138c9`。只内存解析，不存正式库，无模型/密钥读取/重试。

smoke后仅article优先/登录壳/206拒绝及HTTP直连处理有微调，HTTPS transport/DNS/代理路径未变；公网成功证据用于同获取链，不虚称最终解析每条分支再次公网测试。最终解析变化以本地真实HTTP用例覆盖，没有重复外网请求。

## 最终版本复用与保护

施工默认`npm test`754/754，0失败/skip/cancel/todo，74.206s；完整tsc exit0。其后唯一产品差异为Multer multipart fieldSize改成3*MAX_BODY_CHARS+1，解决合法500000中文约1.5MiB被默认1MiB拦截以及Busboy恰好等于limit判截断；字符上限保留。最后相关24/24、tsc0，独立最终5/5补测；全默认和UI/build未受影响项复用，不声称最后SHA全量重新执行。原日志TEMP/rawurl01-backend-6abf4d9e-8756-4ccb-8d32-16a6234cd7a2/npm-test.txt、targeted-final.txt、tsc-final.txt。

jsdom从dev移动runtime同版本，lock418包版本0变化；未新增解析框架。1096基线11份既存文件变化（含本轮spec注记）全在所有权，旧RAWUX01与外部AGENTS未覆盖；最终15SHA对应两施工指纹。product-spec明确用户新单条公开链接授权与旧自动公众号/通用爬虫禁令区别。

独立服务35512已关闭并核不存在，UI自有16488及后端测试服务按交接关闭，Chromefinally关闭。模型调用0、配置/密钥读取0、正式workspace读写0，历史真实模型账本不变。仅一次已授权公开网页访问与TEMP合成网络，不以此声称模型质量。全部停写，不提交推送。
