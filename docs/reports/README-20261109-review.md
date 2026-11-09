# README 重构独立验收（2026-11-09）

施工 `readme_builder`，独验 `readme_review`。受验基线 `956910b90e0f238e8c024dc9f8ffdddaeb0fa765`，最终 `README.md` SHA-256 `3607B4D659CCFAF8F25916F12A0218ED657A0DA8A654CC6A53977A6754E97192`。

## 结论

- 本轮返修 **PASS**。备份白名单和容量口径、资讯抓取与模型开关、Raw 翻译与整理入口、Wiki 问答回存、事项提醒和删除、会议模式与来源限制，均按实际界面、脚本和现有项目记录校正。
- 本轮 README 文档范围 **PASS**。覆盖产品介绍、安装启动、功能用法、借鉴与许可、备份恢复、当前限制、常见问题和详细文档。四个设计参考按本地证据区分，WORK05 外部接收明确为未实现。
- 产品整体验收 **NOT_RUN**。本轮只有文档核对，产品、安装、真实模型、资讯来源和备份恢复均未运行。产品既有验收结论见[项目状态](../status.md)。

## 检查记录

| 检查 | 实际结果 |
|---|---|
| `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check 956910b90e0f238e8c024dc9f8ffdddaeb0fa765 -- README.md` | 退出 0。Git 提示工作树 LF 下次触碰时可能转为 CRLF。 |
| `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --name-only 956910b90e0f238e8c024dc9f8ffdddaeb0fa765 -- app server services scripts package.json package-lock.json .env.example vite.config.ts` | 退出 0，输出为空。 |
| PowerShell `Get-Content -Raw -Encoding utf8 -LiteralPath README.md`、`[regex]::Matches`、`Test-Path -LiteralPath`、`Parser::ParseInput` | 8 个二级章节，11 个相对链接目标有效，3 个 PowerShell 代码围栏配对且语法解析通过。 |
| PowerShell `Get-Content -Raw -Encoding utf8 -LiteralPath package.json` 配合 `ConvertFrom-Json`；逐项对照启动、备份脚本和相关界面 | `dev`、`dev:proxy` 均为实际脚本名。端口、数据根变量、备份命令参数及六个目录与实现一致。 |
| `Get-FileHash -Algorithm SHA256 -LiteralPath README.md` | 受验文件指纹与施工交接一致。 |

事实依据包括[复用记录](../open-source-reuse.md)、[事项方案](../batches/WORK03-WORK05-plan-20261107.md)、[包清单](../../package.json)、[备份脚本](../../scripts/backup_workspace.ts)及当前功能入口。许可证描述依据项目已有记录，本轮未开展新的许可证核验。
