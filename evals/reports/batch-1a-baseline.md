# Batch 1A 检索对照快照

Node v24.18.0，SQLite 3.53.2。冻结语料包含 95 篇原始正式 Wiki、9 份关联 Raw 和 3 篇合成长页。

- `evals/retrieval-baseline.json` SHA-256 `b8937bceae061acecfd28e91d5e03fd0187ac564e39ec76569991b22b0f68899`
- `evals/fixtures/batch-1a-long.ts` SHA-256 `d719119203b35e4403b90f84173939648d96ce61bc9592ac7a76402b0796bdbe`
- `scripts/run-retrieval-eval.ts` SHA-256 `49c18fff8b8fddf2de8b25ea06c697be1057a2de88e62409de77713bfdf0dc59`

- 实际送出的 Wiki 页，按调用方交付顺序。SQLite 同页多个块仍算一页。
- 前 K 页中任一金标准页实际送出完整逐字锚点即命中，金标准按正文 UTF-16 定位并校验 SHA-256。
- 命中后检查同一证据的标题路径。SQLite 检查已发送的定位标签及正文坐标。Legacy 检查已发送标题栈下的证据。
- E 类人工核定无答案，前 K 页有任一非空正文/块即为误召回。

A/B/C/E 计时至详细接口返回。D 计时从正式 Prompt 生成入口至进程内模拟 Provider 接收实际请求，包含选页核验、组装和序列化。P95 使用最近秩。两路均核实引擎且没有发生降级，真实模型请求为零。

## 分类对照

| 类别 | 引擎 | Hit@8 | 章节定位 | E 类误召回 | 平均耗时 ms | P95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | legacy_scan | 3/7 (42.9%) | 3/7 (42.9%) | — | 67.36 | 73.50 |
| A | sqlite_fts | 7/7 (100.0%) | 7/7 (100.0%) | — | 18.56 | 26.84 |
| B | legacy_scan | 0/5 (0.0%) | 0/5 (0.0%) | — | 66.88 | 69.37 |
| B | sqlite_fts | 3/5 (60.0%) | 3/5 (60.0%) | — | 10.87 | 24.14 |
| C | legacy_scan | 0/5 (0.0%) | 0/5 (0.0%) | — | 64.74 | 71.11 |
| C | sqlite_fts | 5/5 (100.0%) | 5/5 (100.0%) | — | 3.49 | 5.62 |
| D | legacy_scan | 2/3 (66.7%) | 2/3 (66.7%) | — | 11.00 | 19.18 |
| D | sqlite_fts | 3/3 (100.0%) | 3/3 (100.0%) | — | 29.12 | 51.23 |
| E | legacy_scan | — | — | 4/5 (80.0%) | 81.04 | 95.01 |
| E | sqlite_fts | — | — | 4/5 (80.0%) | 14.17 | 29.88 |

A/C/D 命中数变化分别为 4、5、1，E 误召回次数变化为 0。

## 逐题对照

