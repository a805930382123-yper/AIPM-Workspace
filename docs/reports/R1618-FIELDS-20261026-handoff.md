# R16/R18 人工字段施工交接

2026-10-26；Sol High。基线 `439ae52`，按最终方案、Astra 四项修订及本轮明确“继续”授权施工。产品与定向工程检查完成，交 Astra 独立审查；**实际 Chrome F04 BLOCKED，lab 草稿 GET smoke 超时未关闭问题，配置读取零上限亦不能声称满足**。施工者不签本轮或批次最终通过。

## 实际文件

产品 8 处：`services/wiki/template-fields.ts`（新增）、`services/wiki/drafts.ts`、`services/storage/record-validators.ts`、`services/wiki/render.ts`、`services/wiki/commits.ts`、`services/wiki/knowledge-workflows.ts`、`app/api.ts`、`app/pages/DraftReviewPage.tsx`。

定向服务测试：新增 `tests/r1618-field-editing.test.ts`。最小可续接入口：新增 `tests/acceptance/R1618-FIELDS-20261026-lab.mjs`、`tests/acceptance/R1618-FIELDS-20261026-browser.tsx`。本报告为新增。没有新增重复 UI 单测，没有修改旧测试/旧报告、正式 workspace、模型协议、Raw 原文或外部 AGENTS/.agents 工作。未执行 Git，提交/同步归主 Agent。

## 已实现行为

- 可选 `templateFields` 按 Concept 8 / Process 14 个既有字段 key 保存本页 evidenceIds 与独立 humanText。无值归一为缺省；旧草稿无隐式读盘迁移。来源摘录逐字显示“来源摘录（用户归位）”，普通自由文字标“人工说明（待核对）”，AI 机会自由文字标“分析建议”。原事实、证据、问题及 Source / Raw 关联保持独立。
- 同一证据允许多字段使用，未知/外页引用拒绝。普通 patch、来源派生之后、审查动作及正式确认前均有新增字段自身的验证；来源移动导致引用消失或同 ID 改绑 Raw/quote/start/end 时原子拒绝，未引用 unit 可移动。
- 字段真实编辑复用原审批清空、revision、dirty 和逐页显审机制；规范化无变化保存保留审批。仅向既有提交 payloadDigest 投影追加可选字段，未增摘要/审批体系。
- 带字段合并与切型明确不支持，拒绝并保全原内容；同请求试图清空后合并/切型也不能绕过。清空按钮明确为删除，未保存可刷新撤回，保存后不承诺恢复。旧无字段操作可用。
- Concept 任一字段有值时，一句话解释只有其自身证据/说明，未填显示待确认；旧一句话说明独立保留。全清空后回退旧表现，不声称解释质量通过。Process 保留原一句话栏。
- 含字段候选的旧 Wiki 更新在 UI 与 createUpdate 服务入口明确拒绝，未改更新模型契约。仅覆盖新建正式页。
- UI 新增证据多选、人工文字、删除说明和已保存完整正文预览；快照带上新属性。输入未保存时沿用 dirty 门禁，预览明确仍为上次保存内容。

## 实际检查与结果

| 命令 | 结果 |
|---|---|
| `node --import tsx --test tests/r1618-field-editing.test.ts tests/r1618-template-fields.test.ts` | 10/10 通过：新增服务 7 项、上一轮受影响模板 3 项 |
| `node --import tsx --test --test-name-pattern='渲染：事实/整理/推断/问题/证据分节' tests/llm.test.ts` | 公共 metric 渲染 1/1 通过 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 最终 exit 0，无输出 |
| `node --check tests/acceptance/R1618-FIELDS-20261026-lab.mjs` | 最终 lab 语法 exit 0 |

