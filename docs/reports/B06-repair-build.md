# B06 返修施工交接

日期：2026-10-07。施工者：原 B06 GPT-6 Luna High。范围只针对 [B06-fix-card.md](B06-fix-card.md) 四项缺陷与草稿保存 UI 缺口；主 Agent 持有独立验收脚本、验收报告与 status。本报告是施工记录，不构成重新独立验收或 PASS。

## 缺陷关闭实现

- **F06-01 冲突清单保留**：恢复发现实际状态不匹配时，将原 `state/audit-operations/<operationId>.json` 改为 `status: conflict`，写入可读 `conflictReason`、预期/观察到的 Wiki revision 与变化 Raw IDs，不删除 operationId。Audit 留在 open，草稿留在 pending，保留用户当前 Wiki/Raw 内容。`GET /api/audits/:id` 新增 `conflicts[]` 摘要；Audit UI 显示操作 ID、原因、Wiki revision 与变化 Raw IDs。Audit 正常列表仍由 Audit JSON 提供，不依赖 draft 存在。
- **F06-02 实物核对**：写 operation manifest 时保存目标 Wiki revision、预期正文 SHA-256、Wiki业务字段/正文摘要、来自草稿的 Raw 正文快照。重启时需同时满足实际 Wiki revision、正文和记录字段摘要完全匹配，且每个 Raw 的当前 `raw.body` SHA 与快照相同，才能完成 Audit/draft/Log。仅 frontmatter revision 相同但正文变动、Wiki revision 后续变化、Raw 正文变动或关联记录缺失均转为 conflict，不补签 resolved，不覆盖人工内容。正常写入后只缺 Audit Log 的重启恢复仍能一次完成且按 operationId 幂等。
- **F06-03 普通段落事实**：`UNSOURCED_FACT` 现在按「来源事实」节的实质内容检测普通段落与列表项；空行分隔的多行普通段落合并检查，显式“待确认 / 暂无 / 无 / N/A”占位跳过；finding offset 落在实际句子所在文件行。
- **F06-04 B04 长引文显示**：带证据 ID 的展示 quote 先核对有效 Raw 的完整 `[start,end)`，并要求显示文本匹配 Raw span 的精确前缀。兼容 B04 90 字符前缀加 `…` 的渲染结果；不允许越界、伪造前缀或任意省略号绕过核验。保留 B04 短引文、B05 Raw offset 与 Raw inline evidence 检查。
- **草稿 UI 保存**：Audit draft textarea 增加「保存草稿」，PATCH 使用当前 revision；成功后 GET 同一 draft ID 读回并校验 revision/replacement，显示已保存版本。编辑未保存时不会因刷新而被误认为已持久化；保存本身不写 Wiki。

## 验证

- `npm run build`：退出码 0；TypeScript 检查通过，Vite 6.4.3 production bundle 完成（40 modules，886 ms）。
- `node --import tsx --test tests/audit.test.ts`：**6/6 通过**，含三种冲突恢复（同 revision 的人工 Wiki 正文改动、API Wiki revision 前进、Raw 实际正文变化）均保留 conflict manifest、Audit open、草稿 pending 且不覆盖人工内容；普通段落无来源 finding；B04 有效长引用通过，伪造长引用仍报错；原正常恢复/四决议/幂等/慢 Provider用例继续通过。
- `npm test`：退出码 0，**113/113 通过**、0 failed，16.56 秒。包括已有 B04/B05 回归与六组 B06 单测。
- 独立 HTTP 与浏览器验收由主 Agent 执行；本次施工没有运行或修改 `tests/acceptance/b06-*`。

## 契约与风险

Provider 输出 schema 未改变，`rationale` 仍是必需 string 且允许空字符串；不以测试要求改变合法 schema。真实 Provider 当前未配置/未调用，真实 AI 质量继续 BLOCKED。返修没有修改 `tests/acceptance/b06-*`、主验收报告、`docs/status.md` 或正式 `workspace/`。
