# RAWOCR05 第一轮独立验收

2026-11-24。受测基线 `9afd0030362aa9c3e5d7153f31333935bb91603c`，加本轮工作区修改。下列 HTTP 和浏览器验证由独立验收者在临时数据目录执行。真实 Provider 与原始微信 GIF 的实测由主 Agent 和施工者完成，单列来源。

## 结论

- **本轮执行链路缺陷通过。** 两个导入入口在本机 Tesseract 下完成处理。真实浏览器可提交单图精读、查看结果、重试失败图片并刷新读回。故障记录按下载、原图、转换、Provider 和结果解析分开。回环故障注入验证了密钥及上游私有内容的隔离。
- **整份六图任务尚待第二轮验收。** 第一轮执行链路专项通过。六图重新导入后的筛选结果、跳过卡片的人工操作留到后续授权；本报告不签发整份任务 PASS。全仓门禁由主 Agent 单独记录。

## 实际命令与观察

| 命令 | 实际结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr05-vlm.test.ts tests/rawocr03-import.test.ts tests/rawocr03-ui.test.tsx` | 19/19，零跳过。覆盖微信 CDN 请求、原图字节、OCR 人工与精读队列配置、PNG/JPEG 请求及故障诊断脱敏。 |
| `node --import tsx tests/acceptance/rawocr03-builder-tesseract.mjs` | 退出 0。自动找到 Windows 安装；手工和资讯入口各三图，两张文字图为 ocr_ready，GIF 为 skipped；两入口正文 SHA 一致，另测缺语言与无法加载语言。 |
| `node --import tsx tests/acceptance/rawocr03-independent.mjs --native-ocr` | 退出 0。Edge 158.0.4370.33，11 个回环模型请求。验证五态、单图、批量局部失败及重试、刷新、切换资料、390px 阅读与原文原图字节。页脚本错误 0；缺配置用例产生预期 HTTP 400。 |
| `node --import tsx tests/acceptance/rawocr02-http.mjs` | 退出 0。真实产品 HTTP 路由，43 个回环请求、并发峰值 3；无效结构、503、重试、过期引用和后续检索符合预期。 |

真实样本的补充证据来自主 Agent 与施工者交接。主 Agent 使用现有代理启动脚本，在隔离副本将图 1 送真实 Provider，返回 `vlm_done`、`json_schema:ok`、正文 145 字符。施工者使用图 4、6 的原始 GIF 核验两入口；独立验收者使用隔离生成的图片复测。上述操作均无需覆盖正式资料。

## 受测文件指纹

主 Agent 收尾核验：产品提交 `8f4e7ba`。隔离目录运行 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=5 "tests/*.test.ts" "tests/*.test.tsx"`，1067/1067 通过，零跳过。首次全仓运行中的三项失败单独复测通过；中间一次强制退出运行触发 Windows libuv 关闭断言，最终常规退出的全仓复跑通过。`npm run build` 退出 0。原服务切换到代理启动模式的命令被本机工具策略拒绝，当前端口的健康检查仍通过，尚未切换到本提交。

下列 SHA-256 前 16 位取自最后一次生产 HTTP 复测时的工作区文件。

| 文件 | SHA-256 前缀 |
| --- | --- |
| services/raw/media-vlm.ts | b2a26f1d3b04fd7c |
| services/raw/web-material.ts | 9aaa5eee709df960 |
| services/raw/local-ocr.ts | 6c50c208cfc14796 |
| services/llm/provider.ts | 838e7d793bf51216 |
| services/raw/url-import.ts | 856b3edfafa106b2 |
| services/raw/media-artifact.ts | 30e8e9f3959923b0 |
| app/components/RawWebContent.tsx | feec29712d9035d5 |