新增 7 项覆盖两类型全部字段、逐字引用与人工标签、同证据复用/非法键/未知和外页证据拒绝、草稿保存新 Store 回读、无操作审批保留、修改使审批失效、重审正式提交与新 WikiStore 正文一致、Raw 全文件及原事实/证据保真；来源引用移走/同 ID 换引文的原子拒绝与未引用 unit 可移动；带字段合并/切型/旧 Wiki 更新拒绝且草稿完整保留、零 Provider 调用；Concept 启用与清空回退、旧草稿 GET 不写盘、非法落盘字段不能绕过确认；无字段旧事务完成后重试仍复用冻结正文。

所有测试数据为系统 TEMP 下新建的虚构夹具，结束删除测试自有目录。服务测试未调用 Provider 或实际配置。首次类型检查分别发现 UI string 索引类型及测试 find 返回类型问题，均已修正后以上最终检查通过。没有全套、旧模型矩阵或真实提取重跑。

## lab 实测、偏差与阻塞

两次 lab 运行均已结束。首次新建夹具的只读 shell/模块/草稿/Wiki/schema/export 请求走完后，smoke 末尾错误要求已有草稿的提取请求返回 503，实际按现有“已有活动草稿”规则返回 409；这是 smoke 断言错误，未视为产品失败，且未调用 Provider。移除此额外提取 probe 后，第二次复用同目录并对每条 GET 加 8 秒超时；shell、browser 入口模块及 DraftReviewPage 模块返回 200，随后 `/api/drafts/<id>` GET 超时。finally 执行关闭，进程 exit 1。未继续扩排查或重复等待。

这不证明 lab 全链可运行：**草稿 GET 超时是尚待定位的入口阻塞**。服务层同一 DraftStore/render/Commit 已在上述定向测试通过，不能因此把 HTTP/lab 问题隐藏成通过。主 Agent CUA getState/reset 均遇 kernel sandbox setup refresh 错误，实际浏览器未操作；没有使用 jsdom 代替 F04，也没有截图或 UI 操作成功声明。

还发现 lab 最初两次 `createServer({configFile:false})` 没有显式 envDir，Vite 默认使用项目根。安装实物 `node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js:49059` 为 `loadEnv(mode, envDir, resolveEnvPrefix(config))`；项目存在 `.env.local`，因此**不能声称本轮实际配置读取为 0，配置读取零上限未证明满足**。没有主动查看、打印、导出配置内容，也未启用真实 Provider、连接测试或外发；真实调用保持 0。此偏差已即时告知主 Agent。

最终 lab 已改为 `envDir: root`（本入口自有 TEMP 根），避免续接再使用项目环境文件；修正只做静态语法检查，未再启动，不能称已实测此最终版本运行。早期 active-lab / r1618-lab 元数据中的 configReads:0 是实现当时的声明，不能作为初次运行零配置读取证据；保留原件，不追改为成功。后续新一轮须区分本报告的历史偏差与修正后实际运行。

## 精确续接与 UI 路径

已保留隔离根：`C:/Users/80593/AppData/Local/Temp/r1618-fields-lab-gX15ae`。草稿 ID `9aabd1f4-5b36-46e1-be51-ef30cd95991d`，Raw ID `a8e99d3c-4db9-4c1c-88ba-803d4d5c4333`。入口只允许系统 TEMP 下本前缀目录，Provider 函数恒为 undefined，不导入 server/index 或配置管理器。

待主 Agent 决定继续排查入口/浏览器后，启动同一夹具：

```powershell
node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --root 'C:/Users/80593/AppData/Local/Temp/r1618-fields-lab-gX15ae'
```

全新隔离夹具可不传 `--root`。`--smoke` 仅测试接线后自动关闭，已知草稿 GET 阻塞时不得冒称成功。启动打印 API 随机端口，并将当前信息写入自有 TEMP 的 `active-lab.json`。

预期浏览器入口（**尚未完成实际 UI 验证**）：`http://127.0.0.1:5176/r1618-fields?draftId=9aabd1f4-5b36-46e1-be51-ef30cd95991d`。

