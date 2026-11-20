# NEWS18 独立验收

**本轮施工通过。** Karpathy 的四个来源归入同一人物抽屉，缓存徽标的提示列出受影响的平台。桌面和手机均能直接切换平台、浏览原文及保存 Raw。

**NEWS18 整体验收通过。** GPT-6.2 Astra Medium 在施工停写后独立检查前端差异、构建和浏览器行为。工程提交为 `00d7496eba6baf7ba57dc0918feaadfd96a4c135`。已用 `git ls-tree -r 00d7496` 比对提交中六个文件，均与受验版本一致。

| 文件 | 冻结版本 |
| --- | --- |
| app/news.css | `034cee294ff497aa1a6d055cbda9b408379a13fe` |
| app/pages/NewsPage.tsx | `2220efbb317336275d316d360b250ff6fed9a637` |
| app/pages/NewsReading.tsx | `a9be201c000585f914ff1b5aa09fc5755da83ae1` |
| app/pages/SourceLogo.tsx | `7e14fe196003fbe92c4b30b2e895f407d3d9355a` |
| app/pages/newsSourceDisplay.ts | `9752bfaff12d5ac22a36e947d4e3e49fd19a0524` |
| tests/news18-persona.test.tsx | `225e0410afa7b599c6362faa25353f3340bbab7d` |

## 实测结果

| 检查 | 结果 |
| --- | --- |
| 人物身份、聚合和诊断 | 四个平台的五篇材料合为一个 Andrej Karpathy 抽屉，头像解码成功且无角标。标题显示 5 条及最新日期 2026-11-20。四个独立的 16×16 像素平台图标各有名称和数量提示。AIHOT 是另一个普通抽屉，保留官网和文章链接。侧栏展示五条独立来源诊断。 |
| 阅读与切换 | 打开人物抽屉即见“全部”与四个平台，胶囊按最近发布时间依次为 GitHub、YouTube、X、Bear Blog，数量为 2、1、1、1。“全部”列表各卡有相应平台名称及图标，按有效发布时间排列，日期无效的 GitHub 条目位于末尾。切回 GitHub，该条目按原渠道的抓取时间回到首位。四个胶囊分别指向正确官网。 |
| 缓存提示 | 在仅 X 失败的期刊中，顶部“含缓存渠道”的提示列出 X，X 胶囊显示缓存点。整期失败回退至两渠道历史期刊时，顶部提示同时列出 X 和 Bear Blog，两个胶囊均显示状态点。 |
| 筛选与日期 | 选中 Bear Blog 后点“仅今日更新”，按上海日期保留 GitHub 及跨 UTC 日期的 YouTube 两项，选中状态回到“全部”。在历史期刊分别验证过滤后只剩 X 的普通抽屉、零来源的空状态。切换日期后恢复首个抽屉展开、阅读筛选为“全部”。“全部展开”和“全部收起”均对两个一级抽屉生效。 |
| 文章与保存 | 浏览器展开及收起长摘录，切换中文和原文，点击“保存到 Raw”。隔离服务的保存投影返回原 GitHub 条目 ID 和 saved，读回 Raw 正文与来源英文逐字相同。手机的新浏览器会话直接显示已保存及“查看 Raw”。 |
| 布局 | 1440×900 下四个平台图标、标题与数量单行排列。390×900 下图标簇与标题分行，胶囊自然换成两行，抽屉左右边界分别为 16px、374px。两种视口的文档宽度均等于视口宽度，选中胶囊为淡紫色，普通胶囊白底。逐张检查截图，浏览器未报告页面异常。 |

## 独立执行

- `npm.cmd run build`。TypeScript 及 Vite 均通过，248 个模块，主包有体积提示。首轮受 Windows 沙箱 realpath EPERM 限制，获准后重跑成功。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news13-integration.test.tsx tests/news16-ui.test.tsx tests/news17-source-logo.test.tsx tests/news18-persona.test.tsx`。Node 22.23.5，6/6 通过。
- `node .scratch-news18-independent/browser.cjs`。使用 Node 22.23.5、Edge 和 Playwright，从首页“阅读资讯”进入生产构建。脚本为本次运行新建隔离数据目录与空模型配置，并在 127.0.0.1:49583 启动应用。使用三期合成数据，隔离替代首页触发抓取、翻译响应及专门测试的整期失败读取。日期查询、历史期刊、保存、读回 Raw 以及页面静态资源均经本地应用服务。真实外网抓取与模型翻译不在本批验证范围。
- 本机证据位于 `.scratch-news18-independent/` 中的 `browser.cjs`、`checks.json`、`desktop-1440.png` 和 `desktop-390.png`。
