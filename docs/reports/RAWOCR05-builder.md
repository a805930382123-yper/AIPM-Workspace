# RAWOCR05 执行链路施工自查

产品提交 `8f4e7ba`。两位 GPT-6.2 Sol High 分别负责 Tesseract 和图片精读执行链路，交接后由 GPT-6.2 Astra Medium 独立验收。

| 入口或故障 | 自查结果 |
| --- | --- |
| 微信动画 GIF | 本机 Tesseract 对样本图 4、6 的原始字节返回退出码 1，原因是动态图不受支持。改用首帧 PNG 后退出码均为 0。手工和资讯导入入口重放后均保留原始 GIF 字节。 |
| OCR 环境 | 调用前检查可执行文件及简中、英文语言数据。缺失与无法加载语言文件分别验证。可选配置将可解码且未完成 OCR 的图片放入已有待精读队列。 |
| 微信图片精读 | 下载使用浏览器 User-Agent，从本地字节生成模型输入。对下载、解码、Provider 鉴权、网络、图像拒绝和结果异常注入故障，卡片和日志保留对应诊断。 |
| 实际网络 | Windows 上的直接探测超时。使用已有代理脚本后，主 Agent 通过隔离副本及工作台真实配置验证样本图 1。产品提交后复测返回 `vlm_done`、`json_schema:ok` 和 145 字符解读。 |

OCR 施工者运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/rawocr03-import.test.ts tests/rawocr03-ui.test.tsx tests/rawocr04-migration.test.ts tests/newsraw01.test.ts`，37/37 通过。另运行 `node --import tsx tests/acceptance/rawocr03-builder-tesseract.mjs`，本机原生测试通过。

VLM 施工者运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr05-vlm.test.ts tests/rawocr03-ui.test.tsx tests/llm.test.ts`，28/28 通过。`node --import tsx tests/acceptance/rawocr02-http.mjs` 完成 43 次回环请求，最大并发 3。类型检查与生产构建通过。
