# ENG02 工作区增量清点与去向建议（G2）

- **清点日期**：2026-11-22
- **基线提交**：`main` @ `8fbdb3b`（`docs: plan ENG02-ENG04 engineering hygiene task cards`）
- **阶段边界**：本报告仅为 G2 只读增量清点与去向建议，**未执行**任何提交、移动、恢复、删除或 `.gitignore` 修改。所有实质操作须经 G3 用户决策门确认后，于 G4/G5 阶段执行。
- **公开仓库提示**：本仓库对应公开 GitHub 仓库，所有建议 `提交` 的文件均须满足：无凭据泄露、无本机绝对路径、无第三方版权正文或真实业务/客户敏感数据、单文件 ≤ 1MB。

---

## 一、双账本总览与统计口径

### 1.1 账本 A（Git 工作树文件）

- **统计命令**：`git -c core.quotepath=false status --porcelain=v1 -uall -z`（stdout 按 NUL 分隔解析全集）
- **实测总数**：**541 个文件**
  - ` D`（工作区已删除）：**7** 个（HEAD 大小合计 19,369 B）
  - ` M`（工作区已修改）：**6** 个（工作区大小合计 31,614 B）
  - `??`（未跟踪）：**528** 个（合计 38,508,721 B，约 36.72 MiB；最大单文件 908,526 B，**0 个文件 > 1MB**）
- **stderr 告警记录与成因**：
  - 实测 stderr 输出：`warning: could not open directory 'docs/reports/AUTO01-20261106-review-evidence/': No such file or directory`
  - 成因：Git 索引与 `HEAD` 中仍跟踪 `docs/reports/AUTO01-20261106-review-evidence/` 下的 7 个文件，但该目录已在工作区被整体删空，Git 遍历工作树时触发 `ENOENT` 告警。执行 `git restore` 或 `git rm` 后该告警即会消失。
- **与 ENG01 基线对比**：ENG01（2026-11-15）记录 706 个未跟踪候选；此后部分基线与指纹文件已在后续批次提交。当前 528 个未跟踪文件中，**527 个**在 ENG01 清点中已存在，仅 **1 个**为 ENG01 之后新增（`docs/handoffs/QUICKUX01-20261120-task.md`，21,378 B）。

| 账本 A 主建议去向 | 文件数 | 总字节数 | 说明 |
| --- | ---: | ---: | --- |
| `git restore 恢复` | 13 | 19,369（HEAD，7 已删）+ 31,614（工作区，6 已改） | 7 个被验收报告引用的缺失证据 + 4 个磁盘簇损坏文件 + 2 个 `autocrlf` 纯元数据脏状态文件 |
| `提交（含新增/修改/git rm）` | 2 | 22,829 | `QUICKUX01` 任务卡 + `tests/news01-sources.test.ts`（注：后者请在 G3 特别确认） |
| `归档并移出` | 526 | 38,485,892 | 21 个历史证据目录 + 9 份 baseline JSON + 2 个源码备份目录 + 1 份历史封装记录 |
| `确认删除` | 0 | 0 | 账本 A 证据与基线统一优先归档而非直删，避免误删不可恢复 |
| `保留` | 0 | 0 | 清理目标为 `git status` 干净 |
| **合计（守恒校验）** | **541** | **38,508,721（未跟踪）** | `13 + 2 + 526 + 0 + 0 = 541` |

### 1.2 账本 B（根目录临时目录）

- **统计范围**：仓库根目录全部 `.scratch-*`、`.test-*`、`.rn-*` 目录
- **实测总数**：**214 个目录**，共 **121,381 个文件**，总大小 **4,404,790,736 B**（约 **4.10 GiB** / 4.40 GB）
- **与 ENG01 基线对比**：ENG01（2026-11-15）枚举 203 个忽略目录；本轮新增 **11 个** `.scratch-*` 目录（合计约 2.70 GB，主要为 `EVAL01`、`QUICKUX01`、`RUN01` 独立验收沙箱副本）。

