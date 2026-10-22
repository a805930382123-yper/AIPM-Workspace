# KB01 R4 独立 Spec 审查

2026-10-14。**当前冻结 Spec FAIL：两个原 P2 已关闭，合法证据 ID 碰撞残余 P2 未关闭。** 本报告只判本 reviewer 的静态契约与独立定点行为；不代签 Standards、真实 Provider 长文质量、HTTP 落盘或浏览器。未修改产品，未读取 `.env.local` 或正式 workspace，未调用真实 Provider。

比较使用 `KB01-R4-20261014-baseline.json` 与最终 `KB01-R4-20261014-frozen.json` 的文件 SHA-256；没有 Git diff，不声称审查了 Git patch。定点执行前后服务、locator、rules、evidence、审核页五个产品文件都与最终冻结匹配。最终交付 85 产品/53 测试计数由主 Agent 冻结库存提供；本 reviewer 不复用其未完成实测结论。

| Finding | 严重度/状态 | 位置和实际证据 |
|---|---|---|
| SP-F01 合法 overlap 同位置同 ID 重复追加 | P2 CLOSED | `services/llm/service.ts:296`、`:319` 已按完整证据身份去重。两个实际 chunk 各自合法选择 Raw `[7600,7800)` 的 e1，现在产生一条证据，事实/整理/推断/问题保持分离。原 FAIL 及 distinct-ID 对照保留；`review-spec-probes-final.json` SP01/02/03 3/3 PASS。 |
| SP-F02 await 候选期间选择改变后提交旧选集 | P2 CLOSED | `app/pages/DraftReviewPage.tsx:240`、`:256`、`:263` 等在 busy 时锁定来源、建议、全选/全不选、写入选择。实际组件在候选响应挂起时 15 个可变控件和选择按钮全部禁用；`review-spec-ui-race-final2.json` PASS。提交原来显式选中的页符合锁定快照预期，不要求禁用控件后还能取消选择。 |
| SP-F03 自动重命名证据 ID 与既有合法 ID 碰撞 | P2 OPEN | `services/llm/service.ts:297` 直接生成 `${id}-c${chunkIndex+1}`，未检查是否已被占用。第一个 chunk 同主题页合法唯一 ID 为 e1、e1-c2；第二 chunk 页内唯一 e1，位置不同。每条 locator/事实引用都合法，服务端却把第二 e1 改为已占用 e1-c2，最终 `LLM_EVIDENCE_DUPLICATE_ID`。实际 LLMService 两次内存调用，`review-spec-id-collision.json` FAIL。应按已占用/当前块待追加 ID 集合确定无碰撞名称，并同步事实引用。该残余属于同一长文聚合唯一性问题，未要求新功能。 |

原失败报告和两份旧脚本/JSON 完整保留于 `KB01-R4-20261014-review-spec-pre-fix.md/json`、`review-spec-probes.json`、`review-spec-ui-race.json` 与 `tests/acceptance/kb01-r4-20261014-review-spec-*-pre-fix.mjs`。最终 UI 首次输出 `review-spec-ui-race-final.json` 的 `allMutableLocked=true` 为正确的等待时快照，但 `selectionButtonsLocked=false` 是错误的提交结束时读取；已仅修 reviewer 的元数据采样并另存 final2，产品未改，前件未覆盖。

已评估完整请求/解析契约：chunk v2 system/user 与严格 v2 schema 一致，顶层版本/当前 chunk locator 目录明确，不接收模型 quote/rawId/offset；服务端绑定当前不可变 Raw，派生精确引文和全局位置，再扫已知凭证并执行旧 schema/页内引用校验。无版本 legacy quote 响应继续严格兼容，歧义仍 fail closed；存储草稿合同和草稿 PATCH 的旧证据重定位不变。document merge 使用独立 document-only 提示与规范化页内事实证据，事实/整理/推断/问题字段分别传入，chunk locator 不进入持久化或 merge。候选错误被显示并阻断确认，成功重新查询清除旧错误，内容变更失效旧 decision；正式新增/更新操作仍需用户明确触发。

独立实际检查为 4 PASS / 1 FAIL：overlap 同 ID、同 span 不同 ID 对照、106400 字符 14 个实际 chunk 的完整有界 locator 目录、busy 锁定、残余生成 ID 碰撞。106400 检查只验证分块与目录，不冒充真实 14 chunk Provider 成功。全量字节相同副本、actual HTTP、六链安全、真实 GLM 短文/长文/维护与真实浏览器由主 Agent 完成；本 reviewer 没有重复执行，也没有代签旧草稿重启或所有迟到选择组合。没有足够证据宣布 KB01 整批/全项目 PASS；当前需要处理 SP-F03 后定点复验，并保留真实 K05 门禁。

执行使用 `node --import tsx ...review-spec-probes.mjs final`、`node --import tsx --import ./tests/support/css-stub.mjs ...review-spec-ui-race.mjs final2` 与 `node --import tsx ...review-spec-id-collision.mjs`。受限 shell 中 tsx 首次在加载前 ENOMEM，工具批准后宿主运行；无网络请求。Reviewer token 计量不可得。
