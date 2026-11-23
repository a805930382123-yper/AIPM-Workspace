# 历史网页配图迁移

本工具为历史网页 Raw 新增缺失的单图派生记录。仅读取已有本地原图，重新检测尺寸并运行本机 Tesseract，沿用现有清洗和分流规则；不下载网页、不调用 VLM。Raw 正文（包括历史 OCR）、修订号、历史快照和原图保持原字节。普通详情阅读会隐藏已判定的历史 OCR 区间，原文模式、编辑和原文引用仍保留原文坐标。

RAWOCR04 的开发验收在临时隔离库完成；随后已按用户选定的正式库范围执行并核对结果。再次迁移时，请停止正在写入该库的服务及精读任务，按[离线备份流程](../README.md#数据备份与恢复)保存迁移前版本，再执行所选范围。工具是独立进程，支持同库无并发写入的离线操作。原先运行的服务可在核验后恢复。

## 运行

需要 Node 22.13+、已安装项目依赖，以及 Tesseract 的 `chi_sim` 和 `eng` 语言数据。默认从 PATH 查找 Tesseract；Windows 可使用默认安装位置，也可用 `FMCG_TESSERACT_PATH` 显式指定程序。

在项目根目录运行，`<data-directory>` 是包含 `knowledge/raw` 的数据根目录：

```text
node --import tsx scripts/migrate-raw-media.ts --data-dir "<data-directory>" --raw-id <Raw-UUID>
node --import tsx scripts/migrate-raw-media.ts --data-dir "<data-directory>" --raw-id <Raw-UUID> --apply
```

第一条只预览：不创建文件、不 OCR、不联网。第二条才写入新派生记录。可以重复 `--raw-id` 选择多条；选择全库须显式改用 `--all`，不能和 `--raw-id` 混用。工具不会从环境变量或默认工作区隐式选择数据目录。`--help` 显示用法。

## 结果与续跑

输出为 JSON，`items` 逐 Raw/图片记录结果，`summary` 汇总，`complete` 表示本次范围是否无异常。退出码：`0` 无异常，`1` 有图片/读取异常，`2` 参数错误。缺失或无法扫描的库不会当成空库成功；实际空库可正常预览。

| status | 含义 |
|---|---|
| `planned` | 本地原图存在且哈希正确，apply 时拟迁移；预览不验证 OCR 是否可用 |
| `migrated` | 已成功持久化新记录；`routeStatus` 为 `skipped`、`ocr_ready` 或 `needs_vlm` |
| `existing` | 已有任意状态的派生记录，原字节和时间保留；不覆盖用户精读结果 |
| `no_current_anchor` | 当前正文没有唯一可用图标记（删除、重复或位于代码示例），跳过，不恢复旧位置 |
| `no_images` | 此 Raw 无网页配图，跳过 |
| `error` | `reason` 给出原图缺失、哈希错误、本机 OCR 不可用、落盘失败或读取异常；其他可处理图继续 |

失败项不会落盘假成功记录。修复原图、Tesseract 或存储问题后，用同一选择范围重跑：成功项及原有 `vlm_done`、`failed` 等状态均跳过，未落盘项可以重试。已有 `failed` 状态的记录由详情页显式重试或精读处理，迁移不会覆盖。

`needs_vlm` 只表示本机 OCR 质量或图表信号需要人工精读，本次迁移不会调用模型；如需精读，在详情页明确操作。人工修订正文时，仅当前唯一可见图标记授权出现位置，采集快照用于识别历史 OCR，绝不拿已修改的 OCR 正文猜配图片。
