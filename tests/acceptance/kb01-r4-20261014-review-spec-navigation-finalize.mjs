// Persist results already observed in independent node:test runs; no re-run or product write.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const freeze=JSON.parse(await fs.readFile('docs/reports/KB01-R4-20261014-frozen.json','utf8'));
const prior=JSON.parse(await fs.readFile('docs/reports/KB01-R4-20261014-review-spec-frozen3-pass.json','utf8'));
const files=['app/App.tsx','tests/app-navigation.test.tsx','tests/app-m05-raw-navigation.test.tsx',...Object.keys(prior.productHashes)];
const hashes={};
for(const file of files){const hash=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');if(hash!==(freeze.product[file]??freeze.tests[file]))throw Error('Freeze mismatch '+file);hashes[file]=hash;}
for(const [file,hash]of Object.entries(prior.productHashes)){if(hashes[file]!==hash)throw Error('Prior evidence cannot be reused after change: '+file);}
const navigation={at:new Date().toISOString(),freezeAt:freeze.at,axis:'Spec',scope:'Only App explicit navigation repair and affected selection-generation regression',
  status:'PASS',rootFinding:{id:'SP-F04-K03-navigation-overlay',priority:2,status:'CLOSED',origin:'Root IAB discovery',file:'app/App.tsx',lines:[89,90,91,92,93]},
  actualTests:[{command:'node --import tsx --import ./tests/support/css-stub.mjs --test tests/app-navigation.test.tsx',pass:1,fail:0,durationMs:2200.778,
    scenarios:['Draft overlay -> sidebar Raw restores Raw selection','Workflow overlay -> sidebar Home exits workflow','Workflow overlay -> sidebar Raw restores Raw selection']},
    {command:'node --import tsx --import ./tests/support/css-stub.mjs --test tests/app-m05-raw-navigation.test.tsx',pass:6,fail:0,durationMs:3081.9626,
      scenarios:['Missing explicit Raw stays selected','Missing target reconnect then ordinary nav clears target','User choice beats stale pending refresh target','Home click preserves older Raw','Deletion chooses remaining Raw','Settled background job follows current Raw choice']}],
  sourceReasoning:'Explicit nav increments pageGeneration and rawSelectionGeneration, clears both reviewDraftId/workflowId, retains explicitRawTarget and current selection; completion intent still requires matching navigation/selection generation and correct Raw.',
  hashes,previousBackendAndReviewEvidenceUnchanged:true,
  limits:['jsdom fixture fetch, not a real browser','Root IAB result is root evidence, not independently rerun here','No actual Provider','Real long document remains FAIL; real update PASS per root current result','Full final build/suite belong to root']};
await fs.writeFile('docs/reports/KB01-R4-20261014-review-spec-navigation.json',JSON.stringify(navigation,null,2));
const final={...prior,at:new Date().toISOString(),freezeAt:freeze.at,productHashes:hashes,findings:[...prior.findings,navigation.rootFinding],
  status:'PASS_FOR_REVIEWED_SCOPE',reusedPriorScope:'docs/reports/KB01-R4-20261014-review-spec-frozen3-pass.json',
  navigationEvidence:'docs/reports/KB01-R4-20261014-review-spec-navigation.json',
  summary:{priorDeterministicChecksReused:{pass:5,fail:0},latestNavigationTests:{pass:7,fail:0}},
  batchQuality:{realLongDocument:'FAIL (root current result)',realUpdate:'PASS (root current result)',KB01BatchPass:false},
  limits:[...prior.limits,'Latest scope is App nav only; seven fixture tests new, prior five deterministic checks reused by same SHA','Real long document failure prevents KB01 batch PASS; no new Provider call']};
await fs.writeFile('docs/reports/KB01-R4-20261014-review-spec.json',JSON.stringify(final,null,2));
const md=`# KB01 R4 独立 Spec 最终审查

2026-10-14。**已审查的实现范围 PASS：三个独有 P2 及 root 发现的 K03 导航 P2 已关闭，没有未决 actionable implementation finding。真实长文仍 FAIL，真实更新 PASS；本报告不签 KB01 整批或全项目 PASS。** 真实结果采用 root 当前交接，本 reviewer 零实际 Provider 调用，未代签语义质量。

最终冻结时间：${freeze.at}，库存 docs/reports/KB01-R4-20261014-frozen.json。没有 Git diff，只按明确文件库存 SHA 比较，不声称审查了 Git patch。App.tsx、新导航测试、既有 Raw 世代测试和此前七个相关 source/test 文件与冻结匹配；后端、JSON mode、locator、审核页均与上一有效审查 SHA 相同。指纹见同名 JSON。

本次仅检查 app/App.tsx:89–93 的显式 nav：所有目标都清 reviewDraftId/workflowId，先递增页面和选择世代；explicitRawTarget/当前选择保留原逻辑。迟到提取完成仍要求匹配页面/选择世代与正确 Raw，不会因清覆盖页而产生隐式任务或导航。K03 原因是 nav 对 Raw 没清 draft，workflow 无论目标都没清；现已统一清理。

实际新跑：app-navigation.test.tsx 1/1 PASS（覆盖 draft→Raw、workflow→首页、workflow→Raw 三个实际组件场景，均检查退出覆盖页与 Raw 选择）；app-m05-raw-navigation.test.tsx 6/6 PASS（缺失显式目标、重连、迟到刷新选择、首页旧 Raw、删除选择、背景任务完成选择）。两组共 7 个测试，不把一个导航测试内的三个场景另算三条测试。全部为 jsdom + fixture fetch，无网络/Provider；独立结果存 review-spec-navigation.json。root IAB 已验证 draft→侧栏 Raw 与长文失败显示/同 Raw 重试，本 reviewer 不冒称自己复跑浏览器。

此前三个 P2 的有效证据复用：SP-F01 overlap 去重、SP-F02 busy 锁定、SP-F03 suffix 碰撞均 CLOSED。原 5 项确定性检查 5/5 PASS，source SHA 不变，本轮未重跑。旧范围报告保留为 review-spec-frozen3-pass.md/json，旧 FAIL 报告和初次 pre-fix 证据均保留。新 7 项测试与复用 5 项检查分别计数，不能称最新一次新跑 12 项。

完整 locator/legacy/schema/事实推断分离与映射后凭证门禁、官方 GLM knowledge JSON mode 范围结论见保留的 frozen3-pass 报告。本轮仅 nav 修复，没有后端变化。单次 JSON mode 诊断成功、静态契约、fake 或 locator 目录完整覆盖均不能关闭真实 K05 长文失败。最终完整副本测试/build、实际 HTTP、安全链和真实质量由 root 汇总；本 reviewer 不假称它们已完成。未读取 .env.local/正式 workspace、未改产品/依赖/配置，Token 计量不可得。
`;
await fs.writeFile('docs/reports/KB01-R4-20261014-review-spec.md',md);
console.log(JSON.stringify({freezeAt:freeze.at,status:final.status,newTests:7,reusedChecks:5,hashes:Object.keys(hashes).length,realLongDocument:final.batchQuality.realLongDocument},null,2));
