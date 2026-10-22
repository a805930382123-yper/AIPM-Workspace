# KB02-R2 S01 最小返修施工交接

2026-10-18，GPT-6.1 Sol High 施工。**施工完成，待用户新窗口 Astra 中独立审查；施工自测不签批次 PASS，原 KB02-R2/FULL3 FAIL 保留。** 依据 [最小返修卡](KB02-R2-ASTRA-20261018-repair.md)。产品和 tests 于北京时间10:48:34冻结后停写，本交接只记录施工证据。

## 修复范围与行为

- `services/llm/jobs.ts`：对已通过兼容性、完整块及覆盖失败资格校验的显式 `planningRetry`，在任何 checkpoint/job/raw-state 写入和后台启动前检查累计 attempts；耗尽时抛 `LLM_ATTEMPT_LIMIT` / HTTP409，明确累计上限和显式重新生成选择。
- `services/llm/checkpoints.ts`：导出 `knowledgeCallLimit(chunkCount)`，保持原 `min(128, 2*chunkCount+4)`。前置拒绝、后台实际 beforeCall 及恢复时的超额检查共用公式。原 beforeCall 的 429 防线和检查点校验仍保留；未重置 attempts、换 job、自动重提取或补 coverage ID。
- `services/llm/knowledge-extraction.ts`：仅将恢复校验原有同一公式替换为共享助手；未改算法、提示、schema、预算值或规划顺序。
- 新默认 `tests/kb02-planning-budget.test.ts` 两项：正常服务链耗尽后连续3次拒绝零写入并保留原诊断/成功块/旧job，显式restart建立新job；最后1次可用预算仍能同job只规划成功，复用成功块和累计账本。

相对接手基线仅上述3产品文件修改、1默认测试文件新增。[精确范围及前后SHA256](KB02-R2-S01-20261018-builder-scope.json)；[接手基线](KB02-R2-S01-20261018-builder-baseline.json)；[最终冻结](KB02-R2-S01-20261018-builder-main-frozen.json)：**97产品/60默认测试**。保留共享区此前全部变更；未把相对旧 git HEAD 的变化归于本轮。

## S01 原反例与受影响回归

| 证据 | 实测结果 |
|---|---|
| [原 Standards 探针复制增强版](KB02-R2-S01-20261018-builder-standards-probes.json) | S01/S02 2/2。正常HTTP，1块/2事实，不篡改cp：提取+首次失败规划2调用，再4次显式规划至attempts=6；之后连续3次立即409。每次Provider增量0，checkpoint/job/raw-state三文件SHA256均完全一致，missing `f-c1-2` 原覆盖诊断、原job及完整成功块保留；完整job对象也不变。取消后的迟到成功回复无plan/draft。 |
| [HTTP回归](KB02-R2-S01-20261018-builder-http-initial.json) | 4/4：有余量同job只规划、普通继续无暗反馈、显式反馈、进程重启与并发重放、已完成重规划拒绝、含秘密坏cp/旧pipeline409及旧字节保留/显式restart；旧trace39/40只离线重放，仍定位missing `f-c2-3`；受控候选→显式更新→预览→确认与重放、双来源及人工备注保留。 |
| [安全/Meeting](KB02-R2-S01-20261018-builder-security.json) | 28/28：长短虚构凭证在extracting/planning/update三阶段的值/键/转义/嵌套键拒绝及正常更新对照；Meeting提取/综合403且零Provider。 |
| [定向默认测试日志](KB02-R2-S01-20261018-builder-targeted.log) | 13/13，0skip（新2项+原KB02-R2 8项+pipeline3项）。 |
| [同冻结可写副本完整默认](KB02-R2-S01-20261018-builder-tests-writable-copy.json) | 最终251/251，0skip，17.711秒。97/60逐字节一致，源树未运行整套。首个可执行完整运行250/251、E04-05 draft2缺失已保留，未唯一归因，详见校准记录。 |
| [同冻结副本构建](KB02-R2-S01-20261018-builder-build.json) | tsc/Vite exit0，3.326/1.758秒；副本97/60逐字节一致。 |

完整命令、默认sandbox环境失败及同命令权限流程复跑、首个完整suite失败和最终结果均见 [校准记录](KB02-R2-S01-20261018-builder-calibration.md)。复制探针只改新输出前缀；Standards额外增强重复拒绝和完整对象/字节断言，未降低原断言。原历史脚本没有执行覆盖原报告。

复验入口（会覆盖本轮同名builder自测输出，独立审查请另用前缀）：

```powershell
node --import tsx --test tests/kb02-planning-budget.test.ts tests/kb02-r2.test.ts tests/kb02-pipeline.test.ts
node --import tsx tests/acceptance/kb02-r2-s01-20261018-builder-standards-probes.mjs
node --import tsx tests/acceptance/kb02-r2-s01-20261018-builder-http.mjs
node --import tsx tests/acceptance/kb02-r2-s01-20261018-builder-security.mjs
node tests/acceptance/kb02-r2-s01-20261018-builder-fullsuite.mjs
node tests/acceptance/kb02-r2-s01-20261018-builder-build.mjs
node tests/acceptance/kb02-r2-s01-20261018-builder-integrity.mjs verify
```

fullsuite实际在可写临时副本执行 `node --import tsx --import ./tests/support/css-stub.mjs --test` 加全部顶层 `.test.ts/.test.tsx`；build依次执行 `node node_modules/typescript/bin/tsc -b` 和 `node node_modules/vite/bin/vite.js build`。完整测试/构建进程已退出，自有fake/API服务已关闭，未停止用户服务。

## 保护、预算与剩余边界

[完整性核对](KB02-R2-S01-20261018-builder-main-integrity.json)：最终产品/tests冻结零漂移，接手时2047个保护文件零变化，正式workspace无新增，实际 `.env.local` SHA256不变。未写正式数据、实际配置、依赖/lock/ACL/全局Git，未提交、部署或推进下一批。

旧审查 [历史异常记录](KB02-R2-ASTRA-20261018-main-integrity.json) 中4项PA01文件曾相对旧基线变动，原因未知。本轮以接手当前字节保护，均未再变化，未恢复或归因：`docs/reports/PA01-R1-20261015-baseline.json`、`docs/reports/PA01-R1-20261015-main-preflight3-probes.json`、`docs/reports/PA01-SOL-20261016-builder-preflight3-component.json`、`tests/acceptance/pa01-r1-20261015-main-preflight3-probes.mjs`。本轮保护通过不能追溯证明其旧历史完整性；原PA01独立PASS保留。

全部使用隔离虚构资料和localhost fake。真实调用本轮0；KB02历史40，条件追加24完整未使用；Prompt15/24独立保留。真实短文、补充更新、106400字符十四区域长文语义质量及实际浏览器未运行，留新窗口按工程独立门禁及既有预算授权裁决；fake/离线回放不代签真实质量。E04-05首轮偶发失败未稳定复现且未唯一归因，独立审查应保留此限制，必要时先捕获实际job错误再决定是否扩修。
