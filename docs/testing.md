# 测试与检查

使用 Node 22.13 以上，Windows PowerShell 使用 `npm.cmd` 或 `npm run`，不使用 npx.ps1。

- `npm run typecheck`：对 tsconfig 范围执行严格类型检查。
- `npm test`：运行 `tests/*.test.ts` 和 `tests/*.test.tsx`，不包括 `tests/acceptance/` 和 `.mts`。工作树中同名 glob 的未跟踪文件也会运行；提交树仅包含已跟踪文件。
- `npm run check`：依次执行类型检查（`typecheck`）、格式检查（`format:check`）、静态检查（`lint`）、体积守护（`guard`）、默认测试（`test`）及生产构建（`build`），任一失败即终止。
- `tests/acceptance/` 是按对应任务卡单独运行的验收脚本，不属于默认 glob。`.mts` live/replay 脚本也不属于默认测试；live 会访问外部来源，必须另获明确授权；replay 通常依赖隔离快照，但 tests/news09-pdf-replay.mts 会真实补拉 PDF，同样须另获联网授权。

测试前将 `FMCG_DATA_DIR` 指向新建的系统临时目录，并将 `FMCG_LLM_CONFIG_FILE` 指向该目录下不存在的配置文件。清除继承的 `FMCG_LLM_*` 凭据和 `EMBEDDING_*` 配置。启动产品服务的测试在构造子进程环境时调用 `withoutInheritedEmbeddings`。Embedding 测试清理后显式写入本次回环配置。不要使用正式 workspace、真实配置或用户已有服务端口。

## 临时数据

测试、诊断、浏览器验收或脚本执行产生的临时数据必须遵循以下收敛约定：

- **默认位置**：统一创建在操作系统临时目录 `os.tmpdir()` 下、以 `aipm-` 开头的独立子目录（例如 `path.join(os.tmpdir(), 'aipm-<batch>-...')`），测试或脚本结束后自行清理。
- **仓库内例外**：确需在仓库内落盘的临时文件，只能放在根目录单一的 `.scratch/` 目录下（已在 `.gitignore` 中忽略）。禁止在仓库根目录再新建 `.scratch-*`、`.test-*` 或 `.rn-*` 目录。
- **卫生检查**：运行 `npm run hygiene` 可只读检查未跟踪/变更条目及根目录临时目录数量与体积；如需将根目录临时目录归档移出，显式执行 `npm run hygiene -- --archive <目标目录>`（必须提供显式目标目录；该脚本不接入 CI）。

## 已知跳过

| 测试 | 原因 | 负责批次 | 登记日期 |
| --- | --- | --- | --- |
| tests/proxy-startup.test.ts | 非 Windows 条件跳过 | ENG01 | 2026-11-15 |
| tests/rawurl01-http.test.ts | Node 不支持 --use-env-proxy 时条件跳过 | ENG01 | 2026-11-15 |

## R12 原始材料独立验收

