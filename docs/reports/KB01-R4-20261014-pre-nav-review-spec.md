# KB01 R4 独立 Spec 最终审查

2026-10-14。**审查范围 PASS：三个独有 P2 均 CLOSED，没有未决 actionable finding。** 本结论仅覆盖静态契约和独立确定性探针，不代签 Standards、KB01 整批、全项目、真实 Provider 质量或 K05。Provider 单次诊断样本不能替代真实同 Raw 长文成功。

最终冻结：docs/reports/KB01-R4-20261014-frozen.json（2026-10-14T15:05:57.605Z）。按 baseline/frozen SHA-256 库存比较，无 Git diff，不声称已审查 Git patch。七个相关产品/测试文件在独立复验前后均与最终冻结匹配，指纹见同名 JSON。没有产品修改、真实 Provider、正式 workspace 或 .env.local 访问。

| Finding | 结果 | 独立证据 |
|---|---|---|
| SP-F01 / P2：overlap 同位置同 ID 重复追加 | CLOSED | 两个实际 chunk 各自合法选择 Raw [7600,7800) 的 e1，聚合只保留一条证据；不同 ID 对照也成功。review-spec-probes-final3.json SP01/02 PASS。 |
| SP-F02 / P2：候选 await 时选择改变后仍提交旧选集 | CLOSED | 已锁定来源/建议 15 个可变控件、写入 checkbox、全选/全不选。review-spec-ui-race-final2.json PASS；审核页 SHA 未变，复用此实际 jsdom 证据，未重跑。 |
| SP-F03 / P2：生成后缀占用合法既有 ID | CLOSED | 首块 e1/e1-c2 与次块 e1 现在成功，生成未占用的 e1-c2-2；每条事实引用保持可解析。review-spec-id-collision.json PASS，原 2 调用 FAIL 原件已另存 frozen2-fail.json。 |

最新定点实际结果：ID 碰撞、overlap 同 ID、overlap 不同 ID 对照、106400 字符 14 个实际 chunk 的完整 locator 目录均 PASS（4 项新跑）；busy 锁定 PASS 是字节相同 UI 的此前有效证据（1 项复用）。合计 5 PASS / 0 FAIL，不能称五项均在最新轮重跑。旧 FAIL 报告保留为 review-spec-frozen2-fail.md/json；原初 pre-fix 报告、脚本与 JSON 未覆盖。

静态契约核对：locator v2 system/user 与严格 schema 一致，仅当前 chunk 目录 ID 可用，模型不能指定 quote/rawId/offset；服务端绑定不可变 Raw 派生精确切片/全局位置，映射后重新扫已知凭证，再执行旧 schema 和页内事实引用校验。事实/整理/推断/问题仍分别存储；merge 接收规范化完整证据，chunk locator 不透传至持久化。无版本 legacy quote 继续严格兼容，歧义仍 fail closed；存储草稿及 PATCH 的旧定位合同不变。候选失败可见且阻断确认，成功查询清旧错误，内容变更失效旧 decision，新增/更新由用户明确动作触发。

当前后缀分配预留已有和 incoming 全部证据 ID，循环分配未占用后缀后同步事实引用。当前 Provider JSON mode 只加入 purpose=knowledge、准确官方 host open.bigmodel.cn/api.z.ai、准确模型 glm-5.3-flash 的既有分支，普通调用/其它模型/非官方 host 路径不加 response_format；timeout、取消和输出门禁保留。此处仅静态范围核对；root 负责实际 scoped wire、安全回归与真实长文/更新，不能用官方参数或单次诊断成功签 K05。

执行：node --import tsx tests/acceptance/kb01-r4-20261014-review-spec-id-collision.mjs；node --import tsx tests/acceptance/kb01-r4-20261014-review-spec-probes.mjs final3。只有内存 provider，无 HTTP/网络请求；受限 shell tsx ENOMEM 已在前报告校准，工具批准后宿主运行。完整副本测试/build/实际 HTTP/六链/真实 GLM/真实浏览器由主 Agent 判断，本 reviewer 不复用其尚未结束的结果。Token 计量不可得。
