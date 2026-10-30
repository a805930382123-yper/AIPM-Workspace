# KB03 R1 主线程静态视觉核验

日期：2026-10-30；基线 b932f5760e1c214086b91026154b32489e5352ea 加本轮未提交变更。施工生成真实 renderStructuredNote → react-markdown SSR 静态 HTML：`C:\Users\DAVID~1.CHE\AppData\Local\Temp\kb03-preview-hQ2D6e\structured-note.html`。虚构样例，无 Provider、无正式数据。

主线程用仅提供该 HTML 的 Node HTTP 服务（127.0.0.1:5189），经 CUA 在 Chrome 新建标签实际打开。读取完整 AX 后截图顶部，滚动一屏再次读 AX 并截图底部。观察结果：五类内容齐全，标题层级清楚；表格两行三列按“列名：值”列表保持关联，长中文正常换行；节点与箭头关系可见；原文支持、整理归纳、补充知识未经原文支持、待核实四类标识及原因、fact-1 引用、100家/20家/20%数值完整可见，无裁切或横向溢出。

截图：[顶部](KB03-R1-20261030-preview-top.png)、[底部](KB03-R1-20261030-preview-bottom.png)。这是静态渲染证据，不代表产品 UI、网格表格或深度流水线完成。最终 R1 门禁由独立验收裁决。

清理：实际关闭本轮 Chrome 标签；Node 静态服务通过自有执行会话 Ctrl+C 停止，进程 exit 1（人工中断）。未关闭用户工作台或其他标签，TEMP 预览保留。
