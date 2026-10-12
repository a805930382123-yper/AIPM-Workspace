# B06 施工交接报告

日期：2026-10-07。施工者：GPT-6 Luna High。范围：Audit、Lint、对应 API/UI/CLI 与必要测试。此报告记录施工结果，不代表主 Agent 独立验收或批次 PASS。

## 交付

- 新增 `services/audit/service.ts`：Audit 与建议草稿存储、段落/整页 anchor、当前定位、显式重定位及迁移历史、产品 Provider 建议生成、Raw 引文校验、四决议、版本门禁、幂等与可恢复操作。整页 Audit 保存创建时完整 Wiki 正文 SHA；段落采用三段 `before/text/after`，完整上下文仅唯一匹配才定位，无法唯一定位返回 ambiguous/missing，不取首次匹配。原 anchor 在每次重定位前进入 history。
- 新增 `services/audit/lint.ts`：只读遍历磁盘 Wiki Markdown 与 Raw，不通过过滤损坏页面的 Wiki 列表，不调用任何初始化或修复路径。问题包含代码、对象、相对文件路径、可读原因和实际 Markdown 行位置（含 frontmatter 行偏移）。
- 新增 `server/audit-api.ts` 并接入 `server/index.ts`；新增前端 Audit/Lint 流程及首页日志变更列表。首页原 `openAuditCount` 字段保持，`recentChanges` 从实际 Wiki 知识日志读取。
- 新增独立脚本 `scripts/audit_review.ts`、`scripts/wiki_lint.ts`；扩展 `services/wiki/store.ts` 的 Audit 日志 action 与幂等键。Raw 的内容哈希均通过实际 `raw.body` 重新计算，不信任存储字段。
- 新增 `tests/audit.test.ts` 五组隔离单测，更新 README 与开源复用记录。

## HTTP 契约

所有业务错误使用现有 `{error:{code,message,details?}}` 形状；成功 JSON 形状如下。ID 均为 UUID。

| 请求 | 成功响应/语义 |
|---|---|
| `POST /api/audits` `{wikiId,scope:'page'|'paragraph',severity:'error'|'warning'|'suggestion'|'supplement',comment,anchor?}` | HTTP 201，Audit 记录。paragraph 要求 `{before,text,after}` 并验证唯一定位；page 不需 anchor，保存整页正文快照 hash。 |
| `GET /api/audits?wikiId=&status=` | `{items: Audit[]}`。 |
| `GET /api/audits/:id` | `{audit:{...audit,location:{status:'found'|'ambiguous'|'stale'|'missing',start,end,method,reason}},draft:AuditDraft|null}`。draft 支持刷新/重启找回。目标删除、整页改动、重复文本均能读出定位原因。 |
| `POST /api/audits/:id/relocate` `{baseAuditRevision,anchor}` | `{audit}`。必须是当前 open Audit 版本；成功保留原 anchor 历史、更新快照与 revision，丢弃旧 pending draft。 |
| `POST /api/audits/:id/propose` `{}` | `{audit,draft}`。无 Provider 返回 503 `LLM_NOT_CONFIGURED`。建议落盘前再次核验 Audit/Wiki/Raw 版本，迟到响应不会复活已决议 Audit。 |
| `GET /api/audit-drafts/:id` | `{draft}`，可按 ID 刷新/恢复。 |
| `PATCH /api/audit-drafts/:id` `{baseRevision,replacement,rationale?}` | `{draft}`；版本不符返回 409。 |
| `DELETE /api/audit-drafts/:id` | `{draft}`；放弃为幂等操作。 |
| `POST /api/audits/:id/resolve` `{baseAuditRevision,decision,confirm?,draftId?,baseDraftRevision?,replacement?,reason?}` | `{audit,decision,operationId,reused,wikiRevision?}`。accepted/partial 必须 `confirm:true`、当前 Audit/Wiki/draft 版本和可见 replacement；rejected/deferred 要求 reason。重复请求复用同一 operationId。 |
| `GET /api/wiki-lint` | `{generatedAt,wikiFilesSha256,findings,summary}`；findings 含 `code,objectId,file,message,location:{line,text?}`。 |

