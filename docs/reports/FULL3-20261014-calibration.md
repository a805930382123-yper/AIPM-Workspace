# FULL3 2026-10-14 校准与证据边界

本轮真调用全部使用实际配置的GLM-5.3-Flash；本轮真实结果没有fake。原始HTTP脚本的3PASS/9FAIL是未校准异常统计，不能直接报为9个产品失败。

- REAL02用不存在的Wiki分类sales_channel，产品正确400 INVALID_CATEGORY：INVALID夹具。已生成的两条虚构Raw保留；新增supplement改为合法metric，仅隔离样本，未改产品/旧证据。
- REAL04/05依赖未生成的extraction draft、初次REAL09依赖失败Brief、初次REAL10依赖未创建manual Prompt：NOT_RUN/前置阻断，不算独立产品缺陷。
- supplement REAL02实际成功；REAL09以明确人工填写Brief独立调用真实Generator，不能伪称AI第一阶段成功；REAL09/10分别真实60秒超时。REAL11完整Prompt也真实60秒超时。
- REAL03是真实提取60秒失败，REAL06真实综合90秒失败；前置夹具分类错误不影响已有真实Raw参与这两次请求及独立Audit。业务超时在原运行check可记FAIL，在109项完整成功/质量矩阵按尚未取得结果及外部延迟原因未明记BLOCKED。没有从超时判断内容质量错误。
- REAL07真实Audit成功。反馈已指明20%，这是有指导纠错；独立8/8语义核验及主Agent最终磁盘/HTTP/浏览器核验成立，不推导自主发现或通用成功率。
- REAL08真实502 LLM_SCHEMA_MISMATCH context；IAB另次LLM_INVALID_JSON。未保存原始Provider响应，不能证明context具体类型或唯一根因。一个exact-wire诊断重放超时，不冒称新的产品HTTP成功。
- final-state首轮把index.md计为Wiki正文、把Prompt假设为Markdown：INVALID计数夹具。初版脚本及invalid.json保留，新增final版本按实际UUID Wiki页/Prompt JSON重新核对PASS。未改任何产品断言。
- 独立Standards首轮漏列.gitignore导致83而非84：INVALID helper。初始结果保留，新final脚本84项与CFG01冻结一致。
- 独立Agent一次新quality-audit.md写入被自动审查以可能覆盖报告拒绝。未执行被拒动作，改用不存在的唯一reviewer文件并CreateNew完成，无剩余阻断。
- 215/215测试和build是2026-10-14 CFG01同冻结复用，并非FULL3重跑。原workspace npm test继承ACL rename EPERM未PASS；可写临时副本字节一致才PASS。FULL3普通证据写入也受ACL约束，仅授权新增证据提权，不改ACL。
- IAB本轮默认窄视口409文档宽，无横向溢出；未新增桌面四闭环成功。Audit显式接受在隔离HTTP，浏览器只核对结果。会议只新看空库，不声称48项全重跑或会议实际AI。

保护文件1360项是本轮baseline原有范围；CFG01旧1296项数字为历史，两者均不相互覆盖。旧报告/脚本、配置、正式workspace原样保留；所有新增证据统一FULL3/full3前缀。

实际主要命令：`node tests/acceptance/full3-20261014-integrity.mjs baseline/freeze/verify`分别运行；`node --import tsx tests/acceptance/full3-20261014-lab.mjs`启动隔离产品；`node tests/acceptance/full3-20261014-real-http.mjs`及supplement真实HTTP；`node --import tsx ...brief-diagnostic.mjs`实际适配器诊断；`node --import tsx ...corrupt-recovery.mjs`实际恢复服务复现；`node --import tsx ...backup.mjs`实际备份/恢复；`node --import tsx ...final-state-final.mjs`字节/请求/资产核验；矩阵与cleanup独立脚本。实际CLI输出原地保留，不把exit0的收集脚本视为其中所有业务PASS。
