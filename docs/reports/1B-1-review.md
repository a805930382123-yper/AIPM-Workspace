# LLM-Wiki 1B-1 独立验收

**本轮结论：返修。** 冻结实现的向量生成、持久化和正式写入定向回归通过。普通 HTTP 回归测试可继承宿主的向量服务配置并发送测试资料，隔离门禁未通过。**整个 Batch 1B 尚未通过**，后续混合检索、回滚、性能与质量评测仍待验证。

## 验收版本与证据

基线 `87b59691b25a899c76c654c64bf8d7bbf6bbe649`，本次验收对象为其上的未提交冻结差异。使用 `Get-FileHash` 实测六份文件，按施工报告顺序的 SHA-256 与报告逐项相同：

| 文件 | SHA-256 |
| --- | --- |
| server/index.ts | eea20556f245eb3eabf2e266980805170e2a4456abfd02d088bcbf2998279f2f |
| services/search/embedding-provider.ts | 871d81c46941a91fc100300cec0466426624bb3a43f63e38426d3afa8ae16480 |
| services/search/embedding-backfill.ts | 44811faca5a5f4e8dc0a9d4ece0a3427fedd0ea0b2e12e3c3d6ddcf9e4d97098 |
| services/search/indexer.ts | acb64abea95fe77ea3adb9913f3daa0af0f78390645ee24701fc41aa27d7a130 |
| services/search/sqlite-store.ts | 70c84fa2b7b6dca3555ada090e32472ba66e9e89b672a8aac7b57ec757e133a8 |
| tests/search-embeddings.test.ts | 4aafea59ae4be477eeaecca8db2702aeec3ee67fa3fa3ca347a27c606a64340b |

用 Node v24.18.0 运行 `node --import tsx --test tests/search-embeddings.test.ts tests/search-runtime.test.ts tests/search-sqlite-index.test.ts tests/search-chunking.test.ts`，33/33，通过，耗时 7.26 秒。测试使用临时目录、缺失配置路径与合成资料。全仓 1,107/1,107 是施工者记录，本轮独立复跑以上 33 项。

- 核对冻结 1A 报告，FTS 命中 A–D 分别为 7/7、3/5、5/5、3/3，B1/B4 漏检，E 误召回 4/5。
- 回环请求覆盖批量、逆序、凭据绑定、无效向量、重试上限及查询超时。生产启动入口在隔离主配置下处理存量页与正式新增页。
- 来源链测试在实际收包端只见允许的一个块，缺失、会议和派生受限来源三个块仍待补算。逐次 HTTP 发送前在 Wiki 锁内重验文件快照及来源授权，锁释放后等待响应。
- 挂起 HTTP 时正式新增、修改、删除与确认均能完成。确认旧响应未写回已删除或修订的块，模型变更、端点变更、实际维度、子视图 BLOB 和内容复用断言通过。补算失败后 FTS 仍可检索，手工重试恢复。

## P1 测试宿主的向量配置进入产品子进程

独立 Node 回环探针先剔除原环境的主模型与向量变量，设临时数据目录和不存在的主配置文件，再给父测试进程三个合成变量：模型 `review-offline`、假 Key 与仅监听随机本机端口的 OpenAI 兼容端点。父测试运行：

```sh
node --import tsx --test --test-name-pattern="E04-01 HTTP" tests/llm-http.test.ts
```

子测试报告 1/1 通过、退出码 0；独立 HTTP 服务计数 `inheritedEmbeddingRequests=1`。期望 0。`tests/llm-http.test.ts:57` 只移除主模型配置，测试创建普通 Wiki 后，实际服务器自动补算。用户若已为工作台配置远程向量服务，同一路径将发送合成页面并可能计费。本次全部流量仅到回环。新嵌入专项测试已有自己的环境清理，但常规测试命令仍会运行这些既有测试。

返修范围为实际启动产品服务的测试环境边界。清除继承的向量配置，仅由嵌入测试显式提供其本地端点。复验应在父环境注入上述合成配置，确认普通测试仍通过且监听器收到零次请求，再确认显式回环向量用例仍正常收包。

## R1 独立复验

**原 P1 已关闭；1B-1 独立定向验收通过。** 在与原探针相同的父环境中，保留假 Key、模型及独立回环监听器，同时运行普通 E04-01 与显式配置的产品启动测试：

```sh
node --import tsx --test --test-name-pattern="E04-01 HTTP|server enables startup" tests/llm-http.test.ts tests/search-embeddings.test.ts
```

结果 2/2 通过，14.35 秒。原失败路径的父监听器请求数从 1 降到 0；显式配置的用例仍在自己的回环服务上收到启动存量与增量页面请求，并验证版本写入。核查普通 harness 在子进程创建边界按大小写无关的前缀剔除向量变量；`rg -l --fixed-strings 'server/index.ts' tests` 命中项中，其余引用为注释、文档文案和基于已有 harness 的脚本生成器。该扫描属于静态检查，历史浏览器验收脚本未逐个执行。

基线提交仍为 `87b59691b25a899c76c654c64bf8d7bbf6bbe649`。本轮 `Get-FileHash` 实测共享测试环境函数 SHA-256 为 `9c5fbf82545641ff21a6ffaf330afd5e65346dd233c579f441562b36c439d336`，普通 HTTP 用例为 `17bf624b1378e30fcb4d8b3169653931848a9d6a8113b3b2cb6ebd9a01ae8ebc`，向量专项用例为 `91d6a4eb87191058b733633d6df9428ff2fc561ed304a217b390e8b309b950e9`。前节产品冻结指纹继续适用。返修后的全仓污染环境哨兵运行由施工者独立记录。本轮对应 Step 0–2；整个 Batch 1B 仍待后续阶段。
