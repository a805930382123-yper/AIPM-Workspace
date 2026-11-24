# RAWOCR06 第二轮施工自查

产品提交 `17ab0bc`。GPT-6.2 Sol High 分别完成导入筛选、精读接口与卡片修改，交接给 GPT-6.2 Astra Medium 独立验收。

- 网页和资讯入库对每个图片位置独立判断，首先截断尾部推广区，再检查极小图、小装饰动画、重复模板，最后结合邻文与 jsQR 的实际解码结果筛查中插推广。原图按内容保留。同一图在正文重复出现时可以复用 OCR 结果。
- 正文细长图、OCR 无字大图可进入精读。人工按钮直接调用单图接口并保留原决策原因。批量请求限于仍然待精读的图片。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/rawocr03-import.test.ts tests/rawocr03-ui.test.tsx tests/rawocr04-migration.test.ts tests/rawocr05-image-screen.test.ts tests/rawocr05-vlm.test.ts tests/newsraw01.test.ts` 通过 45/45。`node --import tsx tests/acceptance/rawocr03-builder-tesseract.mjs` 原生双入口通过，类型和目标文件格式检查通过。
- `node --import tsx tests/acceptance/rawocr02-http.mjs` 通过 44 次回环请求。对临时目录中的新生产构建运行 `node --import tsx tests/acceptance/rawocr03-independent.mjs --native-ocr`，Edge 十项验证通过，12 次回环请求。已跳过图的人工精读恰好增加一次请求，刷新显示原始原因和精读结果。
- 真实微信源站重导、真实 Provider 和逐图核验见[独立验收与六图记录](RAWOCR06-review.md)。
