# B04 返修卡（2026-10-05）

当前裁决 **FAIL**，11项根因尚未关闭。供 DeepSeek V4.1 Flash 下一次获授权施工时使用；本卡不启动施工、不授权 B05。依据是 [冻结B04契约](../handoffs/B04-deepseek-prompt.md)、[独立验收](B04-acceptance.md)、[真实浏览器证据](B04-browser-independent.md)。验收方本轮只写测试/报告/状态，没有修改产品。

## 执行顺序和文件所有权

1. 读取 AGENTS、status、本卡和 B04 卡；逐项按下表复现，复杂 HTTP/故障/长文场景再查询验收报告对应 ID。复现完成的标准是记录实际失败响应/文件或浏览器结果，不能只引用静态代码。
2. 按 F04-10 → F04-01/02/07 → F04-08/09/04 → F04-03/05/06/11 修复；只改本批相关产品模块及必要施工测试。保留冻结契约与首次独立报告/脚本/截图/JSON，返修证据写新文件。
3. 跑受影响检查、build/npm test及 B02/B03 关键回归，真实 Provider 缺配置继续标 BLOCKED。交接 `B04-repair-build.md`：每项变更、预期/实际、命令/浏览器证据、未测边界与产品指纹。施工方可报告自测，最终 PASS 由独立验收裁决。

主 Agent 维护 status/任务卡，施工 Agent 改产品和施工测试，独立验收 Agent 拥有 `b04-independent-*` 与 `B04-independent-*`/`B04-acceptance.md`。已有 npm test 会重写 `B04-http-evidence.json`，再运行前先归档当前施工证据；本轮覆盖副作用已如实记录在 [main-checks](B04-main-checks.json)。

## 必须关闭的缺陷

| ID / 级别 | 修复结果与复验断言 | 定位/独立场景 |
|---|---|---|
| F04-10 P1 | 所有错误路径在返回、持久化、日志前保护服务端凭证。非法JSON回显随机无效测试Key时，job API、任务文件和日志零精确命中；保留可诊断的错误码。测试报告仅记录命中数量/位置。 | `services/llm/service.ts` parseProviderJson；E04-11-fake-key-error-response-no-leak |
| F04-01 P1 | UI「保存草稿」将 Source 标题/正文/等级/状态/可信度和页面编辑一起按 revision 持久化；返回的新 view 仍带 Raw 元数据。刷新/重开后人工改值完全保留。 | `app/pages/DraftReviewPage.tsx` saveEdits；浏览器 U02 |
| F04-02 P1 | 直接确认时提交用户当前编辑快照；可以先保存再确认，也可以明确阻止 dirty 状态要求保存。最终正式页与人工确认内容一致，失败/冲突明确反馈，不能显示成功但写旧内容。 | DraftReviewPage confirm；浏览器 U03 |
| F04-07 P1 | 合并完整保留所有不同事实和对应证据；相同事实合理去重并合并证据，事实不能移入推断替代。测两页不同事实、同事实多证据、其余四类内容。 | `services/wiki/drafts.ts` mergePages；E04-04-merge-facts-preserved |
| F04-08 P1 | 同Raw只允许一个活动提取任务；重复请求复用或明确拒绝。提取/删除通过同一资源互斥与存在性检查串行化，删除成功后晚到应答不创建孤儿草稿；取消亦不复活。 | `services/llm/jobs.ts` start / `server/index.ts` delete；E04-08 两个 race 场景 |
| F04-09 P1 | 已写正式文件后清单更新持续失败仍如实返回 operationId、committed、recoverable、已写IDs/阶段；额外保存错误不能吞掉原有部分提交详情。解除故障重启按原快照/IDs恢复，重复重启/重试不增页面或Log。 | `services/wiki/commits.ts` execute/error path；E04-07-manifest-after-file-write-failure-honest-response |
| F04-04 P1 | 同 key/同 payload、不同 key/同草稿确认重试均复用原 operation/IDs；同 key/不同 payload 明确409。比较冻结请求内容后才返回已完成操作，并发/重启语义一致。 | commits confirm；E04-05 两个失败场景及已通过幂等回归 |
| F04-03 P2 | 新草稿所有知识页默认未选；初始确认按钮零选择不可提交；全选/部分选择/全不选仍正常。 | drafts create；E04-04-default-unselected + 浏览器 U01 |
| F04-05 P2 | 复用Source时新页链接实际现有标题，原Source文件保持不变；新Source只把本次将创建的选中页渲染为Wiki链接，未选建议按待处理文本呈现。测人工改页标题及部分选择后链接唯一解析成功。 | commits/source renderer；E04-04-source-reuse-valid-link-unchanged-old / source-selected-link-set |
| F04-06 P2 | Source预览及正式快照保留Raw真实来源类型/名称/作者/发布日期/链接；缺失字段明确未提供，用户编辑仍能保留。独立对照完整Raw元数据与确认后的Source。 | jobs/drafts/render；E04-04-source-metadata-complete |
| F04-11 P2 | 真正触发长文汇总时输入包含每一块完整结构化结果，包括事实/证据/整理/推断/待确认问题，不只摘要及标题/定义。用三段不同摘要强制触发额外调用，捕获真实HTTP输入逐字段比对；继续保留覆盖尾部、全局UTF-16位置、并发≤2和Raw不变。 | `services/llm/service.ts` callDocumentMerge；更正后的 E04-09-summary-complete-structured-input |

全部缺陷关闭后独立复验；只有代码变更影响的断言及关键回归需要重跑。F04-09须包含“文件已写但清单仍pending”的窗口；F04-11须证明确有额外汇总请求，不能用未触发fixture签PASS。真实LLM项尚需用户已有产品配置，不发送/提交任何Key，fake不代替真实成功和质量验收。
