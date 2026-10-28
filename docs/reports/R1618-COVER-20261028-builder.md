# R16/R18 COVER：零调用准备施工交接

2026-10-28，Sol High `r1618_retest_build`；基线 `a77bcff8a3a906ba3c79ac6025e474c72eac32fe` 加本报告所列差异。按[任务卡](../handoffs/R1618-COVER-20261028-task.md)及[Astra冻结计划](R1618-COVER-20261028-plan.md)，B模式0/2/2/2=6。施工完成，停写交Astra独立检查；不自签准备或真实质量验收。

## 实际范围

仅改既有QUALITY-run.mjs、新增COVER-concept-fixture.json及本报告。新Concept fixture的元数据/六句原文逐字采用计划；原Process六句fixture字节不变。固定映射为concept→C fixture/248起账/249–250，process→原P fixture/250起账/251–252。prepare显式接受profile名并持久化，session校验固定fixture/起账/序号，release同时绑定profile，run读取对应fixture并使用本会话序号/基数；每会话最多2次、独占attempt、首失败停与无重试机制沿用。

CARD/PREFIX绑定本轮，freeze无分支地包含两fixture、入口、本卡及计划和原产品依赖，共66项。产品revision15、拆页/协议/存储、旧fixture/报告/证据未改，没有新增框架或超时。fakeReply仅新增注释说明：其原硬编码补货回答与C语义无关，仍是机械出稿测试，不发给真实模型、不作为C/P质量oracle。没有为C新增fake质量答案。

smoke在同一命令循环两固定profile，保留原稿及原事实检查、未放行/已用会话拒绝，并核session fixture SHA/起账/序号和各自attempt文件。两profile的fake result起账分别248/250，是模拟映射；**实际知识累计仍248/500**，Prompt15/24不变。

## 实际命令与结果

工作目录 `E:\AI\Work\AIPM Workspace`；仅一轮smoke与各一次prepare，Node执行直接require_escalated避开已知沙箱EPERM：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs smoke
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare concept real
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare process real
```

- smoke：exit0，1.349秒；pass=true，4fake/0real/configReads0；profile-binding、unreleased-zero-call、two-request-original-draft-capture、used-session-rejected全部完成。C fake目录`.scratch-R1618-COVER-20261028-DQVUhs`（attempt249/250）；P fake目录`.scratch-R1618-COVER-20261028-NAymJx`（attempt251/252）。每个result均reserved/sent/fakeCalls2，realCalls/configReads0，原稿未人工改写。
- concept prepare：exit0，0.679秒；process prepare：exit0，0.689秒，两个未release会话如下。
- `node --check tests/acceptance/R1618-QUALITY-20261027-run.mjs`及限定`git diff --check`均exit0；后者仅LF未来转CRLF提示。`rg -n`静态核所有profile/fixture/序号/起账引用；原P fixture的Get-FileHash与旧值一致。
- 只读`node --input-type=module`逐个重读两份freeze.files并SHA256、核JSON.stringify(files)聚合及session绑定、枚举根目录release/attempt/run-started：exit0，两会话各66项、drift=[]、aggregateMatches=true、forbidden=[]。未再跑任何测试。

没有执行真实run、加载`.env.local`/实际配置或调用真实Provider。prepare不进入run；fake分支不进入懒加载loadLlmConfig及实际Provider.complete，既有release仍先于它们验证。本轮真实/config读取0。无tsc/旧矩阵/浏览器/服务/正式写入，未Git提交；外部AGENTS和AGENT-ROUTER打包报告保留排除。

## 两个未放行会话

| 项 | C | P |
|---|---|---|
| root | `E:\AI\Work\AIPM Workspace\.scratch-R1618-COVER-20261028-DzxR8N` | `E:\AI\Work\AIPM Workspace\.scratch-R1618-COVER-20261028-Gjkejk` |
| sessionId | `b9ef29c9-bdf7-4f2b-bd1a-5f8a3f691b54` | `473bb246-562c-46f9-8b48-1d96f5875551` |
| rawId | `394279ae-36d5-4edd-b5ff-f27b0a94ceb5` | `0fb6e144-3db7-43f0-a06a-16cb57b1c288` |
| raw.body SHA256 | `c699ae168e20dfc0562215e64dba0e9bf3c00c68c2b57a88d51aecbf048e1853` | `a64ef3745784ea68ceadb7e62d841f537727fcf505a79f918f43507665cb74ef` |
| raw文件SHA256 | `68f8543dbb31290111bd67d4a8052cc01a2f30b8c625cbf4dd02be753a2cc34b` | `6be6c24bc5c61d1f45c45a0462a0726f4ce1f4938544eb9bfd01b0f5ad97944f` |
| profile / 起账 / sequences | concept / 248 / [249,250] | process / 250 / [251,252] |

两者mode均real、maxCalls2、promptUsed15。持久证据各在root/session.json、freeze.json及knowledge/raw/notes/<rawId>.md；根目录无release/attempt/run-started/result。prepare仅stdout返回released=false、budgetApproved=false、issuedAt=null的releaseTemplate，没有落盘release。P会话的250起账是后续C两次成功且质量通过后的预定映射，不表示本轮已消费或授权C/P。

## 冻结SHA256

两会话共同聚合：`aff901d1c4bb8d4f89f352cdbdb4d5a63a39f8a981b8298466bdc71298d772bb`，66项。对应smoke受测源文件保持一致。

| 项目 | SHA256 |
|---|---|
| QUALITY-run.mjs | `a9671e50474bf65541933da951fe57f692ca8d6b0a8754cdae06e16245aecebb` |
| C fixture | `dbaf4a0b704012b004a5b9e895324855a29e5647a3748aa927039905432d8c82` |
| 原P fixture | `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7` |
| COVER任务卡 | `5a95735a93b4b692324675ae64734e6c3d145d2143e9f8749bcfaa2f723827c5` |
| COVER计划 | `ebed071c55b3826d788c3f48ddb4e009fd68068889234111e1b63566fb9453dc` |
| knowledge-planning.ts（未改） | `82a4baf45e5a2dae2e1f5e204ab29a4b9913c07c0007452de0ee3532adc61e9c` |
| rules.ts（revision15，未改） | `2a0fe3abc2dfb8d8b1c658c0b0728bd935163788fbf2079fe74f517329e38d7b` |

本卡和计划均是冻结输入，之后不应修改却继续使用旧freeze。放行前需核实工作副本SHA，包含Git可能的换行变化；本机隔离证据不提交。

## 后续入口与剩余门禁

下列仅供主Agent在用户批准最多4次预算后逐会话签release使用，**本轮未执行**：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-R1618-COVER-20261028-DzxR8N" "<C批准release绝对路径>" "<C release原字节SHA256>"
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-R1618-COVER-20261028-Gjkejk" "<P批准release绝对路径>" "<P release原字节SHA256>"
```

C249抽取+250规划，C执行及独立质量通过后方可签P251抽取+252规划。任何技术失败、质量FAIL或目标缺证停止，不自动重试、不挪用余量。顺序与质量是主Agent逐会话放行门禁，入口没有新增跨会话调度器。outputs若省略仍须记真实措辞改善未覆盖，question-only仅以实际产生分支计证。准备机械检查不证明C01/P01或模型动作状态真实遵从。

施工完成停写，Astra可核实际diff、两个原文、会话和66项冻结，复用同版一次smoke证据。旧246/248 Q02 FAIL及R16/R18/B09整体未通过保持；当前没有新增实现决策，真实预算尚待用户明确。
