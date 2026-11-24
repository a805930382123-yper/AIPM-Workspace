# RAWOCR06 微信六图独立验收

2026-11-24，受测基线 `9c7c7add823517dab87a99aa4306b9a5fc3c6e1b` 加本轮工作区变更。

## 结论

- **第二轮专项通过。** 两个网页导入入口按图片在正文中的出现位置筛选。版式细长、正文无 OCR 文字以及同文复用分别有保护用例。已跳过和失败卡片可单图强制精读，默认批量处理仅覆盖待精读图片。
- **六图任务整体验收通过。** 结合 [第一轮执行链路验收](RAWOCR05-review.md)、此次从微信源站重新导入的正式入口实测，以及独立读取的六份落盘结果，六个位置均达到任务卡规定的状态。正式样本和隔离新导入的正文摘要相同，六份原图分别计算 SHA-256 相同。全仓工程门禁由主 Agent 另行汇总。

## 六图实测

主 Agent 工程收尾：产品提交 `17ab0bc`。在只包含本轮变更的隔离检出中，沿用项目样本原始字节，运行 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=4 "tests/*.test.ts" "tests/*.test.tsx"`，1073/1073 通过，零跳过。共享工作区初跑有两个 Wiki/提交 HTTP 用例失败，临时检出首跑有一项评估夹具因换行改变而失败。恢复临时夹具原始字节后，定向与全量均已通过。

主 Agent 从正常 URL 导入入口请求微信源站，记录导入时模型调用 0 次，初始为两张待精读、四张跳过。随后默认批量 POST 对真实模型发起两次请求，刷新后状态保持。独立验收者检查此次运行的验证脚本并只读复核落盘输出，未重复调用真实模型。

| 图片 | 入队与持久化结果 |
| --- | --- |
| 1 | OCR 质量或排版需核对。真实精读返回 text_excerpt、148 字符、`json_schema:ok`。 |
| 2 | 本机 OCR 文字少，保留为待精读。真实精读返回 flowchart、184 字符、`json_schema:ok`；独立核对包含销售额、购买人数、客单价、活跃用户、付费率、新用户、老用户。 |
| 3、4、5、6 | 每个位置均保存“文末推广区截断，已跳过此图。”，无精读尝试记录。 |

独立执行 `node --import tsx --input-type=module` 的只读核验，从两库读 Raw 元数据，比较六个顺序位置的 SHA，对两侧各六个留存文件使用 Node crypto 重新计算摘要，再核对派生记录的状态、原因、尝试和图 2 术语。退出 0。共同正文摘要为 `f26f34544c0a038112eda62f6cfedcc55aeb7698987991b29a44967cacf424c8`。

## 独立复测

| 实际命令 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr05-image-screen.test.ts tests/rawocr03-import.test.ts tests/rawocr03-ui.test.tsx tests/rawocr04-migration.test.ts tests/rawocr05-vlm.test.ts` | 31/31，零跳过。覆盖正文位置、配置阈值、可解码二维码与邻段引流词组合、同图不同位置、装饰与演示动图、两入口、单图 force 和历史数据。 |
| `node --import tsx tests/acceptance/rawocr02-http.mjs` | 真实产品 HTTP 入口，44 个回环模型请求。包含无效结构、503、批量并发峰值 3、跳过状态与显式单图调用，退出 0。 |
| `node --import tsx tests/acceptance/rawocr03-independent.mjs --native-ocr` | Edge 158.0.4370.33 加原生 Tesseract，开发前端接真实产品 HTTP，10 项检查通过。跳过卡片显示原因，显式点击只发送一次，刷新保留结果和原决定。另测失败重试、批量部分失败、窄屏与原图字节；12 个回环请求，0 个页面脚本错误，模拟缺配置产生预期的 400。生产 bundle 的 Edge 检查由施工者另行通过。 |

审核时的 SHA-256 前缀为 `839c07ac63f21442`（media-image-screen.ts）、`8e1667b4ce3ee458`（media-ocr-triage.ts）、`f3bea5bb5a46c560`（media-vlm.ts）、`8a8739d4cb0fc254`（web-material.ts）、`19c862ee160858f8`（media-migration.ts）及 `2243a59f6569fb77`（RawWebContent.tsx）。
