# RAWUX01 独立验收

Astra规划及独验；后端Sol /root/kb03_r1_builder、UI Sol /root/kb03_r1_planner/lw03_ui施工。B评分0/2/2/1=5。HEAD275067c7d120b15051dedc3981b49c64a05c3f9b及现未提交工作树，版本以最终施工指纹为准。用户授权Raw整体体验重构，不提交推送。

## 独立实测（最终裁决见末节）

独立`node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawux01-http.test.ts`：8/8，3195.475ms；`node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb02-planning-budget.test.ts`：3/3，1534.0174ms。

旧deep32单元/10选择/仅2历史审批/无noteApproval直接成果确认；旧standard没有旧审核目录也可确认；旧deep零主题Source-only；newmaintenance选一项再下一批；摘要/revision篡改、外部目标变化、依赖、QA/inspection误用Raw意图被拒绝。新记录为真实outcomeReview，未制造page/note/change审批。fresh Node真实部分写恢复、并发同请求同事务由测试覆盖。标准已有5/7累计和deep旧11次（原限10）LLM_ATTEMPT_LIMIT均可显式继续，deep到第12次，初始化无请求。

独立fresh完整App：`node --import tsx scripts/rawux01-isolated.ts`，TEMP rawux01-ui-YP8nAE，PID47724/API63027，empty envDir/configFile:false，227模块build通过。`node tests/acceptance/rawux01-independent-browser.mjs <TEMP>/isolated-session.json` exit0。独立驱动复用施工真实操作脚本，新根/新截图review-*，不冒称另造框架。

实际Chrome覆盖旧标准原句定位→单选确认、旧10主题deep/sticky、Source-only；新粘贴导入→阶段进度→fake维护失败→显式继续→新维护2选1→保存503保编辑→重试保存→实际索引500→同key继续201→正式Wiki阅读，Raw SHA保持。review-browser.json success=true，13图、pageErrors=[]、旧审批请求=[]。已亲看紧凑10主题、sticky、新成果、正式读回。新维护摘要呈现85家/56家等正文信息，不是只复述标题。

首版十卡5145px全展开未满足减负，主审要求返修；现两列紧凑、完整正文按需展开、确认顶部sticky。首图保留builder-first-attempt-deep-ten.png，不冒称首次视觉通过。旧deep标题重复摘要最后微调采用事实回退，后续绑定最终图。

## 范围与保护

取消的是产品Raw标准抽取/规划、deep各阶段、维护、checkpoint读盘与显式恢复的请求次数上限；实际计数、阶段完整性/身份、超时/取消和显式继续保留，无无限自动重试。QA/inspection政策及历史验收工具真实预算不改。新Raw成果选择不强迫未选逐项审核，覆盖/未归属是可查看提醒；实际写入的坏引用、来源权限、Raw SHA、目标版本仍核。

本轮真实Provider/config/正式workspace读写均0；合成TEMP+fake不证明模型质量。原用户草稿未修改。baseline1157仅产品/测试/脚本和必要文档，没有遍历正式库或历史截图。历史真实预算保持，不因移除产品上限而取消。

全默认首跑失败2项的原日志必须保留：storage-ui旧维护标题就绪断言、历史migration安全拒绝先命中另一用户profile的TEMP边界。由owner定点处理后重新全量，不继承旧82失败豁免。最终结果、指纹与服务关闭在下方追加。

## 最终裁决与证据绑定

本轮用户卡点及范围内返修PASS；RAWUX01工程整体验收PASS。最终29文件（后端15+UI14）逐一SHA读回29/29一致；1157基线25份既有文件变更均在明确授权所有权内，AGENTS等保护项未变。新增文件及精确清单见两份施工指纹。未提交工作树基于HEAD275067c，不提供虚构新commit。

最终`npm test` exit0：746/746，0fail/skip/cancel/todo，62263.4366ms；`npx tsc -b` exit0。独立已读TEMP/rawux01-backend-a30ca09e-5f12-48d3-9597-236759813dd3/npm-test-final.txt，类型日志tsc-final.txt与施工进程结果相符，同最终29SHA复用，不冒称独立重跑全量。首跑746=744/2原npm-test.txt保留：storage旧标题等待仅按新成果就绪适配；migration实际为历史80593 profile不属于当前David.chen TEMP，CLI先精确TEMP拒绝，测试依据真实路径关系匹配两种确定错误，直接R8/真实ledger拒绝和零写仍保留，工具未改。

独立隔离build在最终摘要小改前通过227模块；最终UI入口同样以空TEMP envDir重新build并完成13图。摘要回退只将标题重复改成首个来源事实，未改变确认/保存流程，因此独立13图动作证据复用；亲看最终builder-legacy-deep-sticky-confirm.png及新维护review-new-outcome-preview.png，摘要包含具体事实，十主题可扫读且无需滚到底确认。最终UI相关14/14，storage就绪适配5/5。未无依据追加整链重复。

可查看四个交付画面（均本报告同级evidence目录）：
- RAWUX01-20261106-evidence/builder-legacy-deep-ready-without-approvals.png：最终紧凑旧十主题。
- RAWUX01-20261106-evidence/builder-legacy-deep-sticky-confirm.png：最终事实摘要与滚动确认。
- RAWUX01-20261106-evidence/review-new-outcome-preview.png：新维护两主题选择。
- RAWUX01-20261106-evidence/review-new-formal-readback.png：编辑后正式Wiki读回。

自有独立服务47724已Ctrl-C关闭并核不存在；UI最终38932亦不存在，Chrome由脚本finally关闭，TEMP保留。无真实Provider/配置/正式数据读写，无提交推送；本轮模型质量未测，历史真实账本不变。移除产品调用次数限制不改变历史显式验收预算。
