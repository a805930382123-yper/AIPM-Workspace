# KB02 规划返修独立验收（2026-10-22）

结论：**未通过**。本轮按已批准 B 模式由 `/root/sol_repair`（GPT-6.1 Sol High）施工，主 Agent 等待冻结后独立读取实际差异、执行工程测试、真实调用及浏览器验收；不以施工自查代替验收。未启动下一批。

## 施工与独立验证

任务依据为 `docs/handoffs/KB02-PLAN-20261022-task.md`，施工报告为 `KB02-PLAN-20261022-sol-builder-handoff.md`。施工保留全部事实/问题 ID，新增 sourceId、原文位置与邻近原文上下文、同源 ID 列表，要求按主题和区域组织、覆盖全部记录；完整规划请求在外发前进行密钥检查及 192 KiB 限制。规则版本升级为 `b04-b04-1-locator-v2-kb02-atoms-planning-7-8ea207ea2d37`。

修改限于规划输入辅助模块、提取调用接线、规则版本及相关测试。另核准 tsconfig 精确排除历史独立验收探针（原有 unused readFile 导致编译失败）；历史探针未修改，独立运行 2/2 通过。未改响应结构、持久化、API/UI、Provider、预算或恢复机制。

Sol 自查：默认完整 341/341、0 skip，tsc/Vite 通过；Node 24.19 SR01 51/51、相关 62/62；施工真实调用 0。主 Agent 独立读取 `KB02-PLAN-20261022-exact.diff`、实际源码和测试，重新执行同冻结完整 341/341、0 skip、tsc/Vite、旧 Node 51/51 与 62/62、历史探针 2/2，全部通过。证据：`KB02-PLAN-AUDIT-20261022-full-latest-run.json`。

## 原问题逐项结论

- F-KB02-FINAL-01：本轮原始长文非业务拼接未进入事实，完成真实草稿检查；在本轮验收样本内关闭。
- F-KB02-FINAL-02：真实更新完整闭环通过，关闭。新旧共同的 100 家目标门店有两侧定位支持；旧侧单边声明未混入一致观点。20%/30% 冲突、旧正文、人工备注、双来源保留。实际浏览器候选→更新预览→明确确认→刷新回读通过，Wiki revision 2→3；重复确认及磁盘重新读取通过。
- F-KB02-FINAL-REPAIR-03：原 seq100 的 81 facts/25 questions 与 seq104 补充输入独立真实诊断均覆盖全部 ID；新长文 79 facts/25 questions、新补充 4 facts/1 question 均首轮规划成功，关闭本项遗漏症状。诊断旧 checkpoint 仅在内存重建，未迁移或改写磁盘旧规则记录。
- **F-KB02-FINAL-REPAIR-04：仍未解决，P1。** 新 seq121 把区域07的 17% 事实 `f-c6-3` 分入“虚构区域06铺货率数据”，同源 `f-c7-1` 分入区域07。两者实际请求均为 `sourceId=s-45613-45652`，原文区间 `[45613,45652)`，且同列于 sourceContext.factIds。区域06页因此混有 16% 与区域07的 17%。上下文已传递，当前问题是同源记录仍可被规划到不同页面，严格 ID 覆盖不能阻止错归。其余13页未发现相同跨区问题。

此次错误已落入隔离待确认草稿，较上轮仅出现于被拒响应的影响升级；未确认长文正式 Wiki，未污染正式工作区。

关键对象：长文 job `d1a4e169-0b57-4101-b5d5-0665abf887e0`，Raw `e1944207-71bf-41fe-ad86-67b35d79de38`，draft `a6f92f98-ea34-4349-b87d-a7b309ba2413`；原文 SHA256 `a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`。更新 workflow `642e6dd8-7446-4cec-98cb-748669780d59`，targetWiki `3b85b15f-be8d-49d1-8a2d-3a56e4374a8c`。

证据：同前缀 `quality.json`、`same-source-split.json`、`long-checkpoint.json`、真实请求响应 trace、`diagnostic-100.json`、`diagnostic-104.json`；更新证据为 `browser-workflow.json`、`browser-confirm.json`、`update-before-check.json`、`update-final-check.json`、`final-wiki.json`、`update-meaning-evidence.json`。主 Agent 实际查看长文草稿、更新预览、更新后 Wiki 截图与 DOM。

## 验收门禁与预算

K2-01 来源和事实部分通过，但跨区域事实归属不通过；K2-02 未通过；K2-03 工程通过；K2-04 真实流程已执行但质量未通过。KB02 整体未通过，不推进依赖批次。

本轮新增真实 22 次（seq105–126），累计 **126/200，剩74**；阶段 22/30 剩8不自动使用，Prompt 15/24 不变。seq105–106 原失败诊断；seq107–121 原始106400字符全文14段及规划；seq122–123短文；seq124–125补充；seq126更新预览。无自动重试，无验收后额外外发。

最终 `integrity.json` 确认100产品、73测试支持、2864保护文件、6根配置、62正式工作区文件均无验收期间变化。`main-lab-final.json` 确认服务关闭且日志无密钥，`browser-closed.json` 确认浏览器关闭。隔离临时数据保留供复查，正式数据/config不变。

浏览器工具因 kernel assets 路径错误不可用，改用已安装 Playwright 驱动真实 Chrome 执行界面验收，有截图与 DOM 证据，不是 jsdom。验收脚本曾遇到沙箱 EPERM/脚本尚未创建、按钮选择器多匹配、job.id/jobId 字段及 API 派生 links 与持久字段比较差异；均修正验收工具后重跑，不涉及产品修改或额外模型调用。区域断言失败转为汇总全部错归，保留并报告产品失败。

## 下一步（待用户确认）

项目仍处于 KB02 真实质量返修。建议继续 B 模式；同一核心区域错归已再次失败，停止盲目重试。先由 Sol 针对 seq121 的79事实25问题及同源分裂证据诊断，主 Agent 裁定最小方案，再由 sol_repair 施工并独立复审。候选方向是显式同源分配约束及一致性校验；仅拒绝坏规划不等于生成质量修复，不允许事后补塞/删除 ID 或放宽覆盖。下一轮需验证同源不跨页、14区域独立、全量覆盖及更新回归。未派发下一轮。
