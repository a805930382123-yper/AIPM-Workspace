# RAWOCR02 施工报告

2026-11-23，按 [RAWOCR02 任务卡](../handoffs/RAWOCR02-task.md) 执行。基线 `f2962bb41e5c16b3aecde8c751f3f2c155662e3f`，Windows Node `v24.18.0`。施工自查通过，独立验收及项目全量门禁由协调者另行记录。

## 本轮实现

- 服务提供单图、批量精读和只读解析入口。同一 `mediaId` 的在途解析共用请求，所有解析入口共用三路并发限制。显式调用可重试失败项或以 `force` 重读，普通读取及已完成图片重复操作无 VLM 调用。结果保存在原有图片产物存储，API 投影去掉 `ocrRawText`。
- 精读使用已校验的本地原图，长边超 2048 像素时等比缩至 1800。请求包含标题和图标记前后各最多 250 个 Unicode 字符。网关支持时用原生严格 JSON Schema，拒绝该格式时降为 JSON object，仍用同一份严格结构校验。通常使用温度 0.1 和 `max_tokens: 1536`，官方推理模型走默认温度和 `max_completion_tokens`，兼容网关明确拒绝这两个参数时分别调整。单次超时 45 秒，瞬时错误及非法结构各至多重试一次，产物留存脱敏尝试代码。熔断、装饰或清洗后空正文均清除展示文本。
- 草稿标准和深度入口先补解析 `needs_vlm`，按图片位置使用 `ocrCleanText` 或精读摘要与正文。虚拟输入以边界分隔正文、图片和提示标识，正文引文映射回原 UTF-16 区间，图片引文保存位置 ID、图序和解析文本 SHA-256。续跑校验已绑定的图片输入，确认写入重新核验被引用图文。问答原有 `needsRaw` 补读也使用同一文本选择规则，图片只作为读到的独立引用目标。
- 历史转录过滤限定为现有 `webImages` 来源标记紧邻的完整转录块。正文偏移变化时可定位唯一实际标记，未绑定图片的代码示例仍是正文。原图、原正文和 Raw 正文修订仍沿用既有存储。第三轮导入及详情交互、第四轮历史迁移留待后续授权。

## 自查证据

数据与配置位于系统临时 `aipm-*` 目录。各进程清除继承的 `FMCG_LLM_*`，HTTP 进程用回环模拟 Provider 和临时端口。真实 Provider 调用为 0。

| 实际命令 | 结果 |
| --- | --- |
| `node --import tsx tests/acceptance/rawocr02-http.mjs` | 实际服务入口通过；28 次模拟请求，图片最大在途 3。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr02.test.ts tests/lw01-deep.test.ts tests/rawux01-http.test.ts tests/lw02-main.test.ts` | 最终版本 14/14 通过。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr02.test.ts tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/kb02-planning-context.test.ts tests/kb02-storage-recovery.test.ts tests/kb02-human-review.test.ts tests/lw02-main.test.ts tests/lw03-http.test.ts tests/provider-knowledge-reasoning.test.ts tests/rawux01-http.test.ts tests/pdf01-http.test.ts` | 扩展回归 90/90 通过，包含存量检查点、问答、知识确认及 PDF 请求。 |
| `npm.cmd run typecheck` | 退出码 0。 |
| `node_modules/.bin/prettier.cmd --check <改动的 TypeScript 文件>` | 通过。 |
| `node_modules/.bin/eslint.cmd <改动的 TypeScript 文件>` | 0 错误，54 项告警。新投影的对象解构丢弃字段触发 1 项未使用变量告警，其余位于已有逻辑。 |

实际 HTTP 对比了 2400×1200 本地 JPEG 与送模后 1800×900 图片，原件逐字节一致。五图批量包含限流、非法 JSON、严格 Schema 拒绝、额外字段、已完成、装饰及空围栏，逐图重读状态与尝试代码。强制重读产生一次请求，已完成普通重复、已完成指定批量及 GET 均未增加请求。

