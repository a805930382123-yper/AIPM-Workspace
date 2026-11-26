# Batch 1B 检索对照

本轮执行离线评测，跳过真实 Hybrid 语义评测。

SQLite 本轮 FTS 修复预期（B1 新增命中及定位，其余沿用 1A）核对通过。

Node v24.18.0，SQLite 3.53.2。评分输入共 95 篇正式 Wiki、9 份关联 Raw、3 篇合成长页。正式 Wiki 为 898 块，合成长页为 156 块。逐文件校验了冻结清单的 SHA-256。

- `evals/retrieval-baseline.json` SHA-256 `b8937bceae061acecfd28e91d5e03fd0187ac564e39ec76569991b22b0f68899`
- `evals/fixtures/batch-1a-long.ts` SHA-256 `d719119203b35e4403b90f84173939648d96ce61bc9592ac7a76402b0796bdbe`
- `scripts/run-retrieval-eval.ts` SHA-256 `39f49c9d1288fd7a15d7135ab2894985952ddeb32d460172ce1f7b96a68558fd`
- `scripts/retrieval-quality-gate.ts` SHA-256 `e5b6076b165a14953b967fec8f2a3118399c1a07bdb87de5509ec6954198ad7f`
- 1A 冻结评测器 SHA-256 `49c18fff8b8fddf2de8b25ea06c697be1057a2de88e62409de77713bfdf0dc59`，沿用其评分函数、题库、长页及 Prompt 入参。

- 实际送出的 Wiki 页，按调用方交付顺序。SQLite 同页多个块仍算一页。
- 前 K 页中任一金标准页实际送出完整逐字锚点即命中，金标准按正文 UTF-16 定位并校验 SHA-256。
- 命中后检查同一证据的标题路径。SQLite 检查已发送的定位标签及正文坐标。Legacy 检查已发送标题栈下的证据。
- E 类人工核定无答案，前 K 页有任一非空正文/块即为误召回。

A/B/C/E 计时至详细接口返回。D 计时从正式 Prompt 生成入口至进程内捕获 Provider 接收实际请求，包含选页核验、组装和序列化。P95 使用最近秩。所有已评分结果均核实实际引擎和未降级状态。

## Embedding 配置与开销

- 真实模型、维度、建向量耗时、Token 和 Query Embedding 网络延迟待验证。真实模型请求数为 0。

## 分类对照

| 类别 | 引擎 | Hit@8 | 章节定位 | E 类误召回 | 平均耗时 ms | P95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | legacy_scan | 3/7 (42.9%) | 3/7 (42.9%) | — | 169.26 | 186.18 |
| A | sqlite_fts | 7/7 (100.0%) | 7/7 (100.0%) | — | 23.82 | 33.01 |
| A | hybrid | 待验证 | 待验证 | 待验证 | — | — |
| B | legacy_scan | 0/5 (0.0%) | 0/5 (0.0%) | — | 196.12 | 227.74 |
| B | sqlite_fts | 4/5 (80.0%) | 4/5 (80.0%) | — | 18.50 | 31.70 |
| B | hybrid | 待验证 | 待验证 | 待验证 | — | — |
| C | legacy_scan | 0/5 (0.0%) | 0/5 (0.0%) | — | 159.42 | 212.40 |
| C | sqlite_fts | 5/5 (100.0%) | 5/5 (100.0%) | — | 5.41 | 8.64 |
| C | hybrid | 待验证 | 待验证 | 待验证 | — | — |
| D | legacy_scan | 2/3 (66.7%) | 2/3 (66.7%) | — | 59.94 | 115.24 |
| D | sqlite_fts | 3/3 (100.0%) | 3/3 (100.0%) | — | 75.03 | 145.08 |
| D | hybrid | 待验证 | 待验证 | 待验证 | — | — |
| E | legacy_scan | — | — | 4/5 (80.0%) | 184.19 | 214.58 |
| E | sqlite_fts | — | — | 4/5 (80.0%) | 18.05 | 36.04 |
| E | hybrid | 待验证 | 待验证 | 待验证 | — | — |

