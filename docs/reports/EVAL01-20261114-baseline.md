# EVAL01 真实质量基线（评分 schema 2）

本基线由**前四例旧真实录制零网重评，加后四例获授权真实续跑**组成，使用 `openai-compatible / gpt-6.1-terra`。八例均达到冻结质量门槛；这是一组有限合成样例的评估结果，不代表全部业务语义正确。评分误判修复、续跑与独立验证详见[独立验收报告](EVAL01-20261115-review.md)。工程提交的真实双版本CI已通过，Sol独立验收确认EVAL01整体PASS；详见文末CI核验与独验报告。

原 v1 运行 `2026-11-15T10-34-38-191Z-832c444a` 在第 4 例因评分器未识别否定限定而停止，原结果保留，SHA-256 `ca9a118ee1f7bba97facaf49c186675537e8ad5612a6d2398b8d33ecd3387b61`。评分器修复后，仅以原四份录制重评，并继续原后四例；没有将原失败改写为历史通过。

## 质量结果

| 用例 | 执行来源 | 结果 | 必含事实 | 证据 | 待确认 |
| --- | --- | --- | --- | --- | --- |
| basic-01-timeout | 旧录制回放 | PASS | 3/3 | 1/1 | N/A |
| basic-02-cutoff | 旧录制回放 | PASS | 3/3 | 1/1 | N/A |
| basic-03-scope | 旧录制回放 | PASS | 2/2 | 1/1 | N/A |
| basic-04-repeat | 旧录制回放 | PASS | 3/3 | 1/1 | N/A |
| basic-05-reconcile | 授权续跑 | PASS | 3/3 | 1/1 | N/A |
| basic-06-rate | 授权续跑 | PASS | 2/2 | 1/1 | 1/1 |
| trap-01-forecast | 授权续跑 | PASS | 3/3 | 1/1 | 1/1 |
| trap-02-units | 授权续跑 | PASS | 2/2 | 1/1 | 1/1 |

结构与字段校验 8/8；证据保真 8/8；必含事实 21/21；待确认 3/3；禁止断言命中 0、分区违规 0、重复率 0、空或仅标题主题 0。N/A 表示该例无待确认 gold，不计为 100%。

## 请求账本

| 真实请求来源 | 请求数 | prompt token | completion token | 用量未知 |
| --- | --- | --- | --- | --- |
| 原运行前四例 | 8 | 33,295 | 3,865 | 0 |
| R1 后四例续跑 | 8 | 33,476 | 1,738 | 0 |
| 累计 | 16 | 66,771 | 5,603 | 0 |

R1 续跑每例均完成 extracting、planning 各一次。按例 prompt / completion token：`basic-05-reconcile` 8,434 / 578，`basic-06-rate` 8,444 / 439，`trap-01-forecast` 8,335 / 336，`trap-02-units` 8,263 / 385。前四例回放使用 8 条旧录制响应，未新增收费请求；没有估造金额。

## 版本与可复核证据

- mixed 结果 `2026-11-15T11-08-15-818Z-2c3749cf`，位于 `.scratch-eval01-evidence/clean-lf/evals/results/2026-11-15T11-08-15-818Z-2c3749cf-standard-extract.json`；原字节 SHA-256 `dfee62b7e12c5905d13b2ba8c7117c3ee3db9fd5083488f8356e5fc43d411cac`。其新请求账本仅含续跑 8 条，来源账本规范序列化 SHA-256 `15fee5274819d55de57c2c16d615197361b030d49c265230ec0d491f93d958f0`。
- 真实运行时的受测代码为 HEAD `ed34d1b7032a4e819aa0a44aca02e61b7150622f` 加本批冻结改动，现已纳入工程提交 `4bb88739c88211f1c40038308643820e1d0459f7`；评分 schema 2，`scripts/eval/score.mjs` SHA-256 `a9e633afe2085a0e295ec68e4961939a2f61fbfcd9906373b0731061246acbcc`，运行器 SHA-256 `1451dc5f1350f8b4b43752d23c411aff846ee41c3c16d493d5793e20575648d7`。
- 规则版本 `b04-b04-1-locator-v2-kb02-atoms-planning-19-7dfb242969dd-4991d5bf`；阈值规范指纹 `6ea41141949c4d658ecfdf17fb7fd6ae5c0422f4a42502deb68374e2fb236e89`；固定录制 ID `live-20261115-baseline`。每例 case、规范正文、gold、录制指纹及完整命中位置均在 mixed JSON 中。
- Sol 独立验证 Node 22 与 Node 24 的八例零网回放与 mixed 用例指标深等，`--baseline` 八项变化均为 0。两份回放结果原字节 SHA-256 为 `d91a99397561a4bbb6cb4601c4c41a61c22750376a959bc23b34061491e3725c` 和 `f372254b1bf7298f090f253af7aabfd10ded087cd472d745c3defc810c03cdaa`；对应文件均在上述镜像 `evals/results/`。

`synthetic-v1` 只用于离线工具回归，不计入本真实基线。原 v1 结果不能直接与评分 schema 2 作为同版本基线比较。

## 提交后CI核验

工程提交`4bb88739c88211f1c40038308643820e1d0459f7`的[真实CI](https://github.com/a805930382123-yper/AIPM-Workspace/actions/runs/43709455049)在Windows Node22.23.4/24.22.2各904/904、失败0、跳过0，正式replay8/8、事实21/21，类型检查及235模块构建通过。本基线来源与评分器未随CI夹具修复改变，原失败与两轮真实账本继续保留。
