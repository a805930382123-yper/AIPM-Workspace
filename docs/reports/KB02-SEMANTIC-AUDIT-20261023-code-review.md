# 独立实际差异审查

基线HEAD0e44ab5563e5de3f4cdd8ed663a51393fde53422，产品17121be；施工冻结SHA256 1cdc22d855c3a4e2175cfe22899799a49471f14ff355d6cf99669ed90220d421。读取实际五产品文件、新schema、新语义tests与support，并以git diff检查既有测试改动；本记录不替代工程/真实结果。

确认审核处于v3结构/覆盖/原ID/秘密检查后及首次有效plan保存前。审核仅Promise<void>，完整input/wirePlan深冻结、序列化前后等值，同闭包等待一次Provider；不返回可复用token。展开发生在审核前，但expand返回新的page对象与flatMap ID数组；共享document随wirePlan被冻结，Provider只收到字符串，无rawPlan引用。未发现审核候选与所存展开plan可由外部响应修改的路径。

严格schema与已批准五字段契约一致（施工交接表“六字段”为文字误计）：全页索引唯一覆盖、已知且不重复ID、pass/OK对应及本页fact支持均有窄校验。失败不保存审核reason或错误载荷；有界可信消息与secret扫描保留。审核超时有本地定时器，取消立即拒绝，晚到不会发布，beforeCall前后guard与总期限保留。语义模型误判仍可能发生，fake统一pass只允许旧结构回归继续走完，不是质量证明。

恢复方面，knowledgePlanCallMinimum对revision12有plan要求chunks+2，普通pipeline和普通resume均没有completedDraft参数入口。仅jobs已有Draft的settlement临时以当前规则验证旧结构，同时用原cp版本与draft.callCount一致时的下界；随后保留job/raw/provider/version/callCount/evidence绑定。新revision12不会因已有Draft自动降为+1。旧未完成仍不兼容，旧完成不赋予新审核认证。未来revision升级需继续维护该明确版本识别，当前范围仅revision12。

逐类审查既有测试改动：

- classification-priority、edge、extraction-contract、final-classification、pipeline、planning-attribution/context/fields、r2、source-assignment：仅fake审核分流、成功路径新增一次计数、规划请求索引保持或从末项改倒数第二项、当前revision断言11→12；原数据/覆盖/旧版本/秘密断言保留。attribution明确保留假pass下坏语义负例。
- planning-budget：失败覆盖规划依旧只花一次，剩1时更早拒绝组合；最后两次用规划+审核到原上限6，原诊断/同job/不重提块/原文件保留检查仍在。不是全局将所有2改3。
- sr01-r1与storage-ui：恢复成功多一次审核，失败检查点、原job、持久计账及UI恢复目的未删。
- llm-flow/http/repair3：多块正常count为chunks+2，整篇规划恰一次及完整输入/证据断言保留。llm规则临时目录补新schema后仍验证原枚举/预算失败；当前revision正则更新。
- fake-llm与storage-fixture：只识别新增审核请求并提供受控pass，不改变既有规划故障分支；新semantic测试专门拒绝/不确定/畸形等负例。默认测试不据fake质量宣称修复。

必要历史验收：FINAL绑定、SOURCE投影、EDGE提取前拒绝不触及审核故原样运行；FIELDS/REGION只在新独占副本给合法完整pipeline增加审核fake和对应计数。非法schema/秘密/旧版本仍要求原0或1调用，不掩盖门禁。

施工偏差按交接保留：第一次源目录默认测试写B04-http-evidence，施工已用baseline/HEAD精确字节恢复。Astra本轮3543保护项已独立核对无漂移；不是将施工根目录运行冒称隔离，也不为已创建后才取baseline的新模块/schema补造创建前哈希。
