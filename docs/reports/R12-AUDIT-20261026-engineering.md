# R12 独立工程验收

2026-10-26，实际指定GPT-6 Astra medium独立验收。Sol冻结停写后审查实际六产品diff、11文件冻结、四份C原件并运行必要测试；未修改产品/施工测试、未提交Git，未触碰主Agent Chrome lab根。

**本轮R12人工独立列出问题工程：通过。Q01–05离线功能闭环通过；实际Chrome操作与其持久化证据待主Agent归档后核。原C09/10模型自动分类历史FAIL保留，全产品/B09仍未通过。** 这是人工引用能力修复，不证明自动分类已改善。无本轮产品缺陷需返修；旧综合UI测试fixture不兼容单列如下。

## 实际结果与证据

基线HEAD `340fc156cd309924d517ea5df2da93e1186703ce`；受测11项文件集合SHA256 `4477a4e433e7ea8a2aefe9d0f92f32d5ac2325a09dde07687885e210bf9bacb2`，逐项见builder-freeze.json。独立运行后重新核11项及4旧原件全部一致。产品六项SHA另在本前缀check.json；提交由主Agent后续统一关联。

| 命令 | 本轮实际结果 |
|---|---|
| `node --import tsx tests/acceptance/R12-AUDIT-20261026-check.mjs` | 最终exit0，7.388秒；独立脚本直接读原C candidate/Raw到新隔离根，不依赖施工新增fixture、不启动Provider/HTTP。结果check.json。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-name-pattern '^(?!HUMAN synthesis)' tests/r12-question-review.test.ts tests/r12-question-ui.test.tsx tests/kb02-human-review.test.ts tests/kb02-human-ui.test.tsx` | exit1，6.120秒墙钟；实际24项，23通过、1旧综合fixture失败。pattern未生效筛掉该项，按真实结果记录，不称全命令通过。新增R12三项、HUMAN核心19项、知识UI1项分别通过。 |
| `npx tsc --noEmit` | exit0。首次10秒返回运行session，随后轮询取得最终成功；总时长未精确计量。 |
| Node只读重算builder-freeze的11+4项与集合摘要；`git diff --check` | exit0，15项一致；仅LF/CRLF提示，无空白错误。 |

首轮默认沙箱：独立脚本在mkdtemp报EPERM；测试runner在spawn EPERM，产品断言未执行。获自动审批后按同命令运行，以上为实测结果。没有把环境阻断标成产品FAIL或遗漏。没有重跑445全量、完整构建、真实模型或SYN01。各层检查数量不能相加为业务场景总数。

## Q01–05裁定

- Q01 PASS：独立复制前核原candidate规范对象SHA `80e518eb41ef9a962ae63020eb2cbc15b9d37bbb7df892ae19785facc0c2dc01`，09/10确为零问题。两unit显式标记后各有完整人工问题；全部页面facts/evidence与原稿deepEqual，完整units/basisDigest未改。原候选文件和Raw文件字节SHA不变。
- Q02 PASS：先审再标记清审批并改变摘要；旧摘要拒绝、未重审拒绝。独立显式逐页测试审查后仅提交09/10两页，创建两知识页加Source；重建DraftStore和WikiStore回读仍含完整人工标识与问题段。confirmed稿拒绝撤销。测试辅助逐页审查是离线用户动作模拟，不冒充Chrome。
- Q03 PASS：独立逆序重复标记在已审状态仍保持草稿文件逐字节一致；单独撤销一项不影响另一项，全部撤销恢复原问题列表。未解决unit的人工标记即使没有页可显示也改变候选摘要，且正式化仍阻断；重新归属恢复展示。新增施工测试本机复跑覆盖移动、合并、自定义Source正文/key_takeaways保全及原生问题保留。
- Q04 PASS：新增测试本机HTTP拒绝非法/重复/非fact/未知ID、非布尔、未知字段，逐次不落盘；普通PATCH拒注入。独立另核null/非数组/重复/未知/非fact持久标记与无humanReview字段拒坏。旧未带字段原C读取字节不变。
- Q05 PASS（实际React/HTTP范围）：新增组件测试经生产HTTP操作标记、busy禁用、审批0/14、问题textarea、卸载重挂保留、dirty禁用及confirmed隐藏。受影响旧知识UI通过。Chrome由主Agent另行操作，独立者尚未核归档，不冒称亲自浏览器操作。

## 旧综合fixture失败及边界

独立实际复现 `tests/kb02-human-ui.test.tsx:41` 的fake只有七字段，缺 `synthesis_format_version:1`。既有 `knowledge-workflows.ts:225` 要求v1八字段，故在createSynthesis创建流程之前抛 `LLM_SCHEMA_INVALID`；不是R12控件或存储失败。`sourceList`由服务端派生，不能称其缺失为本次失败原因。

`git diff 340fc156cd309924d517ea5df2da93e1186703ce -- tests/kb02-human-ui.test.tsx services/wiki/knowledge-workflows.ts` 为空；产品模块最后变更提交fcd0e23953e872d3f2bf733ef6d71617b7c98045。结合失败发生点，足以确认这对契约在本轮前已不兼容，不须复制完整基线再跑同失败。保留旧测试，未扩范围返修；不能声称整份HUMAN UI测试全绿。此缺口不阻R12的受影响路径工程通过，但列为测试维护遗留。

实际diff仅新增人工引用字段、严格路由及校验、派生/审批失效和控件；原提取/共享HumanReview/正式渲染器/综合协议未改。顶层标记被candidateContent内容摘要包含，Source仅非用户正文时重算，未扩大来源等级、模板或四链。冻结检查覆盖11项和四件C原件；全仓保护由主Agent另行核验，不能冒称本子Agent已核所有文件。

独立真实/config/Provider调用均0；兼容测试fake不计真实额度。知识244/500、Prompt15/24保持。隔离独立结果根见check.json，保留供复核。等待Chrome归档后给最终人工闭环裁定；全产品/B09仍有R16/R18、R22、组合版本四链缺证，本轮不推进下一批。token实数不可得。
