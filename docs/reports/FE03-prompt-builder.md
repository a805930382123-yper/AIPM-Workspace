# FE03 Prompt 页面施工交接

日期：2026-11-26。依据 [冻结任务卡](../handoffs/FE03-task.md)，产品基线 `3e19e24dae8c19e79e388393033563126ddb7345`，本交付为未提交文件指纹版本。按用户级 `agent-router` 的 B 模式执行，当前实例仅承担 Prompt 施工与自查；独立验收、集成验证、提交推送和远端 CI 由主 Agent 与独立验收者完成。

## 结论与边界

- **本轮 Prompt 施工范围：自查通过**。原页面 56,216 B / 1,480 行降至 10,949 B / 315 行；全部 8 个产品模块严格低于 40,960 B / 800 行，无内部循环依赖、无子模块反向导入页面入口。
- **FE03 整批：待独立验收与 CI，当前不签整体 PASS**。未在本施工实例执行真实 Edge/Chrome 验收、默认全量测试、全仓检查、远端同步或 CI。施工自查不替代这些门禁。
- 仅修改任务卡所授 Prompt 页面、其内部目录、新测试及本报告；未修改后端、API、公共 hooks/router、CSS、依赖、规则或既有测试，未提交。

## 文件与职责映射

| 文件 | 原职责迁移 | 字节 / 行 |
|---|---|---|
| `app/pages/PromptLibraryPage.tsx` | 保留原公开导出和参数，组合工作台、列表、编辑、历史与详情 | 10,949 / 315 |
| `app/pages/prompt/usePromptLibrary.ts` | 原 75 条状态、ref、effect、衍生值和操作声明保持顺序迁移；生成器回库回调迁入 `openLibrary` | 24,170 / 631 |
| `app/pages/prompt/promptState.ts` | 原输入转换、CSV、requestId、变量签名及 CopyState/Preview 内部类型 | 1,952 / 53 |
| `app/pages/prompt/PromptEditor.tsx` | 原编辑表单及 props | 6,412 / 175 |
| `app/pages/prompt/PromptDeleteDialog.tsx` | 原删除确认、焦点、Escape 与忙碌关闭锁 | 1,949 / 64 |
| `app/pages/prompt/VersionDetail.tsx` | 原历史只读详情及 props | 4,066 / 115 |
| `app/pages/prompt/PromptDetail.tsx` | 原当前详情、变量、预览、复制与版本列表及 props | 9,738 / 261 |
| `app/pages/prompt/Meta.tsx` | 历史与当前详情共用的原 Meta 组件 | 186 / 8 |
| `tests/fe03-prompt-split.test.tsx` | 模块边界与两个完整页面实例的异步隔离 | 7,866 / 186 |

未拆开 selection/list/history/render 世代、busy token、requestId 与 inflight 所有权；未改原 ref 同步 effect。用 TypeScript AST printer 去掉注释、归一空白后核对：5 个迁移组件函数体与基线一致，75 条原状态与操作声明顺序及内容一致。入口生成器回库的原回调仅迁移到 Hook，操作顺序保持原样。AST 核对工具先前一次因使用了错误的 printer sourcefile 产生误报，修正工具后通过，产品代码未因此改动。

## 实测证据

运行时 Node `v24.22.1`。以下命令的 `node` 显式指向宿主提供的该版本可执行文件；按证据规范不记录本机绝对路径。

1. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/prompt-ui.test.tsx tests/uifix01-ui.test.tsx tests/uifix04-ui.test.tsx tests/fe03-prompt-split.test.tsx`
   - **26/26 通过，0 失败、0 跳过**，退出码 0。
   - 测试环境：新建 `os.tmpdir()/aipm-fe03-prompt-<random>`，`FMCG_DATA_DIR` 指向该目录，`FMCG_LLM_CONFIG_FILE` 指向其中不存在的文件；清除继承的 `FMCG_LLM_*`、`EMBEDDING_*`；运行后清理目录。新增测试 fetch 全部由本地 stub 接管，未匹配请求直接失败，未调用真实 Provider。
   - 既有用例覆盖切换/迟到响应、变量预览签名、剪贴板失败手动复制、历史只读、409 保留输入、重叠新建 requestId 所有权、重复选中历史刷新、删除 Escape/焦点/忙碌锁，以及生成器保存后清筛选选中新模板。
   - 新增 2 项：体积/行数/无环/无反向入口导入/入口运行时导出兼容；两个完整页面并存时左侧在途 render 不锁右侧，右侧独立生成预览，左侧换记录后迟到结果不覆盖新选择或右侧变量/预览。
2. `node node_modules/eslint/bin/eslint.js app/pages/PromptLibraryPage.tsx app/pages/prompt tests/fe03-prompt-split.test.tsx`
   - **0 errors / 0 warnings**，退出码 0。
3. `node node_modules/prettier/bin/prettier.cjs --write app/pages/PromptLibraryPage.tsx 'app/pages/prompt/*' tests/fe03-prompt-split.test.tsx`
   - 仅格式化自身改动；随后同范围 `--check` **通过**，退出码 0。
4. `node node_modules/typescript/bin/tsc -b`
   - 最终运行 **通过**，退出码 0。首次在另一施工者尚写入 Draft 文件期间运行见暂态语法错误，未改他人文件；待共享写入稳定后复跑通过。
5. 临时内联 Node 脚本通过 `git show <基线>:app/pages/PromptLibraryPage.tsx` 与 TypeScript AST printer 核对 5 个组件函数体及 75 条状态/操作声明；通过 `node:crypto` 计算下列 SHA-256。脚本未落仓库。

## 未提交交付指纹

| 文件 | SHA-256 |
|---|---|
| `app/pages/PromptLibraryPage.tsx` | `e73ed0917f046408e26729b3aea16d755fe380dfdf7a393738055bf6787072ba` |
| `app/pages/prompt/Meta.tsx` | `329943f72ccb282a07bb428a6cb73cacd0b8eb14b617f195e59d7f0cc782a47b` |
| `app/pages/prompt/PromptDeleteDialog.tsx` | `460ccea69c40c08ad401c619ed97b1513093c9bb5dbebc99fd013c7e7593a3bf` |
| `app/pages/prompt/PromptDetail.tsx` | `d65615dfe6e741d2c463c11c790769197ed0a12b2f502d58a317693ec8b1cce7` |
| `app/pages/prompt/PromptEditor.tsx` | `b4267093e434a97288f8d69ac5f4c7a44f98286fa98b3a7e775cf79f51f632c4` |
| `app/pages/prompt/promptState.ts` | `0eb09db7962482ff4f89f2369e3d1ebb6fd99c6248c7fb6bdc225d5085a09a25` |
| `app/pages/prompt/usePromptLibrary.ts` | `1dc16799a821d6bb6a8353caa5e4be24f46953cf858cc2add601b045a829d15a` |
| `app/pages/prompt/VersionDetail.tsx` | `2fdad50b2ceb4335257408d101d52ce094f8c58b62f16c747c94b41ecb714f95` |
| `tests/fe03-prompt-split.test.tsx` | `3c0dbbba5ae304c33d3c395c6dc57633652c4dd38b3601f2fd20c6a04880af81` |

交接后本施工实例停写。无待主 Agent 裁决的扩围事项；若独立验收发现缺陷，由主 Agent 将具体复现返给本施工者。
