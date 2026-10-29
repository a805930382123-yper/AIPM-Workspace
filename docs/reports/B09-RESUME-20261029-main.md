# B09 续接：主线程执行记录

2026-10-29，用户明确选择“补齐 B09 遗留验收与修复”。基线 `2fe5318e70e188cf28c15af7867aacf460213d66`，分支 main。外部 AGENTS.md 与 AGENT-ROUTER-20261023-packaging.md 不属于本轮。

## 工作台入口

本轮通过 curl.exe --noproxy "*" 检查 `/api/health` 与 UI：API HTTP 200、`{"ok":true}`，UI HTTP 200。真实 IAB 打开 http://127.0.0.1:5173/，首页显示 4 Raw、7 Wiki、2 待审核、2 Prompt。仅查看首页，没有处理用户资料或确认正式资产。这是入口实测，不是四条业务链通过。

## 本轮范围与执行约束

第一小批见 [冻结任务卡](../handoffs/OPENAI-STRUCTURED-20261029-task.md)：B6，Astra规划及独立验收、Sol High施工。用户本轮B09验收与修复授权涵盖必要验证；冻结新上限4次，O255–256，独立通过才放行Q257–258。旧失败会话与剩余2次不复用。工程准备通过前零真实调用。知识起账254/500，Prompt15/24，历史连接测试1次单列。

工程、真实质量及B09整体分别裁决；首失败或目标缺证停，不重抽样。最新代码已启动的主工作台保持运行；虚构测试使用隔离目录。后续记录待实际交接后补充，不预写PASS。

## O 真实执行

准备独立S01–05通过后，主线程只放行新O会话 yO3s6e，按session绑定写main-release并计算原字节SHA。经 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run <O root> <main-release> <SHA>` 实际执行，exit0。255抽取＋256规划，reserved=sent=realCalls=2，配置读取1，知识256/500、Prompt15/24。原始candidate保存，交独立语义验收后才决定Q。

公开脱敏检查后的请求、响应、会话及候选按白名单逐字归档到 `OPENAI-STRUCTURED-20261029-real-evidence/output/`；未复制private响应或本地配置。原始wire content保留nullable字段，候选是规范化后的业务结果，两者不混称。

## Q及本轮结论

O经Astra独立O01/O02及共同标准PASS后，主线程放行新Q eklVgy，沿同一代理入口执行257抽取＋258规划，exit0；实际2请求/config1，知识258/500、Prompt15/24。Q门禁明确两个完整question-only unit与独立fact；原始响应及候选归档question目录。Astra独立Q01/Q02及共同标准PASS。

本小批S01–05、O/Q均通过。真实共4请求、配置读取2；旧O失败/旧P自动痛点评价FAIL不追改，历史HUMAN纠偏通过可复用。R16/R18最终收口口径与B09全链仍需后续检查，不由这两个样本自动联签。下一处理R22来源等级，随后完整App/恢复及总矩阵关联；最新用户已授权B09范围内连续推进。
