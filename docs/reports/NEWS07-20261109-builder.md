# NEWS07 施工交接

基线 `3c1817145f0684e4f679b9ef7ebcc61af841c7d8`。施工完成，独立验收未执行；交接后停写。保留共享工作区原有修改，未动未跟踪 tests/news01-sources.test.ts，未提交。

历史 research-v1 URL/标题集合提前传入来源；规范化共享；每源最多8详情、5合格即停，NIQ PDF上限2。诊断字段 `shortageReasons?: string[]` 写入新 section；页面显示条数、上海抓取开始/完成、原因及回退日期和今日尝试时间。旧记录不补写。AI 原选择路径和 Raw 保存未改。

实际验证：
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx`：35/35 PASS；隔离测试和 fake，真实模型0。
- `node --import tsx --test tests/news07-builder.test.ts`：1/1 PASS；假 fetch 检查历史4条跳过、首同标题失败后补位及详情6次。未覆盖服务与真实适配器组合。
- `npx tsc -p .news07-tsconfig.json --pretty false`：退出0，临时配置 extends tsconfig，仅 include app/server/vite.config.ts，排除 tests，完成后删除。
- `node --input-type=module -` 调用 `vite.build({configFile:false,envDir:<mkdtemp>,plugins:[react()],build:{outDir:<mkdtemp>,emptyOutDir:false}})`：退出0，232模块；既有大 chunk 警告。
- `npx tsc -b --pretty false`：因既有多个损坏测试文件报 TS1490 等失败；未声称全仓通过。
- `git diff --check -- services/news app/pages/NewsPage.tsx`：退出0，仅换行提示。

未进行真实浏览器、真实来源、真实模型及正式数据操作。须由独立验收覆盖服务与适配器组合、8详情/PDF2边界、两栏回退/历史/running页面及真实浏览器；当前施工自查不代表 NEWS07 整体 PASS。

SHA256：
- service.ts `51CB807A3EDF6D0D975F07F626B5B3FFB544E28D06E35DED8BBA799EEDD37C10`
- sources.ts `DBD152F8E5560FFAA94CF986E98B5730233AE5EB6C7695C1DD315B0F1CF16246`
- research-sources.ts `8B42393B19EBD8E44777145A14680F9D972387C06C9213215108EBF37F6A12D6`
- types.ts `1C56F2BB3382D8C0D8B78D5BEDFEB52E3CFE31B4A7A17C73655A6BE65153ABA9`
- normalize.ts `6C3F225309920FC49F0391E9D8D6CE8BB93C4F349D450676AB442A4EFD8BE12A`
- NewsPage.tsx `38005E3896358301E64AEC42BBBDD781F83A7E053591B3C1C5BD02298F34C88A`
- news07-builder.test.ts `460474809F69FB509AF0B6315CFB953FE5DEC71BBCE8D44092DB05BB321956FD`

## 独验后返修交接

PDF预算跳过不再计入读取失败；详情预算仅在确有未读候选受限时记录；服务最终跨源去重导致不足时记录重复原因。排序及预算不变。

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news07-builder.test.ts`：38/38 PASS，包含8/9候选及最终重复新测试。
- `node --import tsx --test tests/acceptance/news07-review-core.mjs`：7/7 PASS，含两个真实PDF成功后第三个预算跳过及跨源重复；为施工方复用独验脚本的运行，仍待独验方复验裁决。
- `npx tsc -p .news07-tsconfig.json --pretty false`：产品范围退出0；临时配置同上，已删除。测试使用隔离数据及fake来源，真实模型0。

返修后 SHA256（覆盖上节同名文件）：
- service.ts `04D0D2B484AD74AD8050C8CC999CB6AB120338CA034026138602006A644A19AD`
- research-sources.ts `856F45633E7EF8A88AD9661E39674173BA2D852CAAC24214460C6D3EF6700876`
- news07-builder.test.ts `B195644B102D17BE8408472045E8CB9D8375F3825489BD34B6D4FC6DAE696B92`

交接后停写；本次缺陷关闭及批次整体状态均待独立裁决。