UI 路径：Concept 卡“字段归位”→例如“定义”选择 concept-e1 并输入人工说明；Process 卡→“触发条件”选择 business_process-e1、“可能的 AI 机会（分析建议）”可选 business_process-e2 并输入明确未来建议；检查完整正文预览；勾选写入并保存编辑，刷新确认字段保留；开始主题与归属审查，逐页确认；再次修改字段、保存、确认审批失效后重新逐页审查；确认写入新 Wiki。顶栏“查看正式 Wiki”进入真实 WikiPage，选 Concept / Process 查看正文与来源，刷新回读。来源摘录允许人工多字段选择，示例操作不代表本轮自动字段质量。

导出：服务启动后 `http://127.0.0.1:5176/lab/export` 返回只读 JSON，含原始页事实/证据、当前 draft/formal、Raw 原始/当前 SHA；可保存成新增证据文件。`/lab/raw` 只读显示当前虚构 Raw。导出中的 configReads:0 仅是恒禁用配置管理器的入口声明，不能覆盖前述 Vite 初次运行偏差。

关闭：向此 node 会话发送 Ctrl+C / SIGINT；handler 依次 close Vite 与 API，打印 `R1618 fields lab stopped; isolated files retained.`。本轮两次均打印此关闭消息；最后实查 5176 / 54741 / 54621 无监听。夹具保留，不删除或改写旧证据。

## 受测标识

基线 `439ae52` 加以下实际工作区文件；本施工未创建提交，由主 Agent 最终报告补提交标识。最后产品与 TS 测试版本均已通过上列检查，lab 最后 envDir 修正仅语法检查。

| 文件 | SHA-256 |
|---|---|
| services/wiki/template-fields.ts | 543c6bf755de5a9782a75f9e6d86c4d14e647e38f26167570724cf4862de37df |
| services/wiki/drafts.ts | 346b8409eafc2924740f8dc91fc4f5604275ab7aa7a89b2b0a22e762539ab3d6 |
| services/storage/record-validators.ts | 2858cff91c01d28d7a5bd0fe549a51d8fbb797a512e6b5fadbd9f6b25a2154f5 |
| services/wiki/render.ts | 6f920d19e4e4120c3d44614655c397c7309362cd52324337b35414cc1dffe330 |
| services/wiki/commits.ts | c44b3e148c66e20d8d804a4e40e37d31f50a0bdb9900648d2ee3b77de77482da |
| services/wiki/knowledge-workflows.ts | 6be452f4509967b7c66bfb426428b4d7df95fe1d0f14f292f15ef124057b4195 |
| app/api.ts | bbe7cea981c79ebd531297eb8bd63cd3b05035a3126900cf45beb8085abfd298 |
| app/pages/DraftReviewPage.tsx | 25b37afe78171c77cfc7fda135d748a9901ee94b4e6d21d2842e5e0577e845bf |
| tests/r1618-field-editing.test.ts | f25bfe8eade1e25f3db46455c4ccd726758278d9aed1872367778d9ac7dc7458 |
| tests/acceptance/R1618-FIELDS-20261026-lab.mjs | 81610ae98fbe0d9f3e8ebb1b9523aaf24021a474787d4b0b526942c9f3d8edc2 |
| tests/acceptance/R1618-FIELDS-20261026-browser.tsx | cfb4424620555bf8e38c94ffc1a3ed468c7d5cd4639cc3ae27d3747cdb100d84 |

## 交回结论

工程服务自查已通过，F04 与 lab GET 尚未完成；配置读取零边界有上述偏差，不以“产品配置管理器未调用”冒称整轮零读取。真实调用 0，知识累计 244/500、Prompt 15/24 保持。人工能力与自动质量分列：R16 真实逐字段自动质量缺证、R18 历史自动失败、R22/四链及 B09/全产品整体未通过继续保留。

施工至此停止产品/tests 写入，交 Astra 与主 Agent 决定独立工程验收及后续入口/浏览器补证，不自行签收或推进下一批。
