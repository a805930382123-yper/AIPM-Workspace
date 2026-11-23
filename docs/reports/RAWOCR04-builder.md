# RAWOCR04 施工交接

基线：`c5432c99ebd86d08cb33cb5ce518d250ed289d4e`。按冻结任务卡交付历史配图派生迁移 CLI、阅读投影及定向回归。施工自查通过；本报告不代替独立验收结论，整批结论与全量检查由主 Agent 和独立验收者记录。未提交代码，由主 Agent 统一提交同步。

## 交付

- `services/raw/media-migration.ts` 复用 `identifyWebImages`、`RawStore.mediaSource`、`evaluateImageOcr` 和派生持久化，仅为当前唯一可用图锚点补缺失记录。重新读取本地原图、核对哈希、检测实际尺寸并调用本机 OCR，不从历史 OCR 正文猜配，不重新下载网页。
- `scripts/migrate-raw-media.ts` 要求显式数据目录和 Raw ID 列表或 `--all`，默认只预览，`--apply` 才写入。逐 Raw/图片报告已有、拟处理、无锚点、无图和异常及汇总，局部失败退出 `1`。不存在的库和不可扫描的库不冒充空库；`RawStore.list` 的严格扫描选项仅由迁移 CLI 开启，其他调用默认行为保持。
- `RawStore.saveMediaArtifact` 增加 `onlyIfMissing`，同实例队列内再次保留已有记录。任意已有五态及用户精读内容、字节、时间均跳过；原图缺失、哈希不符、OCR 不可用、落盘失败逐图报异常，成功图可保留，失败图不落盘假成果，续跑可重试。
- 阅读施工者更新媒体 GET，返回绑定当前 `bodySha256`/修订号的 `readingSource`。`RawWebContent` 等待有效投影后按当前位置渲染，隐藏已识别的历史 OCR 区间，避免加载或版本冲突时短暂展示脏转录；Raw 原始 API、编辑及原文坐标保持。公共派生响应仍移除 `ocrRawText`。
- 操作说明：[历史网页配图迁移](../raw-media-migration.md)。CLI 为独立进程，仅支持停止同库产品写入服务及精读任务后的离线 apply；不新增跨进程锁服务、管理页或调度器。

## 实际验证

运行环境为 Windows Node `22.23.5`。数据全部使用系统临时目录，模型配置文件不存在，清除继承 `FMCG_LLM_*` 凭据；HTTP 测试使用随机回环端口，正式数据未读取/迁移，真实付费模型调用 **0**。

