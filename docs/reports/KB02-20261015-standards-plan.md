# KB02 独立 Standards 验收计划（待冻结）

2026-10-15；本文件为计划，所有产品项 **NOT_RUN**。只使用虚构资料、独立临时数据根和localhost fake，不读取实际配置/正式workspace，不发外部Provider请求。

| 验收ID | 独立操作与主要断言 | 证据范围 |
|---|---|---|
| K2-01 | wire只请求精简事实/问题；未知字段、错误类型、无证据、跨块/未知locator、截断、凭证键值/转义拒绝；重复原文锚点区间准确 | HTTP实际适配器+fake，非真实语义 |
| K2-02 | 106400字符十四区域fixture；planner接收所有验证事实/问题；每事实/问题一次归属，缺失/虚构/重复ID或空页拒绝；草稿默认未选，事实/推断/问题分开；原审核确认链兼容 | HTTP实际产品；mock验证结构，真实覆盖由主Agent证据另复核 |
| K2-03 | 第n块失败仅重做失败块；规划失败不重提取；同逻辑job及累计调用计数保持；同目录重启零调用；并发resume同job、取消晚到不追加checkpoint/草稿；draft落盘后完成前崩溃恢复同草稿 | 实际产品进程重启和仅临时root的故障注入 |
| K2-03 | JSON损坏/未知版本/重算hash后非法结构、Raw换正文、model/规则变化拒绝旧checkpoint；换Key同身份显式恢复仍二次秘密扫描；最新坏记录不被列表跳过 | 临时文件篡改、实际HTTP/隔离规则副本 |
| K2-04 | UI阶段/验证块数/可继续失败，刷新浏览零调用；普通重试与明确restart区分；累计预算恢复不归零；Meeting来源及六链凭证回归 | React+实际HTTP组件（jsdom非实际浏览器）；六链共享契约 |

主Agent负责统一完整test/build、真实IAB和外部短文/长文/补充更新。独立验收不重复完整suite，不把旧KB01 R4并行EPERM、旧FAIL或真实质量BLOCKED抹去。待冻结指纹后才运行并将每项实际结果写入新报告；真实外部语义证据之后独立复核。

脚本：`tests/acceptance/kb02-20261015-standards-harness.mjs`、`-fault-hook.mjs`、`-fixtures.mjs`。故障钩子只在以kb02-standards-命名的临时root生效；不修改产品。
