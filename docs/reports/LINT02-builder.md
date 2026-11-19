# LINT02 施工交接

施工基线 `f522d30b3bb87f8de4550cd33cfe2ed460670208`。按任务卡和 `DESIGN.md` 延续既有 Wiki 界面。施工实例使用 Impeccable 的上下文、Operate 和 craft-floor，以冻结任务卡确定交互。施工自查通过，交独立验收。

## 检查结果与编辑

- 完成区同时显示全库告警数和涉及 Wiki 页数。加载时显示进度状态，失败时可重试并标明上一次结果，成功零结果以绿色提示。
- 11 个规则均有中文名称、规则计数和选择后可见的修复建议。切换类型后仍显示完整检查汇总，并单列当前命中数。页面按 ID 分组，默认折叠，按命中数降序；页标题旁同时显示总数和各类型数量。同名页显示区分信息，缺页 Audit 显示无法编辑。
- 展开后，行级问题显示真实行号和原行，页级问题标记为页面属性。路径、规则码使用次级样式。组内同规则的相同通用说明只在条目列表前显示一次，断链目标、Audit 反馈和同名页具体说明留在对应条目。
- 折叠态可直接打开对应 Wiki 编辑器，按 ID 重新读取当前版本并将焦点移到编辑面板。取消返回同页阅读。保存沿用编辑器的显式提交和版本检查。

## 自查证据

| 命令或操作 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/wiki-selection.test.tsx tests/lw03-core.test.ts tests/lw03-http.test.ts tests/lw03-ui.test.tsx tests/uifix04-ui.test.tsx` | 32/32。覆盖全部规则筛选、完整和命中计数、类型徽章、通用和具体说明、原行、页面属性、错误恢复、同名页刷新定位及显式 PUT。 |
| `npm.cmd run typecheck` | 退出 0。 |
| `node --input-type=module` 调用 Vite `build({ envDir: tmp, build: { outDir: tmpDist, emptyOutDir: false } })` | 239 模块，退出 0，保留既有包大小提示。输出在新建 TEMP。 |
| `node --import tsx --input-type=module` 调用 `WikiLint.inspect()`，并以真实只读 `/api/wiki-lint` 渲染 TEMP 中的生产构建 | 冻结副本 82 文件清单 SHA-256 `ebbe6e5f50f0408913fb660305d505ce31b8e2bde73510403966007a464c96ef`，检查前后相同。Edge 1440×900 结果显示 6 页 25 条，分组和类型计数均为 6/5/4/4/3/3，并默认折叠。390×844 下按键选择类型和展开首组，焦点可见，组内通用说明 1 次，6 条原行逐字匹配，`scrollWidth = 390`，页面异常 0。实际资料截图只存于本机 TEMP。 |
| `node --import tsx scripts/lw03-isolated.ts`，分别接 `node tests/acceptance/qaui03-navigation.mjs <isolated-session.json>` 与 `node tests/acceptance/kbi01-review-browser.mjs <isolated-session.json>` | 两套 fresh 合成资料在真实 Edge 通过。QAUI03 验证折叠态编辑、取消、手动创建保存、首页入口和五个视图 390px 无溢出。KBI01 验证历史草稿往返和主动检查面板的键盘 Lint 跳转，Wiki/Raw 文件哈希相同。 |
| `impeccable.cmd detect --json app/components/WikiLintPanel.tsx app/pages/WikiPage.tsx app/wiki.css` | 仅命中共享 CSS 中 5 个基线已存在的侧边线样式，逐条以 `git show HEAD:app/wiki.css` 核对。新增 Lint 样式没有命中。 |
| `git diff --check` 限施工路径 | 退出 0。 |

正式资料核对只读冻结副本，浏览器写入验证使用 TEMP 的合成资料。模型调用仅使用合成会话的本地 fake。真实配置和模型访问次数为 0。施工进程已结束。

| 文件 | SHA-256 |
| --- | --- |
| `app/components/WikiLintPanel.tsx` | `ccbdfd454bd62cd67ef6b7cf0a3b68c5af9dcf1e99c663b9031b8278062ca995` |
| `app/pages/WikiPage.tsx` | `28065619f24fa1908380cca07f3dd513a22ffa60357f139f2dc88f67d1f6c1c8` |
| `app/wiki.css` | `d6527329f448ad9726e09af486afecd9beef54242a14a4a8ab2c655a31286990` |
| `tests/wiki-selection.test.tsx` | `6a2a9afa144b37b0027097626e3b26eca474c80849d0b6a21eacf94cb4bec968` |
| `tests/acceptance/qaui03-navigation.mjs` | `80d803254cf5235e58b67810fea6db73c2325ee0354e993d7c722c25fef84932` |
| `tests/acceptance/kbi01-review-browser.mjs` | `24bc1f44d99fc763256306c3cd5838f2b82eddccd8c5c5226e07dfbbde9408ef` |
