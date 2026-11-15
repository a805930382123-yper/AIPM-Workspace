# EVAL01 施工交接（2026-11-15）

施工实例 `/root/eval01_builder`，Terra High；基线 HEAD `ed34d1b7032a4e819aa0a44aca02e61b7150622f`，以下文件为其上未提交叠加。施工交接时尚未独立验收；施工期间产品、规则、模型配置及正式 workspace 未修改，真实 Provider 调用 0。后续真实运行和独验结果见[独立验收报告](EVAL01-20261115-review.md)。八例 gold 已经 Sol 静态核验冻结。录制 `synthetic-v1` 为人工合成，不是 live 基线。

验证均在 `.scratch-eval01-evidence/clean-lf`（主线程以 `git -c core.autocrlf=false archive` 生成，规则文件与当前工作树逐字节一致）执行，Node 22.23.5：

- `node --import tsx --test tests/eval01-score.test.ts tests/eval01-live.test.ts`：退出 0，4/4；模拟 fetch 500，账本记录一次失败、用量未知，剩余用例 NOT_RUN。
- `node --import tsx scripts/eval/run.mjs --chain standard-extract --recording synthetic-v1`：退出 0，8/8、事实 21/21，结果 `evals/results/2026-11-15T10-31-07-212Z-b39c59de-standard-extract.json`。该结果仅证明 synthetic 回放，不代表真实质量。
- `node --import tsx scripts/eval/run.mjs --chain standard-extract --recording synthetic-v1 --baseline evals/results/2026-11-15T10-28-24-409Z-f18d63a3-standard-extract.json`：退出 0，8 项对比均为零；此项在原子写入和格式整理前执行。
- `node node_modules/typescript/bin/tsc -b`：退出 0；在最终运行器格式整理前执行，运行器为独立 JS，不在 tsconfig 中。

施工交接时真实 live、正式 `live-20261115-baseline`、全量 `npm run check` 和远端 CI 尚未执行。后续真实运行已部分执行并停止，完整真实基线尚未形成，详见[独立验收报告](EVAL01-20261115-review.md)和[基线记录](EVAL01-20261114-baseline.md)。逐请求结果账本使用项目 `writeJsonAtomic`，在调用前写 attempted；输出仅使用产品已知密钥扫描与安全错误。未将 synthetic 结果写为真实基线。

## 交付文件 SHA-256（原字节）

