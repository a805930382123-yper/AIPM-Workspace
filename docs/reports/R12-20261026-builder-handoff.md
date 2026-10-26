# R12 施工交接（待 Astra 独立验收）

2026-10-26，Sol High。基线 `340fc156cd309924d517ea5df2da93e1186703ce`，按主Agent放行卡及 `R12-AUDIT-20261026-plan.md` 施工，仅六产品文件、两新增定向测试及三薄入口文件。产品/tests 已冻结停写；未提交 Git，未更改状态/标准/旧原件，等待独立裁定。

## 实际变更

- `DraftRecord.humanQuestionUnitIds` 保存用户明确选中的原 fact unit ID；原分类、完整unit/record文本与ID、原事实和证据保持只读。不存在字段的旧稿仍原样读取。
- 草稿专用严格 POST `review/questions` 支持标记/撤销，拒绝非法或重复ID、非fact、非布尔及未知字段；普通PATCH不可注入。有效变化清审批、变更候选摘要及revision，重复相同标记幂等。
- 派生问题追加“人工标记待确认：”和完整unit原文，标记随当前归属/合并移动，撤销保全原生question及ambiguous内容；未解决、陈旧版本/摘要、已确认只读和原文门禁继续生效。Source仅在非用户自定义正文时重算body，key_takeaways不变。
- 实际草稿React界面增加明确复选操作；忙碌/未保存时禁用，已确认后隐藏。共享HumanReview、LLM提取、knowledge-workflows及正式渲染器未改。

## 实测命令与结果

1. 初次 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/r12-question-review.test.ts tests/r12-question-ui.test.tsx` 在默认沙箱因 Node 子进程 `spawn EPERM` 未执行断言；同命令获执行权限后 **3/3通过，4.496秒墙钟**。后续补齐UI忙碌/已确认断言后，以下联合命令再次覆盖三项并通过。
2. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/r12-question-review.test.ts tests/r12-question-ui.test.tsx tests/kb02-human-review.test.ts tests/kb02-human-ui.test.tsx`：**24项中23通过/1失败，4.562秒墙钟**。新增R12三项、HUMAN核心19项、知识审核UI1项通过。失败是旧HUMAN synthesis UI fake缺当前既有 `synthesis_format_version:1`，在未改的knowledge-workflows.ts:225报 `LLM_SCHEMA_INVALID`；原测试与产品该模块均无本轮差异，按主Agent/Astra裁定保留原件和失败，未越权修旧fixture。sourceList由服务端派生，不是该fake应补的模型字段。
3. `node --import tsx --import ./tests/support/css-stub.mjs --test --test-name-pattern 'HUMAN React' tests/kb02-human-ui.test.tsx`：受影响知识审核UI **1/1通过，4.037秒墙钟**；不将旧综合项称为通过。
4. `npx tsc --noEmit`：最终 **exit0，9.848秒**。新增薄浏览器入口初版多余React import曾触发TS6133，删掉无用import后复验通过。产品初版tsc也曾通过，最终以本次为准。
5. `git diff --check`：exit0。仅LF/CRLF提示，无差异空白错误。未跑445全量、旧模型矩阵、完整构建或SYN01。

R12测试逐项deepEqual比对C副本全部页面source_facts/source_evidence、不可变units/basisDigest，不只比较字词；实际HTTP错误请求前后草稿文件字节一致。覆盖显式标记两页、审批/摘要失效、旧revision/摘要拒绝、未审无Wiki、重新审后正式Markdown、重建Store、Raw保持、重复/撤销/移动/未解决/合并、Source自定义保全、坏输入与持久字段拒坏；React事件通过生产HTTP/Store覆盖标记、忙碌、刷新、dirty保护及已确认隐藏。全部仅重放既有虚构原件，**真实调用0、配置读取0**。fake仅兼容测试自身使用，未混算真实额度。

## 受测冻结与原件

冻结见 `R12-20261026-builder-freeze.json`，11个产品/测试/入口文件逐个SHA256及集合摘要、四份C原件指纹均列明。C原candidate对象规范JSON SHA仍 `80e518eb41ef9a962ae63020eb2cbc15b9d37bbb7df892ae19785facc0c2dc01`。原C真实自动分类FAIL保留；本轮只交付人工独立显示能力，不能宣称模型自动分类已修复。全产品/B09不能由本轮施工自签通过。

11文件集合摘要为 `4477a4e433e7ea8a2aefe9d0f92f32d5ac2325a09dde07687885e210bf9bacb2`（SHA256(JSON.stringify(files))，每项path/sha256按冻结顺序）。首尝试Node直接写冻结JSON遇沙箱EPERM，随后只读输出指纹并通过文件编辑工具保存；没有略过摘要核算。进程CIM探查亦被沙箱拒绝，未将其记为服务检查通过。

## 主Agent实际Chrome入口

薄入口已启动（不是另一个真实Provider），命令：

```text
node --import tsx tests/acceptance/R12-20261026-lab.mjs
```

当前manifest `docs/reports/R12-20261026-builder-lab.json`：API `http://127.0.0.1:53629`，页面 `http://127.0.0.1:5174/r12?draftId=6d885d30-285f-4739-bb00-e083ee4075bb`，隔离根 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\kb02-budget-yJljpN`。HTML与浏览器TSX转换端点已实测HTTP200；尚未进行Chrome点击，不冒称实际浏览器通过。

页面直接挂载生产DraftReviewPage，调用生产B04 HTTP/Store；原C candidate/Raw复制到新隔离根，旧已确认Wiki未拷入。尚未标记/审查/正式保存，未预审。主Agent可在事实unit控件标记 `fu-60870-60890-fact`、`fu-68471-68491-fact`，核09/10问题栏出现完整人工标记；明确选择页面/保存并逐14页显审后才可正式确认。整份原稿含14页，不能绕过未选页审查门禁。

运行exec session为66846；停止此lab会关闭自有API/Vite并保留隔离数据供独立磁盘核验。若需重启，启动命令会生成新temp根并更新manifest；不要为重复测试重建已完成会话冒称同一次UI过程。仅此薄入口，无实际配置读取或模型调用；生产用户workspace未碰。主Agent负责实际Chrome、最终服务关闭、保护核对和Git。

剩余：等待Astra独立实际差异/冻结/必要测试及主AgentChrome证据；旧synthesis测试fixture兼容问题单列，上述自查不代签Q01–05或全产品通过。平台未暴露token实数，记不可得。
