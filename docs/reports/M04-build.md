# M04 施工交接（GLM-5.3-Flash[1m] / High）

## 状态

- 已按 docs/batches/M04.md 完成 Local Raw 登记、集中 source-policy 拒绝、HTTP/磁盘恢复、UI 与定向测试。
- 本文件仅为施工交接；不修改验收文档，不宣称 PASS。已停止产品写入，等待主 Agent 独立验收。
- 历史证据保护：测试前已将 docs/reports 共 901 个文件压缩到工作区外 C:/Users/David.chen/.codex/visualizations/2026/10/12/01a12dcb-873b-7e40-9dcb-d296809822bb/M04-docs-reports-pretest-20261012-120146.zip；SHA-256 为 4578BC68A2A3677E281EF7445A9649722CB8962B75A494F625058BBDB82F34D6。

## 变更文件

产品与装配：

- services/meeting/types.ts, services/meeting/policy.ts, services/meeting/store.ts
- services/meeting/source-policy.ts（新增）, services/meeting/raw-bridge.ts（新增）
- services/raw/store.ts
- services/llm/jobs.ts
- services/wiki/store.ts, services/wiki/knowledge-workflows.ts, services/wiki/commits.ts
- services/audit/service.ts
- services/prompt/store.ts, services/prompt-ai/service.ts
- server/index.ts, server/meeting-api.ts, server/validation.ts
- app/api.ts, app/MeetingRawLinks.tsx（新增）, app/pages/MeetingPage.tsx, app/pages/RawPage.tsx, app/meeting.css

测试：

- tests/meeting-raw-m04.test.ts（新增）
- tests/meeting-raw-ui-m04.test.tsx（新增）
- tests/raw.test.ts, tests/wiki.test.ts, tests/import.test.ts（仅按普通 Raw 新契约做的最小夹具/断言调整）

构建产物：

- dist/ 与 tsconfig.tsbuildinfo 因执行 npm run build 而更新。

## 实现要点

- Raw origin 固定为 meeting_id/import_id/original_sha256/registered_confidentiality/processing_policy:"meeting_local_only"，只由 MeetingRawBridge 服务端生成；普通 Raw API 显式拒绝 origin 和 sourceType:"meeting"。
- createMeetingRegistration 是窄写入接口；固定 UUID 重试逐字段复用，正文、来源、tags、origin 不一致抛 RAW_INTEGRITY_ERROR。Raw Markdown 落入 knowledge/raw/meetings/ 并写后回读校验。
- Meeting raw_links 使用 pending -> linked -> failed/unlinked/raw_deleted 状态和请求指纹；跨文件中断由 bridge.reconcile 恢复；解除关联不删 Raw；Raw 删除只改 Meeting 投影；删除会议保留未删除 Raw 的限制。
- 集中 source-policy 使用严格完整 origin 校验；缺失 origin 的历史 Raw 保持兼容，畸形/Meeting origin 拒绝。已接入提取、综合、更新、手动 Wiki、草稿确认/恢复、Audit、Prompt AI 生成/优化和手动 Prompt 关联。
- Prompt 版本写入先重查当前已解析关联，提交空 relatedWikiIds 不能移除 Meeting 受限 Wiki 关联；写入前再重查全部提交 ID，已缺失旧链接可保留，新增缺失链接仍拒绝，重建后的受限 Wiki 在 Provider/写入前被拒绝。Prompt AI 在 Provider 调用前拒绝受限选中 Wiki 和受限目标关联。
- 前端提供版本选择、显式确认、同一 requestId 失败重试、解除关联二次确认、409 重载和本机专用提示；UI 不渲染 imported_minutes，仅显示 Raw ID、版本、摘要与状态。Raw 页面隐藏 Meeting Raw 的 AI/重导入入口并显示 origin 元数据。

## 实际命令与结果

1. npx tsc --noEmit --pretty false — exit 0。
2. node --import tsx --test tests/meeting-raw-m04.test.ts — 5/5 PASS。
3. node --import tsx --import ./tests/support/css-stub.mjs --test tests/meeting-raw-ui-m04.test.tsx — 1/1 PASS。
4. npm run build — exit 0；Vite 仅提示 chunk 超过 500 kB。
5. npm test — exit 1，170/183 PASS。13 个失败集中在工作区临时目录 Windows rename EPERM/文件锁，另有两条在本次后续修复前的路径问题；该结果不作为 PASS 依据。
6. 修复 Audit 恢复 catch 分支并单独回归：node --import tsx --test --test-concurrency=1 tests/audit.test.ts（工作区外 process.cwd）— 6/6 PASS。
7. 为规避工作区 ACL/Defender 的 rename EPERM，以 TSX_TSCONFIG_PATH 指向仓库 tsconfig、process.cwd 指向授权可视化目录，运行同一完整测试清单：node --import file:///E:/AI/Work/AIPM%20Workspace/node_modules/tsx/dist/loader.mjs --import file:///E:/AI/Work/AIPM%20Workspace/tests/support/css-stub.mjs --test --test-concurrency=1 "E:/AI/Work/AIPM Workspace/tests/*.test.ts" "E:/AI/Work/AIPM Workspace/tests/*.test.tsx" — 183/183 PASS。
8. 最终复查：npm run build exit 0；node --import tsx --test --test-concurrency=1 tests/meeting-raw-m04.test.ts tests/meeting-raw-ui-m04.test.tsx — 6/6 PASS。
9. 缺失旧链接语义修正后定向回归：node --import file:///E:/AI/Work/AIPM%20Workspace/node_modules/tsx/dist/loader.mjs --import file:///E:/AI/Work/AIPM%20Workspace/tests/support/css-stub.mjs --test --test-concurrency=1 tests/prompt.test.ts tests/meeting-raw-m04.test.ts tests/meeting-raw-ui-m04.test.tsx（process.cwd 为授权可视化目录）— 24/24 PASS。
10. 最终构建复查：npm run build — exit 0；Vite 仅提示 chunk 超过 500 kB。
11. 最终完整回归：第 7 条同一隔离 process.cwd/测试清单命令 — 183/183 PASS。

## 已知风险 / 环境

- 精确 npm test 在 E:\AI\Work\AIPM Workspace 的 process.cwd 下仍可能触发 Windows 文件锁/rename EPERM；183/183 证据来自同一测试清单和同一 tsconfig 的隔离 process.cwd 运行，不伪称精确 npm test PASS。
- 交付前只读审计发现 workspace/knowledge/wiki/index.md 于 2026-10-12 12:14:44 新建，内容为 169 字节空 Wiki 索引；没有施工命令以其为写入目标，施工侧未删除或改写该正式目录文件，可能是外部产品运行/watcher副作用，需验收时确认。
- 本批未配置真实 Provider，未运行真实 Provider 场景；S-03/S-04 未修复。
- Meeting 详情 HTTP 仍沿用 M03 已有 imports 原文读取能力；M04 Raw UI 不展示该正文，登记接口授权后仍返回完整 Meeting 详情。若验收要求进一步收缩响应，需主 Agent 冻结新契约。
- Raw 页面跨页跳转需要修改未授权的 app/App.tsx，因此展示真实 Raw ID 而未做成跨页链接。
- 已清理本轮 npm test 在工作区遗留的三个已核验临时目录；早期日期的 .test-b04-http-* 历史目录未触碰。
