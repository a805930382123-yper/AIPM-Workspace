# LW真实验收工具交接（2026-11-05）

Sol施工，HEAD275067c7d120b15051dedc3981b49c64a05c3f9b及既存工作树；只新增本卡3工具/测试文件和本报告，未改产品/旧UI/LW/AGENTS/报告，未提交推送。LW02最终26SHA实际复核26/26一致。工具工程自检通过；LW01/LW02真实质量尚未执行，由Astra独立释放、执行、评分。施工真实请求0、实际配置读取0，不读写KB03账本或正式workspace。主线程此前配置预检1次不混记为整轮0。

## 最终入口

- fresh准备根：C:/Users/DAVID~1.CHE/AppData/Local/Temp/lw-real-Llj8LI；session c40dbb8d-ec83-4608-8c2c-acdccbf478b9。
- freeze：d2a592a47c15654616ed542cd86d02e9dc0df7f314c8d2eb2b886165a6044c4a；manifest SHA 10d73b507ffed78b21ad0a546583b03ec93a0021d297e52ec3ff8500efedab60。
- 新独立LW全局账本：C:/Users/DAVID~1.CHE/AppData/Local/Temp/LW-REAL-20261105-f66b274a66d2-ledger；上限12，失败/超时/pending占额。每次complete前wx+fsync预记，跨进程session/freeze绑定不清零；固定虚构A/B/C的UTF8 SHA在manifest，未读取用户资料。
- release-template.json默认approved=false。独立/主线程按既有授权填写approved/authorization并固定文件SHA，身份默认gpt-6.1-terra及OpenAI v1地址SHA；真实run每次只loadLlmConfig一次且记录config-read文件，不调用连接探测。
- 当前真实账本未由施工写入；假账本仅各fake TEMP下。较早SdYW40准备根freeze已过期，未释放、不作为交接根。

```powershell
node --import tsx tests/acceptance/LW-REAL-20261105.mjs run <root> extract <release> <releaseSHA>
node --import tsx tests/acceptance/LW-REAL-20261105.mjs run <root> qa <release> <releaseSHA>
node --import tsx tests/acceptance/LW-REAL-20261105.mjs run <root> save <release> <releaseSHA> --selection <reviewed-QuestionPreview.json>
node --import tsx tests/acceptance/LW-REAL-20261105.mjs run <root> requery <release> <releaseSHA>
node --import tsx tests/acceptance/LW-REAL-20261105.mjs run <root> no_evidence <release> <releaseSHA>
```

真实调用沿scripts/start_with_proxy.ps1启动上述Node参数。每阶段只执行该阶段并落out-*.json，失败停止；再次调用同阶段必须经批准显式--continue。extract严格standard。每次预算预留后续核心最低4/3/2/1/0次，问答最多2次的产品约束保持。无依据阶段不能抢占核心额度。

## 独立HUMAN操作（真实run没有审批代码）

inspect out-extract和draft后，独立可import {open} from tests/support/lw-real-runner.mjs，const {f,q}=await open(root)。对每个实际看过且接受的维护change，调用f.drafts.reviewChange(draftId,{baseRevision,changeId,decision:'accept'})，再以maintenanceDigest(draft,changeId)调用reviewChange({baseRevision,changeId,confirmed:true,digest})，最后f.confirm(draft)。digest来自services/wiki/maintenance.ts，不能注入审批字段。QA前要求LW01草稿已confirmed。

问答返回后，独立基于原段落生成QuestionPreview文件：title/conclusion/inferences/tags/selectedSectionIds/selectedText/citationIds，保留推断类别和完整引用；run不会自动选段。save后逐条调用q.drafts.reviewKnowledgeChange同样接受/摘要确认，再q.commit(draft)。requery/no_evidence前要求保存草稿confirmed。no_change或错误候选保留原样停止，不自动造新页或修答案。

get/read服务可直接读取原始未编辑产物，重启不会发请求。fake函数内仅对人工固定响应模拟HUMAN以验证事务；该自动模拟从未在run中调用，不能作为真实审核证据。

## 实测与限制

日志：C:/Users/DAVID~1.CHE/AppData/Local/Temp/lw-real-builder-6d74af9f-cb3e-4ffb-9886-1fbc15037b21。

- node --import tsx --test tests/lw-real-runner.test.ts：最终5/5 PASS，0skip/cancel，2580.2751ms，tests-final.txt。首次与最终均无失败；最早fake是10次，最终将无依据fixture明确返回insufficient后为9次：standard3+QA2（实际Raw补读）+save1+requery2+无依据1；保留逐次账本，不声称真实质量。
- 真实子进程预记pending后exit17，重启继续累计1..12；第13次与后续核心预算不足拒绝；写入失败不调用provider；secret候选trace脱敏；坏release SHA、approval、freeze/sample拒绝；未HUMAN确认QA前0请求拒绝；不可重复prepare。
- npx tsc -b：FAIL，唯一既有tests/acceptance/lw02-review-copy.tsx:1未使用React（TS6133），非本次所有权，未改。
- 新测试定向tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters tests/lw-real-runner.test.ts：PASS。不重跑全量或build，复用同26SHA产品工程证据。
- prepare只建立虚构A/B/C与合法Wiki；保留人工年度约定。初始正式TEMP仅两页主题，无模型审批。run阶段从不会调用fixture的accept/approve方法。

## 文件SHA256

| 文件 | SHA256 |
|---|---|
| tests/acceptance/LW-REAL-20261105.mjs | 61d6323bb9815690516e295c88538a41a340d5eb89f67df929422e456ebf00b6 |
| tests/support/lw-real-runner.mjs | d03eda98ffd2bf1e775b03ad679ebe040e1c0b7d5822585bf58e6d9abb3842d9 |
| tests/lw-real-runner.test.ts | cf5e82a004ba488e0e034a99fa8f0c82da5a68829d7df3833a44c19029b27ddb |
