# NEWS03 施工交接

基线 7998f27；任务卡最终 SHA256 E68EED7F8F37E446CCDBFA37F70A9FAFEC3F0F9BA1ED77AA180DD036CC00D96E。施工者本实例；本报告是施工自查，不是独立验收。

实现 Worldpanel 中文 HTML 与 NIQ 官方列表→详情→公开 PDF；限制官方路径、大小、候选及 PDF 页数，原文摘录带材料等级和页码。快消新版本筛选 365 上海自然日最多两条、旧版当天迁移保留、历史回退仅研究版，快消不调用 Provider；Raw 保存研究材料信息和原文。资讯页面展示研究元信息及单独旧栏。

## 验证

- 实际 `node --experimental-strip-types --input-type=module` 调用 readResearchSources：两家来源状态 ok，Worldpanel 获中文正文，NIQ 获官方 PDF 可读文字；此前公开来源逐链接实测详见来源报告。第二次检测暴露英文 hair dryer 误入，已加入排除规则，未重复完整实时采样；须独验最终指纹实测。
- `node --experimental-transform-types node_modules/.cache/news03/check.mjs`：旧栏只读投影、并发升级一次、新栏两项、AI原样、Provider 0 与同日复用 PASS；脚本与隔离数据在忽略目录。
- `node --experimental-transform-types node_modules/.cache/news03/raw-check.mjs`：隔离 mock Raw 存储，正文逐字一致、PDF URL/页码和未提供数据时期写入 note、重复保存同 ID PASS；非实际 HTTP。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news02*.test.ts`：5/5 PASS。
- `node node_modules/typescript/bin/tsc -p node_modules/.cache/news03/tsconfig.json --pretty false`：产品范围 PASS。全仓默认 tsc 被既有 7 份损坏测试阻断，原件未改。最终两处细小源码变动后未重复类型检查，独验须按最终指纹执行。
- `node node_modules/vite/bin/vite.js build --configLoader runner --mode production`：231 模块构建成功，体积警告。该次使用默认 envDir，未显式隔离用户配置，不能声称未读取配置；未输出环境值，不应视为空 envDir 验收构建。
- `impeccable detect --target app/pages/NewsPage.tsx` 因未指定 CDP 未运行；随后 `impeccable detect` 退出 0、无输出。未实测浏览器，交独验。

实际 HTTP 的研究 Raw、备份往返、浏览器、完整冻结矩阵与空 envDir 构建尚未施工自测，交独验；未调用付费模型，未安装依赖、未启动用户服务。来源变动/网络失败按未取得正文处理。

## 施工文件 SHA256

- `services/news/types.ts`: `ef15ccbde4e2756b74cf69de11c411e7714cf30b661517eeecd89e4806baf42e`
- `services/news/sources.ts`: `94c7603ddab439fd167852eae20a7def84bfe27bd2b16ee99745743c47886899`
- `services/news/research-sources.ts`: `d59ed56e644c0a36d66d449a84e409c625262d299e0bf530ec535d9238ac8074`
- `services/news/service.ts`: `d4c28ea9f855a48863841913d48eb3cd2d57274b6de0cc8b9c32ccd1cbf4e5a5`
- `services/news/raw-save.ts`: `82927f25edb3136d5f74285d24dc7b63dca133ba873cbad93e57f2044ba66565`
- `app/pages/NewsPage.tsx`: `d040b2ed444e30cd52022769222f6d83c2366acedd8bb76d348885bba0a3da4d`

施工停写；未提交推送。

## 第一轮返修交接

数据时期从含经营数据的原文句提取，未知显示“请以原文为准”；Worldpanel 2025 / 2026一季度及 NIQ 2026年8月样例实际解析。排除农业收储、要求实质量化研究依据；来源固定默认 HTTPS 端口。旧失败栏 retry 返回409且不写文件，历史复用完整卡片呈现分析及保存状态；旧新闻不显示研报规则。Raw 的机构及标签只含材料等级，PDF及时期在 extractionNote。

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02*.test.ts tests/news03-repair.test.ts`：13/13 PASS，含农业收储、非默认端口、旧失败重试及量化研究测试。
- `node node_modules/typescript/bin/tsc -p node_modules/.cache/news03/tsconfig.json --pretty false`：产品范围 PASS；既有损坏测试未修改。
- `node --experimental-transform-types node_modules/.cache/news03/raw-check.mjs`：全新隔离目录 PASS。首次复跑沿用旧目录收据而缺 mock Raw 导致409，改全新隔离目录通过；不算产品故障。
- 公开来源最终规则的实际采样在最后页眉清理之前执行，Worldpanel 购物者数据时期2025年、2026年一季度、4月；NIQ月报第6页2026年8月；清理页眉后未重采样。未重新运行默认envDir构建或真实浏览器，交独验复核。

