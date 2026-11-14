# RAWEDIT01 施工与自查

2026-11-14，Sol High。基线 HEAD `8264aba50b58be6c415be0124499a8977f3197fb`。本轮两个产品文件和两个测试文件已冻结，交由 Astra 独立验收。

## 变更与复现

- `RawOutcomeReview.tsx` 将主题编辑入口移到卡片正文预览前，继续使用现有编辑表单。标准旧草稿的编辑字段为标题、说明与整理条目，完整事实和引用可在预览中阅读。PDF 和维护候选编辑完整 Markdown。
- 基线定点测试中，编辑时「返回」和「查看原始资料」各触发一次离开，预期均禁用。现同时保护本组件的 Raw 引用及 Wiki 跳转，并显示保存或取消的指引。未保存时禁用确认。主侧栏的全局导航仍沿用当前应用行为，按任务卡未纳入本轮。
- 保存后按实际内容摘要变化清除选择及旧确认请求。主题编辑只清该主题，来源笔记和深度笔记清空本次选择。取消保留原选择。后端继续以版本和摘要拒绝旧确认。
- 基线中维护 POST 已保存、GET 503 仅显示读取失败。现保留输入并说明草稿已保存，显示只发 GET 的恢复按钮，恢复前冻结确认和取消。标准保存失败继续显示服务端错误及原输入。
- 基线深度笔记编辑没有取消入口。现取消恢复笔记与排除项、原文问题选择、人工问题，解除脏状态。保存期间禁止并行操作，保存失败保留输入。

## 自查结果

| 检查 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/lw01-maintenance.test.ts` | 11/11，新增定点 3 项、PDF UI 5 项、LW01 维护 3 项 |
| `node --import tsx --test tests/pdf02-http.test.ts` | 8/8，含旧摘要拒绝、证据保持、选择后提交及 62 页合成链 |
| `node --import tsx tests/acceptance/rawedit01-browser.mjs` | Chrome 1536×1050，真实完整 App、API 和隔离存储，退出 0 |
| `impeccable.cmd detect --json app/pages/RawOutcomeReview.tsx app/components/StructuredNoteEditor.tsx` | `[]`，已查看最终运行四张截图 |
| `git diff --check -- app/pages/RawOutcomeReview.tsx app/components/StructuredNoteEditor.tsx` | 退出 0，Git 提示以后工作副本行尾转换 |

范围严格类型检查退出 0，检查产品入口及其导入图、Vite 配置和新 TS 测试。命令如下。旧 `tests/lw01-raw-ui.test.tsx` 单跑在第 1 行第 0 列因已有不可解析字符 `Unexpected �` 失败，未修改旧文件。本轮未运行全仓测试。

```powershell
$ts = @('node_modules/typescript/bin/tsc','--noEmit','--target','ES2022','--lib','ES2022,DOM,DOM.Iterable','--module','ESNext','--moduleResolution','Bundler','--allowImportingTsExtensions','--resolveJsonModule','--isolatedModules','--jsx','react-jsx','--strict','--noUnusedLocals','--noUnusedParameters','--noFallthroughCasesInSwitch','--skipLibCheck','--types','vite/client,node','app/main.tsx','server/index.ts','vite.config.ts','tests/rawedit01-ui.test.tsx')
node @ts
```

浏览器脚本以内存 fake 生成隔离样本，随后用空 Provider 配置启动真实产品服务，并通过空 `envDir`、`configFile:false` 和 React 插件执行 Vite 生产构建。构建转换 233 模块且成功，Vite 提示 JS chunk 超过 500 kB，合成 PDF 生成有字体提示，页面无运行异常。

- PDF 多段正文与 Markdown 原样持久化，刷新后显示更新并可打开原页。取消零写入。保存后注入 GET 503 可只读恢复，旧摘要确认 409，另一项的原选择保持。
- 标准主题注入 PATCH 503 时保留内容且版本未变，重试保存标题、说明、两段整理内容。独立来源草稿的标题与正文也保存并刷新读回，清空全部选择。旧来源事实、引用不变，并在应用内打开原句。
- 深度维护候选保存标题与正文，旧主题审批失效。深度笔记取消零写入，服务端空定位校验和并发 409 均保留输入。重开读回并发版本后，重新保存人工定位，清空选择和旧笔记审批。深度来源单元不变。
- 三份草稿均先断言 Wiki 为空，再分别由浏览器显式勾选和确认，读回三条主题与三条来源。最新编辑和来源关系匹配，已入库主题没有编辑入口。隔离 Raw 三条记录、PDF 原件字节和 PDF 页证据目录指纹保持一致。fake 样本生成调用数 PDF 6、Raw 9，编辑和确认前后不增长。

运行证据见 [浏览器 JSON](RAWEDIT01-20261114-builder-evidence/browser-result.json)、[编辑长 PDF 正文](RAWEDIT01-20261114-builder-evidence/01-pdf-editor.png)、[重新读取已保存草稿](RAWEDIT01-20261114-builder-evidence/02-pdf-readback-retry.png)、[深度版本冲突](RAWEDIT01-20261114-builder-evidence/03-deep-stale-input-retained.png)、[PDF 显式确认](RAWEDIT01-20261114-builder-evidence/04-pdf-explicit-confirm.png)。

最终浏览器子进程关闭，隔离 UI 61556 已关闭，隔离 API 61525（PID 16348）已退出，脚本 PID 29072 退出 0。隔离目录 `%TEMP%/rawedit01-k0DE0L` 保留。真实 Provider、正式 workspace、已有用户服务均未参与。没有提交、推送或部署。

## 冻结指纹

| 文件 | SHA-256 |
| --- | --- |
| `app/pages/RawOutcomeReview.tsx` | `3A3100FD56DE90DD7AAEA7E427F95C02D5D267CC3CC3E1E701F068F268505C16` |
| `app/components/StructuredNoteEditor.tsx` | `D3A57C41F5476F87814F9B38561B569E0827304A9AF2AC3A97CD80976DBB2C01` |
| `tests/rawedit01-ui.test.tsx` | `051309784D6158633786DA530363DB39B763DD672D56260019BAE4727BA7F4AF` |
| `tests/acceptance/rawedit01-browser.mjs` | `55061A84F1F59556C79F79E8322FCB8C999591AC5712F4383E0477E44E8BAAEE` |
