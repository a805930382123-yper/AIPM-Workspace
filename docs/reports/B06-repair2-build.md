# B06 第二轮 UI 返修交接

日期：2026-10-07。施工者：原 B06 GPT-6 Luna High。范围仅 F06-05 多 Wiki/Audit 切换状态残留及异步响应竞态。主 Agent 拥有独立验收脚本、报告与 status；本次不修改这些文件或正式 workspace。

## 修复

- **Wiki 身份切换立即卸载旧详情**：选择 Wiki 时，父页立刻清空当前详情、错误/提示及旧 Lint 面板，再更新 selection version；选中详情按 `selected.id` 设置 React key。WikiDetail 和 AuditPanel 随旧页面卸载，故旧段落选择、Audit 选择、draft 预览、拒绝/延期理由、冲突与消息均不会留到下一页。`selectedId` 发生变化时也先清空详情再加载目标页，避免列表已切换而旧详情仍可操作。
- **Audit 切换立即清理详情**：点另一条 Audit 时先递增选择 epoch、记录目标 Audit ID，并清空当前详情/draft/conflict/replacement/reason/error/save notice；目标详情读回后才显示操作区。
- **异步响应失效保护**：Audit 详情、创建、Provider 提议、草稿保存/同 ID 读回、重定位、丢弃与决议均捕获选择 epoch 和 Audit ID。响应返回时再次检查 epoch、active Audit 与 Wiki 身份；旧选择的响应不设置新页面/新 Audit 状态。创建 Audit 在等待刷新列表期间也再次校验 epoch。
- **Wiki 外层刷新保护**：`wiki:refresh` listener捕获父层 selectionVersion；用户切页后，较早的 Wiki detail 请求不会通过 `.then(setSelected)` 把旧页写回。
- 草稿保存在服务器端原 draft ID；切页后回到原页重新打开 Audit 详情，会重新 GET pending draft，保留原先保存语义。

改动限于 `app/pages/WikiPage.tsx`。没有更改 Audit/Wiki 后端、schema 或独立验收代码。

## 验证

- `npm run build`：退出码 0；TypeScript 检查通过，Vite 6.4.3 production bundle 完成（40 modules，921 ms）。
- `npm test`：完整产品回归 **113/113 通过**、0 fail，16.93 秒。测试套件没有直接覆盖 WikiPage 的 Audit 页切换；实际双向切页、同页切 Audit 与延迟 Provider/保存/决议响应，由主 Agent 用已有浏览器复验服务执行。
- 本 Agent 没有操作主 Agent保留的隔离 API/UI 服务，也没有修改 `tests/acceptance/b06-*`。

主 Agent 已告知后端 15/15 HTTP 与 B05 11/11 回归通过；本返修只改 UI，因此这些后端证据无需由施工方重跑。真实 Provider质量状态仍沿用外部 BLOCKED。
