# KBI01 独立验收

受验工程提交：39c8e0f396609f303913c2443433cd87c7d93f58。独验实例 Gibbs 未参与产品施工。使用 TEMP 合成知识页及本地模型替身，不评估真实模型回答质量。

- 定向测试：`node --import tsx --import ./tests/support/css-stub.mjs --test tests/lw03-core.test.ts tests/lw03-http.test.ts tests/lw03-ui.test.tsx`，18/18；主会话另含 UIFIX04，21/21。类型检查及生产构建通过。
- 浏览器：以 `node --import tsx scripts/lw03-isolated.ts` 启动隔离夹具，`node tests/acceptance/kbi01-review-browser.mjs <isolated-session.json>` 操作真实 Chrome。1440×900 和 390×844，窄屏无横向溢出。历史目录读取错误通过停用夹具文件监听解决，没有修动历史资料。
- 单页检查、四维状态、默认折叠及无自动改页提示可见；变更当前选择后，快捷重跑仅新增一次请求，沿用原页并开启相关知识。勾选建议可生成草稿；返回结果页重开相同草稿。正式 Wiki、Raw 文件哈希在检查、重跑、草稿与页面跳转后均不变。
- 键盘 Tab 可见焦点、Enter 展开说明与激活 Lint；结构检查标签选中且接口 HTTP 200。请求与哈希实测记录在临时目录 lw03-browser-nHNLPi/review.json。

局部结论：结果区表达与交互缺陷关闭，补验三项通过。整批结论：冻结标准满足，PASS。
