# 本机试用交接施工记录（2026-10-30）

本轮交接自查通过，待独立验收；未修改产品代码。Windows，Node v24.18.0、npm 11.16.0，依赖已存在。产品代码基线 53c16918a9c284a1c18fd7e47f468d9b960a1c89；文档基线 HEAD 648872f。当前 B09 整体历史结论为 109 PASS / 0 FAIL / 0 WAIT，包含适用旧证据复用，并非本轮重跑；历史模型失败及输出质量限制保留，见 [矩阵](B09-RESUME-20261029-matrix.md)。本轮交接检查不替代该批独立验收。

执行 `node --version`、`npm --version` 和 `node docs/reports/LOCAL-HANDOVER-20261030-check.mjs`，最后命令退出码 0。隔离服务及 Vite 首页 HTTP 200；手工创建 Raw、关联 Raw 的 Wiki 和关联 Wiki 的 Prompt，读取正文和引用成功；API 同根重启后读取成功；停服后运行 `node --import tsx scripts/backup_workspace.ts export --data-root <隔离源> --output <临时归档>` 与 `restore --input <临时归档> --data-root <新空根>` 均退出 0，6 文件快照一致，新根启动后正文和引用再次读取成功。脚本保留在本目录，临时目录及自有进程已清理。UI 实际操作未测；本次没有真实 API 调用、真实配置读取或部署，也未触及正式 workspace。

交付修改：README.md、docs/delivery.md、docs/batches/B09.md，以及本报告和可复现脚本。使用入口：项目根安装依赖后运行 `npm run dev`，浏览器打开 http://127.0.0.1:5173/；默认数据根 `workspace/`，可在启动前以 `$env:FMCG_DATA_DIR = 'D:\FMCG-Trial'` 指定独立目录。停止服务后依交付说明备份到归档并恢复到新空根。

独立验收指出试用独立根后，旧备份示例仍指向默认 workspace。已修正交付说明：导出示例使用 `D:\FMCG-Trial`，并说明应按实际数据根调整；恢复目标仍为新空目录。此为文档修正，未重跑无关测试。
