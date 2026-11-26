# Batch 1B 检索对照

真实 Hybrid 质量门槛未通过。

SQLite 冻结基线核对通过。
- Hybrid B 类命中低于 4/5。

Node v24.18.0，SQLite 3.53.2。评分输入共 95 篇正式 Wiki、9 份关联 Raw、3 篇合成长页。正式 Wiki 为 898 块，合成长页为 156 块。逐文件校验了冻结清单的 SHA-256。

- `evals/retrieval-baseline.json` SHA-256 `b8937bceae061acecfd28e91d5e03fd0187ac564e39ec76569991b22b0f68899`
- `evals/fixtures/batch-1a-long.ts` SHA-256 `d719119203b35e4403b90f84173939648d96ce61bc9592ac7a76402b0796bdbe`
- `scripts/run-retrieval-eval.ts` SHA-256 `185d9a6325635761964cefb169f66cef6793bb4a114af16206846aa811a0c895`
- `scripts/retrieval-quality-gate.ts` SHA-256 `59e6cbb3b3823fae3cdd9f15e4b2cf4ab30060d9c0b4e5abd02fa19ccf3f91e5`
- 1A 冻结评测器 SHA-256 `49c18fff8b8fddf2de8b25ea06c697be1057a2de88e62409de77713bfdf0dc59`，沿用其评分函数、题库、长页及 Prompt 入参。

- 实际送出的 Wiki 页，按调用方交付顺序。SQLite 同页多个块仍算一页。
- 前 K 页中任一金标准页实际送出完整逐字锚点即命中，金标准按正文 UTF-16 定位并校验 SHA-256。
- 命中后检查同一证据的标题路径。SQLite 检查已发送的定位标签及正文坐标。Legacy 检查已发送标题栈下的证据。
- E 类人工核定无答案，前 K 页有任一非空正文/块即为误召回。

A/B/C/E 计时至详细接口返回。D 计时从正式 Prompt 生成入口至进程内捕获 Provider 接收实际请求，包含选页核验、组装和序列化。P95 使用最近秩。所有已评分结果均核实实际引擎和未降级状态。

## Embedding 配置与开销

- 模型 `text-embedding-3-small`，实际维度 1536。正式语料全量补算 22325.49 ms，供方返回 Token 合计 138854，发出 29 次请求。
- 合成长页补算 5296.58 ms，供方返回 Token 合计 203454，发出 5 次请求。
- 25 问及 9 个长页定位共 34 次成功 Query Embedding，供方返回 Token 合计 689。从发送至响应解码及归一化的平均/P95 为 349.39/876.50 ms。

## 分类对照

| 类别 | 引擎 | Hit@8 | 章节定位 | E 类误召回 | 平均耗时 ms | P95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | legacy_scan | 3/7 (42.9%) | 3/7 (42.9%) | — | 86.12 | 95.60 |
| A | sqlite_fts | 7/7 (100.0%) | 7/7 (100.0%) | — | 15.59 | 26.74 |
| A | hybrid | 7/7 (100.0%) | 7/7 (100.0%) | — | 222.12 | 258.95 |
| B | legacy_scan | 0/5 (0.0%) | 0/5 (0.0%) | — | 85.03 | 87.51 |
| B | sqlite_fts | 3/5 (60.0%) | 3/5 (60.0%) | — | 8.64 | 19.64 |
| B | hybrid | 3/5 (60.0%) | 3/5 (60.0%) | — | 531.41 | 1020.69 |
| C | legacy_scan | 0/5 (0.0%) | 0/5 (0.0%) | — | 84.43 | 85.60 |
| C | sqlite_fts | 5/5 (100.0%) | 5/5 (100.0%) | — | 3.48 | 5.90 |
| C | hybrid | 5/5 (100.0%) | 5/5 (100.0%) | — | 347.48 | 388.12 |
| D | legacy_scan | 2/3 (66.7%) | 2/3 (66.7%) | — | 36.47 | 62.03 |
| D | sqlite_fts | 3/3 (100.0%) | 3/3 (100.0%) | — | 44.88 | 89.60 |
| D | hybrid | 3/3 (100.0%) | 3/3 (100.0%) | — | 450.31 | 606.17 |
| E | legacy_scan | — | — | 4/5 (80.0%) | 102.96 | 110.32 |
| E | sqlite_fts | — | — | 4/5 (80.0%) | 11.36 | 20.29 |
| E | hybrid | — | — | 4/5 (80.0%) | 504.62 | 899.64 |