| 实际命令 | 结果 |
|---|---|
| `node --import tsx --test tests/rawocr04-migration.test.ts` | 最终 **6/6 PASS**。实际 CLI 覆盖默认预览前后文件清单/哈希、显式范围、全选、参数错误、缺失目录、确实空库、文件占 `articles` 目录扫描异常、非零退出及幂等。服务测试覆盖正常/乱码榜单/装饰/重复图、五态原字节与时间保留、人工编辑下删除/重复/代码标记、资讯采集快照 revision=1、逐图 OCR/落盘失败与续跑。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr01.test.ts tests/rawocr02.test.ts tests/rawocr03-import.test.ts tests/rawocr03-ui.test.tsx tests/rawocr04-migration.test.ts tests/rawocr04-reading.test.ts` | **35/35 PASS**，退出 `0`。首次沙箱内五项现有 HTTP 测试因回环 socket 访问限制 `fetch failed`，获准本机执行后相同隔离边界全部通过。严格扫描补充后又独立复跑新增迁移集 **6/6 PASS**。 |
| `node --import tsx tests/acceptance/rawocr04-builder-tesseract.mjs` | **PASS**，退出 `0`。真实 Tesseract `5.5.0`、`chi_sim+eng`。实际子进程 CLI：preview 拟迁移 `1`/缺图异常 `1`，apply 成功 `1`/异常 `1`，重跑已有 `1`/异常 `1`，三次 CLI 均如实退出 `1`。脚本核实预览零写入，`800×240` 实际尺寸、`ocr_ready`，清洗文本为 `Store operations report` / `Weekly results summary`；原 Raw/图等 3 文件哈希不变，范围外 Raw 无派生产物，重复 apply 派生字节/时间不变。 |
| `node node_modules/typescript/bin/tsc -b` | 最终退出 `0`，包含阅读接线。 |
| `node node_modules/prettier/bin/prettier.cjs --check services/raw/store.ts services/raw/media-migration.ts scripts/migrate-raw-media.ts tests/rawocr04-migration.test.ts` | **PASS**，退出 `0`。 |
| `node node_modules/eslint/bin/eslint.js services/raw/media-migration.ts scripts/migrate-raw-media.ts tests/rawocr04-migration.test.ts` | **PASS**，退出 `0`，无输出。 |

原生 OCR 初次运行前本机没有默认 Tesseract，CLI 正确返回 `local_ocr_unavailable`；随后复用主 Agent 准备的临时原生工具与语言数据，以 `FMCG_TESSERACT_PATH`、`TESSDATA_PREFIX` 指定，完成上述实测。临时隔离数据由测试自行清理，没有大型日志或截图进入仓库。

## 交接 SHA-256

以下为施工停写时的工作树文件哈希；提交标识仍为上述基线，正式交付提交由主 Agent 填入验收记录。

| 文件 | SHA-256 |
|---|---|
| `services/raw/store.ts` | `f4b5bba027a540951a6c3e458b84c6c0a31bb744764d6c22b3c821b281028fa1` |
| `services/raw/media-migration.ts` | `f0b5ce513b3d5374089e3fb4d08819c2e4c007b75ef6b61b124f13a25eef71bd` |
| `scripts/migrate-raw-media.ts` | `375a3b6d84f02c5d214c38fde73627e1c9bbe5da0db6de22f77212887cbf4052` |
| `tests/rawocr04-migration.test.ts` | `5fe55b1bf39e1e8e3863c15bb443d8e8d8fec3ac603a91e88d75b47fb1a7f8a3` |
| `tests/acceptance/rawocr04-builder-tesseract.mjs` | `89a9e255007a2ef38a44489cb678c4c61d2be1be483ea93c4405c7bddda02de3` |
| `docs/raw-media-migration.md` | `f5b2342a61a8426d98e1ef3ab9129f416f2c40ae0be7cba78a87f1c5aef3f845` |
| `app/api.ts` | `eb2418dc758506b706545ff1949769362796eab0b0f0122ac4b0191a3e7db819` |
| `app/components/RawWebContent.tsx` | `2a32b76d6f4c69de667f44f0e5dd68af62acd5e1173b5db6143980aa02ce4394` |
| `app/pages/RawPage.tsx` | `a8b97304a3e46eb6de24b754da11897a6f7541374530109683985e237efb9fdf` |
| `server/raw-media.ts` | `6a681c154e770d67c6c1185f8f6e7a37ea4fcdb3ce7bc8bc7c80918eec09ceca` |
| `tests/rawocr03-ui.test.tsx` | `ad1b41e817ec960e640fe3fc37775fd33108807918277fbc2136c72002ff95ab` |
| `tests/rawocr04-reading.test.ts` | `b9ad542894ec1a7f245b7cf6069266099b0b0b14c7ac373160cae0a4607dca40` |

## 边界及待验收

原始正文、bodySha256、修订号、历史快照及原图在迁移后逐字节保持；普通阅读隐藏历史 OCR 不意味着改写源文件。测试覆盖同图重复出现和已失去位置的图片不复活。迁移与预览没有 VLM 依赖；显式精读继续使用既有入口。

施工范围自查无已知未完成缺陷。浏览器迁移前后/刷新、普通阅读 DOM 哨兵、引文定位、回环 Provider 请求计数及主 Agent 全量 `check` 仍由独立验收和主 Agent 按任务卡完成，不能据本报告宣布整批 PASS。正式历史库迁移留待后续明确执行指令。
