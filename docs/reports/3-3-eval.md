# LLM-Wiki 3-3 · 冻结 25 问、补充 5 问与千页检索基准

2026-11-28，Node v24.22.3、SQLite 3.53.2。评测以 [3-3 任务卡](../handoffs/LLMWIKI-3-3.md) 为准。候选来自基于 `a15470a789e9bea17a3ca04af8ff90efff928af8` 的工作树，实际运行文件指纹见末尾。3-2 使用产品提交 `ceff6cc58fb1278da10232ccb59a21b1132f8524` 重跑。

本报告记录检索评测自查。本次评测的真实模型请求为零。真实 Hybrid 语义参考 [1B 历史实测](../../evals/reports/batch-1b-final-live.md)。

## 冻结 25 问

25 问原始题库、评分和 Top 8 上限保持冻结。每次运行先校验 95 篇正式 Wiki、9 份相关 Raw 的逐文件 SHA-256，再向隔离目录加入三篇可再生合成长页。正式语料 898 块，合成长页 156 块。补充五题使用另一套临时目录和索引。

3-2 签收报告保留了历史汇总。本次从实际 3-2 产品提交导出源码，在同机器、同版本依赖、同语料上重评，获得可逐题复核的旧版对照。逐题比较以题号和引擎为键，核对命中、章节、误召回、页数、送出 JSON 字符数、命中证据和送出上下文 SHA-256。耗时单列。评分门槛脚本的文件指纹因换行符不同而变化，统一为 LF 后内容一致。

| 一跳 | 与 3-2 相同 | FTS 长页锚点 | 3-2 实测报告 SHA-256 | 3-3 实测报告 SHA-256 |
| --- | --- | --- | --- | --- |
| 开 | 50/50 | 9/9 | `b84dfc6f16c7058d9b64e96845a7f935a42a96a01c45dfd1008586da9c2e0a5b` | `5758f5dc9ade0aa1650e875b875de3e28d377573900d6b204d8d8f61589b95d7` |
| 关 | 50/50 | 9/9 | `488ef91132efd990a9490e6bc5745624186cf3f0d82da018c0dcada8ba4e70f8` | `1fd29307af4df04546015329c0783d2f989a98f36f19f4d2f7217de2eb1fb18c` |

一跳开启和关闭时，FTS 的 A/B/C/D 命中及章节定位均为 7/7、4/5、5/5、3/3。Legacy 相应为 3/7、0/5、0/5、2/3。B4 在 FTS 继续漏检。两路 E1、E3、E4、E5 均误召回，E2 为空。FTS D1 在开关开启时发送 6 页、8,033 字符，关闭时为 4 页、6,937 字符，两个状态均保留三个锚点。

## 补充五问

采用独立临时目录中的六篇合成 Wiki 和一份合成受限会议来源。F1、F2、F4 执行真实问答服务，由进程内桩原样捕获该次发送的 Wiki JSON。F3 确认无模型的问答入口返回 `LLM_NOT_CONFIGURED`，再通过同一 FTS 检索方法读取本地上下文。F5 执行问答服务，获得依据不足状态，进程内桩未收到载荷。命中按前八页中的精确 UTF-16 原文切片及 SHA-256 评分。

五题均通过。表中三位尾号均基于同一 UUID 前缀 `a1330000-0000-4000-8000-000000000`。白梨库受限同名页 `006` 与黑榛站受限页 `005` 均出现在权限检查前的 FTS 候选中，两页及其来源标识、暗号和引用均未进入载荷。F5 返回空上下文，误召回为 0。五题外部请求合计 0 次。

| 题号 | 金标页及 UTF-16 坐标 | 原文 SHA-256 | 上下文页 | 实际发送页 | 命中 | 受限候选被拦截 | 进程内调用 | 返回引用 | 耗时 ms | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | `001` [10, 24) | `56d366face174ca9d174e622386a87df6fd47a3c4036badda9a477e8ed2be15e` | `001` | `001` | 是 | — | 1 | 0 | 19.10 | 通过 |
| F2 | `002` [10, 27) | `99c7d400aaffbfdfc4641d21961b082c91bd4a635cedd739b247bd9ce9e8148c` | `002` | `002` | 是 | — | 1 | 0 | 13.77 | 通过 |
| F3 | `003` [10, 29) | `489f49bcd908ce1682b0c08bc08ecf6aab68bf94e4c1b09773636fcf0c1a820c` | `003` | 空 | 是 | — | 0 | 0 | 1.37 | 通过 |
| F4 | `004` [10, 24) | `0988b1ad7c6633991647559e0ae0ae70e3a79f65a348fe47a15825a4f4ca3d1f` | `004` | `004` | 是 | 是 | 1 | 0 | 14.18 | 通过 |
| F5 | `005` [10, 26) | `5e150e99ccd9978883dc90ae19d90b52d885676c29d0bf9b18a6568f4499c3f4` | 空 | 空 | 否 | 是 | 0 | 0 | 9.80 | 通过 |

