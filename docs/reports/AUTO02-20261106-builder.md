# AUTO02 施工交接

Sol High `/root/auto02_builder` 已完成施工与自查并停写。交由独立 Sol High `/root/auto02_review` 复审。施工版本为 `4a92d63abfc2a4c263f2b2e89ea259203606c09a` 加下列工作树文件。

## 变更

- 首页复用事项列表与详情预检。按当前 Raw、确切 jobId 和双向可用的 draftId 关联，只在绑定成立时合并运行/恢复与待审。不同 job 的历史待审草稿、工作流、Audit 仍各自显示。问答和检查草稿继续走各自的草稿审核入口，不参加 Raw 任务关联。原详情接口继续处理 409、410 和 503。正常运行进度变化沿用同导航 token，结算、恢复和草稿 revision 变化按对应事项校验。
- 结算在 Raw 状态或 job 登记之前中断时，优先用现有 runner 的挂起草稿 ID。重启缺内存关联时从现有校验后的 checkpoint 核对。`services/llm/jobs.ts` 经主线程批准仅扩展内部 `readJob` 返回，公开 job 接口仍按原字段投影。
- `POST /api/drafts/:draftId/defer` 核对当前 Raw、job、草稿、来源指纹和 revision。在原 Wiki 锁及 DraftStore 队列下仅更新可选 `deferredAt`、revision 和更新时间。原冻结事务仍有未完成步骤时拒绝暂缓或结束，含事务已冻结而草稿状态未成功登记的情况。已完成部分提交可暂缓，暂缓草稿恢复后才允许新的确认，旧成功确认重试仍可读回原 operationId。
- 原成果页提供暂缓与明确继续，保存失败停留原状态并提示重试。首页的专门区与 Raw 详情打开原草稿，打开本身保持暂缓标记。未保存编辑会禁用暂缓，临时勾选在暂缓时清除，已提交成果保持只读。Raw 详情核验草稿响应的身份再开放入口，旧 `lw01-raw-ui` 的迟到响应测试补齐生产响应原有的 `id` 和 `rawId`，原断言保留。

## 施工验证

相关回归 **38/38**，其中新增 4 项。覆盖整理中和结算后同一任务、不同 job 的旧草稿、错配及缺失、版本冲突、Raw 状态真实结算故障后的单卡与恢复、冻结清单未登记到草稿时拒绝暂缓、部分提交后暂缓与重复确认。

```powershell
$env:TEMP = Join-Path (Get-Location) 'node_modules/.cache/auto02-builder'
$env:TMP = $env:TEMP
node --import tsx --import ./tests/support/css-stub.mjs --test tests/auto02-actions.test.ts tests/lifeos-l3-actions.test.ts tests/lifeos-l3-navigation.test.tsx tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l6-review.test.ts tests/app-navigation.test.tsx tests/lw01-raw-ui.test.tsx tests/lw01-actions.test.ts tests/lw01-recovery.test.ts tests/rawux01-http.test.ts tests/acceptance/AUTO01-review-actions.test.ts
npx tsc -b
$env:AUTO02_BUILDER_EVIDENCE = Join-Path (Get-Location) 'docs/reports/AUTO02-20261106-builder-evidence'
node --import tsx tests/acceptance/auto02-builder-browser.mjs
& 'C:/Users/80593/.codex/skills/impeccable/scripts/impeccable.cmd' detect --json app
```