## 逐题对照

| 题号 | 引擎 | 命中 | 定位 | 误召回 | 页数 | JSON 字符 | 耗时 ms | 命中证据 | 送出上下文 SHA-256 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| A1 | legacy_scan | 是 | 是 | — | 8 | 11451 | 95.60 | 1f23b4ca:313 ✓ | 6344d5ac956c042faafe636f7450f3aed4dd9820ef4fb795f7924c46cd2f5e8d |
| A1 | sqlite_fts | 是 | 是 | — | 8 | 6709 | 26.74 | 1f23b4ca:313 ✓ | 8321d893f9b5b8729b74d7965d0dc170ba340aa39a103ab7922680d0b16c6793 |
| A1 | hybrid | 是 | 是 | — | 8 | 7166 | 235.49 | 1f23b4ca:313 ✓ | ab7789603d91de836aa8041142cd1fe642ced3d54fef0bac1796249e2b07f01c |
| A2 | legacy_scan | 否 | 否 | — | 0 | 2 | 79.55 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A2 | sqlite_fts | 是 | 是 | — | 8 | 8870 | 19.20 | ff5ad41c:59 ✓ | 72f0656e77b2d5b159c46b7579341f1410f2b6d2435260e442589ddc15465a32 |
| A2 | hybrid | 是 | 是 | — | 8 | 9185 | 233.23 | ff5ad41c:59 ✓ | 30d19b9ebb287dd4e4ee21d1a8df6355dac9d24baa91d18e5cd9bc7bb22e8d6d |
| A3 | legacy_scan | 是 | 是 | — | 4 | 13448 | 90.67 | b688f860:84 ✓ | 78d76ef5753342933b34a5a20dc89273c41cdf6e45471230a3f86fd436c44edc |
| A3 | sqlite_fts | 是 | 是 | — | 8 | 7887 | 12.81 | b688f860:84 ✓ | c34076e24ed0c4d2d496f4ce1844963fc728bf3bf98eb13b23ffe6218ab998ec |
| A3 | hybrid | 是 | 是 | — | 8 | 7499 | 233.99 | b688f860:84 ✓ | 8447ec195da2b250ab54654580e98043be3b64d6cbdcda9dac47b66675919e64 |
| A4 | legacy_scan | 是 | 是 | — | 1 | 34577 | 83.56 | 5a5a6dce:89 ✓ | 299eb7dfe3420ae823d06c7629f7362e9a7f5f275cef38cf712b24589d1358b4 |
| A4 | sqlite_fts | 是 | 是 | — | 8 | 8504 | 22.27 | 5a5a6dce:89 ✓ | 05cfa0a7fe34c33789b7c4e5b855cbe48033dd6869cce9ec618b1618d7b4e53b |
| A4 | hybrid | 是 | 是 | — | 8 | 8504 | 258.95 | 5a5a6dce:89 ✓ | 05cfa0a7fe34c33789b7c4e5b855cbe48033dd6869cce9ec618b1618d7b4e53b |
| A5 | legacy_scan | 否 | 否 | — | 0 | 2 | 83.44 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A5 | sqlite_fts | 是 | 是 | — | 7 | 13067 | 11.85 | 0e28daa4:299 ✓ | 1f714aea0bf992b4a97c9d9a0156eb7d36001fd8f74543143174b5daf79599fc |
| A5 | hybrid | 是 | 是 | — | 7 | 13067 | 196.72 | 0e28daa4:299 ✓ | 1f714aea0bf992b4a97c9d9a0156eb7d36001fd8f74543143174b5daf79599fc |
| A6 | legacy_scan | 否 | 否 | — | 0 | 2 | 81.82 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A6 | sqlite_fts | 是 | 是 | — | 8 | 8308 | 10.63 | d14984ee:119 ✓ | 59b1b03b100fec3ed82cb2406e41ca96ae0c3b7cb3609ad4783067498de5aad4 |
| A6 | hybrid | 是 | 是 | — | 8 | 8308 | 197.91 | d14984ee:119 ✓ | 59b1b03b100fec3ed82cb2406e41ca96ae0c3b7cb3609ad4783067498de5aad4 |
| A7 | legacy_scan | 否 | 否 | — | 0 | 2 | 88.22 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A7 | sqlite_fts | 是 | 是 | — | 2 | 2012 | 5.59 | fca07c1e:288 ✓、f0bd276a:234 ✓ | 4ae98c173ebe0353b38be3ff96a2f61d15de3b4028527c14eb5201b136af3a58 |
| A7 | hybrid | 是 | 是 | — | 2 | 2012 | 198.54 | fca07c1e:288 ✓、f0bd276a:234 ✓ | 4ae98c173ebe0353b38be3ff96a2f61d15de3b4028527c14eb5201b136af3a58 |
| B1 | legacy_scan | 否 | 否 | — | 0 | 2 | 79.72 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B1 | sqlite_fts | 否 | 否 | — | 0 | 2 | 2.08 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B1 | hybrid | 否 | 否 | — | 0 | 2 | 807.62 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B2 | legacy_scan | 否 | 否 | — | 0 | 2 | 85.35 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B2 | sqlite_fts | 是 | 是 | — | 8 | 11702 | 10.56 | ddb2fdda:34 ✓ | 69c39e2ab1e8335d319093cbf9db4d70ab1d05c2416f817affed1ec1ae34f5da |
| B2 | hybrid | 是 | 是 | — | 8 | 11702 | 182.91 | ddb2fdda:34 ✓ | 6c3f7eee0acf8a6ebfbe687076f144396bfd3a5dec47e86b31d28ed233788184 |
| B3 | legacy_scan | 否 | 否 | — | 0 | 2 | 86.53 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B3 | sqlite_fts | 是 | 是 | — | 1 | 818 | 4.46 | 11a75748:200 ✓ | 183a56ed2df978208f5499d3f0089dd2fc7f14a80afb5ff5599670dece0038bc |
| B3 | hybrid | 是 | 是 | — | 1 | 818 | 193.64 | 11a75748:200 ✓ | 183a56ed2df978208f5499d3f0089dd2fc7f14a80afb5ff5599670dece0038bc |
| B4 | legacy_scan | 否 | 否 | — | 0 | 2 | 87.51 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B4 | sqlite_fts | 否 | 否 | — | 8 | 8429 | 19.64 | — | b2a5066a3295e61ee608e94443d7c40d5e4dbfa2be77821578e4c169afde61c4 |
| B4 | hybrid | 否 | 否 | — | 8 | 8429 | 1020.69 | — | b2a5066a3295e61ee608e94443d7c40d5e4dbfa2be77821578e4c169afde61c4 |
| B5 | legacy_scan | 否 | 否 | — | 0 | 2 | 86.04 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B5 | sqlite_fts | 是 | 是 | — | 2 | 961 | 6.46 | 65ff23a3:28 ✓ | c1c29473d224341ac41462b409863c9775fba024f9335ff5d3439f7cfb3ffe6d |
| B5 | hybrid | 是 | 是 | — | 6 | 5929 | 452.17 | 65ff23a3:28 ✓ | cb163e37c06d30e1dc77854a28a3709affbe90e9fb82e5658a449646f1b58294 |
| C1 | legacy_scan | 否 | 否 | — | 0 | 2 | 85.45 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C1 | sqlite_fts | 是 | 是 | — | 1 | 1543 | 2.78 | a1000000:9 ✓ | 4bedf05425c95f89de18d4528be644e76bc2a996888b256856b3c5fdfa7c7596 |
| C1 | hybrid | 是 | 是 | — | 1 | 1543 | 366.02 | a1000000:9 ✓ | 4bedf05425c95f89de18d4528be644e76bc2a996888b256856b3c5fdfa7c7596 |
| C2 | legacy_scan | 否 | 否 | — | 0 | 2 | 85.60 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C2 | sqlite_fts | 是 | 是 | — | 1 | 2340 | 3.32 | a1000000:27045 ✓ | 80f8f8b25f570394372bc7a0222d039a92b281acf5dd21c8aeb20daf57101bac |
| C2 | hybrid | 是 | 是 | — | 1 | 2340 | 338.32 | a1000000:27045 ✓ | 80f8f8b25f570394372bc7a0222d039a92b281acf5dd21c8aeb20daf57101bac |
| C3 | legacy_scan | 否 | 否 | — | 0 | 2 | 85.04 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C3 | sqlite_fts | 是 | 是 | — | 1 | 926 | 3.00 | a1000000:54076 ✓ | f0815eb9a29b83f793796940f61bd7a305e60fb1bfd135074d0ec97ba2c0f023 |
| C3 | hybrid | 是 | 是 | — | 1 | 926 | 315.28 | a1000000:54076 ✓ | f0815eb9a29b83f793796940f61bd7a305e60fb1bfd135074d0ec97ba2c0f023 |
| C4 | legacy_scan | 否 | 否 | — | 0 | 2 | 82.27 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C4 | sqlite_fts | 是 | 是 | — | 1 | 1563 | 2.40 | a1000000:9 ✓ | f76b3bc274f35fedc15729882692d5d6683ae7d0a4a54cc317bd4b7e885c467b |
| C4 | hybrid | 是 | 是 | — | 1 | 1563 | 329.63 | a1000000:9 ✓ | f76b3bc274f35fedc15729882692d5d6683ae7d0a4a54cc317bd4b7e885c467b |
| C5 | legacy_scan | 否 | 否 | — | 0 | 2 | 83.81 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C5 | sqlite_fts | 是 | 是 | — | 2 | 3421 | 5.90 | a1000000:27041 ✓ | e382b1023d31bcd6b2f3a81b6a6478c28e2fc782e9fd54c242e0105b5c75b6c6 |
| C5 | hybrid | 是 | 是 | — | 2 | 3421 | 388.12 | a1000000:27041 ✓ | e382b1023d31bcd6b2f3a81b6a6478c28e2fc782e9fd54c242e0105b5c75b6c6 |
| D1 | legacy_scan | 是 | 是 | — | 6 | 7343 | 30.36 | c2d3ad29:7513、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | 28a6af87821c246e82dbc2a947466feca528c6092123b95583b12c823dec2c89 |
| D1 | sqlite_fts | 是 | 是 | — | 4 | 6937 | 20.42 | c2d3ad29:7513 ✓、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | b1adaf5610c7e16b91a7a225c376c274c2d9d87f2d4f6233d608400591b352e7 |
| D1 | hybrid | 是 | 是 | — | 5 | 6822 | 373.26 | f3b1c6ee:305 ✓ | fec51627b19376370da0a6e31e1ce2c29d84e2ccfda090156bc884622ed24f43 |
| D2 | legacy_scan | 是 | 是 | — | 6 | 5830 | 17.02 | ae902838:4688、ae902838:1182 ✓、bf77601d:9 ✓ | 366cbecb8f68aad6b733130eb3464b01b354b5497a5ad8c1dc86626a516d13c7 |
| D2 | sqlite_fts | 是 | 是 | — | 6 | 8482 | 24.61 | ae902838:4688 ✓、ae902838:1182 ✓、bf77601d:9 ✓ | ea3fceb53f4243e28e7da127448f81d982193513e80ef422d89b00675ce80b71 |
| D2 | hybrid | 是 | 是 | — | 6 | 8476 | 371.51 | ae902838:4688 ✓、ae902838:1182 ✓、bf77601d:9 ✓ | 2826716332f772219aa48e5beed22a152fef53472fb101e2b9b7a17f92cc8085 |
| D3 | legacy_scan | 否 | 否 | — | 6 | 13386 | 62.03 | — | 60942d0c711aa9bdf5206f4f771cd6c866b12e13d7dfc9c8315dad60a5901590 |
| D3 | sqlite_fts | 是 | 是 | — | 6 | 11869 | 89.60 | 5a5a6dce:3275 ✓ | cb47d7dfc3177e8337e33e9280a235c0cf561d057b9f0edf839845fbc69088da |
| D3 | hybrid | 是 | 是 | — | 5 | 11857 | 606.17 | 5a5a6dce:3275 ✓ | 0dc00d5b41df001b9e76c0c0b39b10737551a7652f51d29b75ad5bad7a7fba43 |
| E1 | legacy_scan | — | — | 是 | 5 | 46808 | 110.32 | — | a0b018d67e00a7c7270da9cd971f77ea536a45aa5c862824e155c31e35581073 |
| E1 | sqlite_fts | — | — | 是 | 1 | 781 | 5.25 | — | c88f39c4c49eaac8cdae6202197b4aae5aec4385073f68193e97b4c3fc4baa70 |
| E1 | hybrid | — | — | 是 | 1 | 781 | 318.39 | — | c88f39c4c49eaac8cdae6202197b4aae5aec4385073f68193e97b4c3fc4baa70 |
| E2 | legacy_scan | — | — | 否 | 0 | 2 | 109.10 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E2 | sqlite_fts | — | — | 否 | 0 | 2 | 1.97 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E2 | hybrid | — | — | 否 | 0 | 2 | 299.56 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E3 | legacy_scan | — | — | 是 | 5 | 47568 | 100.69 | — | a14404b478087d5c5172d2089bb1f13448431a36ae89f9e6aa9b186986a36b8b |
| E3 | sqlite_fts | — | — | 是 | 8 | 9606 | 20.29 | — | 6ed8af6c550cf460f419bb01457f896f0a8c9f221b9adbb2dfe5a2e52f68ce2b |
| E3 | hybrid | — | — | 是 | 8 | 9403 | 899.64 | — | bfe38a3112ce80eb0c181f7ba2629ae648ec27b439e024c2ddf44fb2f73e7ac2 |
| E4 | legacy_scan | — | — | 是 | 2 | 45796 | 95.80 | — | 98a2d594496a189063888ef90f254bdb448da96f08a56ac3bee778c21183c69f |
| E4 | sqlite_fts | — | — | 是 | 6 | 8909 | 20.20 | — | bb3a325d4729c1ef1f505267c416aee5df07dcfd691a0470dd543f6a23bd574f |
| E4 | hybrid | — | — | 是 | 7 | 9655 | 602.30 | — | 3558da04268bd1284a55e9fa73b19a660596a23756e4363d14f10bc66a572dc1 |
| E5 | legacy_scan | — | — | 是 | 5 | 41997 | 98.91 | — | 9e83930b637e96137b2683b647fe8a9899661866bfd4868e32c9b4fa7d460112 |
| E5 | sqlite_fts | — | — | 是 | 3 | 2811 | 9.09 | — | 74ad3883e866fbcf5de617e91971485855c24532a0bf18ff2540134bcc3d1fb6 |
| E5 | hybrid | — | — | 是 | 3 | 2811 | 403.20 | — | 74ad3883e866fbcf5de617e91971485855c24532a0bf18ff2540134bcc3d1fb6 |

