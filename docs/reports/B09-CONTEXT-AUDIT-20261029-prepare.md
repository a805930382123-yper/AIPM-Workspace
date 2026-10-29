# B09 Wiki上下文返修独立验收

最终代码关联：产品及本轮入口已提交 `c6474fe98c63440d7b9cbdb7fe15e98eb8b6aba8`，独立核HEAD与该提交对受测产品/测试/入口/fixture工作区diff为空。后续用户批准后的真实18–20结果与I03/I04闭环见集成stages报告；原17失败不追改。

2026-10-29，integration_audit，实际gpt-6-astra/medium，与施工gpt-6.1-sol/high不同实例。沿B评分0/2/2/1=5及阶段报告冻结C01–C06；本实例未改产品/脚本/fixture，未读取密钥或真实配置、未外发请求。代码基线0cbb9185601079d1da17f7fd3ca0bbaa3f8c8d89加本轮已列差异，最终提交待主线程关联。

**C01–C06工程与具体续接准备PASS。原Prompt17真实FAIL保留；I03/R36真实重验及B09整体仍未通过。** 当前知识263/500、Prompt17/24；新增一次阶段预算尚待用户明确批准，不自动放行。

## 产品差异与独立实测

实际读 `git diff -- services/prompt-ai/service.ts tests/prompt-ai.test.ts`：仅在context同一函数合并独立Markdown标题及后段，移除首次摘录后跳过零分段的旧逻辑；已有相关性排序、原文片段、每页3000/总12000/最多6页、来源/秘密门禁及生成契约保持，没有新增检索框架。

独立实际命令：

```powershell
node --import tsx --test --test-name-pattern="B09 context" tests/prompt-ai.test.ts
```

**3/3 PASS、exit0、723.9479ms**：原17 Brief＋实际Concept进入generate的单次fake请求包含真实定义且不自动入Library；零匹配兜底保留标题正文，有匹配相关段仍优先、未选页面不发；3000/12000预算、6页/第7页拒绝及计数正确。边界测试保留总预算用完后末页0字符的既有行为，不声称所有选中长文都完整送出。

PowerShell `ConvertFrom-Json` 独立将fixture的Brief、failedContext、Wiki正文与原17请求/I02导出比较，全部一致；附Raw文件文本与原实际Raw逐字一致，不用另造简单样本代替复现。`Get-FileHash` 核service `c15b4a6c01c27df293fb70cd0be0766dbd8430173a415ca4bcce04c1f38d390f`、test `6b8474e937b53b6d229564184640205309b58efa6285158a97ba9e5818493e8e`、fixture `250d9e2450f29c935f09d5ae3c1a82c1a9c5eec91ecbd40dcc27168e4d31708f` 与交接一致，复用同版施工11/11及build exit0，不重复全套。

## C06具体续接与证据保全

实际读取两脚本及builder、既有smoke calls/halt记录。run SHA `f2af8a5d3b0ba53655249f8b3f42ffd4ec33d8da89215a43778c33b333a71a08`，trace `f4957c4cfe04c78b284d52b7c85a5b9f678b20cd83ca9c2316d355a359915f5a`，builder `fc609ae7573a613e0f4d333e88ecefa469b8a1a98e3bedf3e0101ca11a865bfc` 均匹配。

唯一prompt-context-continuation profile固定祖先7SOfcf/session，核旧四调用16/17/262/263保全；新账本263/17、knowledgeCap0/promptCap3，允许generate/check/rewrite，trace强制顺序18/19/20。knowledge/Brief拒绝、第四次拒绝、首失败停；start与arm均核新session/freeze/预算及additionalPromptCallApproved=true，准备模板默认false。普通profile保持旧参数，不把当前真实累计退回旧15。

同SHA施工唯一离线smoke exit0/1.902秒可复用。独立读取其原始记录：IKqvpT三次mode smoke为generate18/check19/rewrite20；HbrwKm仅generate18失败并halt；D4KqQt旧六阶段16–19/262–263保持。其“不允许阶段/第四次/首失败后二次”的assertions经代码核对并复用施工运行结果；独立未重跑，不将10次fake计为真实。

最终补验根 `C:/Users/80593/AppData/Local/Temp/b09-integration-20261029-oZSBMc`，session `1be23ab5-560f-4dfa-b4dc-d094228eed01`，freeze `87a1e3a3219c24e4155c54c1da4058dfcd3409890e282bfc055dd0377d79ae8d`。实际逐 `Get-FileHash`：**102冻结文件0差异、20资产在源/新根均0差异、63祖先控制证据0差异；新calls0、无active-grant**。旧失败草稿和原始请求响应保留在新分支与ancestor，没有抹账本或改为成功。独立没有触碰正在运行的manual yqIAZf根。

## 下一阶段边界

可向用户提交具体可审阅方案：额外增加一次本阶段Prompt请求，固定重用原人工Brief与同一Concept，generate18/check19/rewrite20，总账本最高20/24；全球24上限不变。只有用户明确批准后主线程才构造新的release并实际操作，任何失败/未知仍停止。原17失败记录永久保留；工程PASS不能替代新的真实上下文及后续Library/版本/恢复验收。
