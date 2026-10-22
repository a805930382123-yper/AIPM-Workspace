# KB02 同源记录分配返修卡

用户已批准下一轮，沿用B模式。Sol High施工，Astra独立验收；本卡依据已读取的[离线诊断](../reports/KB02-SOURCE-20261022-diagnosis.md)与Astra方案评审批准开工。

## 目标及问题

F-KB02-FINAL-REPAIR-04/P1：seq121的79事实25问题全部覆盖却仍错归，s-45613-45652同span/text/facts/kind=fact的f-c6-3、f-c7-1被放入区域06/07。48个重复组中该组分裂，坏pages实际存入隔离checkpoint。当前单ID输出契约及恢复校验未约束等价重复记录一致归属。目标是修复该缺口，并通过真实14区域质量验收；全unit错放一页仍是语义失败，不能只以拒绝旧坏响应关闭。

## 批准方案及所有权

施工者 `/root/source_repair_sol` 使用专用sol_repair（GPT-6.1 Sol High）；验收者复用 `/root/kb02_review_astra`（原gpt-6-astra/medium实例）。主Agent裁定范围、最终状态与统一提交同步。共享工作区不得撤销他人变更。

规划前按Raw精确位置、精确text、分栏、事实kind建立确定性unit，成员在外发前固定；所有原记录/ID保留。不同位置、不同kind、facts/questions独立；同一完整atom重复记录不能臆造不同语义projection。输出采用清晰v3 schema，factUnitIds/questionUnitIds；不回退接受v2。严格验证schema、分栏、未知/重复/遗漏unit和标题后，按固定成员展开原ID，再核原ID全覆盖，不事后修补错误。完整unit/context/feedback仍在外发前做秘密扫描与192KiB限制。

持久plan结构保持原ID，wire与持久验证分离。恢复先检查原ID完整性与同unit归属一致，再做无损v3投影校验页面元数据；禁止以去重掩盖坏计划。规则revision升级，旧未完成checkpoint409保原字节，显式restart；旧完成草稿兼容。不增自动重试、Provider调用或预算。

批准4产品文件：services/llm/knowledge-planning.ts、knowledge-extraction.ts、rules.ts、rules/kb02-planning.schema.json。批准诊断所列10个默认测试/支持文件的必要契约迁移及新增tests/kb02-source-assignment.test.ts，不得删旧断言或skip掩盖回归。新施工报告/脚本前缀KB02-SOURCE-20261022；独立验收KB02-SOURCE-AUDIT-20261022。历史报告/夹具/脚本只读。若其他文件确有必要先说明。禁止改正式workspace/.env.local、Provider传输、存储、UI、依赖/锁文件、配置或其它业务模块。

## 必须自查和验收

2026-10-22 接手补充裁定：当前实际施工为新 `/root/sol_repair`（GPT-6.1 Sol High），独立审查为新 `/root/astra_review`（GPT-6 Astra Medium），不冒称复用历史实例。首轮完整检查发现 v3 诊断已返回 unit ID，而存储恢复测试仍断言旧原记录 ID；批准额外适配 `tests/kb02-storage-recovery.test.ts` 的共享 missing 精确断言，保留恢复、次数和证据断言。此为测试契约迁移，产品文件范围不扩大，首败日志保留，修正后重新验证。

- 原seq121重现；全部原ID保留；重复/未知/遗漏/错分栏unit拒绝，不能部分组装；同文异位置、不同kind/分栏、多业务atom边界。
- 当前新计划保存/恢复、同规则篡改同unit分裂拒绝、旧规则409与显式restart、旧完成草稿读取；失败保持提取，仅用户显式恢复，无自动外发。
- 规划输入秘密、192KiB、取消/预算/HTTP恢复及更新回归；完整默认测试0skip、tsc/Vite、旧Node24.19 SR01与相关测试；历史独立probe保留单独运行。
- 施工报告逐项映射、命令与失败记录、范围/冻结指纹及未解决风险。施工零真实调用，冻结停写后独立读diff和实测，不自签PASS。
- 独立真实先seq121提取记录诊断，再原106400字14区域全文、短文及补充更新、实际浏览器审核/明确确认/刷新回读。逐页主体/日期/数值、原ID覆盖、双来源/冲突/人工备注/Raw不变均核对，fake不代替真实质量。

真实累计起点126/200、Prompt15/24不变，本轮独立验收最多24次（总上限仍200），所有尝试外发前计数，无自动重试。工程通过后主Agent另行通知验收者可开始外发。必要门槛未过不能宣称通过或推进依赖批次。同核心再失败暂停试修并给证据/下一步裁定，不盲目重复。验收完成后更新状态并统一GitHub同步，向用户汇报后等待下一步确认。
