# NEWS10 阶段性交接（待材料独核）

news07_build / Terra High，基线 HEAD `d6a93bd2936f32b31324032b3aa9fce81c708a32`。新增 `services/news/new-research.ts`，仅显式enabled可运行；尚未接生产默认。KPMG HTML12秒、PDF单个跨跳转总60秒/10MiB、最多100页；Mintel articles+官方press RSS，详情预算6，明确日期与正文等级。两源默认关闭、未修改正式缓存或Raw、模型0。

首轮 `node --import tsx tests/news10-live.mts`：快照与逐请求账本 ignored `node_modules/.cache/news10-live-nJrGHZ/`。KPMG两PDF完整取得，但初版摘要被独验判不合格，后离线修正。Mintel抓到导航无正文。第二轮同命令（按首轮KPMG历史排除）：`node_modules/.cache/news10-live-Ck347V/`；Mintel三个卡片详情为营销/表单，不合格。两轮已耗尽；主线程另授权Sol访问官方press目录、RSS和一条动态发现详情，其快照 `node_modules/.cache/news10-review/mintel-probe-64UpPY/`，未由施工者额外外发。RSS与详情是独立后续采集，不冒称同轮完整链。

`node --import tsx tests/news10-replay.mts node_modules/.cache/news10-live-nJrGHZ`：零外发，使用首轮KPMG及Sol补充Mintel RSS/详情组合回放；KPMG健康食品报告2026-09-09物理31页完整中国渠道句124字符；Mintel公开风味研究2026-09-17正文1472字符。实采结果及回放内容只在ignored目录供独核。`node --import tsx --test tests/news10-builder.test.ts`：2/2 PASS（显式开关、独立失败、日期、营销拒绝）。新闻模块单独tsc曾通过（最终筛选小改后未重跑）。

材料等级、上下文与动态发现待Sol独核；已知未完成N10-02完整边界、真实浏览器、生产入口、全产品tsc/构建及原Raw缓存验收。不得据此签NEWS10整体PASS；材料核过后才可改生产默认。交接后停写，等待主线程指示；不提交。

SHA256：
- new-research.ts `44A573A5A68CCA05937F7A6FE3D914057FA019C44170F7EEAF84391251BD90BA`
- news10-builder.test.ts `389EA601D3E5A80F00E212DC2A35345F69D815943ECCAAAF1B7B47463F718A51`
- news10-live.mts `52E5A11163352633FC3883D8D81CBAA1FED21906D301F077B2BBA857DEA8D4A1`
- news10-replay.mts `E87AAC081F5AF9D1DB56B62FC903FD10ABE1DCD7CB468413A991784735E57EAB`

## 启用前独核返修

Mintel改为官方press-centre HTML声明的同域RSS，再读取feed实际详情；不使用短feed摘要作正文，不允许越界feed声明。press-centre研究材料标记“公开报告摘要，未取得报告全文”。KPMG筛选未作本次返修。默认仍关闭，零外发。

`node --import tsx tests/news10-replay.mts node_modules/.cache/news10-live-nJrGHZ`：退出0，离线组合首轮KPMG与Sol实际3次补证的官方目录/RSS/详情；KPMG物理31页124字符、Mintel 2026-09-17详情1472字符且等级为公开报告摘要。补证3次分别为目录、RSS和详情，替代前节预计2次；组合不冒称同一轮。`node --import tsx --test tests/news10-builder.test.ts`：2/2 PASS，覆盖官方声明、去重、越界声明/链接、日期、摘要等级及详情失败不回退短摘要。真实浏览器/生产入口及完整预算边界仍未测。

本次SHA256覆盖上节同名：
- new-research.ts `4072900E37887E695A47AB829A822C641F9E43FBA61867735684ACA844E10EFD`
- news10-builder.test.ts `B5B9CB148F387B62469FDA871AD3CDE45A55181C84287B9A26A2064AF3CC4AE7`
- news10-replay.mts `A29859C10C432B65BD89BFF216FC91929E0CE654AAE67AB995C9A5819D617B32`

交接后停写；两源继续关闭，待独立复核后再执行默认启用。

## 默认启用交接