| 题号 | 引擎 | 命中 | 定位 | 误召回 | 页数 | JSON 字符 | 耗时 ms | 命中证据 | 送出上下文 SHA-256 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| A1 | legacy_scan | 是 | 是 | — | 8 | 11451 | 73.50 | 1f23b4ca:313 ✓ | 6344d5ac956c042faafe636f7450f3aed4dd9820ef4fb795f7924c46cd2f5e8d |
| A1 | sqlite_fts | 是 | 是 | — | 8 | 6709 | 18.92 | 1f23b4ca:313 ✓ | 8321d893f9b5b8729b74d7965d0dc170ba340aa39a103ab7922680d0b16c6793 |
| A2 | legacy_scan | 否 | 否 | — | 0 | 2 | 68.38 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A2 | sqlite_fts | 是 | 是 | — | 8 | 8870 | 26.84 | ff5ad41c:59 ✓ | 72f0656e77b2d5b159c46b7579341f1410f2b6d2435260e442589ddc15465a32 |
| A3 | legacy_scan | 是 | 是 | — | 4 | 13448 | 68.80 | b688f860:84 ✓ | 78d76ef5753342933b34a5a20dc89273c41cdf6e45471230a3f86fd436c44edc |
| A3 | sqlite_fts | 是 | 是 | — | 8 | 7887 | 19.21 | b688f860:84 ✓ | c34076e24ed0c4d2d496f4ce1844963fc728bf3bf98eb13b23ffe6218ab998ec |
| A4 | legacy_scan | 是 | 是 | — | 1 | 34577 | 65.86 | 5a5a6dce:89 ✓ | 299eb7dfe3420ae823d06c7629f7362e9a7f5f275cef38cf712b24589d1358b4 |
| A4 | sqlite_fts | 是 | 是 | — | 8 | 8504 | 25.47 | 5a5a6dce:89 ✓ | 05cfa0a7fe34c33789b7c4e5b855cbe48033dd6869cce9ec618b1618d7b4e53b |
| A5 | legacy_scan | 否 | 否 | — | 0 | 2 | 63.80 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A5 | sqlite_fts | 是 | 是 | — | 7 | 13067 | 14.85 | 0e28daa4:299 ✓ | 1f714aea0bf992b4a97c9d9a0156eb7d36001fd8f74543143174b5daf79599fc |
| A6 | legacy_scan | 否 | 否 | — | 0 | 2 | 67.27 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A6 | sqlite_fts | 是 | 是 | — | 8 | 8308 | 17.65 | d14984ee:119 ✓ | 59b1b03b100fec3ed82cb2406e41ca96ae0c3b7cb3609ad4783067498de5aad4 |
| A7 | legacy_scan | 否 | 否 | — | 0 | 2 | 63.93 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A7 | sqlite_fts | 是 | 是 | — | 2 | 2012 | 6.99 | fca07c1e:288 ✓、f0bd276a:234 ✓ | 4ae98c173ebe0353b38be3ff96a2f61d15de3b4028527c14eb5201b136af3a58 |
| B1 | legacy_scan | 否 | 否 | — | 0 | 2 | 67.28 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B1 | sqlite_fts | 否 | 否 | — | 0 | 2 | 2.82 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B2 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.13 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B2 | sqlite_fts | 是 | 是 | — | 8 | 11702 | 17.54 | ddb2fdda:34 ✓ | 69c39e2ab1e8335d319093cbf9db4d70ab1d05c2416f817affed1ec1ae34f5da |
| B3 | legacy_scan | 否 | 否 | — | 0 | 2 | 66.02 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B3 | sqlite_fts | 是 | 是 | — | 1 | 818 | 4.48 | 11a75748:200 ✓ | 183a56ed2df978208f5499d3f0089dd2fc7f14a80afb5ff5599670dece0038bc |
| B4 | legacy_scan | 否 | 否 | — | 0 | 2 | 67.57 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B4 | sqlite_fts | 否 | 否 | — | 8 | 8429 | 24.14 | — | b2a5066a3295e61ee608e94443d7c40d5e4dbfa2be77821578e4c169afde61c4 |
| B5 | legacy_scan | 否 | 否 | — | 0 | 2 | 69.37 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B5 | sqlite_fts | 是 | 是 | — | 2 | 961 | 5.37 | 65ff23a3:28 ✓ | c1c29473d224341ac41462b409863c9775fba024f9335ff5d3439f7cfb3ffe6d |
| C1 | legacy_scan | 否 | 否 | — | 0 | 2 | 71.11 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C1 | sqlite_fts | 是 | 是 | — | 1 | 1543 | 2.49 | a1000000:9 ✓ | 4bedf05425c95f89de18d4528be644e76bc2a996888b256856b3c5fdfa7c7596 |
| C2 | legacy_scan | 否 | 否 | — | 0 | 2 | 64.65 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C2 | sqlite_fts | 是 | 是 | — | 1 | 2340 | 2.93 | a1000000:27045 ✓ | 80f8f8b25f570394372bc7a0222d039a92b281acf5dd21c8aeb20daf57101bac |
| C3 | legacy_scan | 否 | 否 | — | 0 | 2 | 62.46 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C3 | sqlite_fts | 是 | 是 | — | 1 | 926 | 3.89 | a1000000:54076 ✓ | f0815eb9a29b83f793796940f61bd7a305e60fb1bfd135074d0ec97ba2c0f023 |
| C4 | legacy_scan | 否 | 否 | — | 0 | 2 | 62.37 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C4 | sqlite_fts | 是 | 是 | — | 1 | 1563 | 2.53 | a1000000:9 ✓ | f76b3bc274f35fedc15729882692d5d6683ae7d0a4a54cc317bd4b7e885c467b |
| C5 | legacy_scan | 否 | 否 | — | 0 | 2 | 63.10 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C5 | sqlite_fts | 是 | 是 | — | 2 | 3421 | 5.62 | a1000000:27041 ✓ | e382b1023d31bcd6b2f3a81b6a6478c28e2fc782e9fd54c242e0105b5c75b6c6 |
| D1 | legacy_scan | 是 | 是 | — | 6 | 7343 | 9.43 | c2d3ad29:7513、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | 28a6af87821c246e82dbc2a947466feca528c6092123b95583b12c823dec2c89 |
| D1 | sqlite_fts | 是 | 是 | — | 4 | 6937 | 16.72 | c2d3ad29:7513 ✓、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | b1adaf5610c7e16b91a7a225c376c274c2d9d87f2d4f6233d608400591b352e7 |
| D2 | legacy_scan | 是 | 是 | — | 6 | 5830 | 4.40 | ae902838:4688、ae902838:1182 ✓、bf77601d:9 ✓ | 366cbecb8f68aad6b733130eb3464b01b354b5497a5ad8c1dc86626a516d13c7 |
| D2 | sqlite_fts | 是 | 是 | — | 6 | 8482 | 19.41 | ae902838:4688 ✓、ae902838:1182 ✓、bf77601d:9 ✓ | ea3fceb53f4243e28e7da127448f81d982193513e80ef422d89b00675ce80b71 |
| D3 | legacy_scan | 否 | 否 | — | 6 | 13386 | 19.18 | — | 60942d0c711aa9bdf5206f4f771cd6c866b12e13d7dfc9c8315dad60a5901590 |
| D3 | sqlite_fts | 是 | 是 | — | 6 | 11869 | 51.23 | 5a5a6dce:3275 ✓ | cb47d7dfc3177e8337e33e9280a235c0cf561d057b9f0edf839845fbc69088da |
| E1 | legacy_scan | — | — | 是 | 5 | 46808 | 77.60 | — | a0b018d67e00a7c7270da9cd971f77ea536a45aa5c862824e155c31e35581073 |
| E1 | sqlite_fts | — | — | 是 | 1 | 781 | 5.40 | — | c88f39c4c49eaac8cdae6202197b4aae5aec4385073f68193e97b4c3fc4baa70 |
| E2 | legacy_scan | — | — | 否 | 0 | 2 | 62.69 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E2 | sqlite_fts | — | — | 否 | 0 | 2 | 1.63 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E3 | legacy_scan | — | — | 是 | 5 | 47568 | 75.59 | — | a14404b478087d5c5172d2089bb1f13448431a36ae89f9e6aa9b186986a36b8b |
| E3 | sqlite_fts | — | — | 是 | 8 | 9606 | 29.88 | — | 6ed8af6c550cf460f419bb01457f896f0a8c9f221b9adbb2dfe5a2e52f68ce2b |
| E4 | legacy_scan | — | — | 是 | 2 | 45796 | 95.01 | — | 98a2d594496a189063888ef90f254bdb448da96f08a56ac3bee778c21183c69f |
| E4 | sqlite_fts | — | — | 是 | 6 | 8909 | 23.38 | — | bb3a325d4729c1ef1f505267c416aee5df07dcfd691a0470dd543f6a23bd574f |
| E5 | legacy_scan | — | — | 是 | 5 | 41997 | 94.32 | — | 9e83930b637e96137b2683b647fe8a9899661866bfd4868e32c9b4fa7d460112 |
| E5 | sqlite_fts | — | — | 是 | 3 | 2811 | 10.57 | — | 74ad3883e866fbcf5de617e91971485855c24532a0bf18ff2540134bcc3d1fb6 |

## Prompt 字符预算

六个选页及顺序在题库固定。Legacy 按摘录字符计量，SQLite 按实际 Wiki JSON 计量；逐题表同时列出两路的实际 JSON 字符数。

| 题号 | Legacy 摘录字符 | SQLite JSON 字符 |
| --- | ---: | ---: |
| D1 | 6012 | 6937 |
| D2 | 4496 | 8482 |
| D3 | 12000 | 11869 |

## 长页定位 9/9

三篇合成 Wiki 正文均超过 48,000 字符。每个位置核对已发送块的章节、原文切片和生产引文检查。

| 夹具尾号 | 标题路径 | 正文 UTF-16 坐标 | 逐字定位 |
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

## B 类 SQLite 漏检

- B1 CVS 通常多大，多长时间营业？
- B4 闪电仓常规下单后多久送到？
