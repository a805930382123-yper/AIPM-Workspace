# AUTO01 第一阶段施工交接

代码对应 `275067c7d120b15051dedc3981b49c64a05c3f9b` 与下表工作树 SHA-256。施工基线为 `%TEMP%/aipm-auto01-start`，含此前已交付的未提交内容。施工者 /root/auto01_builder，独立验收交 /root/auto01_acceptance。本报告记录工程自查，整体结论由独立验收给出。

## 实现

- Raw 入口从原 ExtractionRunner 启动标准或深度整理，已有运行任务或待确认草稿返回原任务。服务端依次检索、提取、规划并准备维护草稿。旧合法草稿和清单保留，缺乏主题归并协议的未完成旧候选提示显式重新生成。
- 一个成果用 `pageIndexes` 保存全部输入主题，稳定主索引继续作为提交选集的页 ID 映射。模型重复目标明确失败。归并后按成果重映射依赖并移除自依赖，确认时验证选中主题组的原始证据。
- 成果页可调整动作和真实目标、预览完整正文及实际行差异、查看证据、选择及编辑。重准备从当前 Raw 和目标读取版本与来源，只把当前目标快照和本组原始主题交给 Provider。沿原 job 和检查点累计调用。HTTP 失败、显式取消保留原草稿。目标已在本次提交时禁止再次合并写入。
- 显式成果确认沿用已有清单、写入及恢复。新协议正文用确认候选写入，新增未解析的主题链接提示检查依赖。每项按 operationId 定位正式记录，已有成功项只读。纯无需变更只有确认记录，无 Wiki、Source、索引或日志版本。结束选择保留未采纳的正文和证据历史。
- 采用 `POST /api/drafts/:draftId/changes/prepare`，传 `baseRevision, changeId, action, targetWikiId?, preparationId?`。取消用 `POST /api/drafts/:draftId/changes/prepare/:preparationId/cancel`，结束用 `POST /api/drafts/:draftId/finish`，传 `baseRevision`。正式入口复用 request-scoped Provider，仅模型动作加载配置。浏览器回到提交失败时读取冻结版本、摘要和原幂等键。

## 自查与证据