## Prompt 字符预算

六个选页及顺序在题库固定。Legacy 按摘录字符计量，SQLite 和 Hybrid 按实际 Wiki JSON 计量。逐题表同时列出送出的 JSON 字符数。

| 题号 | Legacy 摘录字符 | SQLite JSON 字符 | Hybrid JSON 字符 |
| --- | ---: | ---: | ---: |
| D1 | 6012 | 6937 | 6822 |
| D2 | 4496 | 8482 | 8476 |
| D3 | 12000 | 11869 | 11857 |

## 长页和逐字引用

三篇合成 Wiki 正文均超过 48,000 字符。SQLite 九点定位 9/9。Hybrid 9/9。已发送块核对章节、原文切片和生产引文检查。

| 引擎 | 夹具尾号 | 标题路径 | 正文 UTF-16 坐标 | 逐字定位 |
| --- | --- | --- | --- | --- |
| sqlite_fts | 1 | 交接准备 | 9–30 | 通过 |
| sqlite_fts | 1 | 测温处置 | 27045–27069 | 通过 |
| sqlite_fts | 1 | 到仓签收 | 54084–54105 | 通过 |
| sqlite_fts | 2 | 排班交接 | 9–28 | 通过 |
| sqlite_fts | 2 | 检查周期 | 27043–27061 | 通过 |
| sqlite_fts | 2 | 异常归档 | 54076–54094 | 通过 |
| sqlite_fts | 3 | 物料入场 | 9–26 | 通过 |
| sqlite_fts | 3 | 现场盘点 | 27041–27059 | 通过 |
| sqlite_fts | 3 | 撤场清单 | 54074–54093 | 通过 |
| hybrid | 1 | 交接准备 | 9–30 | 通过 |
| hybrid | 1 | 测温处置 | 27045–27069 | 通过 |
| hybrid | 1 | 到仓签收 | 54084–54105 | 通过 |
| hybrid | 2 | 排班交接 | 9–28 | 通过 |
| hybrid | 2 | 检查周期 | 27043–27061 | 通过 |
| hybrid | 2 | 异常归档 | 54076–54094 | 通过 |
| hybrid | 3 | 物料入场 | 9–26 | 通过 |
| hybrid | 3 | 现场盘点 | 27041–27059 | 通过 |
| hybrid | 3 | 撤场清单 | 54074–54093 | 通过 |