原 `tests/r12-question-review.test.ts` 的两项及 `tests/r12-question-ui.test.tsx` 的一项依赖未提交的历史真实材料，已原样保留断言并移至 `tests/acceptance/`，仅修正相对导入。默认测试不执行这三项，不计作跳过。

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/acceptance/r12-question-review.test.ts tests/acceptance/r12-question-ui.test.tsx
```

须有本地获授权的 `.scratch-KB02-K204-C-20261024-vKvjss/candidate-C.json` 及对应真实 Raw 历史输入，仍核原 SHA；缺材料时不运行，不能用空夹具替代。三项分别覆盖原 C 来源记录与正式渲染、可逆标记与审核门禁、React 复选框经生产 HTTP 持久化。本批干净交付树不执行它们，也不上传这些真实材料。

## EVAL01 离线评估

`npm run eval -- --chain standard-extract` 默认回放固定的 `live-20261115-baseline` 录制，严格检查规则和请求指纹，不联网；`--case <id>` 选择单例，`--recording synthetic-v1` 使用明确标记的离线合成录制。`--baseline <结果 JSON>` 对兼容结果比较，结果与 Markdown 写入忽略目录 `evals/results/`。

真实调用仅通过显式 `--mode live --record` 发起，使用产品配置，开始前打印预计调用数，逐次记账并在失败或单例门槛不达标时停止；不得将 synthetic 录制当作真实基线。版权材料仅限 `evals/local/`，不可提交。
Windows 新检出评估环境请使用 `git clone -c core.autocrlf=false <仓库地址>`，使规则文件保留仓库换行；规则指纹直接使用产品加载器，不改产品规则或本机全局配置。

R1 使用评分 schema 2；旧 schema 1 结果不可直接用作 `--baseline`，须对同一录制重评。已授权的唯一续跑使用 `--mode live --record --recording live-20261115-baseline --resume-from <原结果 JSON> --resume-sha256 ca9a118ee1f7bba97facaf49c186675537e8ad5612a6d2398b8d33ecd3387b61`；先核对冻结来源和四份录制、离线重评前四例，全部达标后才读取配置。剩余四例最多发八次请求，首次外发前以本地凭据防止重复运行，失败即停止；不得删除凭据自动续跑。

## 代码格式化、静态检查与 Git Blame

- `npm run format` / `npm run format:check`：使用 Prettier（`.prettierrc.json`：单引号、分号、`printWidth: 120`、`endOfLine: "lf"`；`.editorconfig` 同步约束 UTF-8 无 BOM 与 LF）检查并格式化 `app/`、`server/`、`services/`、`scripts/`、`tests/` 根层与 `tests/support/` 及根配置文件；`.prettierignore` 排除 `docs/`、`workspace/`、`dist/`、`node_modules/`、`evals/`、`rules/`、`tests/acceptance/`、`tests/fixtures/`、`public/`、`THIRD_PARTY_LICENSES/`、`package-lock.json`、`AGENTS.md`、`README.md`、`DESIGN.md`、`.github/`、`.githooks/`、`.agents/`、`*.tsbuildinfo`、`.scratch/`、`.scratch-*/`、`.test-*/`、`.rn-*/`、`*.ps1`、`*.py`、`index.html`、`.env*`、`.git*`、`*.pdf`、`*.docx`、`*.png`、`*.txt`。说明：Prettier `3.10.1` 对部分超长单行链式调用需连续执行两遍 `npm run format` 才能达到幂等不动点，再运行 `npm run format:check` 可通过。
- `npm run lint`：使用 `eslint.config.js`（ESM 扁平配置，采用非类型感知的 `@eslint/js` `recommended`、`typescript-eslint` `recommended`、`eslint-plugin-react-hooks` `recommended`、`eslint-config-prettier` 与 `globals`，`ignores` 与 `.prettierignore` 对齐）。当前 0 违规推荐规则维持 `error`，存量违规推荐规则逐条设为 `warn` 并登记基线（ENG04 基线共 825 条告警，不设 `--max-warnings=0`），已接入 `npm run check` 与 CI。
- `node --import tsx scripts/format-equivalence.ts --commit 02ab4ca63721485ae8413bdca6071bda6f9a93c3`：使用 `esbuild` 独立复验 ENG04 纯格式化提交（Commit 2）的语义等价性，严格校验增/删/重命名数为 `0`，分别汇总 `.ts/.tsx` 与全量扩展名（`.ts`/`.tsx`/`.mts`/`.mjs`/`.css`/`.json`），并对 `.tsx` 的 JSX `{' '}` 相邻文本拆行及 `.css` 自定义属性空白提供诊断归因。
- Git Blame 忽略纯格式化提交：仓库根目录的 `.git-blame-ignore-revs` 已登记 Commit 2 的完整 40 位 SHA（`02ab4ca63721485ae8413bdca6071bda6f9a93c3`）。本地一次性配置：
  ```powershell
  git config blame.ignoreRevsFile .git-blame-ignore-revs
  ```
  或单次查询时显式传入：
  ```powershell
  git -c blame.ignoreRevsFile=.git-blame-ignore-revs blame <file>
  ```

