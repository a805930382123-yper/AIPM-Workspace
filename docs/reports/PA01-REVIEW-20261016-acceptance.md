# PA01 Sol 返修后独立验收 — 2026-10-16

**整批 FAIL；Standards FAIL，受控 Spec FAIL，真实质量 BLOCKED，实际浏览器 NOT_RUN。** 本轮仅审查，未修改产品或默认测试，未施工、提交、部署或推进下一批。按新窗口审查入口执行；不以文档中的模型名称证明当前宿主模型设置。

## 交付版本与方法

先读取 status、PA01 任务卡、coordination、Sol 交接/冻结、原六项返修要求、PA01 接口及 acceptance 条目。96 产品文件、57 默认测试文件与施工最终冻结逐字节一致。本轮 [冻结](PA01-REVIEW-20261016-main-frozen.json)、[基线](PA01-REVIEW-20261016-baseline.json)、[最终完整性](PA01-REVIEW-20261016-main-integrity.json) 可复查。

独立执行原复验断言的审查副本，仅替换脚本/输出前缀，不修改断言；另新增两个独立脚本构造未被既有测试覆盖的反例。沿用测试并重新执行只能证明相应断言，不能保证未覆盖的存储结构安全。全部受控数据为隔离虚构数据，本地 fake 不代表真实 Provider。

## 实测结果

| 项目 | 本轮结果 | 新证据 |
|---|---|---|
| 完整默认 suite | 237/237，0 skip，47.754 秒 | [JSON](PA01-REVIEW-20261016-main-tests-writable-copy.json)、[日志](PA01-REVIEW-20261016-main-tests-writable-copy.log) |
| tsc / Vite | PASS，8.226 / 5.661 秒 | [构建](PA01-REVIEW-20261016-build.json) |
| 服务 | 26/26 PASS | [证据](PA01-REVIEW-20261016-preflight3-probes.json) |
| 实际 HTTP | 8/8 PASS | [证据](PA01-REVIEW-20261016-preflight3-http.json) |
| React + HTTP，jsdom | 15/15 + 5/5 PASS | [组件](PA01-REVIEW-20261016-preflight3-component.json)、[扩展](PA01-REVIEW-20261016-component-extended.json) |
| 边界 | 35/35 PASS，E24 含字段正反边界 | [证据](PA01-REVIEW-20261016-preflight-edges.json) |
| 实际存储执行器 | 3/3 PASS | [证据](PA01-REVIEW-20261016-preflight-storage-supplement.json) |
| 六链秘密 / Meeting 来源 | 62/62 PASS | [证据](PA01-REVIEW-20261016-security.json) |
| 新独立反例 | 3 检查 FAIL，归并下述 2 根因 | [服务反例](PA01-REVIEW-20261016-independent.json)、[HTTP 补证](PA01-REVIEW-20261016-independent-http.json) |

完整 suite 在 JSON 所列可写临时副本执行，96/57 文件复制 SHA 零差异；原目录未跑完整 suite。Node v24.20.0。复用脚本结果中的 date 固定字符串仍为 2026-10-15，属于继承的标签，本轮实际执行日期为 2026-10-16，见基线/构建/最终完整性时间；不把它当旧测试结果。本轮没有首跑产品测试失败后重试转绿；权限失败见下文。

## 残留缺陷与最小复现

### R-PA01-20261016-01 / P2：Workflow 深层坏记录漏过实际读盘门禁（F-PA01-02，连带 F-04/F-05）

位置：services/storage/record-validators.ts:28 的 isWorkflow；services/wiki/knowledge-workflows.ts:37、128、319。校验器不检查 evidence 的存在时类型和元素结构。读盘和恢复扫描共享这个不完整校验，因此共享本身不能保证完整性。

复现：使用真实 createSynthesis 和两个虚构 Raw 生成健康草稿，将隔离副本的 evidence 改成对象 `{"not":"an array"}`。保留健康邻居。实际 get/list 接受坏记录，RecoveryRegistry 两次相关检查没有登记结构问题。调用 patch 修改标题成功并重写坏文件；随后 confirm 遍历 evidence 时抛 TypeError。

实际 HTTP：GET 坏 workflow **200** 并返回错误 evidence；GET recovery-issues **200 / items=[] / scanned=true**；PATCH **200** 且坏字节改变；POST confirm **500 INTERNAL_ERROR**，仅提示“保存或读取失败，请重试”。HTTP 补证阶段 Provider 调用为零；准备健康服务夹具仅 1 次进程内 fake。隔离正式 Wiki 数量仍为 0，未证明正式资产误写或凭证泄漏，不夸大影响。

预期：坏 get 明确 STORAGE_CORRUPT/recovery；list 排除坏项并保留健康邻居；扫描持续告警；patch/confirm 在实际业务执行前拒绝，坏文件原字节不变。此为 PA01 明确要求的 Workflow 读盘校验范围，不要求扩改 KB02 提取/规划算法。