| 实际命令 | 结果 |
|---|---|
| `npx tsc -b` | 最终施工版通过。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawux01-http.test.ts tests/lw01-maintenance.test.ts tests/lw01-repair.test.ts tests/lw01-recovery.test.ts tests/lw01-deep.test.ts tests/lw01-actions.test.ts` | 29/29。初跑 27/29，发现无变化跳过索引/日志的条件影响旧无变化事务，收窄到新成果确认无变化清单后通过。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lw02*.test.ts tests/lw03*.test.ts tests/provider01-entry.test.ts` | 31/31。随后仅改 Raw 重准备取消及相关 UI，问答、检查、Provider01 路由判定未动。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb02-storage-ui.test.tsx tests/kb03-review-ui.test.tsx tests/ui-b04.test.tsx tests/rawux01-http.test.ts tests/lw01-maintenance.test.ts tests/lw01-actions.test.ts` | 最终施工版 35/35。三处旧 UI 测试的入口文字随产品入口更新。 |
| `node --import tsx tests/acceptance/auto01-builder-browser.mjs` | 最终施工版通过。正式 `server/index.ts`、空 envDir 生产构建 227 模块、隔离 Chrome、本机 fake HTTP、四张图。 |
| `git -c safe.directory='E:/AI/Work/AIPM Workspace' -c core.safecrlf=false diff --check` | 通过。 |

浏览器从 Raw 选择标准整理，同 Raw 重复发起返回原 job，刷新后从 Raw 打开成果。三个输入主题显示为两个成果，归并项展示全部可定位的原文证据和差异。目标准备失败增加原任务调用计数，原摘要和版本保留。初版仅取消前端请求，Vite 代理继续转发导致草稿意外增长至 v2（`%TEMP%/auto01-builder-gZmeq7/data/drafts`）。改为草稿 ID 和本次准备 ID 定位的服务端取消，复验确认取消后草稿摘要保留且可再次准备。成功改目标后旧确认摘要失效，正式旧目标原样，新目标保留原人工补充与两个来源。先选独立新建，后选更新，两笔 operationId 不同。新目标只从 v1 到 v2，读盘正文与成果页编辑后的候选完全一致，通过结果按钮打开正式页。

同一 Raw 再检查产生纯无变化结果。正式记录集合前后逐项一致，清单无 Source ID 或写入 ID。另一 Raw 全部不采纳后能从 Raw 打开历史且正式集合不变。独立输入中的重复目标返回 `LLM_MAINTENANCE_TARGET`，无草稿。浏览器无页面异常。证据目录为 `C:/Users/David.chen/AppData/Local/Temp/auto01-builder-A3DwDR`，含 `01-merged-diff.png`、`02-readback.png`、`03-no-changes.png`、`04-not-adopted.png`。本轮自查使用虚构资料和 fake Provider，真实模型语义由独立验收核账后验证。浏览器使用标准模式，深度沿既有定向测试验证。未在本轮施工执行真实 Provider、提交或推送。

## 文件 SHA-256

| 文件 | 施工前工作树 | 施工交接 |
|---|---|---|
| `app/api.ts` | `fbdfb2def0a8519ffd122ca5a6defeafdadd9b1ed1cfb73efd2ec357517f2499` | `038732a22ea0cd26db3bbb860c818f8b9a8ce25c1fff485089c1389ddbb01597` |
| `app/pages/KnowledgeMaintenanceReview.tsx` | `bea8dbe6f14f589b9d2bbddb9e6c41f0da0a59eadcefbd06abbaa8ee38f3d119` | `6aacd40bc9bc5a67c18e387f55daca410011f48bc32cada6265546305c213303` |
| `app/pages/RawOutcomeReview.tsx` | `e9ac9123d4b6b6013aebf4bac492f3b980727d367e8eddc38316c34c9a0d35dd` | `fedaf0b970499cea4e118f0b2709ae07057624014188c9518e17ab5726505e49` |
| `app/pages/RawPage.tsx` | `c21fd136092bf1355bb887adf85ed36d92f340da9e366dbb3b322a6f3befac35` | `fb93ca0bb22f38a6cd66749d9d256e2785c9f28d2fde286896b2d4f4d6a0ad1a` |
| `server/index.ts` | `632e8fc307c4a06387140917a6fc788552e32c5a3804266ab626bf080a1a384c` | `013d52aa7feef5361bdc0053393187dcd8efe3a02cced34976258ffdc3d20eed` |
| `server/llm-api.ts` | `34404497c77589c2b1ef9ee74bc00c233d45604158c96c41514a58fd99a22753` | `c2eed04bce24fd544b353f9e4d9988194972c793b4b22e36662da77d2a09f793` |
| `services/llm/checkpoints.ts` | `7446ff6a274302ce2814f116d02fc6d650b0c4763dcb4e33c06a525c41f0ea3e` | `0c5621b68f550cf373f95ac11d3bf52fae1ccc15fed04d26ee5bf02a0ea281ae` |
| `services/llm/jobs.ts` | `ac72da42e7f4edc6d85d5004f96ea05559a3b4b21dbdfd4d89b9693acfa508b7` | `454f160c502f1c054b27341ed1f74fe92df5a713a2287456f1a1947309754d5a` |
| `services/llm/knowledge-maintenance.ts` | `5121637ce887f9ed17cb6da78676fdbe86800c85146cf1c5d9b547e4e7064108` | `3f774ab2cbcad04b6d21b0c975b4e41fdf33d8b30ed0bbd3fd38b1c0d203be0d` |
| `services/storage/record-validators.ts` | `f1659aadcc6ab4ab9c3a46dcd0ce8bfe839d68d7a2400de799b76dd9e3304f50` | `30d15a3296b0a1c21e8bac46f8d6e1dcbea07fcf5492f2b56fa396c79c679145` |
| `services/wiki/commits.ts` | `028469228682dad3b65f2e239ac1e80ce995609bd7c9ec3fa7b4c805a23486af` | `bfe3c8bcd946768426f554f00f1b82ba98ff97f70b5c96c39fb564f7d5bf52ad` |
| `services/wiki/drafts.ts` | `d733e261a7348590512c165f97c12482c34876e19d75a89761e177e6aafa470e` | `990389e7b1434a78a3390d8342b57dc44bba0daa2ed8c0f6f68739a0222e5a9b` |
| `services/wiki/maintenance.ts` | `d3804a5f125c26eb75f06c5e1ff208c4dce23268becba07610fe8ee1916786d3` | `7af411babefa7f816b6b578f80e0d233389c5cb8c2ae256cf4e478da074955be` |
| `tests/kb02-storage-ui.test.tsx` | `0f75b1cd706f60ecd288cd0031daa275bdeacbfd4a10f8ceb08ce9628690fa69` | `f4b6943ed1323e53f7209fb3c27da2d3d596cc35fee20b26dcaee77cb03edaea` |
| `tests/kb03-review-ui.test.tsx` | `d274c8b4490b0a71f5754054b46aa8a5aa56932f90372449eab4890522570444` | `5fb2f56fa3ea28a77ac32ad66ed8390bdc15507efdcf3d3e3946196a177877ca` |
| `tests/ui-b04.test.tsx` | `cd52067c33d5fb5d4d7d1b8e6716256b74e00084b0bd74b80441bfb8422ec3db` | `447d5deb7e934b470d86e848cb7414d44f80b770f8f81e6b547f230634a1c3fe` |
| `tests/acceptance/auto01-builder-browser.mjs` | `—` | `8e37cbb279fd8289beabbd40cf28ca17c4f52a443ae73c33821054a03809a757` |

## 整合全量回归返修

首次 `npm test` 共 765 项，741 项通过，24 项失败，原日志保留在 `%TEMP%/AUTO01-final-tests.log`。

- 19 项共用假模型输出旧 `pageIndex`。当前严格 wire 需要 `pageIndexes`，假模型编码产生了 `pageIndexes:null`。更新共享夹具为正式协议，保持严格校验与生成提示词。
- 3 项来自 KB03 的运行任务与草稿身份边界。两项测试原期待运行中或待审时跨模式拒绝，改为断言返回同一 job、原模式和原草稿，且不调用模型。缺失已绑定待审草稿时此前会进入新任务分支，现按 Raw 状态中的明确草稿 ID 读取并校验 Raw 与 job 身份，缺失或不匹配时停止启动。
- E04-04 旧结构编辑用例现在用已有 `historicalB04Draft` 生成历史草稿形状，继续原有的删除、合并、证据和版本冲突断言。当前维护草稿由成果动作和目标维护主题映射。
- Raw 历史分类只认可明确的 `confirmed` 和 `discarded` 草稿状态。相关 UI mock 补齐待确认状态，保留旧 Raw 的迟到响应不会污染当前选中 Raw 的断言。

本轮产品改动限于启动时的已绑草稿校验和 Raw 历史状态显示。生成协议及真实模型候选逻辑沿用初次交接指纹。以下 SHA-256 覆盖返修后变更的文件，替代上表对应条目。

| 文件 | 返修后 |
|---|---|
| `app/pages/RawPage.tsx` | `aae8b42f4e47364f9f4318eed4128a88d76148fd53f59ce8d7bbacc577a18a61` |
| `services/llm/jobs.ts` | `ab05663a21c155f6d7e5a0812a5cc958f72462be2f45139b3ecdbeea2f3e0614` |
| `tests/support/compat01-maintenance-reply.ts` | `344aecf4d55083be56037dd59b58bfae9bdfabbed3c7e38b21d514ff29a5f3a0` |
| `tests/kb03-deep-independent.test.ts` | `a59fee0bae5b5ccc02bccdef5cbdbee43ba11d4d8817469404b0b86bbe16ddc9` |
| `tests/kb03-deep.test.ts` | `178d2e37d735eb4431be09b6c9985f6bd6a8a5f30ea8e9452fdfc5657aded854` |
| `tests/llm-flow.test.ts` | `5da406f5331860b7f4e5dcf3f34d38a84428c761774664daf921fe98048cb1d3` |
| `tests/lw01-raw-ui.test.tsx` | `8b39316c243080969290e167a33149f19d009c3002f46b3ec31d26532ecfe974` |
| `tests/lw01-fixture.ts` | `d0a0f8bb86397c18cc8e37b70ab666cf9b0bc241428e861ddfb3e3fe6efa0af2` |

全量复跑 764/765，日志为 `%TEMP%/AUTO01-repair-tests.log`。唯一失败的 LW real-wire 走独立的 LW01 假模型夹具，同样将旧索引编成了 null。更新该夹具后，`node --import tsx --import ./tests/support/css-stub.mjs --test tests/lw-real-runner.test.ts tests/lw01-maintenance.test.ts tests/lw01-actions.test.ts tests/lw01-repair.test.ts tests/lw01-recovery.test.ts tests/lw01-deep.test.ts tests/rawux01-http.test.ts` 实测 34/34，包括唯一失败文件 5/5。最后版 `npx tsc -b` 与 `git -c safe.directory='E:/AI/Work/AIPM Workspace' -c core.safecrlf=false diff --check` 通过。全量结果保留为 764/765，最后一处夹具修复采用直接消费回归验证。

返修后单独运行 `node --import tsx tests/acceptance/auto01-builder-browser.mjs` 通过，含空 envDir 构建 227 模块、正式入口、真实 Chrome 和最终 Wiki 读盘。四张图存于 `C:/Users/David.chen/AppData/Local/Temp/auto01-builder-21AnHW`。该脚本与全量测试并跑时首次停在服务健康探测超时，单独复跑通过。