| 账本 B 主建议去向 | 目录数 | 文件数 | 总字节数 | 约合体积 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| `确认删除（可再生）` | 45 | 94,180 | 3,672,647,878 | 3.42 GiB | 空目录、旧单测残留、含完整仓库克隆/tar 包的大容量验收沙箱 |
| `归档` | 169 | 27,201 | 732,142,858 | 698.23 MiB | 历史实测/诊断 `.scratch-*` 目录，移至仓库外归档目录保底 |
| `保留` | 0 | 0 | 0 | 0 B | 收敛后根目录不再留存上述三类前缀目录 |
| **合计（守恒校验）** | **214** | **121,381** | **4,404,790,736** | **4.10 GiB** | `45 + 169 + 0 = 214` |

---

## 二、重点核查：7 个已删除文件（` D`）

全部 7 个文件均位于 `docs/reports/AUTO01-20261106-review-evidence/`（该目录在工作区已整体缺失，导致 `git status` 输出 stderr warning）：

| 文件路径 | HEAD 字节 | 已提交文档引用 | 建议去向 |
| --- | ---: | --- | --- |
| `docs/reports/AUTO01-20261106-review-evidence/actions.log` | 253 | `ENG01-20261114-workspace-inventory.md` | `git restore 恢复` |
| `docs/reports/AUTO01-20261106-review-evidence/browser.log` | 1,334 | `ENG01-20261114-workspace-inventory.md` | `git restore 恢复` |
| `docs/reports/AUTO01-20261106-review-evidence/final-sha.json` | 5,478 | `AUTO01-20261106-review.md`（L52） | `git restore 恢复` |
| `docs/reports/AUTO01-20261106-review-evidence/final-tsc.log` | 0 | `AUTO01-20261106-review.md`（L52） | `git restore 恢复` |
| `docs/reports/AUTO01-20261106-review-evidence/initial-sha.json` | 4,042 | `AUTO01-20261106-review.md`（L13） | `git restore 恢复` |
| `docs/reports/AUTO01-20261106-review-evidence/repair-targeted.log` | 4,631 | `AUTO01-20261106-review.md`（L50） | `git restore 恢复` |
| `docs/reports/AUTO01-20261106-review-evidence/targeted.log` | 3,631 | `ENG01-20261114-workspace-inventory.md` | `git restore 恢复` |

- **结论与依据**：`docs/reports/AUTO01-20261106-review.md`（正式已提交的 AUTO01 最终验收报告）明确引用了 `initial-sha.json`、`repair-targeted.log`、`final-tsc.log`、`final-sha.json` 作为 SHA 核对与定向回归证据；`docs/status.md` 本身未直接出现该目录路径。7 个文件总计仅 19.4 KB，已在 Git 历史中公开提交且无新增风险。
- **建议**：**`git restore 恢复`**（保持 AUTO01 验收证据链完整，并消除 `git status` stderr 告警）。若用户认为历史日志无需保留在工作树，也可在 G3 覆盖为 `git rm` 提交。

---

## 三、重点核查：6 个已修改文件（` M`）

逐文件比对 `HEAD` 与工作区实际字节、换行符及文本内容后，**6 个文件全部属于意外异常（4 个文件系统簇错乱损坏 + 2 个 Git `autocrlf` 纯元数据脏状态），均非有意修复**：