## 逐题对照

| 题号 | 引擎 | 命中 | 定位 | 误召回 | 页数 | JSON 字符 | 耗时 ms | 命中证据 | 送出上下文 SHA-256 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| A1 | legacy_scan | 是 | 是 | — | 8 | 11451 | 157.59 | 1f23b4ca:313 ✓ | 6344d5ac956c042faafe636f7450f3aed4dd9820ef4fb795f7924c46cd2f5e8d |
| A1 | sqlite_fts | 是 | 是 | — | 8 | 6709 | 21.32 | 1f23b4ca:313 ✓ | 8321d893f9b5b8729b74d7965d0dc170ba340aa39a103ab7922680d0b16c6793 |
| A1 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| A2 | legacy_scan | 否 | 否 | — | 0 | 2 | 173.95 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A2 | sqlite_fts | 是 | 是 | — | 8 | 8870 | 30.05 | ff5ad41c:59 ✓ | 72f0656e77b2d5b159c46b7579341f1410f2b6d2435260e442589ddc15465a32 |
| A2 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| A3 | legacy_scan | 是 | 是 | — | 4 | 13448 | 186.18 | b688f860:84 ✓ | 78d76ef5753342933b34a5a20dc89273c41cdf6e45471230a3f86fd436c44edc |
| A3 | sqlite_fts | 是 | 是 | — | 8 | 7887 | 22.08 | b688f860:84 ✓ | c34076e24ed0c4d2d496f4ce1844963fc728bf3bf98eb13b23ffe6218ab998ec |
| A3 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| A4 | legacy_scan | 是 | 是 | — | 1 | 34577 | 165.25 | 5a5a6dce:89 ✓ | 299eb7dfe3420ae823d06c7629f7362e9a7f5f275cef38cf712b24589d1358b4 |
| A4 | sqlite_fts | 是 | 是 | — | 8 | 8504 | 33.01 | 5a5a6dce:89 ✓ | 05cfa0a7fe34c33789b7c4e5b855cbe48033dd6869cce9ec618b1618d7b4e53b |
| A4 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| A5 | legacy_scan | 否 | 否 | — | 0 | 2 | 162.36 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A5 | sqlite_fts | 是 | 是 | — | 7 | 13067 | 23.37 | 0e28daa4:299 ✓ | 1f714aea0bf992b4a97c9d9a0156eb7d36001fd8f74543143174b5daf79599fc |
| A5 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| A6 | legacy_scan | 否 | 否 | — | 0 | 2 | 175.83 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A6 | sqlite_fts | 是 | 是 | — | 8 | 8308 | 26.21 | d14984ee:119 ✓ | 59b1b03b100fec3ed82cb2406e41ca96ae0c3b7cb3609ad4783067498de5aad4 |
| A6 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| A7 | legacy_scan | 否 | 否 | — | 0 | 2 | 163.66 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| A7 | sqlite_fts | 是 | 是 | — | 2 | 2012 | 10.72 | fca07c1e:288 ✓、f0bd276a:234 ✓ | 4ae98c173ebe0353b38be3ff96a2f61d15de3b4028527c14eb5201b136af3a58 |
| A7 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| B1 | legacy_scan | 否 | 否 | — | 0 | 2 | 179.05 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B1 | sqlite_fts | 是 | 是 | — | 2 | 1817 | 16.89 | 4ac48c25:32 ✓ | 71b5e88599e3fee4aa47ec15e124c958f6c807a50b1b29fc16317111fe921320 |
| B1 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| B2 | legacy_scan | 否 | 否 | — | 0 | 2 | 213.65 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B2 | sqlite_fts | 是 | 是 | — | 8 | 11702 | 26.93 | ddb2fdda:34 ✓ | 69c39e2ab1e8335d319093cbf9db4d70ab1d05c2416f817affed1ec1ae34f5da |
| B2 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| B3 | legacy_scan | 否 | 否 | — | 0 | 2 | 227.74 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B3 | sqlite_fts | 是 | 是 | — | 1 | 818 | 8.89 | 11a75748:200 ✓ | 183a56ed2df978208f5499d3f0089dd2fc7f14a80afb5ff5599670dece0038bc |
| B3 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| B4 | legacy_scan | 否 | 否 | — | 0 | 2 | 213.57 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B4 | sqlite_fts | 否 | 否 | — | 8 | 8429 | 31.70 | — | b2a5066a3295e61ee608e94443d7c40d5e4dbfa2be77821578e4c169afde61c4 |
| B4 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| B5 | legacy_scan | 否 | 否 | — | 0 | 2 | 146.58 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| B5 | sqlite_fts | 是 | 是 | — | 2 | 961 | 8.08 | 65ff23a3:28 ✓ | c1c29473d224341ac41462b409863c9775fba024f9335ff5d3439f7cfb3ffe6d |
| B5 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| C1 | legacy_scan | 否 | 否 | — | 0 | 2 | 128.75 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C1 | sqlite_fts | 是 | 是 | — | 1 | 1543 | 3.22 | a1000000:9 ✓ | 4bedf05425c95f89de18d4528be644e76bc2a996888b256856b3c5fdfa7c7596 |
| C1 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| C2 | legacy_scan | 否 | 否 | — | 0 | 2 | 126.91 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C2 | sqlite_fts | 是 | 是 | — | 1 | 2340 | 5.41 | a1000000:27045 ✓ | 80f8f8b25f570394372bc7a0222d039a92b281acf5dd21c8aeb20daf57101bac |
| C2 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| C3 | legacy_scan | 否 | 否 | — | 0 | 2 | 137.37 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C3 | sqlite_fts | 是 | 是 | — | 1 | 926 | 5.54 | a1000000:54076 ✓ | f0815eb9a29b83f793796940f61bd7a305e60fb1bfd135074d0ec97ba2c0f023 |
| C3 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| C4 | legacy_scan | 否 | 否 | — | 0 | 2 | 191.66 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C4 | sqlite_fts | 是 | 是 | — | 1 | 1563 | 4.23 | a1000000:9 ✓ | f76b3bc274f35fedc15729882692d5d6683ae7d0a4a54cc317bd4b7e885c467b |
| C4 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| C5 | legacy_scan | 否 | 否 | — | 0 | 2 | 212.40 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| C5 | sqlite_fts | 是 | 是 | — | 2 | 3421 | 8.64 | a1000000:27041 ✓ | e382b1023d31bcd6b2f3a81b6a6478c28e2fc782e9fd54c242e0105b5c75b6c6 |
| C5 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| D1 | legacy_scan | 是 | 是 | — | 6 | 7343 | 37.79 | c2d3ad29:7513、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | 28a6af87821c246e82dbc2a947466feca528c6092123b95583b12c823dec2c89 |
| D1 | sqlite_fts | 是 | 是 | — | 4 | 6937 | 41.28 | c2d3ad29:7513 ✓、c2d3ad29:1986 ✓、f3b1c6ee:305 ✓ | b1adaf5610c7e16b91a7a225c376c274c2d9d87f2d4f6233d608400591b352e7 |
| D1 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| D2 | legacy_scan | 是 | 是 | — | 6 | 5830 | 26.77 | ae902838:4688、ae902838:1182 ✓、bf77601d:9 ✓ | 366cbecb8f68aad6b733130eb3464b01b354b5497a5ad8c1dc86626a516d13c7 |
| D2 | sqlite_fts | 是 | 是 | — | 6 | 8482 | 38.73 | ae902838:4688 ✓、ae902838:1182 ✓、bf77601d:9 ✓ | ea3fceb53f4243e28e7da127448f81d982193513e80ef422d89b00675ce80b71 |
| D2 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| D3 | legacy_scan | 否 | 否 | — | 6 | 13386 | 115.24 | — | 60942d0c711aa9bdf5206f4f771cd6c866b12e13d7dfc9c8315dad60a5901590 |
| D3 | sqlite_fts | 是 | 是 | — | 6 | 11869 | 145.08 | 5a5a6dce:3275 ✓ | cb47d7dfc3177e8337e33e9280a235c0cf561d057b9f0edf839845fbc69088da |
| D3 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| E1 | legacy_scan | — | — | 是 | 5 | 46808 | 214.58 | — | a0b018d67e00a7c7270da9cd971f77ea536a45aa5c862824e155c31e35581073 |
| E1 | sqlite_fts | — | — | 是 | 1 | 781 | 7.79 | — | c88f39c4c49eaac8cdae6202197b4aae5aec4385073f68193e97b4c3fc4baa70 |
| E1 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| E2 | legacy_scan | — | — | 否 | 0 | 2 | 194.54 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E2 | sqlite_fts | — | — | 否 | 0 | 2 | 3.78 | — | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| E2 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| E3 | legacy_scan | — | — | 是 | 5 | 47568 | 168.69 | — | a14404b478087d5c5172d2089bb1f13448431a36ae89f9e6aa9b186986a36b8b |
| E3 | sqlite_fts | — | — | 是 | 8 | 9606 | 36.04 | — | 6ed8af6c550cf460f419bb01457f896f0a8c9f221b9adbb2dfe5a2e52f68ce2b |
| E3 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| E4 | legacy_scan | — | — | 是 | 2 | 45796 | 180.00 | — | 98a2d594496a189063888ef90f254bdb448da96f08a56ac3bee778c21183c69f |
| E4 | sqlite_fts | — | — | 是 | 6 | 8909 | 28.43 | — | bb3a325d4729c1ef1f505267c416aee5df07dcfd691a0470dd543f6a23bd574f |
| E4 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |
| E5 | legacy_scan | — | — | 是 | 5 | 41997 | 163.15 | — | 9e83930b637e96137b2683b647fe8a9899661866bfd4868e32c9b4fa7d460112 |
| E5 | sqlite_fts | — | — | 是 | 3 | 2811 | 14.20 | — | 74ad3883e866fbcf5de617e91971485855c24532a0bf18ff2540134bcc3d1fb6 |
| E5 | hybrid | 待验证 | 待验证 | 待验证 | — | — | — | — | — |

