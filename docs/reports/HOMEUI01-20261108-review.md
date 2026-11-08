# HOMEUI01 独立验收

本轮首页实现及两个交互问题修复通过，HOMEUI01 H01–H05 整体通过。桌面工作台左侧为任务流，右侧为到期跟进和独立每日资讯。手机先显示任务，再显示到期跟进与资讯。

基线 `7998f27d9b885fd275b77d0bbf29dbbbb3a000ee`，受验产品提交 `8a8d7741fc70755a6c0c16414c0badf9f10b8b13`。`git diff --exit-code 8a8d774 -- app/pages/HomePage.tsx app/home.css` 无差异。最终 `HomePage.tsx` SHA256 `A0E8D46020D3E8114A8870D40C8CB08A3FD4BFA211DBC8D5AE89ADD5B45E72E3`，`home.css` SHA256 `CA57178935BF9B073049D96395E118B1D3622FA38A9E23066C524991B58E474B`。评分 0/1/1/0=2，A 标准。规划 `/root/qaui_plan`（Astra Medium），施工 `/root/qaui_builder`（Terra High），独立验收 `/root/qaui_review`（Sol High）。[冻结任务卡](../handoffs/HOMEUI01-20261108-task.md) · [施工记录](HOMEUI01-20261108-builder.md)

| 验收项 | 独立实测 |
|---|---|
| H01 主次布局 | Chrome 1440px 下四入口之后主任务和右栏顶边对齐，宽度分别为 720px、360px；右栏两个卡片纵排。1024px 时主任务占满 746px，之后为并排的到期跟进和资讯卡。有任务和任务空态均已截图。 |
| H02 手机与可达性 | 390px 下任务、到期跟进、资讯三个区域依次纵排，实际宽度均为 358px。极长无空格标题和部分来源失败文本换行，主区域无横向溢出。Tab 可到达四入口和四项更多工具，焦点可见。共享侧栏的既有横滑属于全站导航。 |
| H03 去重与入口 | 导入资料和生成 Prompt 各保留一个首页入口；审核草稿筛选、创建会议、周期回顾仍可用。四项更多工具分别打开 Raw 选择器、新建 Wiki、新建 Prompt、结构检查。单一 NewsHome 卡显示模拟状态，“阅读资讯”进入资讯详情。产品提交不含 NewsPage 或新闻服务。Prompt 生成入口已实际打开目标工作台，本地夹具没有提供生成器专用 schema，工作台之后的生成行为未测。 |
| H04 任务行为 | 审核草稿只显示相关待审项目，显示全部可复位；再过滤后点 Open Audit 统计可看见纠错事项。稍后处理可见。打开任务先发送版本标记，合成 409 留在首页并显示错误；恢复后打开指定 Raw。到期刷新再次请求到期列表，查看进入同一事项 ID。首次行动请求失败结束加载文案，显式刷新后显示返回的事项和来源错误。 |
| H05 隔离回归 | 有任务、真空列表、首次失败和部分来源失败均覆盖。页面异常 0，所有 App 请求只到该次回环服务，真实资讯与模型调用 0。独立定向测试 8/8。复用施工同文件类型检查与空环境生产构建。 |

`node tests/acceptance/homeui01-review.mjs` 与 `node tests/acceptance/homeui01-review.mjs --visual` 均退出 0。Chrome 156.0.8078.80 运行实际 Vite App，回环 Vite 中间件返回固定合成响应，未连接产品后端。NewsHome 的准备请求由该中间件接收并直接返回样本。首次尝试时 Vite watcher 扫到不可读的历史 AUTO01 证据目录而退出，独验脚本关闭 watcher 后完成，原目录未动。两次完成后均关闭 Chrome 和 Vite。[独验脚本](../../tests/acceptance/homeui01-review.mjs) · [浏览器结果](HOMEUI01-20261108-evidence/review-browser.json) · [正常数据截图记录](HOMEUI01-20261108-evidence/review-visual.json)

独立执行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l3-actions.test.ts tests/lifeos-l3-navigation.test.tsx tests/homeui01-ui.test.tsx`，8/8。TEMP/TMP 指向专用缓存。复用施工隔离源码的 `node ../../typescript/bin/tsc -b`，退出 0，七个既有受损测试只在副本补齐 HEAD 正文，名单见施工记录。复用空 envDir 的 Vite 生产构建 `build({configFile:false,root,envDir,plugins:[react()],build:{outDir}})`，232 模块，退出 0，仅既有大包提示。未读取正式数据、配置或访问用户服务。

[正常任务桌面](HOMEUI01-20261108-evidence/review-desktop.png) · [正常任务手机](HOMEUI01-20261108-evidence/review-mobile-workspace.png) · [桌面空态](HOMEUI01-20261108-evidence/review-empty-1440.png) · [手机长标题](HOMEUI01-20261108-evidence/review-populated-390.png) · [手机部分失败](HOMEUI01-20261108-evidence/review-partial-error-390.png)