| 文件路径 | HEAD → 工作区字节 | 实际内容与字节差异 | 对 `npm run check`/CI 影响 | 性质判断 | 建议去向 |
| --- | --- | --- | --- | --- | --- |
| `docs/reports/RAWZH01-20261106-backend-builder.md` | 4,030 → 4,031 B（`+63 -23`，纯 LF） | HEAD 为 `# RAWZH01 后端施工交接（2026-11-06）`；工作区从第 0 字节起被其他 `.mjs` 浏览器测试脚本残片（`es', \`${raw.id}.md\`))));`）全文覆盖 | 无影响（非代码/测试文件） | **意外损坏**（文件系统簇覆盖） | `git restore 恢复` |
| `docs/reports/RAWZH01-20261106-review.md` | 4,478 → 4,479 B（`+74 -26`，纯 LF） | HEAD 为 `# RAWZH01 独立验收`；工作区从第 0 字节起被浏览器脚本残片（`stRun.id));\n  await page.getByText(...)`）全文覆盖 | 无影响（非代码/测试文件） | **意外损坏**（文件系统簇覆盖） | `git restore 恢复` |
| `docs/reports/RAWZH01-20261106-ui-builder.md` | 3,479 → 3,480 B（`+56 -16`，纯 LF） | HEAD 为 `# RAWZH01 UI 施工交接（2026-11-06）`；工作区从第 0 字节起被浏览器脚本残片（`ened = await saveFromPage(...)`）全文覆盖 | 无影响（非代码/测试文件） | **意外损坏**（文件系统簇覆盖） | `git restore 恢复` |
| `tests/acceptance/rawzh01-builder-browser.mjs` | 10,763 → 10,764 B（`Binary files differ`） | 前 **4,096 字节**（整 1 个 4KB NTFS 簇）与 HEAD 完全一致；从偏移 `4096`（`0x1000`）起变为二进制乱码且含 NUL 字节，Git 将其识别为 `w/-text` 二进制差异 | 不在 `npm test`（`tests/*.test.ts tests/*.test.tsx`）和 `tsc -b` 范围，不影响 `npm run check`/CI；但若手动运行该验收脚本必然语法崩溃 | **意外损坏**（4KB 簇边界损坏） | `git restore 恢复` |
| `tests/acceptance/AUTO01-review-actions.test.ts` | 3,807 → 3,807 B（`git diff --raw` 为空） | **字节级 100% 一致**（`firstDiffByte = -1`，HEAD 与工作区均为纯 LF 49 行）。因系统级 Git 配置（`etc/gitconfig`）开启 `core.autocrlf = true`，Git 判定 `i/lf w/lf` 与检出预期 CRLF 不符而标 ` M` 并输出 LF/CRLF warning | 不在 `npm test` glob 范围，对 `npm run check`/CI 无影响 | **意外脏状态**（Git `autocrlf` 元数据） | `git restore 恢复` |
| `tests/rawzh01-ui.test.tsx` | 5,053 → 5,053 B（`git diff --raw` 为空） | **字节级 100% 一致**（`firstDiffByte = -1`，HEAD 与工作区均为纯 LF 66 行，首行 `import assert from 'node:assert/strict';` 完好）。成因同上，属 `core.autocrlf = true` 导致的纯元数据脏状态 | **属于 `npm test` 范围**（`tests/*.test.tsx`）；因字节与 HEAD 完全一致，恢复前后均不影响 `npm run check`/CI | **意外脏状态**（Git `autocrlf` 元数据） | `git restore 恢复` |

> **附注（回应任务卡历史线索）**：任务卡提及 ENG01 曾记录 `tests/lw01-raw-ui.test.tsx`、`tests/rawzh01-ui.test.tsx` 首字符损坏。经核实，当前两文件在工作区与 `HEAD` 中首行均完好（`import test from 'node:test';` / `import assert from 'node:assert/strict';`），无需额外修补。

---

## 四、重点核查：`tests/` 下未跟踪文件

经全量扫描，`tests/` 目录下仅有 **1 个**未跟踪文件：

