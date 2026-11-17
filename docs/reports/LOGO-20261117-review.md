# Logo 独立验收（2026-11-17）

本轮品牌交付通过。实际 Chrome 桌面截图可见靛紫 A、三路汇聚的箭头和 AIPM / Workspace 字标，标志和主导航各有独立空间。窄屏实际渲染的图标、字标和导航完整，布局尺寸核对通过。Favicon 的构建接线与静态资源响应通过，原生标签栏显示未验。

验收以用户提供的紫色 A、三路向上箭头与 AIPM Workspace 参考为准。按 frontend-design 技能核对颜色、字标和布局。基线 `205f0abd9a8e89d9ea0d94366e2072e746ee7551` 加本轮差异。对 `%TEMP%\aipm-logo-20261117-baseline\` 执行 `git diff --no-index`，确认 App.tsx 增量仅为导入 Brand 和替换侧栏品牌行，index.html 仅增加 SVG favicon 引用。检查了 Brand.tsx、brand.css 和新 SVG。`git diff --check -- app/App.tsx index.html` 退出 0，只有既有换行提示。复用施工 `npm run build` 退出 0（237 modules，已有大包提示）。

Chrome 预览使用 Node v24.18.0 在 `127.0.0.1:5196` 提供 `dist/`。后续静态预览通过独立 `node:http` 进程提供页面和资源，`/api/stats` 显式 404。桌面实际视口 1745×937 CSS px，标志约 42px，侧栏截图显示 Logo、字标与导航对齐，截图保留在会话工具结果。窄屏设置 432×930 后受 Chrome 缩放影响，实际视口 393×845 CSS px，标志约 34px，品牌行高约 39px，字标完整，导航从其下方约 9px 开始，页面滚动宽度 379px。窄屏截图 CDP 超时，窄屏依据实际 DOM、图像解码与布局尺寸。已复原视口并关闭本轮标签和预览进程。

`Invoke-WebRequest` 验证 `/aipm-mark.svg` 返回 200、`image/svg+xml`。`Get-FileHash public/aipm-mark.svg,dist/aipm-mark.svg` 返回相同 SHA-256 `8E2107512677BA805202BE3C669CBE1D33D862A431F49DCAC25C5227A9481666`，`dist/index.html` 指向该文件。受控 Chrome 标签的图标由 Codex 会话徽标覆盖，未签原生浏览器标签栏视觉。

首次 Vite preview 继承既有 API 代理，首页自动发出 GET 并读取了既有服务状态。发现后结束该预览，改用无代理的静态服务完成截图与尺寸核对。没有发起业务写入，也未截图初次预览。

PIPE01 继续沿用其独立验收记录，本轮只验 Logo、侧栏布局和 favicon 资源。其他工作区差异排除在本轮范围。验收者仅新增本记录，未提交。
