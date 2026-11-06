# RAWZH01 独立验收

本轮默认中文阅读实现及范围内返修PASS；RAWZH01工程整体验收PASS。Astra规划/独验、原Sol High后端kb03_r1_builder与UI lw03_ui施工，B评分0/2/2/0=4（重大来源完整性直接B）。复用近期同实例交付能力，未冒称切换模型。HEAD275067c7d120b15051dedc3981b49c64a05c3f9b加未提交工作树，最终后端6+UI7指纹独立核13/13一致；无提交推送。

## 交付行为

URL-only导入默认勾选“翻译成中文（会调用已配置模型）”，用户提交后先保存原文，再启动独立译文；取消勾选、主要中文内容、文件/粘贴优先分支、未传字段的旧调用均不自动翻译。完成默认阅读整篇中文，段落保留，可切原文；失败/未配置保留已保存Raw，单独重试同Raw不重新抓取。翻译只是state/raw-translations关联阅读层，原Raw正文/字节/SHA/来源保持不变，未生成新Raw/Wiki。

后续知识整理仍读原文；从真实草稿证据点击即切英文原文并精确offset高亮。无逐段审核、内部细节只保留单一进度。Meeting外发、原SHA、Provider/提示身份、secret输入输出保护仍在。长文分段无自动无限重试，取消迟到结果不覆盖；刷新和重启不发模型请求，用户显式继续可复用已完成段。不承诺外部调用exactly-once，中断未保存段允许明确重发并累计计数。

独验静态发现纯英文无常用词句子`Retailers reported strong revenue growth.`误判skipped，交后端最小修复纯Latin自然句识别；标题+该句实际HTTP已送译，中文品牌/围栏代码仍0。未发展语言平台；主要中文带少量英文不自动翻译是当前轻量规则。

## 独立实测与同版复用

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawzh01-http.test.ts tests/rawzh01-ui.test.tsx`：9/9，0失败/skip/cancel，5599.602ms。覆盖自动导入、原文件不变、GET及完成retry去重、中文/取消框/file/paste零工厂、混合保中文、未配置/失败同Raw重试、多段取消及迟到、真实fresh子进程中断后读取0请求及第一段复用、源/模型/提示变化、Meeting/secret/坏JSON/空译、状态写失败仍保原Raw、UI启动失败回包及错SHA不显示。

fresh隔离完整App：`node --import tsx scripts/rawzh01-isolated.ts`，TEMP rawzh01-ui-2mOJmH、PID6652/API52739，空envDir/configFile:false build227模块通过。`node tests/acceptance/rawzh01-independent-browser.mjs <root>/isolated-session.json` exit0，复用施工真实浏览器驱动操作、使用独立fresh根和review截图，不冒称另造框架。

实际Chrome10图：默认框/进度/中文默认/英文切换/刷新GET、取消框英文/中文跳过、失败保原文/同ID重试、取消、file/paste不翻译、显式整理后真实证据定位英文。review-browser.json success=true，pageErrors/outside为空，realProviderCalls=0/configuration=not-connected。已亲看独立默认框、中文完整阅读和英文原句高亮；可读、无逐段审批。假模型验证契约与工程，不冒称真实翻译质量。

- [默认勾选](RAWZH01-20261106-evidence/review-url-default-checked.png)
- [中文阅读](RAWZH01-20261106-evidence/review-chinese-default-reading.png)
- [原文证据定位](RAWZH01-20261106-evidence/review-evidence-forces-english-offset.png)
- [完整浏览器证据](RAWZH01-20261106-evidence/review-browser.json)

最终冻结版`npm test`763/763，0fail/skip/cancel/todo，73912.5024ms；完整`npx tsc -b`exit0。独立读原日志TEMP/rawzh01-backend-e0c4ad6a-a25b-47c9-842b-a99ca18b3011/npm-test.txt并核同最终SHA，按同版复用全量，不称独立重跑763项。相关组合95/95、UI21/21及独立9项相互补充，无已知未关闭本批缺陷。

## 保护与收口

1161基线仅6份既存文件变化，均属所有权；新增后端翻译/路由/测试与UI脚本由最终13文件清单绑定，AGENTS及前批成果保留。依赖未改。独立6652已Ctrl-C关闭并核不存在，UI5104及测试子进程按交接关闭；只关闭本批自有隔离服务，用户实际proxy工作台未触碰。

本轮真实模型/公网调用0、配置读取修改0、正式workspace读写0，历史模型账本不变。已实现用户日常导入的真实Provider接线，运行时由已勾选提交授权触发；开发未调用付费模型，也不追加质量验收请求。全部停写，无提交推送。
