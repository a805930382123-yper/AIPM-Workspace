# LLM-Wiki 2A-2 独立验收

本阶段暂缓通过。基线提交 `0ab22c6ccfaf3f38ff81386a977505ca0d2e2de4`，验收对象为施工报告中的未提交冻结差异，实测 server/index.ts 的 SHA-256 为 `d77a11f6ecdaade2742948ad4c3e85d80c467d38dfa239cb89c2ea0d93c2b9b9`。Batch 2A 整体未验收，2A-3 界面与整批回滚演练待后续授权。

## 实际检索入口

任务卡要求检索结果可读取时效状态。服务端 `GET /api/wiki?q=…` 直接返回 wikiStore.list 的原始记录。临时库设五个共享别名的可见页面，再设一个同名且关联 Restricted Meeting Raw 的页面。实际搜索返回 HTTP 200、6 条完整记录，含 freshness 的记录数为 0。受限页的合成正文亦可在这一路径读到，其详情端点在同一测试返回 403。列表行为在基线已经存在；给当前列表无条件追加提醒会令两种读取口径进一步分歧。修复时应按产品的本地可见策略区分本地浏览与带来源提醒的结果，至少确保合法结果的读时状态可在实际检索入口取得，受限结果不能获得来源提醒。

静态查找 `rg -n 'retrieveKnowledgeContext\(' --glob '!tests/**'` 仅见包装函数定义和文档引用。实际检索使用详细接口，HTTP 列表独立于该包装函数。复验应通过真实路由断言匹配列表的权限、结果状态及原有搜索过滤语义。

## 实测与边界

- Node 24.18.0，运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-review-http.test.ts`，2/2 通过。临时目录、回环假 Provider，真实外发 0 次。覆盖成功修订与冲突、三条不同旧页的相似提醒、弱匹配、同日确认后再次触发、暂缓、周期、正文后缀保留、损坏状态、Lint、问答引文和回滚开关。
- 独立增量探针使用同一合成夹具，在 HTTP 服务就绪后执行 `await api('/api/wiki?q=' + encodeURIComponent(alternate))`，以 `node --import tsx --experimental-strip-types --input-type=module-typescript` 从标准输入运行。结果为 `{"http":200,"matches":6,"annotated":0,"restrictedBodyReturned":true}`。未写入测试文件。
- 写入流程在 Raw 文件落盘后发起提醒。来源变动提醒重读来源链，相似匹配按当前页文件指纹、旧页创建时间、来源权限及不同页 ID 筛选。向量分支复用 indexer 的派发前授权。该次 HTTP 独验使用 SQLite FTS；Raw 提醒的向量命中路径、冻结 25 问及全量门禁未在本次独验重跑。冻结评测与已有回归数值见施工记录。发现检索阻塞后停止，本轮通过的分项不足以判阶段通过。

## R1 复验

原阻塞已关闭。基线仍为 `0ab22c6`，本轮 server/index.ts、services/wiki/store.ts、tests/wiki-review-http.test.ts 文件 SHA-256 依次为 `cb3b8095ee7246fb35f4a982772de117caf83a6b9ecfccfd6f70e8b29f78b334`、`6aa70e2df17871a9a233c04f556de121c2db6eaadd7c583417ccaa2a09ad18ce`、`ba1dda42187020fbf4febf79e6964a8c6432044885dd30767946c9d4949f1fb2`。

- 复跑首轮标准输入探针。相同的无分类搜索返回 200，5 个匹配项全部有 freshness，受限页出现 0 次。可见页的全库分类数 channel=7、company_business=0。HTTP 套件另核验分类搜索、详情一致性、受限详情/导出/引用 403、关闭时效后仍过滤来源。
- `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=3 tests/wiki-review-http.test.ts tests/search-embeddings.test.ts tests/wiki-freshness.test.ts`，24/24 通过。
- 用 `node --import tsx --experimental-strip-types --input-type=module-typescript` 执行合成纯向量探针，复用 search-embeddings 的临时索引及回环 Provider，实际调用 RawStore.create 和 recordRawReview。旧页 shelf/stock 与新来源 hydrology/precipitation abundance 无词面重合。回环端点暂停响应时 Raw 已保存可读，释放响应后生成一条“语义相似度较高”的提醒。将第三次来源重读改为拒绝，新增出站请求 0 次。探针 1/1 通过。
- `node --import tsx scripts/run-retrieval-eval.ts workspace <临时报告> --fts-repair` 返回 0。95 Wiki、9 Raw 冻结清单通过校验，本轮 25 个题目各有 Legacy、FTS 两条记录。与历史报告逐行比较，排除耗时后的 50 行全部相同，涵盖评分、证据、页数、字符数和上下文 SHA-256；长页 9/9。FTS 的 A/B/C/D 为 7/7、4/5、5/5、3/3，E 误召回 4/5。离线复验报告 SHA-256 为 `2856d139abc88bf2baf877c767157391d93c8d042f1fe390a8e4994a66453fd4`。

## R2 凭据复验

另用实际 HTTP 端点核验主动 Raw 向量查询。临时目录内设置一枚合成历史凭据，并用环境变量指定另一枚合成当前凭据；向量端点配置独立凭据。三条符合本地标题匹配的 Raw 分别携带当前标记、历史标记、普通标记，以详情提醒出现为后台计算结束的依据。用 R1 相同标准输入命令运行，观察回环请求载荷。

主配置完整时三条 Raw 均成功入库，回环端点仅收到普通标记一次。保留两枚已知凭据，仅将 FMCG_LLM_MODEL 置空，三条 Raw 均成功入库，回环收到三次请求，其中包含当前和历史标记各一次。独立探针退出 1。server/index.ts 的新回调读取 `(await providerFactory())?.secrets`，主模型缺失时已有 knownSecrets 无法进入校验，而独立向量配置仍能发送。该场景全部使用合成标记和本机回环，实际外部请求 0 次。R2 的完整配置用例通过，当前阶段待关闭此出站缺陷，Batch 2A 整体未验收。

## R2 最终独立复验与签收

本轮出站缺陷已关闭，2A-2 阶段 PASS。Batch 2A 整体仍待 2A-3 的前端、整批集成验收及回滚演练。验收基线提交 `0ab22c6ccfaf3f38ff81386a977505ca0d2e2de4`。本轮 server/index.ts、services/wiki/review-service.ts 和 tests/wiki-review-http.test.ts 的 SHA-256 依次为 `a2367dd9e802948bec160429bacf1c6ad0866029b6077cc43da68a132b77be8e`、`2900359e47fd2ecc89ddfcc7ecbba6078b7ca850239a058fdff5b9bfe69a139e`、`57783c501ecc6640b6b178b3dfe64448b071f8c61123bfcfea831eb4607ac388`。

- 以 `node --import tsx --experimental-strip-types --input-type=module-typescript` 重跑原独立 HTTP 探针，两组分别设置完整主配置及空主模型名。每组录入三条 Raw，当前凭据、历史凭据的两条记录各自成功保存并匹配本地标题，回环向量端点仅收到普通 Raw 查询一次。原反例及对照组均通过。
- 两组均在服务运行中破坏临时配置文件的字段编码，再录入不含凭据的普通 Raw。两次均返回 201、生成本地标题相似提醒、新增向量请求 0 次。全程使用合成值，外部 Provider 请求 0 次。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-review-http.test.ts` 最终冻结版 3/3 通过。前次验证的 50 行冻结检索结果及 24 项回归详见 R1；本轮产品差异只涉及 Raw 查询派发前的凭据读取。
