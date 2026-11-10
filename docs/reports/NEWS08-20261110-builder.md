# NEWS08 施工交接

基线 HEAD `b4eb4418cc0254ee27d72a0565edcd5ff80b08ae`；施工仅修改 service.ts、NewsPage.tsx，新增两份news08测试。只读投影 `recentFmcg` 按近30日原期刊逆序、365日发布日期筛选去重，保留原期刊日期；页面今日与近期分组，原日期保存，状态查询按日期去重，按日期版本避免跨期竞态。未改抓取、Raw、模型或来源。无真实网络、模型、正式数据操作。

实际验证：
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news07-builder.test.ts tests/news08-builder.test.ts`：39/39 PASS，最终页面末次微调之前执行。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news08-builder.test.ts tests/news08-ui.test.tsx`：2/2 PASS；UI末次微调后单跑 news08-ui 1/1 PASS。跨期A保存与B在途、A旧响应覆盖回归通过（JSDOM）。
- `npx tsc -p .news08-tsconfig.json --pretty false` 产品范围失败：共享并行PDF任务 `services/wiki/pdf-input.ts` 第38–40行 `PdfDraftInput.rawId/evidence` 不存在及 locator 隐式any；未修改该任务。配置extends项目tsconfig、include app/server/vite.config.ts、exclude tests，临时文件已删除。
- `npx tsc -p .news08-target-tsconfig.json --pretty false`：最终版退出0；include NewsPage.tsx、services/news/service.ts及其依赖，临时文件已删除；不是全产品类型通过。
- 空临时envDir与输出目录 `node --input-type=module -` 调用 Vite build（configFile:false、react插件）：最终版退出0，233模块，既有大chunk警告。

未测真实浏览器、真实隔离服务Raw保存和missing、所有时间边界状态矩阵；须独立验收，不能判整批PASS。零真实模型及外部抓取，未提交。交接后停写。

SHA256：
- services/news/service.ts `062A40C0E3C6B3702ED2296A60F6361316633FB65CED62F4ED878E9B75DF54E1`
- app/pages/NewsPage.tsx `9132FC9977B93C76995D4DE8F63B3F621D9223BDEC97DABB6A4C2D5F69A956F5`
- tests/news08-builder.test.ts `2162CF4EECA7AF686634CAA07F39B535EE4C7222349A47AD110CADE883B24E84`
- tests/news08-ui.test.tsx `EF9CACF46F016803BF60AB7288FB6B337410294E12D9A538CCEDBAA480131EF4`

## 独验返修

今日快消恢复对 source failed 的覆盖不完整提示，即使已有5条仍显示。`node --import tsx --import ./tests/support/css-stub.mjs --test tests/news08-ui.test.tsx`：2/2 PASS，包含5条加来源失败和跨期竞态。隔离fixture，无外部抓取或模型。交接后停写；待独验复验。

返修 SHA256（覆盖上节对应值）：
- app/pages/NewsPage.tsx `E72A592762B507853F913CEF801CD1608E4047AF15C7340C534C4C33D60672A7`
- tests/news08-ui.test.tsx `F3E96BFFB9E4601409D7869F62FEF473033A033A59BF04A5E9C4C65A70B9A5A4`
