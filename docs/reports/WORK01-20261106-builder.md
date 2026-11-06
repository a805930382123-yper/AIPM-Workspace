# WORK01 施工交接

施工实例 `/root/work01_builder`。基线 `main` 上的 `43de87c375b5a0266031bce2a953f71b2aa3653f`。范围按 [冻结任务卡](../handoffs/WORK01-20261106-task.md)。施工自查完成，交 `/root/work01_review` 独立验收。

## 交付差异

- `app/App.tsx`、`app/pages/WorkItemsPage.tsx`、`app/pages/HomePage.tsx`、`app/styles.css`、`app/api.ts` 接入工作事项列表、快速建卡、三段详情与独立到期区。客户、项目、发生时间、等待对象、下一步与跟进日期可空。复制、记录实际发送、回复、复测、关闭与重开各由用户操作。
- `app/pages/RawPage.tsx` 增加经主线程批准的可选原文阅读入口。工作事项按关联 Raw ID 打开原始正文，其他入口沿既有默认阅读模式。关联被删来源在详情中有明确提示。
- `services/work-items/types.ts`、`services/work-items/store.ts`、`server/work-items-api.ts` 和 `server/index.ts` 接入按 revision 保存的本机记录、上海自然日到期查询及有归属检查的截图 API。截图边界含恰好 5 MiB。元数据保存失败时回收本次图像，保留先前记录。
- `services/storage/files.ts` 让原子文件写入口同时接收文本和字节。`scripts/backup_workspace.ts` 在原 v1 备份与恢复白名单增加 `work-items/`。`tests/work01-http.test.ts` 和 `tests/acceptance/work01-builder-browser.mjs` 记录可重跑验证。

## 实测

- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/work01-http.test.ts tests/auto02-actions.test.ts tests/lifeos-l5-backup.test.ts tests/meeting-minutes-backup.test.ts` 9 项通过。真实本机服务覆盖必填校验、可选值清空、无效日期、陈旧 revision、关闭重开、截图 MIME／签名／归属及大小边界。模拟 JSON 原子提交失败后旧文件与 revision 保留，本次图像未登记且已回收。导出恢复后重启服务读回同一事项、历史、三张截图原字节及 Raw，旧 v1 归档也能恢复。固定时刻验证上海午夜边界，损坏文件读取报告失败并保留原字节。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/app-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx tests/lifeos-l3-home-ui.test.tsx` 8 项通过。验证既有 Raw 精确定位、失效目标、迟到刷新及首页来源异常分离。
- `node --import tsx tests/acceptance/work01-builder-browser.mjs` 通过。使用实际 `server/index.ts` 和空 envDir 的 Vite 生产构建，228 模块，有既存包体积提示。Chrome 1440px 与 390px 完成创建、保存等待、当天和逾期展示、复制与确认已发送、回复和独立复测、上传与打开截图、查看指定 Raw 原文、关闭／重开、延期、重载、到期源失败及失效 Raw。中文译文入口使用浏览器内合成响应，检验工作事项链接仍显示原文。真实剪贴板断言通过，页面异常 0。七张图和浏览器结果见 [施工证据](WORK01-20261106-builder-evidence/)。
- 按 `tsconfig.json` 使用 TypeScript API 检查 `app`、`server`、`tests/work01-http.test.ts` 和 `vite.config.ts` 及传递引用，退出码 0。直接 `tsc -b` 遇到七个历史测试工作树文件为二进制，均在本轮改动范围外，已交主线程从 Git HEAD 原字节构建隔离检查。相关产品范围 `git diff --check` 通过。
- `impeccable.cmd detect --json app` 实际运行一次，退出码 1，发现六条既有 `side-tab` 样式提示，分别落在 `b04.css`、`prompt.css`、`wiki.css` 及 `styles.css` 的既有演示提示行。WORK01 新增差异没有 detector 提示。已检查桌面和手机渲染证据。

本机 HTTP 与浏览器初次受沙箱回环限制，经授权在隔离目录重跑。浏览器首轮另发现下拉框标签的可访问名称混入选项文字，已改为显式关联。复测定位随后收紧到实际历史标题，最终流程通过。隔离资料保存在 `node_modules/.cache/work01-builder`，自有服务和浏览器已关闭。正式工作区、真实配置和真实模型未接触。施工停写，Git 提交和同步由主线程处理。
