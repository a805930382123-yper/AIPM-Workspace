# 证据存放规范

本规范定义工程证据的分类边界、仓库体积门禁、外部归档清单格式与可再生测试输入约定，避免大型二进制产物或过程日志继续膨胀仓库。

## 1. 单位约定

统一采用二进制单位：`1 KiB = 1,024 B`，`1 MiB = 1,048,576 B`。

## 2. CI 硬门禁与人工评审细则

`npm run guard`（[`scripts/repo-guard.ts`](../scripts/repo-guard.ts)）在本地 `npm run check` 与远端 CI 自动执行；超出 CI 硬门禁直接失败。人工评审细则由施工与独立验收在提交和复核时核对，不作为 `repo-guard` 硬阻断项。

| 层级 | 适用对象 | 阈值 / 规则 | 校验方式 |
|---|---|---|---|
| **CI 硬门禁** | 仓库内任何 Git 跟踪文件 | 单文件 ≤ `1 MiB`（`1,048,576 B`） | `npm run guard` |
| **CI 硬门禁** | `docs/reports/` 下非 Markdown 文件（`.png`、`.json`、`.jsonl`、`.txt` 等） | 单文件 ≤ `300 KiB`（`307,200 B`） | `npm run guard` |
| **CI 硬门禁** | `docs/status.md` | 整文件 ≤ `24 KiB`（`24,576 B`）；瘦身操作目标 ≤ `20 KiB`（`20,480 B`）以留缓冲 | `npm run guard` |
| **CI 硬门禁** | `docs/agent-control.md`、`docs/acceptance.md` | 单文件各 ≤ `48 KiB`（`49,152 B`） | `npm run guard` |
| **CI 硬门禁** | 存量豁免名单（[`scripts/repo-guard-allowlist.json`](../scripts/repo-guard-allowlist.json)） | 仅豁免历史存量 `docs/reports/` 非 Markdown 文件（`300 KiB < 体积 ≤ 1 MiB`），每条必须附匹配规则与非空 `reason`；名单只减不增，禁止收入台账或新文件 | `npm run guard` |
| **人工评审细则** | 施工报告、独立验收报告 | 使用 Markdown（`.md`）写入 `docs/reports/` | 施工自查 + 验收复核 |
| **人工评审细则** | 关键截图（最终页面态、缺陷对照） | 每批 ≤ `10` 张，单张 ≤ `300 KiB`（`307,200 B`） | 施工自查 + 验收复核 |
| **人工评审细则** | 小型结构化 JSON / 文本摘要 | 单份 ≤ `200 KiB`（`204,800 B`） | 施工自查 + 验收复核 |
| **人工评审细则** | 外部证据索引清单 | 每批如有仓外证据，提交 `docs/reports/<批次>-evidence-manifest.json` | 施工自查 + 验收复核 |

## 3. 仓外归档与 Manifest 引用

下列产物**不得进入 Git**：完整运行日志、浏览器 Trace/HAR、全量导出包、大型静态夹具、以及超出关键截图上限的重复或过程截图。

1. **仓外存放路径**：统一归档至仓库外目录 `<ARCHIVE_ROOT>/evidence/<批次>/`（保留与证据一致的相对子路径）；本机默认归档根目录见[工程整固路线图](batches/ENG-HYGIENE-ROADMAP-20261122.md#启动前需用户决定)。
2. **仓内 Manifest 清单**：在仓库提交 `docs/reports/<批次>-evidence-manifest.json`，仅记录每份产物的：
   - 相对路径（原仓内相对路径与 `<ARCHIVE_ROOT>/evidence/<批次>/` 下归档相对路径）
   - 精确字节数（`bytes`）
   - 内容摘要（`sha256`）
   - 用途说明（`purpose`）与引用备注
3. **报告引用**：施工报告与验收报告通过 `docs/reports/<批次>-evidence-manifest.json` 引用这些产物，不直接向仓库提交大体积附件。
4. **零敏感信息与零本机绝对路径**：所有拟提交到仓库的报告、Manifest、脚本与测试，**严禁包含任何本机绝对路径**（如盘符路径、用户目录路径或 `file://` 本地 URI）或模型密钥/Token/凭据；外部归档根目录统一使用占位 `<ARCHIVE_ROOT>/evidence/<批次>/` 表述。

## 4. 可再生测试输入与临时数据

- **可再生大输入**：超过小摘要上限的大测试输入（例如边界超限文件、长文压测样本、合成批处理输入）必须在测试运行时于 `os.tmpdir()` 下动态生成并在测试结束时清理，禁止作为静态夹具提交进 Git。
- **临时目录收敛**：执行测试、诊断与浏览器验收产生的临时目录统一遵守[测试与检查说明](testing.md#临时数据)（默认位于 `os.tmpdir()` 下 `aipm-*` 子目录；仅必要仓内临时文件允许放在根目录 `.scratch/`）。
- **相关规则**：台账条目写法模板见[协作规则](coordination.md#控制-token-与耗时)，证据记录格式见[验收规约](acceptance.md#1-状态边界与证据)。