- `scripts/eval/run.mjs`: `80f8eb6e2190fa7c40a512b545ce1f6e155777f940bdfad7fd53474663772fc9`
- `scripts/eval/score.mjs`: `840b5ed4fca22611f479aa08aa8c2c0872680bced41bd6e32d31c1ebe435df2d`
- `scripts/eval/generate-synthetic.mjs`: `b7a7905cca4da61d81ed923dcd1eff823aa2b68e903064af1b1f610668bf21ab`
- `evals/thresholds.json`: `fd76ae5aa58d390a3207ef06fadb7c76c42c76414b2e7f57c934fabb42fac9cb`
- `tests/eval01-score.test.ts`: `37f40e9fd35ccdc9a522fb15032580ceba08342641720da8df34e29607032134`
- `tests/eval01-live.test.ts`: `566da5c8b6cbe7492ffc3a2e302bdf488d791e0405d0db4b88d845df6a00ca60`
- `tests/eval01-preload.mjs`: `c924b0fb2bbd7fa40fe83cb1f47c891589a99445d7a0ad49f0ea8d0701a214b6`
- `package.json`: `e0548eedae82a1f9c25e567056e0e8aba5ff861d77cc05397205c5d2691cf088`
- `.gitignore`: `49abe8b3564d8ce4845fbc7eb12a33bab1ddcf1ff09a4fb891b8ee67de108b20`
- `.github/workflows/ci.yml`: `66ecbc0c1725217e68deb428269655c24f8683544f6b993b58010a43124a6362`
- `docs/testing.md`: `5a717e245303bb50053c54054de46adb9c6af1ac760973ef5043ba72c6800c99`
- `evals/cases/standard-extract/basic-01-timeout/body.txt`: `8079c841dfddcc45d4e70747b372329da652edc4416e6a1b36e765b781438bd4`
- `evals/cases/standard-extract/basic-01-timeout/case.json`: `8e5a70296dd4df13874746dcee200c597f069dbc7753c8fa6ca78d609e776284`
- `evals/cases/standard-extract/basic-01-timeout/gold.json`: `04e2b26120c7a4ef7212dd6cb37022005960acf2ca197821d772d545ecc870cc`
- `evals/cases/standard-extract/basic-01-timeout/recordings/synthetic-v1.json`: `a187274b3f480a91de8dc072bf153dbbb7f858c7280825d114ffd6bf3d1c7d73`
- `evals/cases/standard-extract/basic-02-cutoff/body.txt`: `90e32ed0c135a4dbb500efbfbc30191bbe6b35fc77f849f647d6829340b7ccba`
- `evals/cases/standard-extract/basic-02-cutoff/case.json`: `51af6a5b918138b77a48f92bb63389dcd3d672c1e286f987f2ba8a7423bc6208`
- `evals/cases/standard-extract/basic-02-cutoff/gold.json`: `eb976e9515bb85db3ef97e8886f5dadc0e2ce69248fdc4dcf887c8b9ca3203a9`
- `evals/cases/standard-extract/basic-02-cutoff/recordings/synthetic-v1.json`: `fed8688e2d40c3743260a326350adb0d5246e4c63ba99e1926550139a3b76097`
- `evals/cases/standard-extract/basic-03-scope/body.txt`: `1afaacf5f9241f4f2620ccc817b325d1476fe75ca49e9afba17c39c22d3c0991`
- `evals/cases/standard-extract/basic-03-scope/case.json`: `a157a0ce02ec0fd1736fdb08f867359ade747e7f07a350b9141bbb7323c9f868`
- `evals/cases/standard-extract/basic-03-scope/gold.json`: `506539cc62b8e1d1e07ab95f567d394c0e1276e6aa4d3222c7577ae7f2fc2b58`
- `evals/cases/standard-extract/basic-03-scope/recordings/synthetic-v1.json`: `a607d3e9a4440dcabf67e7fec19847a6032b93cb4b17d57d633575696bd21b7e`
- `evals/cases/standard-extract/basic-04-repeat/body.txt`: `dfcb5420e35347f574b990d8f4d25926b79ba333a0c9dadd3fb21240119c2fc4`
- `evals/cases/standard-extract/basic-04-repeat/case.json`: `ac5a1d35f58934025d1d9286fcb8f403c421a9003b537dd02d7e680e4bdf730b`
- `evals/cases/standard-extract/basic-04-repeat/gold.json`: `baba7878ae86ced2b3c0257af5beca8a485404c7c549edb9156e87c872a39015`
- `evals/cases/standard-extract/basic-04-repeat/recordings/synthetic-v1.json`: `1d6bbd1367c24ceb0681e00a395b92e6cff354dd14b8353846bf069419dd3fb4`
- `evals/cases/standard-extract/basic-05-reconcile/body.txt`: `89389b2e964fca7df4e20d75d0de689711fdaa266ce566dc3519d6bbc3827ea0`
- `evals/cases/standard-extract/basic-05-reconcile/case.json`: `315de66e780ea0bec84ad7b06d90a3653dac9c99df3218bcbcf815c90793b45d`
- `evals/cases/standard-extract/basic-05-reconcile/gold.json`: `f76a1719d0e3eddb23811d3f0ca28ec3093ef92c3a96e4b2448f9ec35f295fbb`
- `evals/cases/standard-extract/basic-05-reconcile/recordings/synthetic-v1.json`: `f4391eb71083212186c86c1b74ec1924c68f63091ce6be9c923efa176bf3bbb8`
- `evals/cases/standard-extract/basic-06-rate/body.txt`: `e73b0352af7a563c42284fc5429ed0b096a49e18080aa6c86ba514d2fdbf4fff`
- `evals/cases/standard-extract/basic-06-rate/case.json`: `42931f4998180f76483c9b24bc64bff2c9c58158ae75858609a560c3e43f3022`
- `evals/cases/standard-extract/basic-06-rate/gold.json`: `61952b5ba19b28ff45b3c0946956b631a727ad0e7c738f61f0df7972fb147956`
- `evals/cases/standard-extract/basic-06-rate/recordings/synthetic-v1.json`: `f3d4370981a95fba8c6e0c7f1cdc4e0383d6782038f9657d7dde9f7f3daa1437`
- `evals/cases/standard-extract/trap-01-forecast/body.txt`: `259e88ce1e5f41487a1b87dcd860dbb42d0562f3a2fe67fbdb225bd0c4bb9140`
- `evals/cases/standard-extract/trap-01-forecast/case.json`: `12be7dca4b569c9c28806537c9726817191bb6c17aaf289bd6f1554693e9be1b`
- `evals/cases/standard-extract/trap-01-forecast/gold.json`: `3369175fd0b6d4f15242d5f44f237255f673b64155ff379c3f734fba6f8d21f2`
- `evals/cases/standard-extract/trap-01-forecast/recordings/synthetic-v1.json`: `3cf44f5cd9fd6414e14077e6961dd038fff0d1d7c8e2bdb4d86b01c0e2679a64`
- `evals/cases/standard-extract/trap-02-units/body.txt`: `7c4743639dd9dc0ceb0af8eed561cbf4130b2dba76e447fd28d76e5434e7a8ba`
- `evals/cases/standard-extract/trap-02-units/case.json`: `14fe2941182ea816e9ca8a1a5566c31c133506d391566d80d71154c6b75745d2`
- `evals/cases/standard-extract/trap-02-units/gold.json`: `62b9585e3a4191e04454fe6fbc79c354b0f2e6d59e4df880e2f1a30f2f0ab9cf`
- `evals/cases/standard-extract/trap-02-units/recordings/synthetic-v1.json`: `f2f4eda7725a8644d8bfd92c8310695e215e75b2f3b2dacd5f054d0d0400580f`
