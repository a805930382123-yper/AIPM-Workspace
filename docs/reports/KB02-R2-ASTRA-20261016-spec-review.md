# KB02 R2 受控 Spec 独立审查

2026-10-16。范围为 F-K202-R1-02 的原文 atom/摘要/声明边界，以及 F-K202-R1-03 的更新证据绑定和旧存储形状兼容。依据当前 builder-scope 的增量及主协调已核验的 97 产品/59 测试冻结，未用旧 Git HEAD 归算施工范围。

**本子审查范围受控 Spec PASS；没有发现已稳定复现的新增确定性缺陷。真实语义质量 BLOCKED，实际浏览器 NOT_RUN。** 本结论不代替主协调的全批、规划恢复、安全/Meeting 或完整 suite 裁决，也不关闭旧 KB02/FULL3 的真实质量 FAIL。

## 实际证据

- 脚本：`tests/acceptance/kb02-r2-astra-20261016-spec-probes.mjs`。
- 结果：`docs/reports/KB02-R2-ASTRA-20261016-spec-probes.json`。
- 命令：`node --import tsx tests/acceptance/kb02-r2-astra-20261016-spec-probes.mjs`。
- 7 项探针断言均通过，其中 KSP04 是对已声明语义依赖的观察，不是语义正确性 PASS；其余 6 项为确定性机制验证。全部使用虚构数据和内存 Provider，外部调用 0；没有浏览器或监听服务。
- 首次默认沙箱运行在临时 Wiki 索引原子 rename 遇 EPERM，未完成探针报告，不计产品失败或通过。相同命令经 require_escalated 通过；未改 ACL、生产代码或夹具断言。隔离数据留在结果 JSON 所列临时根目录。

| 探针 | 实测内容 | 结论 |
|---|---|---|
| KSP01 | “如果预算未获批，甲区域不得新增20家；乙区域的30家是历史覆盖，不是甲区域目标。AI目前未上线，仅在未来作为建议。”逐 atom 与全局 Raw 切片一致，派生事实保留否定/条件/不同主体/未来限定 | PASS |
| KSP02 | 超过512字符的条件长句，即便受控 Provider 将两片都标 fact，服务端均改 ambiguous，生成两条待确认提示 | PASS |
| KSP03 | 来源免责声明只进 checkpoint sourceNotes，未进入 planner 输入或摘要；健康 checkpoint 可复验，篡改摘要/事实正文均拒绝 LLM_CHECKPOINT_CORRUPT | PASS |
| KSP04 | 跨换行条件依赖模型完整选择与分类，见下节 | OBSERVED |
| KSP05 | 同正文不同 Raw、证据跨 Raw、字符串 offset、越界、quote 篡改、坏类型/未知事实引用、重复 ID、未绑定目录条目共9种，在 Provider 前拒绝；调用增量0 | PASS |
| KSP06 | Provider evidenceId 为数字/null/对象/未知字符串，共4种均拒绝，不创建可用更新草稿 | PASS |
| KSP07 | 重复句第二次位置准确保留（start=10），派生旧 rawId/quote/start/end 形状，可 get/patch/confirm/同key重放；目标最终 revision=2，双来源与 KB02_HUMAN 保留 | PASS |

## 语义限制，不计确定性代码缺陷

稳定样本为 `仅在预算获批时：\n甲区域新增20家。`。`knowledge-atoms.ts:11` 把换行作为自然边界，`:19` 的两条 atom 都是 fragment=false。受控 Provider 若只选第二条并标 fact，管线会派生 `甲区域新增20家。`，摘要同样只包含这条，无待确认提示。相关分类责任已在 `knowledge-extraction.ts:101` 的提示和任务卡真实质量门禁中明确；服务端不能仅凭 ID/切片严格性证明模型没有漏选跨句限定。KSP04 只是把这个依赖变成可复验观察，不证明真实 Provider 会这样输出，亦不据此签产品 FAIL。

后续获授权的真实短文/补充/长文评估应加入跨换行条件、跨句主体承接、未说明维度与来源免责声明的正确分类检查。必须检查全文上下文及原有条件，不能仅验证引用可定位。

更新同样只确定性验证 ID/Raw/位置/目录和 fact 引用绑定（`knowledge-workflows.ts:125–139`）；自由建议 text 的业务含义仍由模型和人工审核承担，合法 evidenceId 不保证建议 text 没有错误解释原文。这里没有把“支持 ID 存在”冒称“语义蕴含验证”。

## 实物核对与覆盖限制

- atom 强制歧义在 `knowledge-extraction.ts:120`，恢复重验在 `:67`；摘要从事实确定性构造在 `:21/:165`，恢复重验在 `:79`；来源声明分离在 `:123–135`。
- update 的 Raw/hash 绑定在 `knowledge-workflows.ts:44–50`；Provider 只选 evidenceId 并派生旧形状在 `:53–56`；严格类型在 `:113`；目录/事实引用在 `:125–139`。
- KSP07 是使用当前产品生成的旧兼容存储形状做读改确认重放，没有批量读取历史真实业务 Workflow；本子审查未单独重测所有旧工作流类型、版本冲突、秘密/Meeting、实际 HTTP/组件或全套测试。上述相关集成复验由主协调负责，不能将本报告计数扩展为它们已通过。
- 没有真实 Provider、实际浏览器、其他操作系统或最低 Node 版本质量声明。未读取实际配置秘密、未改正式 workspace、产品/default tests/旧报告，未运行完整源树 suite。仅新增本前缀脚本与报告；审查后停止写入。
