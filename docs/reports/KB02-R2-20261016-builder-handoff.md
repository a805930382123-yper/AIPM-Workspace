# KB02 R2 施工交接（2026-10-16）

## 结论

KB02 R2 仅处理 F-K202-R1-01–03。施工与受控自测完成，产品/tests 已于 17:32（北京时间）冻结并停止写入；状态为 **施工完成，待用户另开 Astra 中窗口独立审查**。本报告不签批次 PASS，不启动独立验收，不推进下一批。

- 接手基线：96 产品 / 58 默认测试，1967 个保护文件，见 [baseline](KB02-R2-20261016-builder-baseline.json)。
- 最终冻结：97 产品 / 59 默认测试，见 [main-frozen](KB02-R2-20261016-builder-main-frozen.json) 与 [精确差异](KB02-R2-20261016-builder-scope.json)。
- 最终完整性：产品/测试冻结无变化，1967 个接手保护文件不变，正式 workspace 无新增，实际 `.env.local` 哈希不变，见 [integrity](KB02-R2-20261016-builder-main-integrity.json)。

## 逐项映射

### F-K202-R1-01：规划遗漏与显式恢复

- `services/llm/knowledge-atoms.ts` 新增服务端原文 atom 目录与有界 `CoverageDiagnostic`；atom 绑定 Raw 全局偏移、locator 与 fragment 标记，512 字符无标点边界只生成 `fragment:true` 并强制歧义。
- `services/llm/knowledge-extraction.ts` 将 facts/questions 规划输入改为服务端已验证 ID/text 集合；`coverageDiagnostic` 输出 facts/questions 的 missing/duplicate/unknown 与重复页位置，不保存失败模型计划或自由错误载荷。
- `services/llm/jobs.ts`、`server/llm-api.ts`、`app/api.ts`、`app/pages/RawPage.tsx` 增加 `planningRetry:true`。只有兼容、全部块完成、无计划且存在覆盖诊断的失败检查点可显式仅重规划；沿用同 job、成功块和累计 attempts。普通继续请求体仍为空，不暗中反馈。
- `services/llm/checkpoints.ts`、`services/llm/rules.ts` 将 pipeline 身份升为 `kb02-2`、规则 revision 纳入新 schemas；旧未完成检查点返回不兼容 409，原字节保留，必须显式 restart 新 job。

### F-K202-R1-02：原文事实与歧义边界

- Provider 提取 wire 严格 version 2：`facts:[{atomId,kind}]`、`questions:[{atomId}]`、`sourceNotes:[{atomId}]`；不接受模型自由 text/offset。服务端从 atom 派生事实文本、locator、证据与原文位置。
- 否定、条件、未知、未来边界和未说明维度保留原文；跨主体、省略维度与 fragment 归入 `ambiguous`，组装时进入待确认。排版/免责声明只进 checkpoint `sourceNotes`，不进入事实、问题或 planner。
- Planner 输入只含已验证事实/问题；模型只返回 document 标题/主题与页面归属。摘要由全部来源事实确定性派生，恢复时重验，不能自由补业务含义。

### F-K202-R1-03：更新证据 ID

- `services/wiki/knowledge-workflows.ts` 的 update Provider 输出改为 `{text,evidenceId}`。服务端先验证选中草稿页 evidence 目录：Raw/hash 绑定、quote/start/end、ID 唯一、事实关联、目录无未绑定项；再外发目录。
- Provider 只能选择已验证 ID；服务端派生原存储 `{text,rawId,quote,start,end}` 工作流证据，不按首个 quote 猜位置。重复句不同位置可用不同 ID 精确区分。
- 旧合法 Draft/Workflow 读取、编辑、冲突预览、显式确认、重放/版本冲突与秘密/Meeting 门禁保持；synthesis wire 未改。

## 变更范围

产品修改 10 个既有文件、新增 `services/llm/knowledge-atoms.ts`；默认测试迁移 9 个既有文件、新增 `tests/kb02-r2.test.ts`。完整 SHA 见 [scope](KB02-R2-20261016-builder-scope.json)。未修改 PA01 record-validators、扩展 synthesis、会议与 Prompt 功能，未改依赖、锁文件、ACL、全局 Git 设置、正式 workspace 或实际配置。

本轮新增验收脚本仅使用 `kb02-r2-20261016-builder-*` / `KB02-R2-20261016-builder-*` 前缀：targeted、HTTP、component、fullsuite、build、integrity、scope。旧报告和旧脚本只读；源树未运行会覆盖 B04 历史报告的完整测试。

## 验证结果

- 定向受控回归：`targeted-final4` **74/74、0 skip**（21.236 秒），覆盖 KB02 新契约、旧链路迁移、B05 更新与 PA01 R-01/R-02 回归。
- 实际隔离 HTTP + 旧真实 trace 离线回放：`http-final` **4/4**。sequence39/40 均定位 46事实/23问题输入中的 missing `f-c2-3`；R01 同 job/成功块/累计账本，R02 当前秘密与旧 pipeline 拒绝且零副作用，R04 候选→显式更新→预览→人工确认、双来源和 `KB02_HUMAN` 保留。
- React + 实际隔离 HTTP（jsdom）：`component-final` **5/5**。普通继续 body 为空、损坏检查点零调用、明确 restart body、规划期无部分草稿、刷新失败检查点只读、显式按钮 body 为 `{planningRetry:true}`。
- 最终逐字节可写临时副本完整默认测试：**249/249、0 skip**（27.476 秒），见 [tests](KB02-R2-20261016-builder-tests-writable-copy.json)。
- 同一冻结副本 `tsc -b` 与 Vite build 均 PASS（6.671 / 6.826 秒），见 [build](KB02-R2-20261016-builder-build.json)。
- 首轮失败、夹具修正与命令校准见 [calibration](KB02-R2-20261016-builder-calibration.md)；未混用失败首跑与最终通过结果。

## 边界与风险

- 本轮 KB02 真实外发 **0 次**，累计仍 **40/40 已用尽**；Prompt **15/24** 独立保留。离线 trace、fake、HTTP 和 jsdom 只证明结构/机制，不证明新规则真实模型质量。
- 真实短文、补充更新、原 106400 字符十四区域长文与实际浏览器均为 **BLOCKED/NOT_RUN**，需用户另开 Astra 中窗口审查；若需真实调用，先获得新增有限预算，不得借用 Prompt 预算。
- 语义分类和原子边界仍需独立审查；确定性切句不能证明业务分类完全正确。旧 KB02/FULL3 FAIL 在独立裁决前保留，PA01 PASS 作为回归基线保留。
- 未提交、未部署、未自动启动审查、未推进下一批。