## 千页检索基准

Node v24.22.3、SQLite 3.53.2，1,000 页、6,000 块。每路 5 次预热、30 次计时查询，逐次检查实际引擎、未降级和非空结果。全量重建 1,476.02 ms，低于 5,000 ms 门槛。FTS 平均和 P95 均低于 50 ms 门槛。

| 引擎 | 计时次数 | 平均 ms | P95 ms |
| --- | --- | --- | --- |
| `sqlite_fts` | 30 | 7.43 | 12.77 |
| `legacy_scan` | 30 | 343.18 | 363.71 |

## 命令与指纹

使用 Node 24。清除继承的 `FMCG_LLM_*`、`EMBEDDING_*`，使用新建的系统临时数据目录及不存在的配置文件。冻结评测读取清单所列源文件后，在临时副本上运行。基准使用临时生成语料。

- 从 `ceff6cc` 用 `git archive --format=zip` 导出 `services`、`rules`、`config`、`package.json` 及冻结题库、夹具、评测脚本和质量门槛脚本，解包到 `.scratch` 下的临时源码目录。从解包目录和当前仓库分别运行 `node --import tsx scripts/run-retrieval-eval.ts <冻结语料根> <报告.md> --fts-repair`，各以 `SEARCH_WIKI_ONE_HOP=1`、`SEARCH_WIKI_ONE_HOP=0` 执行。两版共四次，均退出 0。
- `node --import tsx scripts/eval-wiki-batch-3.ts` 从候选工作树执行补充五题，退出 0。结果 JSON SHA-256 为 `50f12377a6c4aad34506cbe220b0be43876c2f690fa4fb0305ba63c291f0c58b`。
- `node --import tsx scripts/bench-1000-pages.ts` 从候选工作树执行千页检索，`SEARCH_WIKI_ONE_HOP=1`，退出 0。

| 文件 | SHA-256 |
| --- | --- |
| `evals/retrieval-baseline.json` | `b8937bceae061acecfd28e91d5e03fd0187ac564e39ec76569991b22b0f68899` |
| `evals/fixtures/batch-1a-long.ts` | `d719119203b35e4403b90f84173939648d96ce61bc9592ac7a76402b0796bdbe` |
| `scripts/run-retrieval-eval.ts` | `ed0349fec2caf9282f1acffa01ccd1cbce24b91612cd8fd3868814d827d7611f` |
| `scripts/retrieval-quality-gate.ts` | `e5b6076b165a14953b967fec8f2a3118399c1a07bdb87de5509ec6954198ad7f` |
| `scripts/eval-wiki-batch-3.ts` | `3c4d2c16da9e0489bdf1422e3ef03a549b45214f2f4299118a6cff0ee64c98be` |
| `scripts/bench-1000-pages.ts` | `952faf8ea2ef855a3d7552913b7ebd40f6f12a46c1396391f0362f15f4277fb8` |
| `services/llm/knowledge-maintenance.ts` | `62bf527de2daa4174a0ac57965000a58ce0ecc77da6fd4322f029ae09137fd84` |
| `services/llm/knowledge-answers.ts` | `d2dc705f13764d76975fef1e8299cd2f746f5f1c2e1c0a62ab023abc67088357` |
| `services/search/fts-retriever.ts` | `4e1329b8dea3947ce8632c5ba41112aa50cef6e8080317002ddaac4e28d203c7` |
| `services/search/indexer.ts` | `5bdb23c609bac5a4634da577959de23715c2e3844ef415b21cc8731767309cb1` |
| `services/search/sqlite-store.ts` | `f24ae77e767ebeeb07e8d085bdad68c40e4f73a8d624a1ea51d54ee7d2a5ebf7` |
| `services/wiki/store.ts` | `072c0bbcff89a7f9c8988630bd9888ca7c5f494d867174c3a4fde3b19a049d6e` |

