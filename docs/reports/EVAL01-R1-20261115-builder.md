# EVAL01 R1 施工交接（2026-11-15）

施工 `/root/eval01_builder`（Terra High），任务卡 R1 SHA-256 `3af01f0eec0772177c8b98633e0944e085827b6ef010fc0b848f01ad729f5ce0`；本报告是施工自查，独立验收待执行。评分 schema 升至 2，禁止断言仅对具有非空 exclude 的规则按局部分句和命中位置识别限定；无 exclude 的原字段范围不变。有限续跑绑定固定原 run、来源 SHA、旧录制及产品指纹；前四例先零网重评，后四例最多八次，单次凭据防重复。真实 Provider 本轮调用 0，未修改正文、gold、阈值、产品、原结果或四份旧录制。

LF 镜像 `.scratch-eval01-evidence/clean-lf` 自查：

- Node 22.23.5、Node 24 各运行 `node --import tsx --test tests/eval01-score.test.ts tests/eval01-live.test.ts`，均 7/7、退出 0。fake 隔离副本覆盖来源与录制错误、旧录制缺失、先前重评错误、后四录制或凭据已存在、首次/中途网络失败、非法 JSON/schema、质量不达标、重复运行、混合结果与回放一致及 v1 基线拒绝；fake 成功 8 次、累计旧8+新8，均未访问真实 Provider。测试中重绑定来源只发生于临时脚本副本，正式 CLI 固定 SHA 不可由参数绕过。
- `node node_modules/typescript/bin/tsc -b`：退出 0。`node --import tsx scripts/eval/run.mjs --chain standard-extract --recording synthetic-v1`：8/8、21/21，退出 0。此二项与两 Node 专项通过后，仅细化评分器的连续空白规范化；随后 `node --import tsx --test tests/eval01-score.test.ts` 5/5 退出 0，并再次执行下列原录制验证。补充未显式 live 的零外发反例后，工作树 Node 22 `node --import tsx --test tests/eval01-live.test.ts` 2/2、退出 0。
- 指定原结果和 SHA 启动续跑预检，环境中使用 fake 地址及故意不匹配的模型，四例各以产品链重评 PASS（3/3、3/3、2/2、3/3）；随后按预期 `Provider identity mismatch` 退出 1，未外发、未占用续跑凭据。四个 v2 重评结果分别为 `evals/results/2026-11-15T11-04-06-850Z-007138dd-standard-extract.json`、`2026-11-15T11-04-06-984Z-c700d6b8-standard-extract.json`、`2026-11-15T11-04-07-103Z-cf6c1342-standard-extract.json`、`2026-11-15T11-04-07-223Z-4445af12-standard-extract.json`，均在该镜像下。

原 run SHA `ca9a118ee1f7bba97facaf49c186675537e8ad5612a6d2398b8d33ecd3387b61`。四份旧录制原字节 SHA 按顺序 `c9ef7235c3cbfa32600b3ea7a138beac9ce3971d96b8b31ce476c45294493feb`、`c196ff11e93c40987def15b483c75c3293353cc11a4ff894f32506d84691b942`、`1412e1f8614432fd2eea9b97fd3da4ee437c4130646b8dc2930a43528d7ee9b1`、`cb39cc3063a8942274dc0c2ea86305e3cbf04fff1058f5008be76bd57fff80f3`，复核未变。原失败保留；四例重评通过不代表整体通过。独验须复核后才可进行已授权的后四例真实续跑；续跑未执行、完整基线和远端 CI 待验。

本轮文件 SHA-256：

- `scripts/eval/run.mjs`: `1451dc5f1350f8b4b43752d23c411aff846ee41c3c16d493d5793e20575648d7`
- `scripts/eval/score.mjs`: `a9e633afe2085a0e295ec68e4961939a2f61fbfcd9906373b0731061246acbcc`
- `tests/eval01-score.test.ts`: `633de64d11aa46825248215e53fd269c84627b6b459631670f4e068d59334ae8`
- `tests/eval01-live.test.ts`: `bf3915fe92cf318f64ea5cc6b5689c26b5873b30c3083d78d212a54691fefd39`
- `docs/testing.md`: `95b3f5aea57afeb395a60f0e90cdfde76c49fb34445b40aad21641b2c50d1c2a`
