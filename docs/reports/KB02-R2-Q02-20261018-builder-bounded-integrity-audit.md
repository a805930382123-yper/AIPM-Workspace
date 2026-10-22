# 保护文件异常的有界补核

2026-10-18：仅核对本轮10份`tests/acceptance/kb02-r2-q02-20261018-builder-*.mjs`写入位置，不展开历史审计。

`rg -n --glob 'kb02-r2-q02-20261018-builder-*.mjs' 'writeFile|writeFileSync|copyFile|fs\.cp|symlink|PA01-R1|preflight' tests/acceptance`显示：报告输出均使用本轮`docs/reports/KB02-R2-Q02-20261018-builder-*`；provenance仅`--create`时写本轮seq62夹具；HTTP故障注入写隔离h.dataRoot里的checkpoint/draft；fullsuite将产品/tests复制到新建os.tmpdir目录，并把source/node_modules作为junction供依赖读取，全部测试与构建cwd为该同字节副本。其余测试输出到副本内docs/reports，不向源树旧B04输出。未发现脚本硬编码`PA01-R1`或旧preflight输出路径。本核对只说明可见本轮脚本的写入范围，不足以断定未知漂移原因。

受影响路径`docs/reports/PA01-R1-20261015-baseline.json`：

- 接手基线SHA256：`b7153de9b325edb0f34abb8135a8cf6ef5e91b5283b0749f47b732fc2763b7bf`
- 最终复核SHA256：`b0cf1d0c97ba64ae8a7b29148959895255632a95d36564d9c2eb767211ee2c91`
- 当前文件228901字节，mtime仍为2026-10-15T08:02:54.044Z；mtime不能证明没有变化或推出原因。

当前字节已在本轮historical-drift-current.json保留；原文件未恢复、未改写、未归因。main-integrity.json的pass=false原样保留；工程检查均完成，但历史保护完整性1项未过，不宣称2244项全部不变。
