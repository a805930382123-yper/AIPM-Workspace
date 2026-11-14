# PDF01-GLOBAL 正式执行记录（2026-11-13）

正式Raw `b6dd4207-8afd-4e1f-8e66-4c0e40a24338` 已完成62页读取、54批清理、181标签全局目录（38主题）及11批写作。生产POST cleanup/draft生成待审核草稿 `a308bcd9-c4d0-44b2-87cd-99813e0ef1db`；没有确认Wiki。

累计145/150实际模型请求，剩5不调用。已知681526输入+205277输出=886803 tokens，5次失败无usage，不视为0费用。131全局目录成功；132连接超时；133、134原响应经独验修复后生产原样复用，不重复计费；135真实错误保留且不复用，136纠正后成功；141越界引用失败，142同参数有限重试成功，随后至145完成。

执行通过既有TEMP预算预加载器：发送前durable计数、总150限制、精确wire顺序、首失败停止。未改模型/凭据/配置；API中断后仅核目标failed状态再替换项目监听PID，未触及其他服务。最终预算API已停止，普通API session5151恢复，UI5173可访问，任务无自动继续。

本次运行产品与独验冻结见GLOBAL review；运行账SHA `ba711eb220ec5f25733b2d45622ba426571035d1dc46f70f9889f77c1b0dc538`，最终CP `11bcea7bdc5b293fac07d0dc947b3027bbddeacc57141ca9c4bba239cc8dd200`，草稿 `b80b0c6e3e1b4c13e2f607b1f34ed389ee5ac8e1b8e58c4ee3bb26bc293871b8`。R1 manifest `3025c68d1a2d0f0aa294a121d42458d29c88671d965e27a43d1876e48ec71396`保持。完整使用量与指纹在既有TEMP global7-final145.json，原响应均保留。

## 实际页面验证

命令 `node C:/Users/David.chen/AppData/Local/Temp/pdf-real-ui-full.cjs`。真实Chrome打开正式Raw→打开知识草稿→展开完整市场主题→展开后半美妆主题→展开PDF原页依据并GET原PDF。38成果卡可见，源PDF返回200。浏览器所有非GET API请求均拦截，未选择或确认入库。

截图和原始观察位于 `docs/reports/PDF01-GLOBAL-20261113-real-ui/`，四图对应概览、市场正文、后半品类和原页依据。工程/运行完成不替代真实内容质量判定；最终质量由独立review实例依据原材料与全草稿裁决。未提交推送。
