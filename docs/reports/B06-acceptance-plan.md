# B06 独立验收计划

2026-10-07，按用户指定由GPT-6 Luna High施工，主Agent独立验收。此文是检查计划，未运行项目不记PASS。产品Provider真实成功与质量继续BLOCKED；fake只核验机械工作流。

| ID | 独立场景与门禁 |
|---|---|
| E06-01 | 整页/段落、四severity、反馈/三段anchor、UUID校验、open统计、刷新与同目录进程重启 |
| E06-02 | 行号移动仍定位；重复文本上下文区分；多处相同、删除/修改目标、整页改变阻止错误应用；显式重定位保留历史 |
| E06-03 | Provider实际收到Wiki+Raw+反馈；合法建议可保存/edit/discard，未确认Wiki/Raw摘要不变；坏JSON/schema/quote、无Provider拒绝 |
| E06-04 | accepted/partial显式确认，精准替换、保留其余正文及metadata/来源；rejected有理由且resolved、deferred留open；历史不丢；刷新/重启一致 |
| E06-05 | 旧Audit/draft/Wiki版本409零正式改写；取消/拒绝/延期不改Wiki；重试与并发不重复版本/Log |
| E06-06 | 实际Index/Log写失败，状态不可伪成功；同目录重启恢复完整提交或明确conflict；人工新编辑不覆盖；Raw实际SHA变更拒绝 |
| E06-07/07b | 实际Raw正文变更拒绝、未配置Provider/坏JSON/schema/quote、严格字段长度与非本页来源引文负例；以交接实际schema为准，不强加rationale非空或Raw quote唯一限制 |
| E06-08 | 11类Lint磁盘fixture逐类命中且定位；损坏YAML不能由正常list掩盖；扫描与CLI前后资产摘要不变；兼容B04短/长证据格式及Raw标记、Source孤儿排除 |
| E06-09 | 慢Provider等待期间人工先拒绝Audit，旧响应409，不复活open或丢历史 |
| E06-10浏览器 | 主Agent实际浏览器整页/段落Audit→建议→人工编辑→确认，拒绝/延期/恢复、Lint结果定位和首页最近变更 |

施工交接后冻结产品文件集合/摘要再验收；主Agent只拥有tests/acceptance/b06-*与B06验收报告，施工者只拥有产品与施工测试。正式workspace不写，测试资料在隔离临时根；验收后关闭自身服务与浏览器标签。保留首轮失败，返修后重新冻结复验受影响项与关键回归。
