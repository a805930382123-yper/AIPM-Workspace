# RAWZH01 后端施工交接（2026-11-06）

Sol High `/root/kb03_r1_builder`，B 模式。开工基线为 RAWURL01 通过后的未提交工作树，HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b`。后端六个施工文件、两个既存基线 SHA 见 `RAWZH01-20261106-backend-fingerprints.json`。UI 与实际 Chrome 由 UI 施工交接，批次结论由 Astra 独立裁决。

URL 导入接受显式 `translateToChinese`。文件和粘贴正文仍优先，两个分支忽略翻译意图。URL 原 Raw 按既有路径保存后才登记翻译。未传/false、主要中文与围栏代码不调用模型，且不取得 Provider 配置。已保存 URL 原文和翻译响应分开，翻译启动失败仍返回 201 及原 Raw。重试复用原 Raw ID，不重抓网页，不重复导入。

GET `/api/raw/:id/translation` 只读，返回 `{translation:View|null}`。POST 同前缀 `/retry` 与 `/cancel` 分别显式继续或取消。View 含 Raw ID/SHA、queued/running/completed/failed/cancelled/skipped、进度、尝试次数、必要原因或安全错误。正文只在完整完成时提供。读取不写状态，不启动任务。相同 Raw 的在途调用通过现有 SerialQueue 及活动表去重。取消和继续保留已验证段，迟到旧响应无法覆盖后续状态。

`state/raw-translations/<rawId>.json` 记录 zh-CN、提示版本、原文 SHA、原文区间、翻译段和非敏感 Provider 身份摘要。英文标志词与无标志词的自然英文句合并判断，中文为主、短品牌名、网址及代码围栏不会触发。对实际英文段按原文次序、最多 8000 个 UTF-16 单元分段，沿用现有无重叠且避免截断代理对的分块方法。译文展示时按原文范围替换，未翻译的独立中文段、代码和空白从原文按原位置拼回。混合在单行的英文与中文交由同段翻译提示保留中文。该规则是轻量启发式，真实模型语言质量仍待授权实测。

实际请求前检查原文与权限并持久增加计数，每段一次发起。进程重启后，只读接口把未落盘的在途状态显示为中断，待用户手动继续。中断或取消后未保存的一段可重发并累计，已有段不重发。源 SHA、提示版本或已有部分译文的模型身份变化阻止复用。保护真实 Meeting origin 与已知服务端凭据，模型错误只写本机固定脱敏文案。坏 JSON、空内容、未翻译的英文及截断不会落成完整状态。Raw Markdown、正文 SHA、原链接和来源资产从未被翻译更新，现 Wiki 处理和证据读取仍使用原 Raw。

实际后端组合 95/95，涵盖 RAWURL、RAWUX、KB03、Meeting 原有流程。之后按独验建议补无标志词的常见短英文正文和标题，以及中文品牌加英文代码零 Provider。最新翻译 HTTP 7/7，包含上述行为、未配置/故障保 Raw、实际三段取消后迟到响应、真实 Node 子进程在第二段发起后终止、新服务 GET 零发起及显式续原段、恶意输出/输入密钥、原文与提示/模型身份改变、持久化失败后已存 Raw。后端 tsc exit 0，最终合并版另记。

```powershell
node --import tsx --test tests/rawzh01-http.test.ts tests/rawurl01-http.test.ts tests/import.test.ts tests/rawux01-http.test.ts tests/kb03-deep.test.ts tests/kb03-confirm.test.ts tests/meeting-raw-m04.test.ts
node --import tsx --test tests/rawzh01-http.test.ts
npx tsc -b
```

原始证据 `C:\Users\David.chen\AppData\Local\Temp\rawzh01-backend-e0c4ad6a-a25b-47c9-842b-a99ca18b3011` 中 `targeted.txt` 与 `translation-final.txt`。仅 TEMP synthetic、本机 HTTP 和 fake Provider。真实 Provider/config 0，正式资料访问 0，用户运行中的代理服务未操作。未提交推送。后端产品与测试已停写。

UI 产品和默认测试停写后的最终合并版本 `npm test` exit 0，763/763，0 失败/跳过/取消/todo，73.913 秒，见 `npm-test.txt`。最终 `npx tsc -b` exit 0，见 `tsc-final.txt`。六文件 SHA 已逐项回读匹配。
