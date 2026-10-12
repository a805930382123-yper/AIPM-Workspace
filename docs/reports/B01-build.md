# B01 施工交付

施工范围为本地运行骨架、Raw 文本导入与六项真实统计。没有引入 LLM、上传解析、Wiki/Prompt 编辑、演示数据或删除操作。

## 交付内容

- `app/`：中文桌面工作台 UI，首页与 Raw 页面可用；其他导航项标明后续批次并禁用。
- `server/`：本地 HTTP API 与服务端输入校验。
- `services/raw/`：初始化、Raw Markdown 写入、列表和详情读取。
- `services/stats/`：从数据文件计算首页统计。
- `tests/raw.test.ts`：正文持久化、校验、隔离、统计与长文契约测试。
- `README.md`：Windows 启动方式、端口和数据位置说明。

Raw 单文件使用 UUID 文件名和 YAML frontmatter；标题不会参与路径生成。正文保留前后空白、换行、中文与 `---`，保存正文 SHA-256。写入先落临时文件再 rename；读取不会改写文件。六项首页数据为 Raw、Wiki、本周新增、待确认、Open Audit、Prompt；本周窗口为上海时间周一 00:00（含）至下周周一 00:00（不含）。

## 实际验证

- `npm install`：176 packages 安装完成，npm audit 报告 0 vulnerabilities。
- `npm run build`：TypeScript 检查与 Vite production build 通过，28 个模块构建成功。
- `npm test`：6 项契约测试全部通过。
- HTTP 自检：health 正常；API POST/GET 往返正文逐字符一致且返回 SHA-256；清理自检 Raw 后统计恢复为 0。
- 开发服务保持运行：UI `http://127.0.0.1:5173/`，API `http://127.0.0.1:4317/`。

沙箱执行中的 Vite 文件 realpath 与 loopback socket 检查返回 EPERM，因此通过提升执行运行 build、dev server 和 HTTP 自检；这属于本机执行权限限制。独立浏览器验收由 monitor 与主 Agent 完成。

## 尚未完成

B01 不包含 Wiki 创建/搜索/编辑、Raw 文件上传、AI整理、Audit、Prompt Library、数据导出或 production server。`npm run dev` 是当前本地开发运行入口。开源项目规则与实现复用记录由主 Agent整理。
