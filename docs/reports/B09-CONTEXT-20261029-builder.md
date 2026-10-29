# B09 所选 Wiki 上下文最小修复

2026-10-29，Sol High integration_prepare；基线 `0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89` 加当前已验UI差异。主线程授权本轮具体上下文缺陷修复及有界续接入口，Astra冻结C01–C06。**工程自查通过，独立验收待定；原Prompt17真实FAIL保持，I03/R36及B09整体未签通过。** 当前实际累计知识263/500、Prompt17/24，本轮施工真实调用0/配置读取0；未启动真实服务或执行real start/arm。

## 修复与自查

原context把Wiki正文按空行拆段，首次摘录后跳过全部零分段；原17关键词无匹配时只发首标题16字符，Wiki完整正文1364字符且预算未满。仅在 `services/prompt-ai/service.ts` 的同一context函数将独立Markdown标题和随后正文合为一个单元，保持原匹配分数降序，移除零分段跳过，使剩余预算按原稳定顺序提供正文。没有新增检索器/关键词算法/模型阶段/重试，没有改生成契约、所选ID、secret/source门禁、每页3000/总12000或最多6页限制。

回归fixture `tests/fixtures/b09-context-20261029-request17.json` 保存原17人工编辑Brief、实际选中Concept ID/完整正文、失败上下文16字符及原官方Raw文件。原请求字节SHA `c39220b77d446c09447521fd3aaf1260a2ccd8a897a9a6bb3754f99f406561a6`；Wiki取主线程 `i03-failed-export.json`，fixture附其SHA。原历史请求/响应/活跃7SOfcf未修改。新增测试通过实际generate caller及fake Provider核原Brief/所选ID保持、正文定义进入单次请求、未自动保存Library；零匹配的标题/正文完整保留；有匹配相关段连标题优先；未选页面零发送；分隔符纳入字符计数、6页/3000/12000及第7页在调用前拒绝。

首次定向5项有4通过，原17 fixture因缺其Raw文件被既有来源门禁正确拒绝；补齐原Raw依赖后执行全 `tests/prompt-ai.test.ts`，**11/11 PASS，exit0，1.272秒**。这不是放宽来源门禁或修改历史数据。实际命令：

```powershell
node --import tsx --test tests/prompt-ai.test.ts
npm run build
git diff --check
```

build升级执行exit0，tsc通过，214modules，Vite1.31秒（命令6.904秒），只有原大bundle提示；UI产物仍index-BwMLIOGy.js，因为本次只改后端。diff检查exit0，只有现有LF→CRLF提示。未重跑全仓suite或真实模型。产品与测试已先停写交Astra并行审C01–C05。

## C06：仅本次上下文补验续接

两个既有run/trace仅增加 `prompt-context-continuation` 固定分支：从固定原7SOfcf/session继承，核原四call为16/17/262/263、httpSent1/provider-returned；完整复制knowledge/drafts/state/prompts/meetings，包含原失败生成草稿。旧integration全目录逐字存新根 `integration/ancestor`，新calls为空；session分别列资产/history的全部路径SHA和ancestorSessionId，不覆盖旧17或伪写成功。

新分支基线知识263、Prompt17，知识cap0、Prompt cap3，只允许generate/check/rewrite，trace按顺序18/19/20；拒绝update/audit/brief、第4次及首失败后所有请求。普通分支仍知识261/Prompt15、cap2/4及旧六阶段。start和stage release继续绑定新session/freeze/预算，另须 `additionalPromptCallApproved=true`；prepare模板默认该项false、released=false、budgetApproved=false。**主线程取得用户追加一次的明确预算批准后才可构造release；本报告及模板不是调用授权。** 没有执行real start/arm，也不自动使用剩余额度。

唯一离线命令 `node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs continuation-smoke`，升级共享TEMP执行，**exit0，1.902秒**：新分支3fake序号18/19/20、知识/Brief拒绝、第四次拒绝；独立失败分支1fake序号18、第二次首失败停拒绝；普通分支6fake序号16–19/262–263全部通过。共10fake、外发0、配置0，没有启动任何HTTP服务。原始calls证据根分别 `...\b09-integration-20261029-IKqvpT`（新成功）、`...\b09-integration-20261029-HbrwKm`（新失败停）、`...\b09-integration-20261029-D4KqQt`（普通分支）。

最终仅调用prepare，不启动：

- 补验根 **`C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-oZSBMc`**，session `1be23ab5-560f-4dfa-b4dc-d094228eed01`，ancestor `add48a69-7222-408b-9a05-de83fe2688ef`/7SOfcf。20资产文件、63历史文件复制逐SHA一致，原17请求再逐字比较一致。
- 独立零模型UI空根 **`C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-yqIAZf`**，session `0d578d8d-9891-4df5-8a04-3f7613692b8a`，source=null/copied=[]/kind=manual。manual的旧预算字段只是原准备元数据，Provider永禁，不能据此回退实际263/17账本。
- 两根同freeze **`87a1e3a3219c24e4155c54c1da4058dfcd3409890e282bfc055dd0377d79ae8d`**。旧freeze因后端/入口改动不再用于新的arm；旧证据仍按原版本保留。主线程新增upload fixture不在本施工所有权内，原样保留。

manual空根可由主线程启动：

```powershell
node --import tsx tests/acceptance/B09-INTEGRATION-20261029-run.mjs serve "C:\Users\80593\AppData\Local\Temp\b09-integration-20261029-yqIAZf" manual 5180 63993
```

补验根未来命令仍为 `serve <oZSBMc根> real 5179 63992 <新start-release.json> <该文件SHA>`，每阶段 `arm <同根> <新stage-release.json> <SHA>`；对应stage/route为generate `/api/prompt-ai/generate`、check `/api/prompt-ai/optimize/check`、rewrite `/api/prompt-ai/drafts/实际新草稿ID/rewrite`。本轮不生成已批准release，不执行这些real命令；若获准，generate必须实际复用原人工Brief/同一所选Concept，不能调用Brief或新抽样，原17失败照常留档。

| 文件 | SHA256 |
|---|---|
| services/prompt-ai/service.ts | `c15b4a6c01c27df293fb70cd0be0766dbd8430173a415ca4bcce04c1f38d390f` |
| tests/prompt-ai.test.ts | `6b8474e937b53b6d229564184640205309b58efa6285158a97ba9e5818493e8e` |
| tests/fixtures/b09-context-20261029-request17.json | `250d9e2450f29c935f09d5ae3c1a82c1a9c5eec91ecbd40dcc27168e4d31708f` |
| tests/acceptance/B09-INTEGRATION-20261029-run.mjs | `f2af8a5d3b0ba53655249f8b3f42ffd4ec33d8da89215a43778c33b333a71a08` |
| tests/acceptance/B09-INTEGRATION-20261029-trace.mjs | `f4957c4cfe04c78b284d52b7c85a5b9f678b20cd83ca9c2316d355a359915f5a` |

交接后全部停写，交Astra独立工程验收与主线程用户预算决策。未提交、未改原真实响应或已完成知识资产；矩阵proposal按主线程指令暂停，未创建。