最终文件 SHA256：

- `services/news/types.ts`: `ef15ccbde4e2756b74cf69de11c411e7714cf30b661517eeecd89e4806baf42e`
- `services/news/sources.ts`: `94c7603ddab439fd167852eae20a7def84bfe27bd2b16ee99745743c47886899`
- `services/news/research-sources.ts`: `aa47ae7a0c1efee2bedbf4bc2bf749c134028780f3f56a966077a8ae47696a59`
- `services/news/service.ts`: `1804638685603923912908e17bb60c90120b3ccd0215ba7405da1ef69703cd8a`
- `services/news/raw-save.ts`: `17fcb728d44cf568dbfaa525aa7487c97f1ed93202b3e8896110c034f58e8c23`
- `app/pages/NewsPage.tsx`: `b0b1b25c5179ba083cac4cc0254c332fe8a53c11605a79362136864f59671ce2`
- `tests/news01.test.ts`: `a4b3a40df256b9beae25daaf1e9ffecc80825735ef678dbb176136d8e0d57728`
- `tests/news03-repair.test.ts`: `ce1d9f053ef343b39229e8ee2db8ae1615dd09b0d400d4211bb611de53260e60`

返修停写，未提交。

## 第二轮最小返修

冻结任务卡 SHA256 44A9BD7FFC110AF1A8946C7A0EE2DA524DDCE81032E335E1A050492B0C44865D。日期以逗号及明确数据提示切局部子句，排除发布语义并仅保留与统计指标关联的原文日期；小数点不切分。官方文章中明确报告摘要/介绍标题时标注官方报告介绍，普通研究文章即便有下载链接仍标正文。

`node --import tsx --test tests/news03-repair.test.ts` 4/4 PASS，包含暴露失败原句、仅发布日期、跨季度、小数、报告摘要及带下载链接的正文；`node node_modules/typescript/bin/tsc -p node_modules/.cache/news03/tsconfig.json --pretty false` 产品范围 PASS。真实来源和浏览器本轮未重复，交独验按范围复验。零付费模型调用、无依赖安装。

最终文件 SHA256：

- `services/news/types.ts`: `ef15ccbde4e2756b74cf69de11c411e7714cf30b661517eeecd89e4806baf42e`
- `services/news/sources.ts`: `94c7603ddab439fd167852eae20a7def84bfe27bd2b16ee99745743c47886899`
- `services/news/research-sources.ts`: `efc438bd29df628211cb2b6959a6d9d8aa30219054ad7937f21970e0e03e584f`
- `services/news/service.ts`: `1804638685603923912908e17bb60c90120b3ccd0215ba7405da1ef69703cd8a`
- `services/news/raw-save.ts`: `17fcb728d44cf568dbfaa525aa7487c97f1ed93202b3e8896110c034f58e8c23`
- `app/pages/NewsPage.tsx`: `b0b1b25c5179ba083cac4cc0254c332fe8a53c11605a79362136864f59671ce2`
- `tests/news01.test.ts`: `a4b3a40df256b9beae25daaf1e9ffecc80825735ef678dbb176136d8e0d57728`
- `tests/news03-repair.test.ts`: `62221b792b8db6318982cf997a46fbc5aa1c8498d3ed058ddb8c313a4f2b8fbf`

第二轮返修停写，未提交。
