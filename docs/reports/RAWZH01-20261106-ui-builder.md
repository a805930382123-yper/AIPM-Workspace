# RAWZH01 UI 施工交接（2026-11-06）

Sol High UI 施工实例 `/root/kb03_r1_planner/lw03_ui` 已停写，交 Astra 独立复审。改动沿 RAWURL01 与 RAWUX01 工作树基线，基准 HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b`，实际版本见 7 文件 SHA。

仅 URL 导入表单显示默认勾选的“翻译成中文（会调用已配置模型）”，随提交发送 `translateToChinese`。文件或正文优先时不发送翻译意图。成功先显示保存的 Raw，再由详情读取并轮询活动翻译任务。完成默认显示完整 AI 中文译文，可切原文。原文证据沿现有 SHA 和偏移定位，自动显示并高亮英文原句。失败保留原文和同 Raw 重试，取消后可明确继续，刷新仅 GET。若导入已成功而翻译状态未能落盘，首个导入响应仍可在同 Raw 上显示失败及重试。

## 验证

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawzh01-ui.test.tsx tests/rawurl01-ui.test.tsx tests/ui.test.tsx tests/ui-interaction.test.tsx tests/ui04-interface.test.tsx`，21/21。新增覆盖仅 201 返回的启动失败仍可同 Raw 重试，拒绝显示不同源 SHA 的译文。旧 RAWURL01 UI 用例更新默认意图字段，保留原路由、材料优先与仅保存断言。
- `npx tsc -b --pretty false` 退出 0。空 envDir 隔离构建 227 模块成功，现有 bundle 体积提示保留。所改已跟踪文件 `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check -- app/api.ts app/pages/RawPage.tsx app/raw.css tests/rawurl01-ui.test.tsx` 通过，7 文件无行末空格。默认全量由后端 Sol 合跑。
- `node tests/acceptance/rawzh01-builder-browser.mjs C:/Users/DAVID~1.CHE/AppData/Local/Temp/rawzh01-ui-llbi4z/isolated-session.json` 退出 0。完整 App、实际本机 Chrome、真实本地 HTTP fixture、真实导入/持久译文服务和 fake Provider。默认英文一次翻译，完整保段落，自动中文且可切原文。刷新无 POST。取消勾选英文、主要中文、粘贴和文件没有额外模型请求。翻译失败可读原文，重试同 Raw、没有再次抓取。取消后保留原文及明确继续入口。用户另行发起真实整理，生成的草稿证据可打开并精确高亮英文原句。最终 Raw 与翻译前的正文、SHA、来源一致。浏览器页面错误、外部请求和真实模型调用均为 0。
- `RAWZH01-20261106-evidence/builder-browser.json` 记录 10 图、请求与计数，已亲看默认勾选、中文阅读、失败仍可读英文和证据定位图。翻译 4 次 fake 调用含受控失败和取消，整理 3 次 fake 调用发生在用户单独明确操作后。

## 隔离入口

项目根运行 `node --import tsx scripts/rawzh01-isolated.ts`。每次创建 TEMP 数据根、空 Vite envDir 和 TEMP 输出目录。stdout 与根下 `isolated-session.json` 包含 `pid/url/api/root/envDir/outDir/fixtures`，fixture 提供英文、取消勾选英文、中文、失败重试、慢翻译和不可用 URL。浏览器脚本可指定独立证据目录。`GET /__control/counters` 记录本地 fixture 请求、fake 翻译和整理次数。`POST /__control/provider` 的 `available:false` 供未配置反例，只有隔离服务提供这个入口。

自有隔离进程 5104 已停止，TEMP 数据与证据保留。用户后台服务没有操作。真实 Provider、配置和正式 workspace 访问均为 0。模型语义质量与整批验收按各自证据裁决。