草稿故意在事实检查点落盘后使规划失败，解析变化时续跑返回 409；恢复原解析后沿用原作业及已完成事实分块，续跑不重复图片请求。图前、图后引用可逐字切回 Raw，OCR 和 VLM 引用各自绑定具体图片。失败项及旧内嵌 OCR 的哨兵未出现在模拟 Provider 请求。用户确认前 Wiki 为空，被引用图片重读变化后确认返回 409，恢复原解析后确认成功且正式页面保留图片解析链接。Raw 文件字节、SHA-256 与修订值一致。问答补读使用只有图片解析含有的检索词，能读取与返回图文引用；用 Raw 正文 ID 冒充图片引用时得到 `ANSWER_CITATION_INVALID`，补读未发图片请求。深度整理通过实际草稿入口生成结构化笔记及图片引用。

## 交接指纹

28 个产品和测试文件的聚合 SHA-256 为 `3b467003666a362fb50240da291d45fefe8aa0f89ce41d22c159ca779f2dcc39`。按路径区分大小写排序，每行排列为小写文件 SHA-256、两个空格、仓库相对路径，以 UTF-8 LF 拼接并保留末尾 LF 后计算聚合值。主要文件如下。

| 文件 | SHA-256 |
| --- | --- |
| `server/raw-media.ts` | `83e5e9a189f534d818a5031ca8a26e94c466f2be97eb4e111096cfa28ec7599d` |
| `services/raw/media-context.ts` | `3ab733660e4ee35da32bc2b6a2a4594084e627adf97aed515a05bfbf898f2c56` |
| `services/raw/media-vlm.ts` | `1d2f401c134a42b55a3cead13d9bc7c58b492bdc2ae7693cbe600efe24ab8ffd` |
| `services/llm/jobs.ts` | `b743bd67e841e8f9c03ca2fe57b4c849dcf89f82730e60d8310af6e6080cb78d` |
| `services/llm/knowledge-answers.ts` | `79f64f6ab68ddf239124c0c33c9edf6a51402658b5d9ca1205b0017bca09224d` |
| `tests/rawocr02.test.ts` | `093af7835963c410b6012e9d08d2db31a839ca1a15a218989bf97d42d0cead2c` |
| `tests/acceptance/rawocr02-http.mjs` | `4ae3496583870d9abff1201c33e9b66a56f3248163d2ce591b68dc21491b02b8` |

## 人工正文编辑返修

返修基线 `1682a2be3fc7c3747562597686d42055be91e967`。先将两条独立验收反例加入实际 HTTP 夹具。基线上，一条经 PATCH 改写标记后仍将旧转录发给相邻图片的精读，另一条在 PATCH 删除全部图片标记后仍把旧图作为草稿证据。两项在同次运行明确失败。

返修将两项判断分开。旧转录归属以 Raw 当前采集版本或已保存的采集版快照为依据，用户改写或单删图片标记后，遗留的实际转录继续隔离。当前正文中只有唯一、有效的图片标记可绑定解析产物，支持行内位置和 ` · 标签` 改名。围栏及行内代码中的示例保留，重复标记不绑定。孤立产物仍保留在本机，原图仍可读取。该图片不再进入单图、批量和草稿自动精读，也不会成为新草稿或问答补读证据，现有图片解析引文链接返回 409。

