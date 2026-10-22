# KB02 R2 最小接口冻结（2026-10-16）

本接口由主协调在施工前确定。仅覆盖 F-K202-R1-01–03；[任务卡](../batches/KB02-R2.md)。实现如需变更必须先回报主协调。

## 原文事实提取

流水线身份 kb02-2，规则使用新 revision。服务端按句/分号等确定性边界构建带 ID 的完整原文单元目录，绑定原 Raw、已有 locator 和准确偏移。不能凭业务关键词丢弃单元、静默截断目录或切去否定/条件/未来限定；保留原 50 万字符容量、8 千字符分块及既有时间/调用/响应上限。

提取 wire 为严格 version:2：facts:[{atomId,kind:'fact'|'ambiguous'}]、questions:[{atomId}]、sourceNotes:[{atomId}]。只选择服务端给定 ID，不接受模型自由 text 或 offset。事实和原文明示未知从完整原文单元派生；来源声明留 checkpoint 元数据，不进入业务事实/planner。歧义不得擅补主体或维度，保留并提示待确认。分类及语义原子性不能仅靠结构验证证明，仍列真实质量门禁。

Planner wire version:2，document 只含 title/main_topic；pages 保持主题及 factIds/questionIds 分配。summary 从已验证原文事实确定性派生，模型不能再自由补摘要业务含义。最终 DraftRecord 仍使用既有存储结构、审核分栏和显式确认流程。

## 覆盖诊断与显式恢复

严格、有界、仅 ID 的 CoverageDiagnostic 包含 facts/questions 的 missing、duplicate、unknown 及 duplicateTitles。写入 checkpoint.lastError 可选 diagnostic，并通过 job.error.details 返回；不得保存失败模型计划、秘密或无限内容。不放宽全部恰一次归属，不自动补 ID。

POST extract 额外允许 planningRetry:true。仅兼容、所有块完成、无有效计划的覆盖失败接受该操作；只给上次诊断重做规划，沿用同 job 和累计 attempts，复用成功块，不自动重试。普通继续不得暗中反馈，UI 明确“仅重新规划（带覆盖诊断）”。重放/并发/取消继续受现有串行及账本门禁约束。其他恢复场景保持既有契约。

规则版本变化后旧未完成 checkpoint 返回清晰不兼容 409，保留旧字节；用户显式 restart 才创建新 job。不能静默迁移、混用旧缓存或强制其他合法恢复 restart。旧 Draft/Workflow 读编辑确认兼容。

## 更新建议证据 ID

仅 createUpdate 的 Provider 响应证据对象改为 {text,evidenceId}；各业务数组保持既有含义，inferences/questions 仍依原契约。服务端先对选中草稿页的 evidence 目录验证本 Raw 绑定、Raw 哈希、quote/start/end、ID 唯一性及 fact 关联，再外发可选目录。未知 ID、跨 Raw、畸形、篡改严格拒绝。重复句不同位置用不同 ID，不按第一个 quote 猜偏移。

服务端按选择 ID 派生原有 {text,rawId,quote,start,end} 工作流证据，保留旧存储结构；编辑/冲突预览/显式确认/重放/版本冲突和秘密/Meeting 门禁保持。synthesis 不在本轮范围，不改变其 wire。

## 实测边界

真实 KB02 40/40 已用尽，本轮外发零。受控测试和旧真实响应离线回放只能证明结构/机制，不代替新模型质量。最终需要新窗口独立审查，若真实外发则先有新增有限预算，禁止借 Prompt 预算或把 fake 标成真实通过。

补充实现约束（2026-10-18 Q02澄清）：无标点长句允许沿既有 <=512 字符 locator 边界生成 fragment:true 服务端元数据单元。先判断业务陈述/非业务来源声明，再判断业务陈述的完整性：选中的业务事实fragment强制ambiguous并生成待确认提示；非业务标题/排版fragment可进sourceNotes或不选，不能因fragment强迫进入facts/questions。fragment只是原文切片完整性标记，不是业务相关性或分类结果。保留业务否定/未知/未上线/未来建议边界；不得因长句静默截断/降低 50 万字符容量、用泛关键词删业务或把碎片宣称完整语义。Q02提示修订进入规则指纹，旧已误分类的未完成检查点必须明确不兼容保字节、显式restart；旧已完成草稿兼容保持。
