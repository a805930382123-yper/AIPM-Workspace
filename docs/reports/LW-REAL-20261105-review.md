# LW01/LW02真实小样本独立验收（2026-11-05）

独立Astra /root/kb03_r1_planner，Sol独立施工工具。用户授权及主线程明确委托审核后释放；仅完全虚构TEMP资料，未读写正式workspace、未改产品/旧UI/AGENTS，未提交推送。

## 结论

**工具工程PASS；LW01、LW02本卡真实集成及小样本质量PASS。** 完成真实提取维护→独立HUMAN确认→真实问答→选择原回答→真实回存提议→独立HUMAN确认→补读Raw再问→无依据回答。没有未关闭的本卡阻塞。两次partial是模型明确保留信息不足，不是调用失败。

结论限本卡单块standard、跨年直营口径及已授权虚构样例，不覆盖所有模型/长文/deep/所有业务语义。沿用原LW工程与浏览器证据，不宣称本次新增浏览器操作；KB03历史真实质量与第三阶段均不由此签收。

轻度可读性问题：回存模型已在“推断”段写年度差额与比例，产品又追加“问答推断与建议（待核）”，出现重复。同一推断仍明确标识、没有事实升级或来源洗白，本次不改产品掩盖；后续可作为小范围呈现优化。

## 版本、授权与工程核验

HEAD275067c7d120b15051dedc3981b49c64a05c3f9b加现有未提交工作树；LW02最终26SHA独立核26/26相同。新工具freeze d2a592a47c15654616ed542cd86d02e9dc0df7f314c8d2eb2b886165a6044c4a，独立重算相同。受测新3文件见builder指纹；工具真实run无自动审批，实际Provider由独立注入现有产品服务。

独立命令`node --import tsx --test tests/lw-real-runner.test.ts`：5/5、0skip/cancel、2643.8512ms，exit0。覆盖真实adapter fake9次、实际子进程pending重启、12次上限/核心预留、写账失败先拒绝、secret脱敏、坏释放/冻结/样例、未HUMAN不能进入QA。复用同26SHA产品原工程证据。施工全tsc唯一既有tests/acceptance/lw02-review-copy.tsx未用React失败单列；新增测试定向tsc通过，不声称本次全仓类型检查PASS。

新root C:/Users/DAVID~1.CHE/AppData/Local/Temp/lw-real-Llj8LI，session c40dbb8d-ec83-4608-8c2c-acdccbf478b9。独立release-approved.json SHA e4dbe3df1b055fcbd31ad23ccb188bad35bc1c7d493cb1919b79693ae595b7b1。主线程配置身份预检复用：gpt-6.1-terra，api.openai.com，local-file；endpoint SHA d9617135d6fdd0a2cde722d637a1dfcc3da37515708b3ea5d66ae607c8ac785e。未输出密钥或读取配置正文。

虚构A/B/C正文SHA分别46d006ed4830134ae30521f5120c24ef8acc5c46421ae9c7e1a4de9a8aa9a9df、1ce535d31812c359c3b44b37e61fc246166a8f4f14e9e6f5439955683f44ee46、8f2c4c9a485ae4569a07d23701d27df1b277f41419b190f20b6df6c986537330。原句及判据在冻结卡，未用真实用户资料。

## 实际请求与预算

全部通过已有proxy入口：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx tests/acceptance/LW-REAL-20261105.mjs run <root> <phase> <release-approved.json> <releaseSHA>`，save另带`--selection <root>/independent-selection.json`。五次进程均exit0；没有--continue或自动重试。

| 请求 | 阶段 | 耗时ms | 结果 |
|---|---|---:|---|
| 1 | 原文抽取 | 4648 | 成功 |
| 2 | 主题规划 | 4513 | 成功 |
| 3 | LW01维护 | 7725 | update原主题 |
| 4 | 首次QA | 34862 | partial，4条Wiki引用 |
| 5 | QA回存维护 | 15600 | update原主题草稿 |
| 6 | 再问首次 | 35043 | 请求必要Raw |
| 7 | 补读后回答 | 23094 | partial，2份Raw、3条引用 |
| 8 | 无依据问题 | 13628 | insufficient |

8次均finishReason=stop，usage保留本地summary。**LW8/12，已停止；知识累计275/500（原267+8），Prompt20/24不变。** 独立LW账本TEMP/LW-REAL-20261105-f66b274a66d2-ledger，KB03账本不读写、不借额度。配置读取：主线程安全预检1+五次run各1=本轮已知6；施工/独立fake0，不冒称整轮0。剩4次不为凑覆盖而调用。

## 逐项质量与落盘

LW01：模型检索读到星桥与海岚干扰页，正确更新星桥58315c1d-1120-4569-9343-a8c0217747a1；2025目标100/开业80、2026目标120/开业90分别保留，直营/不含经销线上、负责人未知、AI尚未上线/无收益验证均保留。人工年度不相加约定及A/B双源保留，海岚300/210未混入。独立先读完整原候选，使用reviewChange accept及maintenanceDigest确认，随后现Commit写入TEMP；未改正文。

首次QA：事实与推断分栏，正确计算目标差20、开业差10、比例80%/75%；强调开业差10不等于净新增10，门店重合未知。年份不能直接相加作为人工约定，负责人及收益不确定明确。4条引用逐字对应实读Wiki片段、原位置；没有强制补读Raw。

回存：独立全选已核回答，保持段落类别、完整引用，选择文件保留原文；模型认为差额/比例与净新增限制构成有效新增，update原主题，不另造无价值专题。原事实/人工约定/双底源保留，新增计算放推断，knowledge_status=inferred。独立reviewKnowledgeChange及digest确认，正式主题v2→v3，提交只写原主题，无新增Raw或问答Source。

再问：模型自然要求补读两份Raw（故真实必要Raw分支已覆盖）。答案把原始门店数字、AI未上线作为事实，把年度不相加说明为人工约定而非Raw结论，把差额/比例/5个百分点标分析；仍不认定净新增。独立调用citation服务验证当前3引用，底层独立Raw恰为A/B，没有将同Raw多页当独立证据。

无依据：海岚2027净利润明确无法确定，仅有2026经销门店数据，不编利润，不拿210门店当金额；引用服务验证通过。

独立读盘assert：3份Raw SHA全同；总Wiki3（两主题+LW01创建的1份Source），QA未新增Raw/Source；星桥v3 inferred、sources精确A/B；海岚未改。两次commit manifest的source/pages/index/log/state均完成，原目标ID保持。QA更新后旧QA引用自然绑定v2，只按其冻结快照复核原句，不把过期引用误称当前版本；再问引用针对当前版本服务验证。

本地证据：root下independent-extract/qa/save/requery/no-evidence.json、independent-selection.json、independent-lw01-confirm.json、independent-qa-confirm.json、independent-disk.json、independent-summary.json及逐请求账本收据。仓库仅报告与工具，不复制完整请求或配置。无活跃模型进程，真实验收完成停止。