- `npx tsc -b` 通过。实际 Chrome 156.0.8078.80 使用隔离 `server/index.ts`、空 `envDir` 的 Vite 构建和仅监听本机回环的 fake。构建 227 模块，保留 Vite 既有体积提示。
- Chrome 实测从运行卡返回确切 Raw，再回首页等待同任务结算。编辑第二项、先确认第一项，模拟暂缓保存失败后重试成功。刷新后从首页、再从 Raw 打开同一 draftId，显式恢复后重新选择并入库。7 份 Raw、Wiki、job、Raw 状态及事务文件在暂缓至恢复期间 SHA 一致，fake 总请求 3 次，全部用于最初生成。第二次提交沿新 operationId 确认剩余主题，第一项 Wiki SHA 保持，第二项在正式 Wiki 可读到草稿中保存的人工补充及 Raw 来源。最终首页撤下事项，Raw 历史出口可回到已确认成果，Chrome 页面错误 0。
- 查看了 1440×960 与 390×844 的首页、成果和 Raw 受影响区域，脚本断言窄屏无横向溢出。实际证据见 [浏览器摘要](AUTO02-20261106-builder-evidence/summary.json)、[运行卡](AUTO02-20261106-builder-evidence/01-running-home-desktop.png)、[成果暂缓](AUTO02-20261106-builder-evidence/02-deferred-review-desktop.png)、[首页稍后区](AUTO02-20261106-builder-evidence/03-deferred-home-narrow.png)、[成果继续](AUTO02-20261106-builder-evidence/04-deferred-review-narrow.png)、[Raw 入口](AUTO02-20261106-builder-evidence/05-deferred-raw-narrow.png)及[最终 Wiki](AUTO02-20261106-builder-evidence/06-final-wiki-narrow.png)。
- 一次 impeccable 扫描退出码 2，6 项均为已存在的 `.demo-notice` 等侧边框警告，本次新增区域无检测项。首次默认沙箱测试遇到 TEMP 原子重命名 EPERM 和回环连接 EACCES，随后以仓内忽略的测试 TEMP 和通过自动审核的独立回环命令完成。一次新增 HTTP 自查暴露运行中仅进度变化会产生 409，收窄版本键后通过。首次 Chrome 脚本停在测试定位器，更正后完整通过。
- 初次 `git diff --check` 通过。最终尝试遇到主线程同样复现的索引读错 `unknown index entry format 0x38610000`，由主线程核查索引。下列施工指纹从文件内容直接计算。施工未提交或推送。

测试使用合成数据和本地 fake，真实模型调用 0。正式 workspace、实际凭据及用户服务隔离。全仓默认套件与真实模型质量未在本轮施工重验。隔离服务和浏览器已关闭。

## 施工文件 SHA-256

```text
36d1d2560b6cbc406dd908444a1c1d5e1c1c4c9e0fcb4d75676fa0ebcac2eb73  app/App.tsx
c5808466ac7345f7affee30dc06d0b1838c8b6a2be58969da00477864671516e  app/api.ts
cfaafac65de600d314abdb7f4744fe8b9d7428e9b13ebaf191f9efbdf6bcebe7  app/pages/DraftReviewPage.tsx
6d3d6f1ec6a9e7ac5e2798951c05984b4e968f301aaa504b3d208afc0f11979d  app/pages/HomePage.tsx
08f265460d4dfde09163f24f40526b424df9d581417af85f5dc37f40208db132  app/pages/RawOutcomeReview.tsx
df319f03336cf40c35f5275aafff826cf1dbddbceb6b220a74816cecd262aa90  app/pages/RawPage.tsx
7115d24b60d8e664455e64ce529e898ca2d2cfd4d9cbbd46856bda37a75180e0  app/styles.css
d4166fca5aa1dd230dbf64cc5e65b6edf5ee1ce9f1726106032c49f0f7bce303  server/llm-api.ts
dd8e7dab5159117a9e7ca071541f6a0fed799629e190ca526876d39eef719fcd  services/home/actions.ts
316773756351f604a5454461c2bb49f6405f35d80f7a0462161d238bd552eaaa  services/llm/jobs.ts
70599e8a4d6efca04c93e50c6a6a7ae562cf4aa5216dc48abd0d14eaedb8639f  services/storage/record-validators.ts
2093784e3b90919a9ed73d324ed371c4c633b0f00a1db0b789f1843133c27628  services/wiki/commits.ts
80d9cc064296b38f0efea684b5069233723139c1e77c27346d8a106186623cf1  services/wiki/drafts.ts
1fca18b0a49472bf2fb6a8c9fe82faef1355395805c13c1364aa0191ecb82312  tests/lw01-raw-ui.test.tsx
1a174994e8ae1fa9eeb50799bc142ad4dca0df3add4b98c56af3ae39438cc9e5  tests/auto02-actions.test.ts
f04b73422beb579b66f03823333d45821bd73305b22c8dda40f6e66765d311bf  tests/acceptance/auto02-builder-browser.mjs
```
