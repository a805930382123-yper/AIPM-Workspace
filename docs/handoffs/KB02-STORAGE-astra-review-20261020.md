# KB02 SR01 存储失败恢复：新窗口独立审查入口

用户指定在新窗口用 GPT-6 Astra / medium 独立审查。本聊天不自动启动。施工与本窗口的范围核对均不能代签批次 PASS。

## 当前状态

施工完成、待独立审查。Sol High 于北京时间2026-10-20 **00:59:02** 冻结产品及默认tests后停写；实际冻结为98产品文件、68测试及支持资产（43默认测试入口）、2份旧响应夹具。10份自有施工脚本另列指纹。请以本节最终交接和实际指纹为准，不以历史 Q02 冻结直接验收新增代码。

- [施工逐项交接](../reports/KB02-STORAGE-20261020-builder-handoff.md)
- [精确变更范围](../reports/KB02-STORAGE-20261020-builder-scope.json)、[最终冻结](../reports/KB02-STORAGE-20261020-builder-main-frozen.json)
- [最终同冻结副本运行](../reports/KB02-STORAGE-20261020-builder-2026-10-19T16-59-02-071Z-run.json)：完整默认289/289、0skip，tsc/Vite通过；Node24.19受影响26/26。实际Node24.20未安装，NOT_RUN；无真实Provider调用。
- [主协调交接完整性核对](../reports/KB02-STORAGE-20261020-main-integrity.json)：冻结实物无漂移、2507接手保护文件变化=[]、正式workspace/config无新增。这是交接核对，不是独立验收。

首轮完整288/289因重启对账返回内部completed而非既有pending_confirmation，修正产品返回契约后重冻并完整通过；旧首轮证据 `KB02-STORAGE-20261020-builder-2026-10-19T16-57-33-508Z-*` 保留。HTTP/UI反例与编译/环境校准见施工交接。前次POC `.mts` 引用只在隔离副本存在的文件，本轮仅在正式tsconfig排除这一个实验脚本，未排除其他默认tests或降低业务断言。

本轮实际新增产品助手 `services/llm/storage-recovery.ts`，修改jobs/checkpoints、llm-api、前端API/App/RawPage及tsconfig。原预算测试只增强诊断/等待/清理和前置断言，新增3个默认测试入口与3个测试支持文件。规则/schema/预算公式/Provider策略未改；受控React+真实HTTP不等同实际浏览器验收。

## 依据与范围

- [施工卡 SR01-01–06](KB02-STORAGE-20261020-task.md)
- [已验证修复方案](../reports/KB02-STORAGE-PLAN-20261020.md)
- [最初定位及置信边界](../reports/KB02-BUDGET-DIAG-20261020-review.md)
- [最小试验交接](../reports/KB02-STORAGE-POC-20261020-handoff.md)

重点检查真实磁盘记录与后台执行状态分离、持续存储故障可见性、只落盘恢复、恢复前阻止所有重新生成选项、重启时合法已存在草稿及坏记录、取消/迟到返回、容量限制、HTTP/UI和过期响应隔离，以及原预算断言是否保持。

完整默认测试只在同冻结逐字节可写副本运行，避免旧 B04 证据被覆盖。保留首败，区分产品问题、工具校准和环境失败。不能把受控 fake 当作真实模型质量，也不能把原263/265记录抹去；历史原两项失败的精确OS触发点仍未唯一确认。

真实预算仍为 KB02 62/74、剩12；Prompt15/24独立。当前入口只授权受控工程审查准备，不自动进行真实外发或追加额度。Q02/KB02真实质量FAIL、S01关闭与PA01既有PASS保留。

旧PA01历史摘要漂移原因未知，不擅自恢复或归因；核对接手与冻结的真实实物后，单列本轮完整性结果。