## Prompt 字符预算

六个选页及顺序在题库固定。Legacy 按摘录字符计量，SQLite 和 Hybrid 按实际 Wiki JSON 计量。逐题表同时列出送出的 JSON 字符数。

| 题号 | Legacy 摘录字符 | SQLite JSON 字符 | Hybrid JSON 字符 |
| --- | ---: | ---: | ---: |
| D1 | 6012 | 6937 | 待验证 |
| D2 | 4496 | 8482 | 待验证 |
| D3 | 12000 | 11869 | 待验证 |

## 长页和逐字引用

三篇合成 Wiki 正文均超过 48,000 字符。SQLite 九点定位 9/9。Hybrid 待验证。已发送块核对章节、原文切片和生产引文检查。

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

真实 Hybrid 纯向量出块及逐字引文待验证。

## 1A 的 B 类漏题复查

| 题号 | SQLite | Hybrid 结果 | ftsRank | vectorRank | 阈值前向量排名 | vectorScore | hitSource |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| B1 | 命中 | 待验证 | — | — | — | — | — |
| B4 | 漏检 | 待验证 | — | — | — | — | — |

## E 类负样本和阈值

产品默认最低余弦为 0.42。实际阈值校准待验证。最高余弦取自阈值和 RRF 灰区裁切之前的允许范围。

| 题号 | SQLite 误召回 | 阈值前最高余弦 | Hybrid 误召回 |
| --- | --- | ---: | --- |
| E1 | 是 | — | 待验证 |
| E2 | 否 | — | 待验证 |
| E3 | 是 | — | 待验证 |
| E4 | 是 | — | 待验证 |
| E5 | 是 | — | 待验证 |

## Top-30 至最终预算

分母为 A–D 中任一路 Top-30 含完整金标准锚点的题数，向量路应用本轮最低余弦阈值。分子为融合后仍有该锚点、实际发出的前 8 页却未包含它的题数。仅被最低阈值或融合灰区裁切的题目计入各自原因。

待真实 Hybrid 评测后计算，重排序判断待验证。