| 实际命令 | 结果 |
| --- | --- |
| `node --import tsx tests/acceptance/rawocr02-http.mjs` | 基线两条反例均复现；返修版通过，36 次回环模拟请求、图片最高并发 3。另经 PATCH 验证仅删标记仍隔离 OCR、改名和内联移动仍可精读、歧义标记拒绝、孤立图的真实草稿与问答引用无效。对照原图及明确编辑后的 Raw 文件字节一致。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr02.test.ts tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/newsraw01.test.ts tests/kb02-planning-context.test.ts tests/rawux01-http.test.ts tests/lw02-main.test.ts` | 43/43 通过。包含内容完全相同的围栏转录示例保留、行内代码标记不绑定、无图片正文保持原样、旧检查点及正常关联回归。 |
| `npm.cmd run typecheck` | 退出码 0。 |
| `node_modules/.bin/prettier.cmd --check <返修改动的 TypeScript 文件>` | 通过。 |
| `node_modules/.bin/eslint.cmd <返修改动的 TypeScript 文件>` | 0 错误，10 项既有告警。 |
| `git diff --check` | 退出码 0。 |

本次仍使用系统临时目录与回环模拟 Provider，真实请求数为 0。返修的 9 个产品和测试文件按上节同一规则计算，聚合 SHA-256 为 `315448bdcbd3e6244628c93565bda99e7f30c0d30b80748fdbf0ddd5ac7e2d16`。`services/raw/media-context.ts` 的 SHA-256 为 `036b78c900043e71362101e47897789e8c5041f5c2db27894a6f044446961355`，`tests/acceptance/rawocr02-http.mjs` 为 `8c353c5db27f81e27f78c41ea4390db48b6f401b3478b55b866dd53993f865fd`。

## 删除图标记并编辑转录的返修

基线 `e3b0c29852039ff25bacd8b6d6e717c802a25046`。先在实际 HTTP 夹具加入删标记并加句号的复验，基线回环 Provider 捕获到旧 OCR。在同一基线上，整行替换的纯函数测试也确认拼装结果带出转录。

采集版中实际图片标记与完整起止标识的邻接关系证明旧 OCR 归属。对于已有证实旧 OCR 的 Raw，当前正文中围栏外的完整候选块按采集版归属、唯一的两侧正文或文档首尾、以及普通示例内容是否仍一致来核验。可核对为普通正文的示例及围栏代码照常保留。无法核定归属的完整候选也留在本机，隔离范围止于其起止标识。图片能否进入精读或引用继续取决于当前唯一有效的图片标记。未证实含旧转录的 Raw 沿用普通正文路径。

| 实际命令 | 结果 |
| --- | --- |
| `node --import tsx --test tests/rawocr02.test.ts` | 基线 2/3，整行替换反例未通过。 |
| `node --import tsx tests/acceptance/rawocr02-http.mjs` | 基线复现加句号后漏出。终版实际服务入口通过，43 次回环模拟请求，图片最高并发为 3。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr02.test.ts tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/newsraw01.test.ts tests/kb02-planning-context.test.ts tests/rawux01-http.test.ts tests/lw02-main.test.ts` | 终版 46/46。覆盖多块、剪除标记后重写、归属不明的完整块、普通示例、相同内容的代码示例和处于文档首尾的普通示例。 |
| `npm.cmd run typecheck` | 退出码 0。 |
| `node_modules/.bin/prettier.cmd --check services/raw/media-context.ts tests/rawocr02.test.ts` | 通过。 |
| `node_modules/.bin/eslint.cmd services/raw/media-context.ts tests/rawocr02.test.ts` | 0 错误，0 告警。 |
| `git diff --check` | 退出码 0。 |

实际 PATCH 后，分别用改标点、改词、替换整行及追加一行的输入精读保留图片，模型收到的正文没有编辑后的旧转录。走正式草稿入口确认保留图的证据仍绑定正确图片，图前图后的引文按 UTF-16 区间切回当前 Raw，草稿落盘过程未改动已编辑的 Raw 文件字节。实际问答补读保留普通正文及仍关联的图片引用，移除的图片和修改过的旧 OCR 没有进入该次补读。全部使用隔离临时目录和回环模拟 Provider，真实调用为 0。

按上节规则，3 个产品和测试文件的聚合 SHA-256 为 `ad6db27ca467719eccb456f82ada3bf39212c27b68bda4e8864899be2b09e76f`。

| 文件 | SHA-256 |
| --- | --- |
| `services/raw/media-context.ts` | `c0c5f643afdb9a91cafd31704a5f520a8d014e47485b90ada68fff07f4bd6d6b` |
| `tests/acceptance/rawocr02-http.mjs` | `8c490aca76740e27c13a590b34d48bd228923de04a8789f446251ba19f73f4ec` |
| `tests/rawocr02.test.ts` | `da0710ad80533dd75b2cc31cd94fe7ef3400f1c0f35b60a81ce0e29f85bddfee` |