Sol启用前复验PASS后，`research-sources.ts`接入KPMG与Mintel新适配器，正常下一次生成生效；无正式缓存重建、真实来源新增请求或模型调用。`node --import tsx tests/news10-production-replay.mts node_modules/.cache/news10-live-nJrGHZ`：用KPMG首轮与Sol补证Mintel目录/RSS/详情离线组合，经实际readNewsSources→NewsService生成两源，隔离Raw正文逐字、重复保存幂等，同日ensure新增请求0。隔离数据 `C:/Users/DAVID~1.CHE/AppData/Local/Temp/news10-prod-h7Wgaz`。

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news07-builder.test.ts tests/news08-builder.test.ts tests/news08-ui.test.tsx tests/news09-builder.test.ts tests/news10-builder.test.ts`：45/45 PASS，最后追加日期营销fixture前执行；最终 `node --import tsx --test tests/news10-builder.test.ts` 3/3 PASS。
- 产品范围 `npx tsc -p .news10-tsconfig.json --pretty false`：退出0，include app/server/vite.config.ts、exclude tests，临时配置已删除。
- 空临时envDir和输出目录Vite build退出0，233模块，既有大chunk提示。
- KPMG跨跳转60秒/第63页/10MiB及浏览器由独验独立检查，施工未冒称已测；整批结论待独验。两轮来源及主线程批准补证账本沿上节保留，不再外发。

最终SHA256（覆盖上节同名）：
- research-sources.ts `B597CD31CC1315EAEC7E699CC4EE015FC815B29DA3415E95A21FE250E8DE6C6C`
- new-research.ts `4072900E37887E695A47AB829A822C641F9E43FBA61867735684ACA844E10EFD`
- news10-builder.test.ts `AF815BD592FCA3E86763B75FA45A3E5897F4D3F50FE6E7CDD4DA466EE34BBD0A`
- news10-production-replay.mts `0183286B0A462076FD183ADC62DB16F3C51A4CDEB11ADC3CC49D3FC0AB001F22`

基线HEAD `d6a93bd2936f32b31324032b3aa9fce81c708a32`；交接后停写、不提交。

## 发布日期返修

KPMG明确官方YYYY-MM保留月精度，以上海月初仅用于365日筛选；Mintel优先明确published元数据、非updated时间及可见发布日期，RSS时间回退按上海自然日转换。保留原精度，不调用外部来源或模型。

- `node --import tsx --test --test-name-pattern='published month|visible release day' tests/acceptance/news10-review-bounds.mjs`：2/2 PASS，独验固定反例施工方复跑，待独验复验。
- `node --import tsx --test tests/news10-builder.test.ts`：4/4 PASS，新增RSS跨UTC日期回退及不取dateModified。

返修HEAD `d6a93bd2936f32b31324032b3aa9fce81c708a32`，SHA256覆盖上节：
- new-research.ts `6ED1D950735639E677692310EA5106ECD0B3F6417213047139563A214DD6D141`
- news10-builder.test.ts `DED992D2B96D603D8ECBF178C1EF6C61346EC39A5DFCDBE665580434E1B5ED6C`

交接后停写，局部关闭与NEWS10整体待独验裁决。

## 纯方法反例返修

Mintel研究证据判断不再以孤立“例如”“受访者”成立；方法设计步骤等句子不用于证明研究结果，仍可接受非数字明确发现。首次收紧时独验方法反例仍失败，进一步排除方法性语句后通过；未外发。

- `node --import tsx --test --test-name-pattern='methodology illustration|visible release day|published month' tests/acceptance/news10-review-bounds.mjs`：3/3 PASS（施工复跑独验fixture，待复验）。
- `node --import tsx --test tests/news10-builder.test.ts`：4/4 PASS。
- `node --import tsx tests/news10-production-replay.mts node_modules/.cache/news10-live-nJrGHZ`：退出0，离线实采两源仍入选、Raw逐字/幂等及缓存零新增请求；模型0。

最终 new-research.ts SHA256 `A7070ADD2E04635BD677C7D1F84770BD20F89691E694D6C40E0D0C04098788DD`，覆盖前述SHA；HEAD仍 `d6a93bd2936f32b31324032b3aa9fce81c708a32`。交接后停写，待独验裁决。
