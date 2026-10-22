# KB02-R2 Q01 独立验收（2026-10-18）

结论：**工程门禁 PASS；真实短文与补充更新 PASS；真实长文质量 FAIL；KB02-R2 整体 FAIL，不签收。** 本轮只审查，不修改产品、不自动施工或推进下一批。S01独立关闭、PA01已有独立PASS保留。

## Q02 / P1：非业务来源声明被当作歧义事实

真实原长文106400字符、14区域，SHA256 `a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7`。当前作业 `a1fd756d-d45e-4d18-99f6-ad5a61769ddb` 在6/14段后失败，无draft。

已成功持久化的6段里，有 **11条** 附录标题或截断排版说明进入facts，kind=ambiguous。例如第1段f-c1-7是“附录2排版说明6：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客”，第2段f-c2-1是“【长文验收附录2，虚构】”。这是实际检查点分类错误，不是仅凭提示词推测。

第7段seq62返回结构合法，但c7-a0001（附录7标题，fragment=true）和c7-a0278（附录8标题，fragment=false）同时进入facts与sourceNotes，服务端正确拒绝，显示 `LLM_SCHEMA_INVALID 来源声明与事实/问题分类冲突。`。严格拒绝保护有效，但来源声明不进入业务事实的质量要求仍不满足。

代码定位：`services/llm/knowledge-extraction.ts:102` 无条件要求“fragment必须ambiguous”，与后续非业务声明分类缺少明确优先级；144–147行将已保存facts全部送入整篇规划，且规划要求全部覆盖。这是最小返修方向，不将模型行为唯一归因于该句。**规划尚未调用、长文草稿和正式Wiki未产生，不能声称已污染正式内容。** 现有回归不足以覆盖非业务fragment分类。

[机器证据](KB02-R2-Q01-AUDIT-20261018-main-q02-evidence.json)、[最终作业与检查点](KB02-R2-Q01-AUDIT-20261018-main-quality.json)、[返修卡](KB02-R2-Q01-AUDIT-20261018-repair.md)。

## 独立验证矩阵

| 轴/场景 | 结果 | 证据与限制 |
|---|---|---|
| Standards：Q01实际schema、合法非空示例、版本指纹与严格拒绝 | PASS | 两产品文件审查；旧4份失败响应逐值溯源且仍拒绝，4/4 |
| 全量默认测试 | PASS | 同冻结可写副本259/259，0skip；没有在正式数据上跑全套 |
| 构建 | PASS | tsc、Vite通过 |
| S01/取消 | PASS | 实际受控HTTP 2/2 |
| 恢复、旧revision兼容、更新 | PASS | 受控HTTP 4/4 |
| 安全/Meeting回归 | PASS | 28/28 |
| 真实短文 | PASS | 首次提取/规划成功，2次调用 |
| 真实补充更新 | PASS | 首次提取/规划/建议成功，3次；HTTP候选→预览→显式确认，20%/30%、双来源与KB02_HUMAN保留；浏览器刷新后版本3可见 |
| 真实长文恢复 | PASS（限恢复机制） | 首跑第6次调用网络失败；浏览器显式继续复用前5段，原始字节相同，第6段成功 |
| 真实长文业务分类/完整处理 | FAIL | 上述Q02；6/14，未完成规划；完整14区域、最终覆盖、摘要、长文预览/确认未能验收，不标PASS |
| 完整性/清理 | PASS | 97产品、61默认测试、夹具与2196旧保护文件无变化，正式workspace无新增、配置不变；自有服务关闭、日志无密钥 |

Q01旧“sourceNotes字符串/缺字段”等格式错误在本轮真实样本未复现；这不等于整体质量关闭。真实质量报告summary的4PASS/1FAIL只是实际执行断言计数，draft依赖检查未运行，不表示其余长文质量通过。工程中间报告的“待授权/待真实”已由本报告更新。

全量初次沙箱运行在tsx初始化报uv_os_get_passwd ENOMEM，初次Vite临时配置AccessDenied；保留原日志，随后同冻结可写副本/获准执行通过，未更改ACL或产品配置。不能把环境失败伪装成首跑通过。

## 真实额度与浏览器证据

用户在工程门禁通过后追加最多10次，上限64→74。本轮seq50–62共13次：短文2、更新3、长文8（含网络失败1与分类失败1）。前49＋本轮13＝**62/74，剩12**；Prompt独立15/24。seq60底层网络原因未捕获，不定性为产品缺陷。seq62之后停止调用，未自动重试。

浏览器实际操作包含失败显示、显式继续、复用5段、分类失败显示以及已更新Wiki刷新核对；更新确认由HTTP完成，本轮不声称浏览器执行了更新确认。截图：[长文失败](KB02-R2-Q01-AUDIT-20261018-main-browser-conflict.png)、[更新Wiki](KB02-R2-Q01-AUDIT-20261018-main-browser-updated-wiki.png)。

## 证据索引

全部为本轮独立AUDIT前缀，不覆盖此前REVIEW或builder证据。

- [工程明细](KB02-R2-Q01-AUDIT-20261018-engineering.md)
- [259测试](KB02-R2-Q01-AUDIT-20261018-main-tests-writable-copy.json)、[构建](KB02-R2-Q01-AUDIT-20261018-main-build.json)
- [HTTP](KB02-R2-Q01-AUDIT-20261018-main-http-initial.json)、[S01](KB02-R2-Q01-AUDIT-20261018-main-standards-probes.json)、[安全](KB02-R2-Q01-AUDIT-20261018-main-security.json)、[夹具溯源](KB02-R2-Q01-AUDIT-20261018-main-fixture-provenance.json)
- [短文](KB02-R2-Q01-AUDIT-20261018-main-real-http-SHORT.json)、[更新](KB02-R2-Q01-AUDIT-20261018-main-real-http-UPDATE.json)、[长文首次失败](KB02-R2-Q01-AUDIT-20261018-main-real-http-LONG.json)
- [预算](KB02-R2-Q01-AUDIT-20261018-main-real-budget.json)、[调用账本](KB02-R2-Q01-AUDIT-20261018-main-provider-attempts.jsonl)、[脱敏轨迹](KB02-R2-Q01-AUDIT-20261018-main-provider-trace.jsonl)
- [最终完整性](KB02-R2-Q01-AUDIT-20261018-main-main-integrity.json)、[服务关闭](KB02-R2-Q01-AUDIT-20261018-main-lab-final.json)

历史PA01证据摘要异常保留，本轮无漂移不追溯证明历史完整。不提交、不部署、不改变正式业务数据。
