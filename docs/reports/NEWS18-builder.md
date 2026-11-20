# NEWS18 施工交接

基线提交 `563a2f030e930b9eff07b2bb0fc2057ff5dec7f9`。施工已完成，交独立验收。以下结论为施工自查。

- 前端来源配置统一使用 `single` 和 `persona_group`，Karpathy 的四个原渠道继续沿用各自的来源 ID。人物头像和平台图标复用原资源。
- 多渠道共享一层人物抽屉，默认展示全部条目，按发布时间倒序，无有效发布时间的条目排在末尾。头部显示渠道图标、计数、最新发布日和缓存提示。平台按最近发布时间排序，选定后沿用该平台原有的条目顺序和官方入口。
- 「仅今日更新」从各渠道已收录条目按上海日期过滤，再决定人物聚合、单渠道降级或隐藏。不可用的选择回到全部，日期切换恢复默认展开及筛选设置。已有 AIHOT 等单源的每源上限、渠道诊断、翻译、摘录及原条目 Raw 标识沿用原实现。

## 自查证据

| 命令或操作 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news18-persona.test.tsx tests/news13-integration.test.tsx tests/news16-ui.test.tsx tests/news17-source-logo.test.tsx` | 6/6。新用例覆盖四渠道、无效日期、原有单渠道排序、当日 2/1/0 渠道、缓存、展开收起、日期重置及保存 Raw 与回显。 |
| `$newsTests = @(git ls-files 'tests/news*.test.*') + 'tests/news18-persona.test.tsx'`，随后 `node --import tsx --import ./tests/support/css-stub.mjs --test @newsTests` | 74/74。初次在默认沙箱运行有三个随机端口 HTTP 用例遇 `EACCES`，开放本地回环后重跑全部通过。 |
| `npm.cmd run typecheck` | 退出码 0。项目无独立 lint 命令。 |
| Vite Node API 调用 `build({ envDir: false, resolve: { preserveSymlinks: true }, build: { outDir: await mkdtemp(join(tmpdir(), 'news18-builder-')) } })` | 隔离构建转换 248 个模块并成功产出。首次采用默认设置遇 Windows 沙箱 `realpath` 限制。仅在本次构建调用中使用 `preserveSymlinks`。 |
| `git diff --check`，限本次已跟踪产品文件 | 退出码 0。 |

真实浏览器桌面、窄屏交互与布局交独立验收。施工过程使用测试夹具和临时构建目录。

| 文件 | SHA-256 |
| --- | --- |
| `app/news.css` | `afbe27104559d43f4e371190063e69ff0e9e2fb86478d422685d057fb623eb84` |
| `app/pages/NewsPage.tsx` | `6573bd6229326eacba14430d66c2a99c13472af27110fe9a9796b769ecba7298` |
| `app/pages/NewsReading.tsx` | `c53abc3d846ac67c81ff505c26916ff157473e9bed6da22647101a4ceb3d56bf` |
| `app/pages/SourceLogo.tsx` | `ae6f8ac5d875c6a0ccdb8dcd5671df28dc1cbe8e2d75330e5fffc23c07696791` |
| `app/pages/newsSourceDisplay.ts` | `8fae9d8e73236843a80004d3a8d35cf197a547ebf4bb8cd6fd54ed256a65fe15` |
| `tests/news18-persona.test.tsx` | `888aa42e828d9af7b89fa5db39273e64b67c6639a63d418712e87a3fc5e5bb05` |