## 3-3 逐题结果

“同 3-2”是本行全部非耗时字段的比较。证据写作页 ID 前八位和正文偏移，✓ 表示章节匹配。耗时 A/B/C/E 为检索详细接口，D 为实际 Prompt 载荷抵达进程内采集桩。

| 一跳 | 题号 | 引擎 | 命中 | 定位 | 误召回 | 页数 | JSON 字符 | 耗时 ms | 命中证据 | 送出上下文 SHA-256 | 同 3-2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 开 | A1 | legacy_scan | 是 | 是 | — | 8 | 11451 | 70.26 | 1f23b4ca:313 ✓ | `6344d5ac956c042faafe636f7450f3aed4dd9820ef4fb795f7924c46cd2f5e8d` | 是 |
| 开 | A1 | sqlite_fts | 是 | 是 | — | 8 | 6709 | 11.00 | 1f23b4ca:313 ✓ | `8321d893f9b5b8729b74d7965d0dc170ba340aa39a103ab7922680d0b16c6793` | 是 |
| 开 | A2 | legacy_scan | 否 | 否 | — | 0 | 2 | 52.29 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | A2 | sqlite_fts | 是 | 是 | — | 8 | 8870 | 14.45 | ff5ad41c:59 ✓ | `72f0656e77b2d5b159c46b7579341f1410f2b6d2435260e442589ddc15465a32` | 是 |
| 开 | A3 | legacy_scan | 是 | 是 | — | 4 | 13448 | 62.36 | b688f860:84 ✓ | `78d76ef5753342933b34a5a20dc89273c41cdf6e45471230a3f86fd436c44edc` | 是 |
| 开 | A3 | sqlite_fts | 是 | 是 | — | 8 | 7887 | 10.72 | b688f860:84 ✓ | `c34076e24ed0c4d2d496f4ce1844963fc728bf3bf98eb13b23ffe6218ab998ec` | 是 |
| 开 | A4 | legacy_scan | 是 | 是 | — | 1 | 34577 | 63.38 | 5a5a6dce:89 ✓ | `299eb7dfe3420ae823d06c7629f7362e9a7f5f275cef38cf712b24589d1358b4` | 是 |
| 开 | A4 | sqlite_fts | 是 | 是 | — | 8 | 8504 | 16.61 | 5a5a6dce:89 ✓ | `05cfa0a7fe34c33789b7c4e5b855cbe48033dd6869cce9ec618b1618d7b4e53b` | 是 |
| 开 | A5 | legacy_scan | 否 | 否 | — | 0 | 2 | 65.29 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | A5 | sqlite_fts | 是 | 是 | — | 7 | 13067 | 12.30 | 0e28daa4:299 ✓ | `1f714aea0bf992b4a97c9d9a0156eb7d36001fd8f74543143174b5daf79599fc` | 是 |
| 开 | A6 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.57 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | A6 | sqlite_fts | 是 | 是 | — | 8 | 8308 | 9.40 | d14984ee:119 ✓ | `59b1b03b100fec3ed82cb2406e41ca96ae0c3b7cb3609ad4783067498de5aad4` | 是 |
| 开 | A7 | legacy_scan | 否 | 否 | — | 0 | 2 | 67.07 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | A7 | sqlite_fts | 是 | 是 | — | 2 | 2012 | 4.40 | fca07c1e:288 ✓、f0bd276a:234 ✓ | `4ae98c173ebe0353b38be3ff96a2f61d15de3b4028527c14eb5201b136af3a58` | 是 |
| 开 | B1 | legacy_scan | 否 | 否 | — | 0 | 2 | 67.01 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | B1 | sqlite_fts | 是 | 是 | — | 2 | 1817 | 7.72 | 4ac48c25:32 ✓ | `71b5e88599e3fee4aa47ec15e124c958f6c807a50b1b29fc16317111fe921320` | 是 |
| 开 | B2 | legacy_scan | 否 | 否 | — | 0 | 2 | 67.37 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | B2 | sqlite_fts | 是 | 是 | — | 8 | 11702 | 9.90 | ddb2fdda:34 ✓ | `69c39e2ab1e8335d319093cbf9db4d70ab1d05c2416f817affed1ec1ae34f5da` | 是 |
| 开 | B3 | legacy_scan | 否 | 否 | — | 0 | 2 | 66.70 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | B3 | sqlite_fts | 是 | 是 | — | 1 | 818 | 3.02 | 11a75748:200 ✓ | `183a56ed2df978208f5499d3f0089dd2fc7f14a80afb5ff5599670dece0038bc` | 是 |
| 开 | B4 | legacy_scan | 否 | 否 | — | 0 | 2 | 62.70 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | B4 | sqlite_fts | 否 | 否 | — | 8 | 8429 | 15.85 | — | `b2a5066a3295e61ee608e94443d7c40d5e4dbfa2be77821578e4c169afde61c4` | 是 |
| 开 | B5 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.85 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | B5 | sqlite_fts | 是 | 是 | — | 2 | 961 | 4.72 | 65ff23a3:28 ✓ | `c1c29473d224341ac41462b409863c9775fba024f9335ff5d3439f7cfb3ffe6d` | 是 |
| 开 | C1 | legacy_scan | 否 | 否 | — | 0 | 2 | 63.92 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | C1 | sqlite_fts | 是 | 是 | — | 1 | 1543 | 1.86 | a1000000:9 ✓ | `4bedf05425c95f89de18d4528be644e76bc2a996888b256856b3c5fdfa7c7596` | 是 |
| 开 | C2 | legacy_scan | 否 | 否 | — | 0 | 2 | 63.66 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | C2 | sqlite_fts | 是 | 是 | — | 1 | 2340 | 3.52 | a1000000:27045 ✓ | `80f8f8b25f570394372bc7a0222d039a92b281acf5dd21c8aeb20daf57101bac` | 是 |
| 开 | C3 | legacy_scan | 否 | 否 | — | 0 | 2 | 58.42 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | C3 | sqlite_fts | 是 | 是 | — | 1 | 926 | 2.82 | a1000000:54076 ✓ | `f0815eb9a29b83f793796940f61bd7a305e60fb1bfd135074d0ec97ba2c0f023` | 是 |
| 开 | C4 | legacy_scan | 否 | 否 | — | 0 | 2 | 62.31 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | C4 | sqlite_fts | 是 | 是 | — | 1 | 1563 | 1.95 | a1000000:9 ✓ | `f76b3bc274f35fedc15729882692d5d6683ae7d0a4a54cc317bd4b7e885c467b` | 是 |
| 开 | C5 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.55 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | C5 | sqlite_fts | 是 | 是 | — | 2 | 3421 | 4.43 | a1000000:27041 ✓ | `e382b1023d31bcd6b2f3a81b6a6478c28e2fc782e9fd54c242e0105b5c75b6c6` | 是 |
| 开 | D1 | legacy_scan | 是 | 是 | — | 6 | 7343 | 14.57 | c2d3ad29:7513、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | `28a6af87821c246e82dbc2a947466feca528c6092123b95583b12c823dec2c89` | 是 |
| 开 | D1 | sqlite_fts | 是 | 是 | — | 6 | 8033 | 16.55 | c2d3ad29:7513 ✓、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | `ae3b70f7d0e95dca944ebe4d65cb0213faedfe4d079f29e81bda13368da3a329` | 是 |
| 开 | D2 | legacy_scan | 是 | 是 | — | 6 | 5830 | 10.27 | ae902838:4688、ae902838:1182 ✓、bf77601d:9 ✓ | `366cbecb8f68aad6b733130eb3464b01b354b5497a5ad8c1dc86626a516d13c7` | 是 |
| 开 | D2 | sqlite_fts | 是 | 是 | — | 6 | 8482 | 16.41 | ae902838:4688 ✓、ae902838:1182 ✓、bf77601d:9 ✓ | `ea3fceb53f4243e28e7da127448f81d982193513e80ef422d89b00675ce80b71` | 是 |
| 开 | D3 | legacy_scan | 否 | 否 | — | 6 | 13386 | 35.55 | — | `60942d0c711aa9bdf5206f4f771cd6c866b12e13d7dfc9c8315dad60a5901590` | 是 |
| 开 | D3 | sqlite_fts | 是 | 是 | — | 6 | 11869 | 59.04 | 5a5a6dce:3275 ✓ | `cb47d7dfc3177e8337e33e9280a235c0cf561d057b9f0edf839845fbc69088da` | 是 |
| 开 | E1 | legacy_scan | — | — | 是 | 5 | 46808 | 69.88 | — | `a0b018d67e00a7c7270da9cd971f77ea536a45aa5c862824e155c31e35581073` | 是 |
| 开 | E1 | sqlite_fts | — | — | 是 | 1 | 781 | 5.78 | — | `c88f39c4c49eaac8cdae6202197b4aae5aec4385073f68193e97b4c3fc4baa70` | 是 |
| 开 | E2 | legacy_scan | — | — | 否 | 0 | 2 | 64.39 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | E2 | sqlite_fts | — | — | 否 | 0 | 2 | 1.55 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 开 | E3 | legacy_scan | — | — | 是 | 5 | 47568 | 72.31 | — | `a14404b478087d5c5172d2089bb1f13448431a36ae89f9e6aa9b186986a36b8b` | 是 |
| 开 | E3 | sqlite_fts | — | — | 是 | 8 | 9606 | 15.56 | — | `6ed8af6c550cf460f419bb01457f896f0a8c9f221b9adbb2dfe5a2e52f68ce2b` | 是 |
| 开 | E4 | legacy_scan | — | — | 是 | 2 | 45796 | 70.81 | — | `98a2d594496a189063888ef90f254bdb448da96f08a56ac3bee778c21183c69f` | 是 |
| 开 | E4 | sqlite_fts | — | — | 是 | 6 | 8909 | 17.27 | — | `bb3a325d4729c1ef1f505267c416aee5df07dcfd691a0470dd543f6a23bd574f` | 是 |
| 开 | E5 | legacy_scan | — | — | 是 | 5 | 41997 | 70.50 | — | `9e83930b637e96137b2683b647fe8a9899661866bfd4868e32c9b4fa7d460112` | 是 |
| 开 | E5 | sqlite_fts | — | — | 是 | 3 | 2811 | 6.71 | — | `74ad3883e866fbcf5de617e91971485855c24532a0bf18ff2540134bcc3d1fb6` | 是 |
| 关 | A1 | legacy_scan | 是 | 是 | — | 8 | 11451 | 67.66 | 1f23b4ca:313 ✓ | `6344d5ac956c042faafe636f7450f3aed4dd9820ef4fb795f7924c46cd2f5e8d` | 是 |
| 关 | A1 | sqlite_fts | 是 | 是 | — | 8 | 6709 | 8.58 | 1f23b4ca:313 ✓ | `8321d893f9b5b8729b74d7965d0dc170ba340aa39a103ab7922680d0b16c6793` | 是 |
| 关 | A2 | legacy_scan | 否 | 否 | — | 0 | 2 | 58.72 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | A2 | sqlite_fts | 是 | 是 | — | 8 | 8870 | 15.38 | ff5ad41c:59 ✓ | `72f0656e77b2d5b159c46b7579341f1410f2b6d2435260e442589ddc15465a32` | 是 |
| 关 | A3 | legacy_scan | 是 | 是 | — | 4 | 13448 | 64.33 | b688f860:84 ✓ | `78d76ef5753342933b34a5a20dc89273c41cdf6e45471230a3f86fd436c44edc` | 是 |
| 关 | A3 | sqlite_fts | 是 | 是 | — | 8 | 7887 | 11.50 | b688f860:84 ✓ | `c34076e24ed0c4d2d496f4ce1844963fc728bf3bf98eb13b23ffe6218ab998ec` | 是 |
| 关 | A4 | legacy_scan | 是 | 是 | — | 1 | 34577 | 54.34 | 5a5a6dce:89 ✓ | `299eb7dfe3420ae823d06c7629f7362e9a7f5f275cef38cf712b24589d1358b4` | 是 |
| 关 | A4 | sqlite_fts | 是 | 是 | — | 8 | 8504 | 15.11 | 5a5a6dce:89 ✓ | `05cfa0a7fe34c33789b7c4e5b855cbe48033dd6869cce9ec618b1618d7b4e53b` | 是 |
| 关 | A5 | legacy_scan | 否 | 否 | — | 0 | 2 | 59.39 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | A5 | sqlite_fts | 是 | 是 | — | 7 | 13067 | 9.10 | 0e28daa4:299 ✓ | `1f714aea0bf992b4a97c9d9a0156eb7d36001fd8f74543143174b5daf79599fc` | 是 |
| 关 | A6 | legacy_scan | 否 | 否 | — | 0 | 2 | 58.76 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | A6 | sqlite_fts | 是 | 是 | — | 8 | 8308 | 8.46 | d14984ee:119 ✓ | `59b1b03b100fec3ed82cb2406e41ca96ae0c3b7cb3609ad4783067498de5aad4` | 是 |
| 关 | A7 | legacy_scan | 否 | 否 | — | 0 | 2 | 56.11 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | A7 | sqlite_fts | 是 | 是 | — | 2 | 2012 | 3.65 | fca07c1e:288 ✓、f0bd276a:234 ✓ | `4ae98c173ebe0353b38be3ff96a2f61d15de3b4028527c14eb5201b136af3a58` | 是 |
| 关 | B1 | legacy_scan | 否 | 否 | — | 0 | 2 | 59.55 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | B1 | sqlite_fts | 是 | 是 | — | 2 | 1817 | 6.64 | 4ac48c25:32 ✓ | `71b5e88599e3fee4aa47ec15e124c958f6c807a50b1b29fc16317111fe921320` | 是 |
| 关 | B2 | legacy_scan | 否 | 否 | — | 0 | 2 | 59.05 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | B2 | sqlite_fts | 是 | 是 | — | 8 | 11702 | 9.06 | ddb2fdda:34 ✓ | `69c39e2ab1e8335d319093cbf9db4d70ab1d05c2416f817affed1ec1ae34f5da` | 是 |
| 关 | B3 | legacy_scan | 否 | 否 | — | 0 | 2 | 62.36 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | B3 | sqlite_fts | 是 | 是 | — | 1 | 818 | 4.49 | 11a75748:200 ✓ | `183a56ed2df978208f5499d3f0089dd2fc7f14a80afb5ff5599670dece0038bc` | 是 |
| 关 | B4 | legacy_scan | 否 | 否 | — | 0 | 2 | 63.67 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | B4 | sqlite_fts | 否 | 否 | — | 8 | 8429 | 13.29 | — | `b2a5066a3295e61ee608e94443d7c40d5e4dbfa2be77821578e4c169afde61c4` | 是 |
| 关 | B5 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.43 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | B5 | sqlite_fts | 是 | 是 | — | 2 | 961 | 3.85 | 65ff23a3:28 ✓ | `c1c29473d224341ac41462b409863c9775fba024f9335ff5d3439f7cfb3ffe6d` | 是 |
| 关 | C1 | legacy_scan | 否 | 否 | — | 0 | 2 | 62.30 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | C1 | sqlite_fts | 是 | 是 | — | 1 | 1543 | 2.33 | a1000000:9 ✓ | `4bedf05425c95f89de18d4528be644e76bc2a996888b256856b3c5fdfa7c7596` | 是 |
| 关 | C2 | legacy_scan | 否 | 否 | — | 0 | 2 | 66.57 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | C2 | sqlite_fts | 是 | 是 | — | 1 | 2340 | 3.00 | a1000000:27045 ✓ | `80f8f8b25f570394372bc7a0222d039a92b281acf5dd21c8aeb20daf57101bac` | 是 |
| 关 | C3 | legacy_scan | 否 | 否 | — | 0 | 2 | 59.99 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | C3 | sqlite_fts | 是 | 是 | — | 1 | 926 | 2.33 | a1000000:54076 ✓ | `f0815eb9a29b83f793796940f61bd7a305e60fb1bfd135074d0ec97ba2c0f023` | 是 |
| 关 | C4 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.95 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | C4 | sqlite_fts | 是 | 是 | — | 1 | 1563 | 1.59 | a1000000:9 ✓ | `f76b3bc274f35fedc15729882692d5d6683ae7d0a4a54cc317bd4b7e885c467b` | 是 |
| 关 | C5 | legacy_scan | 否 | 否 | — | 0 | 2 | 61.82 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | C5 | sqlite_fts | 是 | 是 | — | 2 | 3421 | 3.20 | a1000000:27041 ✓ | `e382b1023d31bcd6b2f3a81b6a6478c28e2fc782e9fd54c242e0105b5c75b6c6` | 是 |
| 关 | D1 | legacy_scan | 是 | 是 | — | 6 | 7343 | 16.05 | c2d3ad29:7513、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | `28a6af87821c246e82dbc2a947466feca528c6092123b95583b12c823dec2c89` | 是 |
| 关 | D1 | sqlite_fts | 是 | 是 | — | 4 | 6937 | 15.32 | c2d3ad29:7513 ✓、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | `b1adaf5610c7e16b91a7a225c376c274c2d9d87f2d4f6233d608400591b352e7` | 是 |
| 关 | D2 | legacy_scan | 是 | 是 | — | 6 | 5830 | 9.06 | ae902838:4688、ae902838:1182 ✓、bf77601d:9 ✓ | `366cbecb8f68aad6b733130eb3464b01b354b5497a5ad8c1dc86626a516d13c7` | 是 |
| 关 | D2 | sqlite_fts | 是 | 是 | — | 6 | 8482 | 16.21 | ae902838:4688 ✓、ae902838:1182 ✓、bf77601d:9 ✓ | `ea3fceb53f4243e28e7da127448f81d982193513e80ef422d89b00675ce80b71` | 是 |
| 关 | D3 | legacy_scan | 否 | 否 | — | 6 | 13386 | 39.26 | — | `60942d0c711aa9bdf5206f4f771cd6c866b12e13d7dfc9c8315dad60a5901590` | 是 |
| 关 | D3 | sqlite_fts | 是 | 是 | — | 6 | 11869 | 58.63 | 5a5a6dce:3275 ✓ | `cb47d7dfc3177e8337e33e9280a235c0cf561d057b9f0edf839845fbc69088da` | 是 |
| 关 | E1 | legacy_scan | — | — | 是 | 5 | 46808 | 66.29 | — | `a0b018d67e00a7c7270da9cd971f77ea536a45aa5c862824e155c31e35581073` | 是 |
| 关 | E1 | sqlite_fts | — | — | 是 | 1 | 781 | 3.90 | — | `c88f39c4c49eaac8cdae6202197b4aae5aec4385073f68193e97b4c3fc4baa70` | 是 |
| 关 | E2 | legacy_scan | — | — | 否 | 0 | 2 | 63.18 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | E2 | sqlite_fts | — | — | 否 | 0 | 2 | 1.61 | — | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 是 |
| 关 | E3 | legacy_scan | — | — | 是 | 5 | 47568 | 74.08 | — | `a14404b478087d5c5172d2089bb1f13448431a36ae89f9e6aa9b186986a36b8b` | 是 |
| 关 | E3 | sqlite_fts | — | — | 是 | 8 | 9606 | 18.22 | — | `6ed8af6c550cf460f419bb01457f896f0a8c9f221b9adbb2dfe5a2e52f68ce2b` | 是 |
| 关 | E4 | legacy_scan | — | — | 是 | 2 | 45796 | 69.67 | — | `98a2d594496a189063888ef90f254bdb448da96f08a56ac3bee778c21183c69f` | 是 |
| 关 | E4 | sqlite_fts | — | — | 是 | 6 | 8909 | 17.41 | — | `bb3a325d4729c1ef1f505267c416aee5df07dcfd691a0470dd543f6a23bd574f` | 是 |
| 关 | E5 | legacy_scan | — | — | 是 | 5 | 41997 | 70.53 | — | `9e83930b637e96137b2683b647fe8a9899661866bfd4868e32c9b4fa7d460112` | 是 |
| 关 | E5 | sqlite_fts | — | — | 是 | 3 | 2811 | 6.72 | — | `74ad3883e866fbcf5de617e91971485855c24532a0bf18ff2540134bcc3d1fb6` | 是 |

### FTS 长页逐字定位

经核对，下表位置和结论在 3-2 重跑与 3-3 的两种一跳设置中全部一致。

| 夹具尾号 | 章节 | UTF-16 正文坐标 | 逐字定位 |
| --- | --- | --- | --- |
| 1 | 交接准备 | 9–30 | 通过 |
| 1 | 测温处置 | 27045–27069 | 通过 |
| 1 | 到仓签收 | 54084–54105 | 通过 |
| 2 | 排班交接 | 9–28 | 通过 |
| 2 | 检查周期 | 27043–27061 | 通过 |
| 2 | 异常归档 | 54076–54094 | 通过 |
| 3 | 物料入场 | 9–26 | 通过 |
| 3 | 现场盘点 | 27041–27059 | 通过 |
| 3 | 撤场清单 | 54074–54093 | 通过 |