Provider 建议采用一个严格 JSON 对象（拒绝额外字段）：

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["replacement", "rationale", "evidence"],
  "properties": {
    "replacement": { "type": "string", "minLength": 1, "maxLength": 200000 },
    "rationale": { "type": "string", "maxLength": 4000 },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["rawId", "quote"],
        "properties": {
          "rawId": { "type": "string" },
          "quote": { "type": "string", "minLength": 1, "maxLength": 2000 }
        }
      }
    }
  }
}
```

`evidence` 可为空，但若有条目，其 Raw 必须是目标 Wiki 当前有效来源之一，且 quote 必须逐字包含于对应 Raw 当前正文。草稿 rawSnapshots 的 SHA-256 由当前正文计算。Provider 使用产品现有 OpenAI-compatible 服务端适配器；没有把平台内部 token 暴露给产品。

resolve 操作以 operation manifest 记录，执行 Wiki 写入、Wiki Log 与 Audit 决议。Wiki 已写而 Audit Log 失败时返回 500 `AUDIT_LOG_PENDING`，包含 operationId/recoverable 信息，Audit 仍 open；服务重启检查实际 Wiki revision 后恢复 Audit/draft 状态及缺失日志。resolve API 在 Audit 队列执行，Wiki writer 仅由 WikiStore 内部进入，避免同一队列嵌套死锁。accepted/partial 对用户确认的 replacement 落盘；重启恢复也用 operation manifest 中的 replacement 同步建议历史。

## 冻结 Lint 代码

Lint 有发现时只报告，不修复；无有效来源与事实级证据缺失是两种独立 finding。

| Code | 判断 |
|---|---|
| `BROKEN_WIKI_LINK` | Wiki 链接缺目标或命中多个页面；`[[raw:UUID]]` 不当作 Wiki 链接。 |
| `ORPHAN_WIKI` | 非 Source 页面没有有效入链或出链。 |
| `INDEX_MISSING` | Index 缺失/为空，或页面 ID/标题/别名未收录。 |
| `FRONTMATTER_MISSING` | Frontmatter 缺少或 YAML 无法解析。 |
| `SOURCE_MISSING` | sources 空/缺失，或任一来源 Raw 不存在。 |
| `KNOWLEDGE_STATUS_MISSING` | frontmatter 中 `knowledge_status` 缺少/空。 |
| `CONFIDENCE_MISSING` | frontmatter 中 `confidence` 缺少/空。 |
| `SOURCE_LEVEL_MISSING` | frontmatter 中 `source_level` 缺少/空。 |
| `UNSOURCED_FACT` | 已验证/来源支持页无有效 Raw；或「来源事实」下的单条事实无可定位引用。兼容 B04 `（证据 id）` + 来源证据 `[start,end)`，B05 `来源 Raw UUID…原文 [start,end)` 与受支持的 `[[raw:UUID]] “quote”` 格式；对照真实 Raw 正文验证 offset/quote。 |
| `OPEN_AUDIT` | 页面仍有关联 open Audit。 |
| `DUPLICATE_TITLE` | NFKC、大小写与标点/空白归一化后标题重复。 |

## CLI 与 UI

- `node --import tsx scripts/audit_review.ts [data-root] [--open|--resolved|--all]` 输出按 Wiki 分组的 Audit JSON；合法参数退出 0，非法 mode 退出 2；仅读取 Audit JSON。
- `node --import tsx scripts/wiki_lint.ts [data-root]` 输出完整 JSON；有 findings 退出 1，无 finding 退出 0。直接扫描 Markdown，绝不调用 Raw/Wiki/Audit store initialize，因此不会在“只读检查”时创建目录、恢复操作或修复 Index。
- Wiki Audit UI 可选择全文或选中段落，列表/详情显示定位及原因；提供重定位、生成/编辑建议、replacement 预览和四决议。Lint 可在页面触发并显示定位结果。首页保留原 openAuditCount，增加真实最近知识变更。

## 上游核验与复用边界

核验对象为 [llm-wiki-skill](https://github.com/lewislulu/llm-wiki-skill) 的 `main` 分支网页快照，日期 2026-10-07。读取 `audit-shared/src/anchor.ts`、`schema.ts`、`serialize.ts`、`llm-wiki/scripts/audit_review.py`、`lint_wiki.py`、`llm-wiki/references/audit-guide.md`；仓库树显示 `id.ts`，但本次没有取得可验证原文。页面没有可用 immutable commit SHA。README 声明 MIT，但实际 LICENSE 文件本次未能找到，raw LICENSE URL 返回 404。因此未将 MIT 声明当作复制授权；本地采用通用 anchor/决议/Lint 思路，TypeScript 代码独立编写，没有复制/翻译改编上游实现。详情在 `docs/open-source-reuse.md`。

## 验证与限制

- `npm run build`：退出码 0；`tsc -b` 通过，Vite 6.4.3 完成 40 modules 的 production bundle（887 ms）。
- `node --import tsx --test tests/audit.test.ts`：覆盖 anchor 行移动/重复/缺失/page stale，四决议/幂等/Raw 不变量，Audit Log 注入失败及同目录重启恢复，慢 Provider 晚到与人类先拒绝，11 类 Lint/索引与 Wiki 文件不修复，以及 B04 有效证据事实不误报。
- `npm test`：退出码 0，**112/112 通过**，0 failed，完整时长 16.50 秒。最终全套包括 B04 有效证据格式正向测试。
- CLI 隔离目录冒烟：两命令退出 0；Audit review 返回 0 条，Wiki Lint 返回 0 findings；只读脚本未创建/修复任何 fixture 资产。
- 配置摘要只检查布尔状态与缺项，未读取或输出密钥值：当前无 Provider 配置，`FMCG_LLM_BASE_URL`、`FMCG_LLM_MODEL`、`FMCG_LLM_API_KEY` 均缺失。
- fake Provider 仅用于确定性测试。真实产品 Provider 未配置、未发出真实调用；B04/B05真实 Provider外部阻塞延续，不能据此声称 AI 生成质量通过。
- 独立验收由主 Agent 执行。本报告不修改/预判 `docs/status.md` 或验收报告，也不声称批次 PASS。
