# NEWS13 独立验收

工程提交 `c7d7fa3fb37ef52cca59c99c937766e83e6b6376`。局部改动 PASS。新增八个来源的入口、读取结果与失败隔离、精选满额后的来源浏览及手动保存通过。整批按任务卡 PASS。Karpathy Bear Blog 本次受到 HTTP 403 限制，其在线正文抓取仍未验证成功。

## 独立测试

运行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news13*.test.*`，8/8 通过。覆盖来源归属、请求预算、摘录与摘要标识、部分失败和重定向。隔离服务样例以 AIHOT 五条开局，手动检查后五条顺序保持，来源列表增加一条；跨来源重复链接排除。重启服务后保存新增视频、重复保存返回同一 Raw，正文、链接、日期与作者符合期刊。该样例模型工厂调用为 0。主会话另报相关回归 88/88、typecheck 成功。

## 实采复核与真实页面

主会话首次读取时 AIHOT 有五条、四个编辑源各三条、Karpathy GitHub、YouTube、X 各五条，Bear 403。独验复制主会话第二次实采的 `%TEMP%/news13-live-ZTPMbw/state/news/2026-11-20.json` 到独立目录 `%TEMP%/news13-edge-review`。第二次 AIHOT 也暂时失败，其余七个来源共取得 27 条。

使用 `node --import tsx server/index.ts`（隔离数据目录、空配置路径、AI 关闭、API 4493）及 `node node_modules/vite/bin/vite.js --port 5173`。Edge 打开首页，进入「阅读资讯」，看到精选五条（Cookbook 三条、Anthropic 两条）。按来源展开的其余 22 条为 Anthropic 1、Hugging Face 3、Simon Willison 3、Karpathy GitHub、YouTube、X 各 5。来源诊断含九个官方入口，Bear 行显示 403。该次 X 有公开帖，覆盖范围限于源返回的数据。

在 YouTube 组选择《How I use LLMs》，页面标识作者及「视频简介」。点击保存后显示「已保存 · 查看 Raw」。检查 TEMP 中生成的 Markdown，来源链接为原视频，发布日期为 2025-02-27T22:29:56Z，摘录说明保留作者与材料类型。临时 UI 端口 5293 首次保存被可信来源校验拒绝；在默认受信端口 5173 完成上述操作。浏览器核验脚本为 `node "$env:TEMP/news13-edge-review/verify.mjs"`。本轮手工保存仅发生在独立目录。
