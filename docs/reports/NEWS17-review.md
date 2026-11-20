# NEWS17 独立验收

工程提交 `d101ca9940afc2dba766aa67035f66f4f3e404a4`。独立验收者 GPT-6.2 Astra Medium。产品文件与该提交的 git diff 为空。

**本轮返修通过。** KPMG 从官方矢量图渲染为 128×50，本地和生产响应一致。短品牌缩写保留大小写，PwC 图像加载失败的回归断言通过。

**NEWS17 功能验收通过，两个来源有原图分辨率限制。** 来自两个栏目注册表的 15 个来源使用 12 张真实本地图像，两个头像辨别清楚，Karpathy 四渠道共用头像并显示不同的平台角标。国家统计局为官方 16×16 favicon，Worldpanel 为官方 32×32 W 标记。小尺寸可识别，但高像素密度屏上的清晰度受原图限制。其余图像有九张 128×128，加上 128×50 的 KPMG。

## 实测记录

在项目根运行以下检查。浏览器生产服务绑定 127.0.0.1:49571，使用独立临时数据目录，新闻 API 由浏览器提供含真实来源 ID 的合成期刊，图标请求由生产服务直接响应。验收用脚本及四张截图在本机 `%LOCALAPPDATA%/Temp/NEWS17-independent`，没有写入正式工作区数据。

| 命令或方法 | 结果 |
| --- | --- |
| `npm.cmd run typecheck`、`npm.cmd run build` | 退出码 0，Vite 构建 247 个模块，有主包体积提示。项目没有独立 lint 命令。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news17-source-logo.test.tsx tests/news13-integration.test.tsx` | 4/4 通过，包括名称、ID、未知域名、无地址、稳定颜色及 PwC 图片失败。未运行全仓测试。 |
| `node --import tsx --input-type=module` 调用 React 服务端渲染 | 15 个注册 ID 和 15 个加入大小写、空格或标点变体的注册名分别渲染同一图像；4 个 Karpathy SVG 路径互异。 |
| `node --import tsx server/index.ts --production`，随后 `node "$env:LOCALAPPDATA/Temp/NEWS17-independent/browser.cjs"` | 12 个 URL 均返回 200 和图片 MIME，响应字节与仓库 PNG 完全一致。检查像素联系表并在 Edge 逐一解码。 |
| 同一浏览器脚本，1440×900 与 390×900，两者 DPR 2 | 每个视口实测 9 个 26px AI 抽屉图标位于箭头后、当期上限 5 个 16px 快消来源标签、6+9 个 20px 诊断图标。每个图像懒加载、异步解码、空 alt。机构为带内距白底圆角方形 contain，人物为圆形 cover。角标可命中，未被裁切，与诊断状态点分开。 |
| `node "$env:LOCALAPPDATA/Temp/NEWS17-independent/fallback.cjs"` | Edge 拦截本地 Karpathy 图像、GitHub owner 头像、Google S2 域名图标，另测无 URL，分别显示 KX、GH、CN、O，四个抽屉均无残留 img。 |
| 隔离副本运行 `node --import ./invalid.mjs scripts/fetch-source-icons.mjs` 两次 | 每轮交替注入 27 次伪装成 image/png 的 HTML、空内容、无效图像。12 个来源均生成 64×64 缩写 SVG，两次输出的 SVG 和清单 SHA-256 均一致。另用 12 张有效 PNG 和真实清单重复两次，无网络请求，所有哈希一致。隔离脚本与冻结脚本 SHA-256 相同。 |