### R-PA01-20261016-02 / P2：恢复清单 500 项摘要截断未披露（F-PA01-04）

位置：services/storage/recovery.ts:26，items.slice(0,500) 没有同步摘要溢出状态；app/components/RecoveryNotice.tsx 直接使用 items.length，只有 overflow 为 true 才显示“以上”。

复现：隔离 drafts/prompts 放置 501 个截断 JSON，总 4008 字节，远低于 10000 文件/64MiB 扫描预算。连续扫描均 scannedFiles=501、items=500、scanned=true、partial=false、overflow=false。实际 HTTP 同样返回 500 项并宣称没有溢出（HTTP 根还有两个 workflow，scannedFiles=503）。最后一条问题从公开摘要隐藏且没有截断提示；UI 按代码会显示“发现 500 个”，这句为代码推导，不冒称真实浏览器观察。

预期：扫描完成和摘要截断分别诚实表达，给出总数或明确截断/overflow 状态；UI 不将摘要条数当完整问题数。保留有界返回，不要求无限扩大响应。

## 六项返修裁决

| 原返修项 | 本轮裁决 | 依据 |
|---|---|---|
| F-PA01-01 | CLOSED，受控范围 PASS | 完整快照、规则/Provider/目标、当前凭证 get/list/rewrite/replay/confirm、旧完成草稿复验通过 |
| F-PA01-02 | OPEN / FAIL | 原坏 manifest、真实 DraftStore 反例已修复；新 Workflow 深层反例仍漏读盘门禁 |
| F-PA01-03 | CLOSED，受控范围 PASS | 20 组件测试覆盖冲突/目标缺失、输入与补充编辑、双恢复乱序、卸载、迟到检查/保存回执 |
| F-PA01-04 | OPEN / FAIL | 原目录、持续告警、根隔离、文件/字节预算通过；深层 workflow 不告警和摘要静默截断仍存在 |
| F-PA01-05 | PARTIAL / OPEN | Prompt 四阶段受控诊断通过；坏 Workflow 实际 API 仍落入未分类 INTERNAL_ERROR，属于 R-01 连带症状，不另增根因 |
| F-PA01-06 | CLOSED，受控范围 PASS | 同源结构/例子、动态类别、逐字段类型长度数量及业务限制通过 |

## PA01-01–10 门禁

| ID | 裁决 |
|---|---|
| PA01-01 | 受控 PASS；六模板+custom 的真实内容质量未测 |
| PA01-02 | 受控 PASS；本轮默认 suite/HTTP 覆盖 guard、取消及错误，不声称真实超时质量已过 |
| PA01-03 | 受控 PASS；渲染/变量/受控字段与背景预算 |
| PA01-04 | 受控 PASS；分阶段、恢复、重放、并发、三次上限 |
| PA01-05 | 受控 PASS；绑定、编辑隔离、旧 API/Library/确认兼容 |
| PA01-06 | Prompt 受控 PASS；跨存储恢复错误仍见 R-01，整体相关错误门禁未关闭 |
| PA01-07 | FAIL；Workflow 坏结构与摘要截断 |
| PA01-08 | 安全/Meeting/原提交回归 PASS；实际 caller 的完整严格校验子项 FAIL（R-01） |
| PA01-09 | PASS；同冻结完整测试和 build |
| PA01-10 | BLOCKED；工程门禁未过，真实质量未测，实际浏览器 NOT_RUN |

真实 Prompt 累计 **0/24**，本轮新增 0；KB02 仍 **40/40**，不挪用预算。不以旧成功/fake/jsdom 签真实质量。未开展 OS ACL 不可读文件注入；目录异常、超大记录、10001 文件为已实测边界，不冒称 OS 权限场景全部通过。

## 保护、权限与结束状态

初次创建新审查脚本被工作区权限拒绝，相关脚本不存在导致随后的启动未执行。之后通过 require_escalated 权限流程创建新前缀文件并运行验证；未改 ACL、依赖、产品配置，也未降低断言。不是自动审批拒绝后的绕过。

最终 96 产品/57 默认测试零变化；1805 既有保护文件零变化；正式 workspace 没有新增文件，实际 .env.local 哈希一致。独立 HTTP/fake 子进程均报告 closed=true，完整 suite/build 进程已退出；未停止用户服务。审查仅新增自身 tests/acceptance 与 docs/reports，另更新状态/验收索引；历史证据未改写。

**不可签收或推进下一批。** [最小返修卡](PA01-REVIEW-20261016-repair.md) 只记录后续要求，不自动派工。ST-F01 仍 OPEN；SP-F01 与 Prompt 范围 BL-F01 的真实质量仍未完成，KB02/FULL3 原 FAIL 保留。