- **文件路径**：`tests/news01-sources.test.ts`（1,451 B，9 行）
- **对应批次**：NEWS01（测试 `services/news/sources.ts` 的 `matchesNewsFocus` 纯函数过滤规则）
- **对 `npm run check` / CI 影响评估**：
  - `package.json` 的 `test` 脚本为 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/*.test.ts tests/*.test.tsx`，`check` 脚本为 `npm run typecheck && npm test && npm run build`。
  - 该文件位于 `tests/*.test.ts` 匹配范围内，**本地运行 `npm test` / `npm run check` 时会自动执行它，但远端 CI 因该文件未提交而不会执行**，导致本地与 CI 测试集不一致。
  - **实测验证**：单独执行 `node --import tsx --test tests/news01-sources.test.ts`，结果 **1/1 PASS**（耗时 1.15ms，无网络/磁盘副作用）。
- **公开风险检查**：正则凭据扫描 0 命中、`.env.local` 已知密钥静默比对 0 命中、本机绝对路径 0 命中；测试样本为公开新闻标题短语（如“太古可口可乐中国发布致胜战略”“Cursor 推出与智能体的实时语音聊天”等），无第三方版权正文或客户隐私风险。
- **引用情况**：被 `NEWS01`/`NEWS02`/`NEWS07` 等 29 份已提交文档/任务卡提及。
- **建议去向**：**明确不宜保留未跟踪**。主建议为 **`提交`**（补齐本地与 CI 一致性并纳入回归保护）；鉴于 ENG01 报告（第 927 行）曾记载当时“news01-sources.test.ts 不提交”，请用户在 G3 明确拍板选择 **`提交`** 或 **`归档并移出`**。

---

## 五、账本 A：全部 528 个未跟踪文件分组与公开风险评估

> **全局安全与体积扫描摘要（528 个文件全覆盖）**：
> - **凭据扫描**：对所有文本文件运行凭据正则（`sk-*`、`Bearer *`、`ghp_*`、`AIza*`、私钥头、长 API key 赋值）**0 命中**；与本机 `.env.local` 中已配置密钥做静默子串比对 **0 命中**。
> - **>1MB 文件检查**：最大单文件为 `docs/handoffs/LW03-20261105-baseline.json`（908,526 B），**0 个文件 > 1MB**。
> - **本机绝对路径扫描**：检出 11 个历史证据目录中共 23 个文本/日志文件包含 Windows 本机盘符绝对路径（用户目录或工作盘路径）；所有含本机路径的文件均已归入 `归档并移出`，不建议提交。

| # | 文件/目录组 | 对应批次 | 文件数 | 总字节 | 最大单文件字节 | 已提交报告/测试引用 | 公开风险（版权/业务/凭据/路径） | 沿用 ENG01 结论 | 唯一主建议去向 |
| ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | `docs/handoffs/QUICKUX01-20261120-task.md` | QUICKUX01 | 1 | 21,378 | 21,378 | 是（`AUTO-STAGE2-ROADMAP-20261120.md`） | 低：0 凭据、0 本机路径、纯任务规格说明 | 否（ENG01 后新增） | **`提交`** |
| 2 | `tests/news01-sources.test.ts` | NEWS01 | 1 | 1,451 | 1,451 | 是（`NEWS01/02/07` 等 29 处） | 低：0 凭据、0 本机路径、公开短标题单测（见第四节） | 否（ENG01 曾暂不提交，现建议二选一） | **`提交`**（待 G3 拍板） |
| 3 | `docs/reports/PDF01-GLOBAL-20261113-real-ui/` | PDF01-GLOBAL | 5 | 202,824 | 52,198 | 是（`PDF01-GLOBAL-20261113-review.md` 等） | **高（版权正文）**：4 张 PNG + `page-text.txt` 含《2026即时零售时刻经营白皮书》商业报告截图与提取文本，**严禁公开提交** | 是（ENG01 已列未提交） | **`归档并移出`** |
| 4 | `docs/reports/UI02-20261031-evidence/` | UI02 | 57 | 5,500,594 | 182,820 | 是（12 处，含归档 status） | 中：49 PNG + 8 JSON，截图可能含测试工作台/业务样本，0 凭据/0 路径 | 是（ENG01 暂不提交） | **`归档并移出`** |
| 5 | `docs/reports/UI04-20261101-evidence/` | UI04 | 63 | 5,311,855 | 324,069 | 是（11 处） | 中：47 PNG + 16 JSON；**3 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 6 | `docs/reports/LW01-20261101-evidence/` | LW01 | 45 | 4,854,313 | 354,446 | 是（14 处） | 中：29 PNG + 16 JSON；**3 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 7 | `docs/reports/UI03-20261101-evidence/` | UI03 | 42 | 4,645,676 | 367,865 | 是（11 处） | 中：35 PNG + 7 JSON，大量 UI 截图体积较大，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 8 | `docs/reports/UI01-20261031-evidence/` | UI01 | 27 | 3,260,432 | 235,792 | 是（14 处） | 中：23 PNG + 4 JSON；**2 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 9 | `docs/reports/LW03-20261105-evidence/` | LW03 | 22 | 1,927,059 | 161,415 | 是（7 处） | 中：18 PNG + 4 JSON，历史 UI 截图证据，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 10 | `docs/reports/PDF01-R2-20261110-ui-evidence/` | PDF01-R2 | 52 | 1,919,263 | 47,157 | 是（8 处） | 中：48 PNG + 4 JSON，PDF 整理界面截图；**1 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 11 | `docs/reports/LW02-20261101-evidence/` | LW02 | 19 | 1,701,275 | 221,930 | 是（11 处） | 中：10 PNG + 9 JSON；**1 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 12 | `docs/handoffs/*-baseline.json`（9 份） | LW03/PDF01/PROVIDER01/RAW* | 9 | 1,540,758 | 908,526 | 否（仅 ENG01 清点引用） | 低-中：历史文件哈希清单（`LW03` 908KB 等），无公开交付价值，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 13 | `docs/reports/RAWUX01-20261106-evidence/` | RAWUX01 | 32 | 1,426,583 | 157,635 | 是（5 处） | 中：29 PNG + 3 JSON，历史 UI 截图，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 14 | `docs/reports/PDF01-R1-20261109-evidence/` | PDF01-R1 | 16 | 1,418,115 | 129,116 | 是（8 处） | 中：15 PNG + 1 JSON，历史 PDF UI 截图，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 15 | `docs/reports/RAWZH01-20261106-evidence/` | RAWZH01 | 21 | 958,249 | 63,087 | 是（8 处） | 中：20 PNG + 1 JSON，英文网页翻译 UI 截图，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 16 | `docs/reports/RAWURL01-20261106-evidence/` | RAWURL01 | 19 | 927,329 | 79,036 | 是（7 处） | 中：16 PNG + 3 JSON；**2 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 17 | `docs/reports/UI02-nav-20261101-evidence/` | UI02-nav | 11 | 741,670 | 106,598 | 是（10 处） | 中：10 PNG + 1 JSON，历史导航截图，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 18 | `docs/handoffs/RAWEDIT02-20261114-baseline/` | RAWEDIT02 | 17 | 461,587 | 71,260 | 否（仅 ENG01 引用） | 低：施工前手工备份的旧源码副本（12 `.ts` + 5 `.tsx`），冗余不应入库 | 是 | **`归档并移出`** |
| 19 | `docs/handoffs/RAWEDIT01-20261114-baseline/` | RAWEDIT01 | 18 | 396,590 | 83,425 | 否（仅 ENG01 引用） | 低：施工前手工备份的旧源码副本（11 `.ts` + 5 `.tsx` + 2 `.json`），冗余不应入库 | 是 | **`归档并移出`** |
| 20 | `docs/reports/COMPAT01-20261105-review-evidence/` | COMPAT01 | 9 | 309,084 | 97,942 | 是（5 处） | 中：3 PNG + 3 TXT + 2 MJS + 1 JSON；**2 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 21 | `docs/reports/PDF01-R3-20261112-ui-evidence/` | PDF01-R3 | 8 | 298,479 | 66,638 | 是（8 处） | 中：7 PNG + 1 JSON，历史 PDF UI 截图，0 凭据/0 路径 | 是 | **`归档并移出`** |
| 22 | `docs/reports/COMPAT01-20261105-ui-evidence/` | COMPAT01 | 11 | 260,209 | 90,765 | 是（6 处） | 中：4 PNG + 3 JSON + 4 TXT；**2 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 23 | `docs/reports/PDF01-R2-CONSOLIDATION-20261110-ui-evidence/` | PDF01-R2 | 7 | 209,935 | 43,191 | 是（6 处） | 中：5 PNG + 2 JSON；**1 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 24 | `docs/reports/RAWEDIT02-20261114-builder-evidence/` | RAWEDIT02 | 3 | 139,856 | 136,490 | 是（9 处） | 中：2 LOG + 1 PNG；**2 个日志命中本机绝对路径** | 是 | **`归档并移出`** |
| 25 | `docs/reports/COMPAT01-20261105-builder-evidence/` | COMPAT01 | 11 | 64,944 | 25,404 | 是（5 处） | 中：6 JSON + 5 TXT；**4 个文本命中本机绝对路径** | 是 | **`归档并移出`** |
| 26 | `docs/reports/AGENT-ROUTER-20261023-packaging.md` | AGENT-ROUTER | 1 | 8,863 | 8,863 | 是（35 处历史基线清单） | 低：0 凭据/0 路径；原文注明“本轮未提交/推送”，属开发技能封装记录 | 是 | **`归档并移出`** |
| 27 | `docs/reports/RAWEDIT02-20261114-review-evidence/` | RAWEDIT02 | 1 | 350 | 350 | 是（4 处） | 低：1 份 `summary.json`，0 凭据/0 路径，随同批证据统一归档 | 是 | **`归档并移出`** |

> **说明**：第 12 组 `docs/handoffs/*-baseline.json` 包含 9 个文件：`LW03-20261105-baseline.json`（908,526 B）、`RAWZH01-20261106-baseline.json`（190,895 B）、`RAWUX01-20261106-baseline.json`（190,501 B）、`RAWURL01-20261106-baseline.json`（181,283 B）、`RAWEDIT01-20261114-baseline.json`（61,742 B）、`PDF01-R1-20261109-baseline.json`（2,771 B）、`PDF01-R2-20261110-baseline.json`（2,412 B）、`RAWEDIT02-20261114-baseline.json`（2,247 B）、`PROVIDER01-20261106-baseline.json`（381 B）。合计 528 个文件、38,508,721 B。

---

## 六、账本 B：214 个根目录临时目录分组清点

根目录共检出 214 个 `.scratch-*` / `.test-*` / `.rn-*` 目录（121,381 个文件，4,404,790,736 B ≈ 4.10 GiB），按前缀/批次分为 22 组：

| # | 目录前缀/名称 | 目录数 | 文件数 | 总字节 | 约合体积 | 修改日期范围 | ENG01 状态 | 内容特征与依据 | 唯一主建议去向 |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | `.scratch-eval01-evidence` | 1 | 33,671 | 1,555,676,204 | 1.45 GiB | 2026-11-15 | **新增** | `EVAL01` 验收沙箱（含 `baseline.tar`/`candidate.tar`/`clean-repo`/`clean-lf` 仓库副本） | `确认删除（可再生）` |
| 2 | `.scratch-eng01-evidence` | 1 | 29,400 | 931,516,859 | 888.36 MiB | 2026-11-15 | 已有 | `ENG01` 清点临时目录（含 `git-docs`/`candidate-v2`/`ENG01-archive-candidate` 副本） | `确认删除（可再生）` |
| 3 | `.scratch-quickux01-review-bdf45` | 1 | 5,957 | 403,964,321 | 385.25 MiB | 2026-11-20 | **新增** | `QUICKUX01` 独立验收完整仓库隔离克隆 | `确认删除（可再生）` |
| 4 | `.scratch-quickux01-review-lf-bdf45` | 1 | 5,959 | 401,186,351 | 382.60 MiB | 2026-11-20 | **新增** | `QUICKUX01` 独立验收 LF 隔离克隆 | `确认删除（可再生）` |
| 5 | `.scratch-run01-evidence` | 1 | 17,317 | 330,114,136 | 314.82 MiB | 2026-11-15 | **新增** | `RUN01` 验收沙箱（含 `clean-repo` 与日志） | `确认删除（可再生）` |
| 6 | `.scratch-kb01-r4-repair3-agent` | 1 | 1,673 | 47,036,934 | 44.86 MiB | 2026-10-14 | 已有 | `KB01` 历史 agent 临时工作副本 | `确认删除（可再生）` |
| 7 | `.scratch-quickux01-baseline-lf-bdf45` | 1 | 166 | 3,146,820 | 3.00 MiB | 2026-11-20 | **新增** | `QUICKUX01` LF 基线临时目录 | `确认删除（可再生）` |
| 8 | `.test-b04-*` | 37 | 37 | 6,253 | 6.11 KiB | 2026-10-07 ~ 10-30 | 已有 | `B04` 自动化测试残留（每个仅 169 B），`docs/` 未引用 | `确认删除（可再生）` |
| 9 | `.rn-TboqEB` | 1 | 0 | 0 | 0 B | 2026-10-11 | 已有 | 空目录 | `确认删除（可再生）` |
| 10 | `.scratch-KB02-*` | 99 | 26,195 | 725,076,263 | 691.49 MiB | 2026-10-23 ~ 10-24 | 已有 | `KB02` 历史实测/语义审计目录（含 K204/HUMAN/SEMANTIC），`docs/` 有提及 | `归档` |
| 11 | `.scratch-R1618-*` | 14 | 206 | 1,429,293 | 1.36 MiB | 2026-10-27 ~ 10-29 | 已有 | `R1618` 质量/覆写/OQ 历史实测目录 | `归档` |
| 12 | `.scratch-lint01-frozen` | 1 | 83 | 1,119,550 | 1.07 MiB | 2026-11-19 | **新增** | `LINT01` 冻结基线临时目录 | `归档` |
| 13 | `.scratch-SYN01-*` | 26 | 331 | 1,119,280 | 1.07 MiB | 2026-10-25 ~ 10-26 | 已有 | `SYN01` 实测/复核目录 | `归档` |
| 14 | `.scratch-OPENAI-*` / `.scratch-openai-*` | 14 | 162 | 865,205 | 844.93 KiB | 2026-10-29 | 已有 | OpenAI 连接与结构化输出实测目录 | `归档` |
| 15 | `.scratch-R22-*` | 8 | 165 | 694,252 | 677.98 KiB | 2026-10-29 | 已有 | `R22` 真实调用实测目录 | `归档` |
| 16 | `.scratch-R12-*` | 1 | 9 | 612,539 | 598.18 KiB | 2026-10-26 | 已有 | `R12` 审计目录 | `归档` |
| 17 | `.scratch-github-publish` | 1 | 2 | 378,779 | 369.90 KiB | 2026-10-22 | 已有 | GitHub 发布准备目录 | `归档` |
| 18 | `.scratch-news18-independent` | 1 | 26 | 360,202 | 351.76 KiB | 2026-11-20 | **新增** | `NEWS18` 独立验收临时目录 | `归档` |
| 19 | `.scratch-lint02-review` | 1 | 11 | 334,686 | 326.84 KiB | 2026-11-19 | **新增** | `LINT02` 验收临时目录 | `归档` |
| 20 | `.scratch-pipe01` | 1 | 5 | 95,682 | 93.44 KiB | 2026-11-16 | **新增** | `PIPE01` 临时目录 | `归档` |
| 21 | `.scratch-lint-candidates` | 1 | 3 | 56,819 | 55.49 KiB | 2026-11-19 | **新增** | Lint 候选临时目录 | `归档` |
| 22 | `.scratch-workbench-launch` | 1 | 3 | 308 | 308 B | 2026-11-19 | **新增** | 工作台启动探测临时目录 | `归档` |

> **说明**：第 1–9 组（45 目录，3.42 GiB）均为可再生隔离克隆、空目录或单测残留，对应批次报告均已提交；第 10–22 组（169 目录，698.23 MiB）体量可控，默认建议归档至仓库外归档目录（`<ARCHIVE_ROOT>/ENG02-20261122/`），如用户确认全部历史实测草稿均可丢弃，亦可在 G3 覆盖为 `确认删除`。

---

## 七、额外待确认项

1. **本地已合入分支清理**：
   - 分支名：`codex/quickux01-delivery`（提交 `665a9ac`，`QUICKUX01: filter draft topics and capture Raw from any page`）
   - 核实状态：`git branch --merged main` 确认已完全合入 `main`。
   - **建议**：在 G4 执行 `git branch -d codex/quickux01-delivery` 删除该已合入本地分支。
2. **归档目标目录**：
   - 默认沿用任务卡约定的仓库外归档根目录（`<ARCHIVE_ROOT>/ENG02-20261122/`，保留原相对路径并生成 `MANIFEST.json`，提交版脱敏副本落盘为 `docs/reports/ENG02-20261122-archive-manifest.json`）。

---

## 八、G3 用户决策摘要表

以下汇总所有待用户拍板的组别。用户可**一键确认全部默认建议**，或仅对特定行指定覆盖方案：

| 决策编号 | 账本/类别 | 组别 | 数量 | 总大小 | 建议去向 | 风险提示与需拍板要点 |
| --- | --- | --- | --- | ---: | --- | --- |
| **D1** | 账本 A（` D`） | `docs/reports/AUTO01-20261106-review-evidence/*` | 7 文件 | 19.4 KB（HEAD） | **`git restore 恢复`** | 被正式已提交的 `AUTO01-20261106-review.md` 直接引用；恢复可保证据链并消除 `git status` warning（可选覆盖：`git rm` 提交） |
| **D2** | 账本 A（` M`） | 3 份 `RAWZH01` 报告 + `rawzh01-builder-browser.mjs` | 4 文件 | 22.8 KB | **`git restore 恢复`** | **高置信意外损坏**（前 3 份被 `.mjs` 残片覆盖，第 4 份 4096B 后二进制乱码），切勿提交损坏版 |
| **D3** | 账本 A（` M`） | `AUTO01-review-actions.test.ts` + `rawzh01-ui.test.tsx` | 2 文件 | 8.9 KB | **`git restore 恢复`** | 字节与 HEAD 100% 一致，纯 `core.autocrlf=true` 元数据脏状态，无内容变更 |
| **D4** | 账本 A（`??`） | `docs/handoffs/QUICKUX01-20261120-task.md` | 1 文件 | 21.4 KB | **`提交`** | ENG01 后新增任务卡，被已提交路线图引用；0 凭据/0 路径/≤1MB |
| **D5** | 账本 A（`??`） | `tests/news01-sources.test.ts` | 1 文件 | 1.5 KB | **`提交`** | **需特别拍板**：命中 `npm test` glob，实测 1/1 PASS，**不宜保留未跟踪**；ENG01 曾暂不提交，请确认 `提交` 或 `归档并移出` |
| **D6** | 账本 A（`??`） | `docs/reports/PDF01-GLOBAL-20261113-real-ui/` | 5 文件 | 202.8 KB | **`归档并移出`** | **高公开风险（第三方版权正文）**：含《2026即时零售时刻经营白皮书》截图与文本，**严禁提交** |
| **D7** | 账本 A（`??`） | 其余 20 个历史证据目录 + 9 份 `baseline.json` + 2 个 `RAWEDIT` 源码备份目录 + `AGENT-ROUTER-20261023-packaging.md` | 521 文件 | 38.28 MB | **`归档并移出`** | 含大量 PNG 截图及 23 个命中本机绝对路径的文件，0 凭据命中；移至仓库外归档目录并记入 SHA-256 manifest |
| **D8** | 账本 B（目录） | 9 组大容量验收沙箱/单测残留/空目录（`eval01`/`eng01`/`quickux01`/`run01`/`kb01`/`.test-b04-*`/`.rn-*`） | 45 目录（94,180 文件） | 3.42 GiB | **`确认删除（可再生）`** | 占临时目录总体积 83.4%，均为完整仓库克隆/tar 包或单测残留，删除前会确认无进程占用（可选覆盖：改为 `归档`） |
| **D9** | 账本 B（目录） | 其余 13 组历史实测/诊断 `.scratch-*` 目录（含 `KB02`/`SYN01`/`R1618`/`OPENAI`/`R22`/`LINT` 等） | 169 目录（27,201 文件） | 698.23 MiB | **`归档`** | 移至仓库外归档目录（`<ARCHIVE_ROOT>/ENG02-20261122/`）保底（可选覆盖：若不再需要历史实测数据，可改为 `确认删除`） |
| **D10** | Git 分支 | 本地分支 `codex/quickux01-delivery`（`665a9ac`） | 1 分支 | — | **`删除分支`** | 已完全合入 `main`，建议 `git branch -d` 清理 |