实际发出的纯向量块逐字核验 20/20。

## B 类漏题

| 题号 | SQLite | Hybrid 结果 | ftsRank | vectorRank | 阈值前向量排名 | vectorScore | hitSource |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| B1 | 漏检 | RRF 前灰区裁切 | — | 2 | 2 | 0.420069 | — |
| B4 | 漏检 | 最低阈值裁切 | — | — | 8 | 0.315833 | — |

## E 类负样本和阈值

产品默认最低余弦为 0.42。实际阈值为 0.42。最高余弦取自阈值和 RRF 灰区裁切之前的允许范围。

| 题号 | SQLite 误召回 | 阈值前最高余弦 | Hybrid 误召回 |
| --- | --- | ---: | --- |
| E1 | 是 | 0.453368 | 是 |
| E2 | 否 | 0.474995 | 否 |
| E3 | 是 | 0.490212 | 是 |
| E4 | 是 | 0.490170 | 是 |
| E5 | 是 | 0.495596 | 是 |

1A 冻结误召回门槛为 4/5。本轮 Hybrid 4/5，满足。

## Top-30 至最终预算

分母为 A–D 中任一路 Top-30 含完整金标准锚点的题数，向量路应用本轮最低余弦阈值。分子为融合后仍有该锚点、实际发出的前 8 页却未包含它的题数。仅被最低阈值或融合灰区裁切的题目计入各自原因。

- Top-30 命中 19/20，融合灰区漏失 B1。
- 最终预算漏失 无，占比 0/19 (0.0%)。
- 按本次 20% 判据，RRF 已足够，无需引入重排序模型。
