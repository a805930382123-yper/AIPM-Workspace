# RAWOCR04 独立验收

验收者为独立规划/验收实例（未参与产品施工），基线 `c5432c9`。本轮仅使用系统临时目录合成样本、空模型配置与本机 Tesseract，未操作正式数据，真实付费模型调用 0。

## 当前结论

- CLI、迁移保真与幂等范围：**PASS**。
- RAWOCR04 整批：**PASS**，R4-01 至 R4-05 均有对应实测；浏览器与最终全量结果见下文。

## 独立实测

命令 `node --import tsx tests/acceptance/rawocr04-independent.mjs`，设置临时工具目录中的 `FMCG_TESSERACT_PATH` 和 `TESSDATA_PREFIX`。结果 exit 0 / PASS：

- 真实 900×350 图片被本机 Tesseract 识别为 ocr_ready，清洗文本包含 Independent migration。
- 健康单条预览 exit 0；混有缺图、哈希错误的全库预览 exit 1；预览前后全目录文件 SHA 一致。
- 显式单条执行未改变范围外记录；全库执行新增剩余两项，已有五态逐字节保留；删除标记与重复标记跳过；缺图和哈希错误各项失败，CLI exit 1，无完整成功假象。
- 人工添加前言后的当前锚点仍成功迁移。所有原 Raw、历史版本、原图和已有派生文件 SHA 不变；再次 apply 后全目录文件 SHA 完全一致。

命令 `node --import tsx --test tests/rawocr04-migration.test.ts tests/rawocr04-reading.test.ts tests/rawocr01.test.ts tests/rawocr02.test.ts`：20/21 通过，阅读 HTTP 因沙箱回环连接 `EACCES` 未执行成功。随后以允许回环连接的执行环境单独运行 `node --import tsx --test tests/rawocr04-reading.test.ts`，1/1 PASS。有效实测合计 21/21；没有将环境失败隐去。迁移测试覆盖纯文本、乱码、装饰图、重复原图、非零资讯采集修订、代码/重复标记、OCR/落盘异常及续跑。

## 实测版本指纹

| 文件 | SHA-256 |
|---|---|
| services/raw/media-migration.ts | F0B5CE513B3D5374089E3FB4D08819C2E4C007B75EF6B61B124F13A25EEF71BD |
| scripts/migrate-raw-media.ts | 7446013868D71650BC41B9EC55EAB30D860C3280B2757B44526F8F3C66E8DB89 |
| services/raw/store.ts | 681EB209FF48A85207824FFFE0C0E0897819B176D029C4AB86BB7DB4743D9881 |
| app/components/RawWebContent.tsx | 2A32B76D6F4C69DE667F44F0E5DD68AF62ACD5E1173B5DB6143980AA02CE4394 |
| app/pages/RawPage.tsx | A8B97304A3E46EB6DE24B754DA11897A6F7541374530109683985E237EFB9FDF |
| server/raw-media.ts | 6A681C154E770D67C6C1185F8F6E7A37EA4FCDB3CE7BC8BC7C80918EEC09CECA |

提交号由主 Agent 提交后补充；上述是基线加实际未提交产物指纹。正式库迁移未执行，交付离线操作工具与说明。

## 严格扫描返修独立复验

主 Agent 发现旧 `RawStore.list()` 吞掉目录读取异常，导致 `--all` 对损坏 articles 路径误报空库成功。施工者增加仅 CLI 使用的 strictScan 后，独立命令 `node --import tsx tests/acceptance/rawocr04-independent-scan.mjs` **PASS**：真实空库 preview exit 0 / complete true；将 articles 路径构造为普通文件，preview exit 1 / complete false / raw_scan_failed。本轮已知缺陷关闭，整批仍待余下门禁。

最终返修指纹替换上表对应两项：`scripts/migrate-raw-media.ts` = `375A3B6D84F02C5D214C38FDE73627E1C9BBE5DA0DB6DE22F77212887CBF4052`；`services/raw/store.ts` = `F4B5BBA027A540951A6C3E458B84C6C0A31BB744764D6C22B3C821B281028FA1`。迁移服务 SHA 未变；其余既有结果按未受影响路径复用。

## 独立浏览器交接复核

复用另一独立验收实例执行的 `node --import tsx tests/acceptance/rawocr04-reading-browser.mjs`（设置临时 Tesseract 环境，允许回环端口），Edge 158.0.4370.33，exit 0 / **PASS**。7 个合成样例覆盖历史、人工改写、删图、重复标记、围栏标记、普通围栏 OCR 示例和新导入图；迁移前后及刷新正常阅读无脏 OCR，编辑逐字保留，原图正常显示，删/重复/围栏标记不呈现图卡，普通代码示例保留。390px 无溢出，真实 RawPage initialCitation 浏览器挂载验证完整原文及 mark 原坐标；原 Raw 与原图字节不变。pageErrors、consoleErrors、blocked 均为空，providerCalls = 0。实际 CLI 3 migrated + 1 existing + 3 no_current_anchor / complete true。

实测浏览器脚本 SHA-256 `77C4B68E69ABDE2E659A5C226E818761312E1BCA4F890B0AF8D6801BF979E0A3`。提交版本仅移除文件末尾空行，SHA-256 为 `3EB900748F54E6C6AE0FF477DE3BBCDD9F2C4371A7A6F52C7BB0CC7FEF36FC36`。该实例未参与产品施工，其实际操作结果与本报告 CLI 验证合并裁决；浏览器 UI 不以服务测试替代。

独立 CLI 两脚本已补 finally 清理临时目录（删除前核对根路径及专属前缀），扫描复验仍 PASS。整批只余主 Agent 最终全量门禁待汇总。

## 最终双层裁决

1. **本轮施工及已知缺陷：PASS。** 严格扫描误报已由真实 CLI 复验关闭，最终版 native OCR 独立脚本在补自动清理后再次 exit 0 / PASS。
2. **RAWOCR04 整批：PASS。** R4-01 至 R4-05 的 CLI、分流、保真、幂等、阅读、实际 HTTP、浏览器及关键回归证据齐备。复用主 Agent 最终隔离 `npm.cmd run check`：Windows Node 22.23.5，exit 0，1055/1055（0 跳过），build 通过，lint 0 errors / 825 已知 warnings，guard 0 违规。首次全量 1054/1055 的既有 NEWSRAW02 并发断言失败保留记录，最终完整复跑通过。

交付版本为本报告与产品代码所在同一提交，父提交 `c5432c99ebd86d08cb33cb5ce518d250ed289d4e`；具体新提交 SHA 由 Git 记录确定。正式数据迁移未执行，本轮交付工具、阅读兼容与隔离验证，停止本批；无待用户确认事项。
