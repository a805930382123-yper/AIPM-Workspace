# 测试与检查

使用 Node 22.13 以上，Windows PowerShell 使用 `npm.cmd` 或 `npm run`，不使用 npx.ps1。

- `npm run typecheck`：对 tsconfig 范围执行严格类型检查。
- `npm test`：运行 `tests/*.test.ts` 和 `tests/*.test.tsx`，不包括 `tests/acceptance/` 和 `.mts`。工作树中同名 glob 的未跟踪文件也会运行；提交树仅包含已跟踪文件。
- `npm run check`：依次执行类型检查、默认测试及构建，任一失败即终止。
- `tests/acceptance/` 是按对应任务卡单独运行的验收脚本，不属于默认 glob。`.mts` live/replay 脚本也不属于默认测试；live 会访问外部来源，必须另获明确授权；replay 通常依赖隔离快照，但 tests/news09-pdf-replay.mts 会真实补拉 PDF，同样须另获联网授权。

测试前将 `FMCG_DATA_DIR` 指向新建的系统临时目录，并将 `FMCG_LLM_CONFIG_FILE` 指向该目录下不存在的配置文件；清除继承的 `FMCG_LLM_*` 凭据。不要使用正式 workspace、真实配置或用户已有服务端口。

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
