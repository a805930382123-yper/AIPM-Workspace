# PDF01 R2 有证据主题写作施工交接

revision 5 从已完成的同源同 Provider revision 4 复用清理、索引与片段。新范围走清理、索引、主题写作。旧版检查点仍可读，显式升级后保留旧字节。写作输出的主题和单元键必须与本批一致。服务端根据逐单元归属反算事实段的来源，检查显式量值、单位、正负、预测与口径。表格、原推断及待核问题沿现有渲染。纯元数据和宣传可带理由留在台账，纯噪声主题不生成候选。正式确认继续沿现有成果审核。

## 验证

- `node --import tsx --test --test-concurrency=2 tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts tests/openai-structured.test.ts`，44/45。唯一失败来自 HTTP 测试的裸数字否定断言误匹配随机 Raw UUID。按完整事实短语限定断言后，`node --import tsx --test --test-name-pattern='one PDF unit' tests/pdf02-http.test.ts` 通过 1/1，产品字节不变。独立专项 20/20。测试覆盖 strict 键、跨主题/空证据、数字与符号单位改动、合法万量换算、纯噪声无候选、取消迟到、旧版升级只写作、人工编辑与隔离正式确认。
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts`，退出 0。Vite 空 TEMP envDir 隔离构建退出 0，233 模块，有既有 JS 包体提示。
- 原日志位于 `%TEMP%/pdf-consolidation-27980514a066413f9364c7b782150534/` 的 `rev5-combined-final.txt`、`rev5-http-targeted-final.txt`、`rev5-tsc.txt`、`rev5-build.txt`。范围外全仓测试未运行。

最终实测使用冻结 R1 与 revision 4 数据。25 个含事实主题共 181 项，7 个写作包大小为 7,277、3,460、3,265、2,894、6,441、6,509、321 字节。5 条原推断和 2 条问题留在本地，另一个题只有这类材料。工具本机 fake 七批通过并生成隔离草稿。[真实执行](PDF01-REAL-SYNTHESIS-V5-20261112-execution.md)

| 文件 | SHA-256 |
| --- | --- |
| `services/raw/pdf-cleanup.ts` | `a4a8944e1bc1effad0b957e7cb81efddbfa6abc6b282923b93b120431c2f79b1` |
| `services/raw/pdf-topic-writing.ts` | `a18090d6aa309d86a057e6a4affdbc4764a9a9ae38726e1d5b59ad69528f0958` |
| `services/wiki/render.ts` | `0d3acb4ac429379d18bcb93bf0bb69516c4d132231820e0a3ee8f049b2ba14cd` |
| `tests/pdf-cleanup-structured.test.ts` | `680177783bf0f2f911e19bc792bb35e67e13c1e4204b5cf2264f4d330701eba0` |
| `tests/pdf02-http.test.ts` | `ceed35fca07b83868359a32e0775c30e13c895ee062fdea055351752f5503707` |

## 第 43 次章节号校验修复

真实第 43 次响应的唯一差异是缺少被提取为业务数量的章节号 `1.1`。修复只在同题输入存在显式章节引用、且另一个输入行的编号和标题均匹配时忽略该结构编号。带量值单位的小数继续校验。现有主题写作请求、响应合同和来源数据保持一致。

`node --import tsx --test tests/pdf-cleanup-structured.test.ts` 通过 21/21。范围严格类型检查退出 0。使用本地响应拦截将原响应逐字通过生产 Provider 适配器和完整写作校验，生成的请求 SHA 与第 43 次实际 HTTP 请求一致。接受的响应和待持久对象 SHA 均为 `163a14c9cafe4b20f73d10087da07ff193e15c9c795ddbd04f26376236e83caa`，覆盖 4 题、21 项。重新校验已保存第 42 批后 SHA 仍为 `8f9e8f8de9584250fa9294ae898ae443f660a1dc683ee7039cf38c9fe98e0a17`。日志 `rev5-chapter-targeted.txt`、`rev5-chapter-tsc.txt`、`rev5-replay43-offline.txt` 在上述系统 TEMP 目录。工程阶段实际调用 0。

修复版 `services/raw/pdf-topic-writing.ts` SHA 为 `4e1cbe512b1d25c85494459aaf8ef747be560226ef61e6559b80f0cb4146cfd1`，`tests/pdf-cleanup-structured.test.ts` SHA 为 `59f69dee50ad5c8e9b4ffd430adc94245560ae4039cae213fafe1d9e3ae89e53`。本机 fake 在克隆中保留第 42 次结果，原样回放第 43 次，再模拟第 44–48 次写作并生成隔离草稿，真实配置和账本保持原样。

## 第 44 次标题与时代上下文修复

第 44 次实际结果的差异都在同一主题。两份同页的标题因排版差异未被识别为同一个编号标题。切分后的两个段落分别引用同一父单元的后续维度，原先的校验没有看到前导时代。修复在同页跨来源标题与索引名一致时识别编号。连续同父同题的分号段可继承明确的时代与维度关系，输出出现不同或未绑定的时代会拒绝。原始片段和请求保持一致。

`node --import tsx --test tests/pdf-cleanup-structured.test.ts` 通过 22/22，范围严格类型检查退出 0。第 42、43、44 次原响应逐字经生产适配器和完整写作校验，三个请求 SHA 均匹配真实账本。第 42、43 次持久结果原 SHA 相同，第 44 次原响应和接受结果 SHA 同为 `d49e15f6ad47d7cf290a4a7abae7a3984743d0e7c3a940fb42a7d1323471074b`。日志 `rev5-era-targeted.txt`、`rev5-era-tsc.txt`、`rev5-replay44-offline.txt` 在上述 TEMP 目录。

最终 writer SHA `cec4d9dd86b01abfcaab922a83ce077041d392b3b7dc34e4cdd0866fa0e7f033`，专项 SHA `f6ba89612f6d34a344c01500913c296e93e42bfc175e5419debfff4ce9234eb4`。本机 fake 保留两批，原样回放第 44 次并模拟第 45–48 次后生成隔离草稿。

## 第 45 和 46 次版面识别修复

第 45 次五个独立题头被元数据边界拒绝。修订后，简短同名主题标签、明确章节标题、与主题对应的“关于”标签和独立字段名可附理由留在台账。带数量或实质断言的句子继续校验。第 46 次 PDF 解析把页码粘到指标释义末尾。校验仅在同页 R1 明确有对应页码且同一段另有同页完整释义佐证时，从数量比较中移除该尾随整数。实际请求和响应内容保持一致，现有原件、Raw、R1、片段与证据均保留。

第 45 次修复后专项 23/23，第 46 次修复后 24/24。两次范围严格类型检查均退出 0。第 42–46 次原响应逐字经同一真实请求 SHA 的生产适配器和完整校验，前四批接受对象与已存批 SHA 相同，第 46 次响应与接受对象 SHA 同为 `fc80690cab7abe63430b1b0cd1dafba815ca03dc9946eabae1cd8f752c34a7e3`。缺同页标签、跨页、异释义和实际带单位尾值均有拒绝反例。日志 `rev5-metadata-targeted.txt`、`rev5-footer-targeted.txt`、`rev5-footer-tsc.txt`、`rev5-replay46-offline.txt` 在上述 TEMP 目录。

最终 cleanup SHA `a29b254d62c6ee80fa3726f5440542df277ef43e370184f23941d3a2f281f9cf`，writer SHA `00dd0d613d173e1389af9328c34f697783ca2b97544c3cae92c953d9867ea24c`，专项 SHA `908db454974d073a747128e139e9eb08525ce6233a198a391d5908432b3fb586`。最终本机 fake 保留四批，原样回放第 46 次并模拟第 47–48 次，生成隔离草稿。真实配置读取和请求均为 0。

## 第 47 次形式归一化

表格的独立列名可以保留在元数据台账。校验识别同一城市线级区间的中阿数字写法，且只在有明确人员样本证据时将 `N=` 与人数对照。仅当同一事实段引用同页紧邻原始行时，在比较阶段接合断开的美元单位。写作请求和原文均保持原样。“平均收入以上”与“高于平均收入”的措辞差异记录给独立质量评分，代码保持数量关系符语义。

专项 25/25，范围严格类型检查退出 0。第 42–47 次全部原样经生产适配器和完整校验。第 47 次接受对象与原响应 SHA 同为 `9a7ee19a7fd9af3478919582b3ce3a0750f95f57d5a639040dca6bf75fe37a39`，前五批已存摘要不变。日志 `rev5-forms-targeted.txt`、`rev5-forms-tsc.txt`、`rev5-replay47-offline-final.txt` 在上述 TEMP 目录。一次本机 fake 保留五批并回放第 47 次后，仅模拟一次第 48 次就生成隔离草稿。

最终 cleanup SHA `4295da5e04d968c6cec0add1c3fcc1a8b23190efb9a96e6852f9fd95e7dc2a7d`，writer SHA `a3c8153e3258312adf04f666d590d9b3b7d708f5c910b8b046a273c9c0a2035e`，专项 SHA `1b67b726781a1f964c9c0798eb942cf9feb186f8a398d21823310c331498cc0a`。
