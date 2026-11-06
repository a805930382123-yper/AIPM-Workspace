# LW03 UI 施工交接（2026-11-05）

UI施工实例：/root/kb03_r1_planner/lw03_ui，实际sol_repair / Sol High。遵循冻结卡与agent-router；只修改分配的app、隔离脚本、UI测试及自有证据。未修改App.tsx与DraftReviewPage.tsx，无依赖修改、提交、推送或真实调用。独立验收待Astra执行，本报告不宣告批次最终通过。

## 实际变更

- Wiki新增“主动知识检查”，用户选择当前或多页、可选有界相关；8页上限外露。原结构检查改名“结构检查（Lint）”，API及Audit旧入口保留。
- 新WikiInspectionPanel查询持久current/异步轮询，展示选定/候选/实读/跳过/原因/缺口、四类问题、快照与AI标识、口径差异、逐条证据、处理说明、已查看/暂缓/提交状态；明确未执行全库Lint。新发起、失败明确重试及草稿多选均由用户操作；卸载迟到响应不导航。
- evidence端点核验成功后，Wiki真实正文按引用offset高亮；Raw沿现有精确引用回调。
- api DraftView扩InspectionDraftView真实联合；KnowledgeMaintenanceReview独立显示检查ID/选集/问题与真实依据，通过inspection evidence端点，复用逐项接受/编辑/暂缓、完整差异与明确确认。QA/Raw原分支保留。
- scripts/lw03-isolated.ts：TEMP合成两Raw三Wiki，先走真实问答回存产生派生记录，再人工更新依据页形成真实快照比较；fake Provider覆盖inspection与inspection_maintenance。清继承Provider/LLM/key环境变量，Vite configFile:false+空envDir，无正式workspace/配置读取。

## 实测

1. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lw03-ui.test.tsx`：2/2，通过范围缺口/暂缓恢复/多选请求以及卸载迟到恢复响应测试。
2. `node scripts/lw03-builder-build.mjs`：226模块构建成功，空envDir与TEMP输出；旧bundle体积提示保留。记录在evidence/builder-build.json。
3. `node tests/acceptance/lw03-builder-browser.mjs C:/Users/DAVID~1.CHE/AppData/Local/Temp/lw03-browser-QS53DI/isolated-session.json`：fresh完整App、真实本机Chrome、fake，成功，pageErrors=[]。实际操作两页选择→进度→四类与缺口→精确证据高亮→暂缓说明→刷新→同依据再查保留暂缓→选重复/冲突两问题→双目标现草稿→逐项只接受/核对第一项→确认201仅一主题写入、未选主题不变→单独旧年份页无发现→768宽无横溢。确认前正式集合SHA保持，确认后按目标读回保留人工文字和原来源。10幅最终图与JSON在docs/reports/LW03-20261105-evidence/，已实际打开检查范围/阶段/四类/定位/审核/暂缓/确认/窄屏图。
4. `npx tsc -b --pretty false`：app无报错。一次仅既有tests/acceptance/lw02-review-copy.tsx未用React失败；最后执行时后端正在施工的tests/lw03-core.test.ts还有两项未用import和readonly secrets赋值，已交后端处理，不能声称全tsc通过。
5. 所有9份自有代码文件无行末空格；`git diff --check`在当前工作区未能按repo执行（git进入no-index用法），不标通过。全库secret/default回归由后端施工及Astra统一覆盖。

首次准备问题如实记录：Chrome继承本机代理导致127.0.0.1导航超时，显式--no-proxy-server后解除；初样例只有answer旧快照而没有正式派生关系，补真实问答审核回存后出现snapshot来源影响；fixture继承同名alias触发真实标题保护，改为合成页无alias；Playwright.check对异步受控审批框立即验态失败，改真实click后等HTTP/settle，见builder-browser-attempt-checkbox.json及builder-failure-checkbox.png。上述准备失败不算产品通过证据。

## 可重现隔离入口与控制

项目根运行 `node --import tsx scripts/lw03-isolated.ts`，不传参数会创建全新TEMP根，stdout及root/isolated-session.json提供 `{pid,url,api,root,fixtures:{a,b,wa,wb,wc},provider:'fake-only',configuration:'not-connected'}`。复用仅可 `--root <TEMP根>`，脚本校验路径必须属于TEMP。浏览器以当前用户home解析Playwright，并使用当前用户AppData/Local/Google/Chrome/Application/chrome.exe及--no-proxy-server。

全部control只存在隔离服务、只作用合成TEMP数据：

- POST api + `/__control/inspection-mode` `{mode:'normal'|'empty'|'fail'}`：三类模型建议/无模型建议/显式Provider失败；source_impact始终由真实snapshot比较产生。
- POST `/__control/delay` `{ms:0..3000}`：阶段观察。
- POST `/__control/change-basis` `{id?:wa|wb|wc}`：人工追加合成Wiki正文、revision变化。
- POST `/__control/remove-raw` `{id?:a|b}`：删除合成Raw使相关页底源不可读；该控制不可恢复，建议用新TEMP根。
- GET `/__control/counters`、`/__control/requests`：fake请求；真实调用0。
- legacy `/__control/fail-commit`与`/__control/recover`保留；`fail-draft`仅旧QA，不用于inspection故障证明。

本实例自有隔离服务已停止；TEMP证据根QS53DI保留。首次完整主链成功后，发现部分确认页面显示依据已变；已交后端，后端反馈补精确本事务pageRecords恢复豁免及逐change来源归属，尚待其核心回归与Astra独验，本报告不把该后端修复视为已由UI复验。最终整批七类门禁与后端最终SHA由原施工者汇总交Astra；本报告只交UI自查范围。

UI产品/自有脚本最终SHA：docs/reports/LW03-20261105-ui-fingerprints.json；基准HEAD为275067c7d120b15051dedc3981b49c64a05c3f9b，仅任务卡基线标识，未新增提交。本UI实例已停止产品写入，等待独立复审。
