# RAWURL01 UI 施工交接（2026-11-06）

Sol High UI 施工实例 `/root/kb03_r1_planner/lw03_ui` 已停写并交 Astra 独立复审。工作树沿用 RAWUX01 已验基线，实际版本见 7 文件 SHA。基准 HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b`，没有新增提交。

现 Raw 表单使用文件、正文、链接的顺序选择导入材料。标签页只切换输入视图。已选文件跨标签显示并可移除，粘贴正文保留原样。仅链接时可空标题和来源，界面显示读取状态并通过真实导入接口保存 Raw。成功回到资料详情，可见原始链接、实际读取地址、读取时间和正文。链接读取失败保留输入与上传或粘贴替代。用户可在 Raw 页另行发起整理。重导入仍生成新 Raw，原件成功与部分写入界面延续原契约。

## 验证记录

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawurl01-ui.test.tsx tests/ui.test.tsx tests/ui-interaction.test.tsx tests/ui04-interface.test.tsx`，19/19。新增用例覆盖 URL 仅保存、失败保输入并粘贴补救、文件跨标签和解析失败无回退。旧重导入 SSR 用例按“预填链接、尚未选文件时只显示网页保存动作”更新，原格式、大小、预填和标签断言保留。
- `npx tsc -b --pretty false` 退出 0。使用 TEMP 空 envDir 隔离 Vite 构建 227 模块成功，现有 bundle 体积提示保留。`git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check -- app/api.ts app/pages/RawPage.tsx app/raw.css tests/ui.test.tsx` 通过，7 个文件无行末空格。默认全仓结果由后端 Sol 和 Astra 汇总。
- `node tests/acceptance/rawurl01-builder-browser.mjs C:/Users/DAVID~1.CHE/AppData/Local/Temp/rawurl01-ui-txTLVx/isolated-session.json` 退出 0。完整 App、真实 Chrome、实际服务端导入路由和解析器。真实本地 HTTP fixture 回应 302 与 HTML 正文，持久读回原 URL、最终 URL、读取时间和逐字正文 SHA。JS-only 返回 422，保留链接及明确替代。粘贴前后空白换行保持，文件与粘贴和坏 URL 同时存在时只采用文件，原件 SHA 一致。无效 UTF-8 文件返回 415 并保留原件，没有新增 Raw 或抓取回退。全部为空显示具体错误。浏览器外部请求、页面错误、模型调用与提取请求都是 0。计数中的实际本地 fixture 路径恰为 `/entry`、`/article`、`/script-only`。
- 最终 `RAWURL01-20261106-evidence/builder-browser.json` 含 8 图及检查。已亲看读取进度、成功来源、失败保留、跨标签优先与文件解析失败。首轮两项浏览器脚本准备偏差原记录分别保存，文本断言改为接受布局换行，无效 UTF-8 响应按原接口 415。首次看图发现失败提示会被固定底栏裁切，已移到表单顶部并以最终版本实图复核。

## 可重现隔离入口

项目根运行 `node --import tsx scripts/rawurl01-isolated.ts`。每次生成 TEMP 数据根、空 Vite envDir 和 TEMP 构建目录，输出及根下 `isolated-session.json` 含 `pid/url/api/root/envDir/outDir/fixtures`。fixture 键为 `entry/final/script/bad`。隔离应用注册产品 `registerRawImportRoute`，使用产品 `readPublicRawUrl`，仅在 fixture 依赖注入中把合成公网域名的 HTTP 请求接到本地服务器。生产 DNS、原生连接和代理不由这套浏览器 fixture 代验。

可运行 `node tests/acceptance/rawurl01-builder-browser.mjs <isolated-session.json> [证据目录]`。浏览器使用本机 Chrome 和 `--no-proxy-server`。自有最后进程 16488 已关闭，TEMP 数据与证据保留。无真实 Provider、真实配置读取、正式 workspace 访问或提交推送。整批结论以 Astra 独立验收为准。
