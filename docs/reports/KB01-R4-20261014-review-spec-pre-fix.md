# KB01 R4 独立 Spec 审查：返修前发现

2026-10-14。按 AGENTS、coordination 和 code-review 技能独立审查；没有产品修改、真实 Provider、正式 workspace 或 `.env.local` 访问。只检查 R4 请求契约及针对具体未解决风险的内存探针。该报告保留返修前证据，不能用于最终冻结版本签收。

比较来自 `KB01-R4-20261014-baseline.json` 与首份 `KB01-R4-20261014-frozen.json` 的文件指纹，不是 Git diff。R4 有 4 个产品变化（DraftReviewPage、service、rules、新增 locators）及 4 个测试变化（llm-flow、llm、fake-llm、ui-b04）。当前 workspace 没有 Git 比较证据，不声称审查了实际 patch。

Spec：**FAIL，两个 P2 已交主 Agent**。Standards 由另一个独立 reviewer 判断，本报告不代签该轴。首冻结后主 Agent 已启动最小返修；14:44 复查 service 指纹已不等于首冻结，locators/rules/DraftReviewPage 仍相同。下面证明的是两个实际探针运行时的行为，不把后续施工中版本当最终冻结。

1. **SP-F01 / P2：合法重叠证据导致整个长文失败**。`services/llm/service.ts:296` 同页同 ID 引文/位置相同时不重命名；`service.ts:318` 又按对象引用追加该证据，产生重复 ID。两个合法 v2 分块分别选择其目录中的同一个 Raw `[7600,7800)`，每页唯一 e1、同主题，完整 LLMService 实际返回 `LLM_EVIDENCE_DUPLICATE_ID`。仅把第二块 ID 改 e2，完全相同 locator、事实及分块立即成功。应按证据身份去重或为聚合建立无冲突 ID，而不能要求模型在独立分块之间协商证据命名。本段是旧聚合实现中直接影响本轮长文目标的缺陷，不声称由 R4 新增。
2. **SP-F02 / P2：等待候选查询时仍可修改选择，随后提交旧选集**。`app/pages/DraftReviewPage.tsx:164` 确认先 await 候选，随后 `:171` 和 `:175` 使用旧闭包 pages/snapshot；`:263` 写入 checkbox 只按 readOnly 禁用。jsdom 中点确认、挂起内存候选响应、取消勾选后屏幕 checkbox=false；释放响应，实际组件仍 PATCH selected=true 并 POST confirm selectedPageIds=[page-1]。来源/建议字段也未在 busy 时锁定，存在同类旧快照覆盖风险。应锁定提交相关可变字段/选择，或以修改世代拒绝迟到提交。探针证明实际组件请求，不声称实际 HTTP 落盘或浏览器实测。

证据：`KB01-R4-20261014-review-spec-probes.json`（SP01 FAIL、对照 SP02 PASS、106400 字符 14 个实际 chunk 的 locator 全覆盖 SP03 PASS）；`KB01-R4-20261014-review-spec-ui-race.json`（SP04 FAIL）。原探针源码保留为 `tests/acceptance/kb01-r4-20261014-review-spec-*-pre-fix.mjs`，新版探针允许验证 busy 锁定的合法行为，输出另存。

静态契约核对：chunk v2 system/user 提示与严格 provider schema 一致；不接受模型指定 quote/rawId/offset；定位目录只提供当前 chunk 的有界 ID/text；服务端绑定 Raw 精确派生，继续旧 schema 和页内证据引用校验。document merge 只读取规范化引用，事实/整理/推断/问题字段独立。旧 quote 格式无版本时继续严格校验，旧歧义仍 fail closed，持久化草稿格式未变。首冻结映射后凭证重扫问题由另一轴发现、主 Agent 交修，本报告不重复算独有 finding。

局限：没有重跑全量/HTTP/真实 Provider/真实浏览器，也未代签质量、旧草稿同根恢复、所有 UI 迟到场景。K05 必须由主 Agent 真实长文复验；静态正确和 106400 字符目录覆盖均不等于真实模型成功。

环境记录：受限 shell 中 tsx 在加载探针前 `uv_os_get_passwd ENOMEM`；获工具批准后运行内存探针。首次 SP fixture 错把预算对象直接传 chunkText，缺 overlap，探针初始化失败；已改为明确 maxChunkChars/overlap/maxRawChars 后运行，初始化错误不算产品缺陷。
