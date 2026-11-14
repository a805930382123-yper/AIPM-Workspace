# PDF01 真实清理返修独立验收

2026-11-10，HEAD `febf47eaf2fbff274aa5530e642a903b79a4ffb0`加共享未提交产物。按[冻结卡](../handoffs/PDF01-REAL-REPAIR-20261110-task.md)，5分B；Astra规划及独验、Sol High施工，实例不同，验收者未改产品。

## 工程结论

本轮接线、字段诊断与GET状态三项缺陷关闭PASS；本轮工程范围PASS。这不改变此前R2真实FAIL结论，真实清理质量仍待续测，R3未启动。

独立运行 `node --import tsx --test tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts`：11/11通过，0失败/跳过/取消，26.109秒。包含实际HTTP adapter两阶段strict schema、仅可选null解码、8类结构反例脱敏路径、索引重复/遗漏、可控GET失败/完成/取消及真实中断、62页310单元末尾保留、来源变化/隐私/正式事务故障恢复。使用TEMP合成与本地fake，未读真实配置或调用真实Provider。

源码核对：清理及索引复用既有structuredOutput/decode，Provider未应用时保留业务schema检查；全归属/重复与来源业务校验未放宽。诊断仅静态字段路径、数组下标和预定义原因，不复制Provider值或任意属性名。GET异步读取后发现任务不再活动，重读持久终态；仍为活动才判中断，GET不请求模型。

保持状态version1，落盘业务合同不变，不迁移原Raw/R1或清空失败计数。旧有效批仍经原业务验证。本次实际失败0批、attempts1可以显式继续，历史错误原样保留。并未证明先前丢失响应的具体坏字段。

最终核实指纹：

| 文件 | SHA256 |
| --- | --- |
| services/raw/pdf-cleanup.ts | 0050bb50215f83e012a0292047b7e61f25f6ff1326af76b18bd59b82ceba6238 |
| tests/pdf-cleanup-structured.test.ts | e94f1dd6601adc1e38975c53c3e7a4af488708ada668261e67d97981dfd8e1f5 |
| tests/pdf02-http.test.ts（未改回归） | 7335d156bfc2f5c97ccc722fb5f58a740f4b6a102cb6a7ce13b8f9e8b89eeac5 |

已读并复用同版施工11/11组合与空envDir 233模块build原日志，位于TEMP `pdf-cleanup-structured-ff2c8d17-58a8-4df5-be4f-fa383a457702`。施工类型检查0输出未生成日志文件，已更正记录；独立补跑 `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --skipLibCheck --strict --noUnusedLocals --noUnusedParameters server/index.ts tests/pdf-cleanup-structured.test.ts tests/pdf02-http.test.ts` exit0、0诊断。未重复无影响UI；未跑全仓损坏测试，不称全仓绿。

## 真实续测状态

原六页R1真实PASS19/20保留。新版工具完整只读审核、22冻结产品指纹匹配；四路fake原账副本实证正常8–12、预算不足0新增、拒第13次发送、字段错误一次停止。主审条件放行后由Sol实际执行，同TEMP同Raw同账追加，未重导或重跑R1。

工具SHA `a27d9e449fd8e0a604e13d2ff2898ab1b01b7b947e1f15dc0cf5e6c5050f2cfe`，freeze SHA `c3706a5eddbf5a34797d79a228709812ca3a3703222fcf2dbcf2812d1b2ba236`，实际release SHA `fcb36762661345ba82e142c2e1d9a64578c98caab6e71c468e4a0779017ba006`。旧账7条收据、旧freeze/tool/release及初失败副本全部保留。

| 请求 | 实际结果 | 输入token | 输出token |
| --- | --- | ---: | ---: |
| #8 清理首批 | HTTP200、finish stop；48条决策通过并持久保存 | 2295 | 2634 |
| #9 清理第二批 | HTTP200、finish stop；strict结构通过，业务标题规则拒绝 | 2477 | 2263 |
| 本轮新增 | 2次，失败立停 | 4772 | 4897 |
| 原7次加本轮累计 | 9/12 | 21493 | 8535 |

累计30028 tokens，本轮9669；金额无可信账单依据，未知。配置本轮安全读取1，连前轮累计4，未改模型/端点/配置。未发送第10次，余3不足剩3清理批+至少1索引，不再起跑。

独立直接读取持久检查点：failed/cleaning，attempts3（旧失败1+本轮2），1/4批成功、48条归属，error `PDF_CLEANUP_SCHEMA`，具体 `$.decisions[0].topic` / `invalid_title`。GET与持久状态一致，旧掩错已关闭。原R1 SHA仍 `40528b9a16cc399d02da39192a03f1e512cf8d1a0a3b74b884ba8e8d90940e48`。最终ledger SHA `d4b6d921b95db483512f6f8e0b794174c658abf29cf85c107d78d3a6ad441598`，失败检查点SHA `498b60ef973083700b5b0bd7c7909b5a25739837d56424513f0d6d5df5021f00`。

R2真实执行FAIL；仅部分归属完成，无整体清理/索引/草稿可供质量评分，R2整体质量NOT_EVALUATED，不能以首批成功判PASS。PDF整体真实验收仍未通过，R3未启动。真实资料只在TEMP处理，正式Wiki0，无提交推送。

同核心链路返修后再失败，转Sol只读诊断，不盲改/盲试。当前可定位为主题名称的首尾空白或禁止字符等命名规则；具体返回值未保留，不能断言是哪字符。应区分展示名称可规范化的限制与来源/数字/归属等必要校验，再拟最小方案；本轮不追加调用或扩预算。

## 第二次工程修正与最终交付

根审基于证据批准范围内工程修正，未批准再调用。中间Decision.topic及索引topic不再套正式标题的[]<>限制，首尾空白在边界trim后统一保存/匹配，换行与空白标签仍明确拒绝；最终assignment.title保留单行、无首尾空白和链接安全要求。validJob、索引输入、持久结果保持同一合同。诊断区分multiline_label、surrounding_whitespace、unsafe_title_characters等，无正文值泄露。

独立实际 `node --import tsx --test tests/pdf-cleanup-structured.test.ts`：6/6通过，1.138秒。已审真实adapter下[]<>中间标签存盘重启/索引、最终标题三类反例，以及旧attempt3/1批48决策恢复：只发送剩3清理+1索引，首48条逐项原样，不重发。读取施工最终 `topic-final.txt` 确认同版13/13（6专项+7PDF02），scope tsc exit0、diff check0；复用必要回归，不重复UI。前版空env build仅对应前版，此后仅后端标签规则/专项测试改变，无前端/依赖改动。

最终两个变更SHA：`services/raw/pdf-cleanup.ts` 为 `8a417f4bded1ea31b850fad33ee1f4070f85ec757dc7ae3641d95f8686ab2630`；`tests/pdf-cleanup-structured.test.ts` 为 `3588a1e36d7cfec59343665c6897199ab032bf1d978d1940db1388f8d6e813dc`。前表0050/e94f是实际真实续测版本，不能混称最终新版已真实验证。旧真实freeze/工具/账本未改，新版尚无真实release。

最终裁决：本轮两次工程修正及范围内反例PASS；真实R1仍PASS19/20，R2最后实际FAIL、整体质量NOT_EVALUATED，PDF整体真实验收未通过。累计9/12、30028tokens不变；剩3不足至少4，未来若续测须另批预算及绑定最终新版的release。R3不启动，本轮到此停止，无提交推送。

下一步可审阅建议：将总上限12调整为15，即新增3次额度；剩3+3=6，预计实际需要4–5次；这不是已获授权，也不允许失败后自动重试。任何新失败立即停，先诊断再决定，且不得以预算充足保证质量通过。

## 后续20次授权与14次质量裁决

用户后续明确上限20，旧记录不覆盖。#10又因topic invalid_length失败；本地9对照排除null误验，但原值未保存，不能断言具体长度。root另准单次#11诊断，实际wire与#10同SHA、strict/schema nullable min1/max100及structuredOutputApplied均核实；仅TEMP保存content。#11未复现：48项44keep主题8–15字符、4skip为null。完整原样生产adapter/schema/业务离线回放通过，首批48不变；root批准复用这条已付费响应，不重复发送/计费，随后#12–14完成剩2清理+1索引。没有证明#10根因已修复。

本次执行PASS，累计14/20，输入30957/输出16943=47900tokens；费用未知。167条归属132keep/2merge/33skip，15主题和TEMP草稿；正式Wiki0。ledger SHA `47ece6013c86517cd44f744cf18dd741db146c490ac54eed51bddbe9ac5bda7b`，R1与原账前缀保持。响应内容仅TEMP，不进repo。

独立核全部15个maintenance.changes[].candidate.body、归属和原图：R2质量 **FAIL，22/30**（准确4、重要覆盖3、追溯5、边界5、噪声3、重复归并/新增保留2），未达25且覆盖/新增均不足4。R1仍PASS19/20，不启动R3。

- 确定阻断：原62新增“年度活跃用户超5亿”原文两行及R1摘要全被skip，理由为平台规模宣传；15候选无该信息。独立重看原62图确认，这不是纯修辞。机构90余国家/82%人口/7.4万亿美元自述也全略去，虽不能当样本统计，仍是具体来源自述。原11/62重复覆盖没有保留两页来源。
- 其余关键项保留：序言实质；原10 MAT渠道同比、2026预测、订单与销售口径；原11图像规模与1.0/2.0；原59覆盖范围/排除、B2C/C2C/方法；原61定性N8及日期、收入、行为条件。未观察预测变实绩或样本冒充总体。
- 清理不足：原10纯轴刻度100/600/1100与“60418%”解析碎片留在正文，旁边R1图解虽完整正确，读者仍需自行辨别；原文字行与图像AI重述重复。两条精确merge不等于已做好语义去重。

root批准继续最小泛化提示修复（任务卡末节）：保护机构自述中的具体事实、区分孤立轴刻度与完整数据，不硬保所有数字，不降低全同merge规则；新revision重清理，旧结果/草稿保留。余6预估4清理+1–2索引，工程通过后另报root放行，当前不追加调用。

## 提示v2与第15次覆盖失败

泛化提示v2工程独验8/8、同版相关15/15及scope tsc0，旧结果只读和显式归档切换通过。服务SHA18fbb674…2fc1。root放行工具后在新TEMP克隆重清理，原完成态/旧草稿不动。#15首批48输入仅返回1个decision，缺47、无陌生或重复ID；HTTP200/finish stop，响应425字节，输入2425/输出294token。真实累计15/20、50619tokens，未发#16。

本次完整content已保TEMP，独立读取并对照输入；Sol离线完整adapter回放复现旧strict shape通过但业务PDF_CLEANUP_COVERAGE拒绝。证据明确为wire未约束全ID覆盖；不是R1事实缺失，也不能通过删coverage检查解决。v2实际0/4批，尚未产生新版可评分成果，旧R2语义FAIL保留。

root批准动态keyed required协议返修，两阶段将本批ID/topic作为必需且禁止额外的键，解码仍回原数组，磁盘/API/业务校验不变。剩5只够最低4清理+1索引；先工程独验和工具冻结，再报root实际放行，不自动追PASS。

## 最终收口：Unicode工程通过，真实质量仍未完成

动态keyed协议独验11/11、相关18/18通过后，主审放行同账最后5次范围。#16/#17完整覆盖并通过业务校验；#18返回全部48键，但本地topic长度校验拒绝，按约立即停止，未发送#19。最新实际根源已确证：该topic含5个UTF16代理对，代码点100、码元105；JSON Schema的maxLength100按代码点合法，本地value.length却按码元误拒。4项同topic受影响。这个证据不能反推没有响应原值的#10。

根审授权最小工程修复：共享schema-validator字符串min/max改按代码点，PDF表名本地长度一致，100阈值不变，无截断、无改写响应。最终独立 `node --import tsx --test --test-concurrency=2 tests/pdf-cleanup-structured.test.ts tests/openai-structured.test.ts` 29/29通过（12专项+17共享），2.119秒。同版施工36/36（再含7PDF02）与strict范围tsc0复用；扩展llm.test因既有损坏compat01 fixture未能执行，未掩盖/未修旧测试，不称全仓PASS。前端/依赖未变，不重复UI；前版build证据如前明确。

独立核#18完整原样离线回放：新代码生产adapter/schema/业务通过并在克隆保存第三批48条，响应所有非null字段与保存结果逐项一致（0差异），前两批相等、R1不变。原真实运行根仍2/4，第三批只在离线克隆，未把回放伪称新真实请求或全流程成功。克隆已有18个不同topic，按16/索引批，至少还需1清理+2索引=3请求；余额2不足，按root要求不调用余额、不改批限迁就预算。

最终文件指纹：

| 文件 | SHA256 |
| --- | --- |
| services/raw/pdf-cleanup.ts | 598146318e63231a6a5032d966427ce1a4bbbec7a5837255e3122f7a58496c40 |
| services/llm/schema-validator.ts | 673abf4190acc152ff9872df436ba348bedd9dafb504217daf6cc91fc4b0fd3f |
| tests/pdf-cleanup-structured.test.ts | a32dc6452d5a8433195976b6405c753c3e0be29b99e8696e6c94f54ef2009aac |

累计18/20真实请求，输入53567/输出24569，共78136tokens，费用未知。#11离线复用没有重复计入usage；#18回放没有新付费请求。最终ledger SHA `4ecd5501bdc3c2c747140af29eaddf326aa3bb4bb8e378d1dd85a3be1f158cf7`；原账、原PDF/子集、R1、旧完整但质量失败的15候选及每次失败证据保留。模型content仅TEMP，不进repo。

**最终分开裁决**：本轮覆盖协议和Unicode工程缺陷已关闭PASS；R1抽样真实质量仍PASS19/20；最新R2真实执行未完成，旧完整R2的22/30质量FAIL尚未关闭，PDF整体真实验收未通过。R3未启动。下一次若获预算，应绑定最终代码和#18已付费原样响应，复用已验三批后至少3请求（末批可能产生更多主题，因此只是下限），另经主审放行。本轮不追加预算、不调用、不提交推送。

## 50额度续测：完整执行成功，整理质量仍未达标

用户提高累计上限50。最终产品指纹仍为上节版本，复用已通过的29/29独验、36/36组合及范围tsc；本次不重跑无变化工程检查。独审新freeze与同账工具后，#18原样响应通过生产校验保存第三批（0新增调用），#19末清理、#20/#21索引完成。旧18条账前缀、R1、旧草稿及失败结果不变；正式Wiki0。执行证据见 `PDF01-REAL-RESUME50-20261110-execution.md`。

独立读全部21个实际 maintenance.changes[].candidate.body，核167单元归属（136保留、1归并、30略过）及冻结原图gold。评分：准确5、重要覆盖5、追溯5、边界5、噪声3、重复归并/新增保留2，共25/30；最后综合轴未达4，**R2质量FAIL**。R1仍19/20 PASS，R3不启动。

已关闭关键语义缺陷：原62年度活跃用户超5亿及NIQ90+国家/82%人口/7.4万亿美元机构自述保留；原10孤立轴刻度100/600/1100、60418%碎片略去，而完整年度数字、预测和单位仍在；原59/61范围、方法和样本条件完整，没有观察到新增重大错数或预计变实绩。

剩余明确缺陷：原11与62的300余城市/3000区县在不同候选重复，没有按gold归并保双页来源；大量文字层逐行材料与完整AI重述重复摆放；23标签仅归成21候选，相关大盘数据分散多主题；纯NIQ宣传修辞及仅描述三列表格/Logo的材料仍成正文或独立主题。新增事实保留成功，不能抵销重复整理未完成。

机制核查：索引只读标签，无内容依据；全同merge按kind/section/text限制；renderer逐个追加保留项。因此不再仅加强prompt追分。root已授权范围内最小机制修复：有界内容辅助归组，主题内展示代表与等义来源映射，原单元/处置完整保留，不改数字口径或原文、不自由生成无依据事实。待新卡冻结、工程独验后另报真实预计次数；当前无新请求。

累计21/50，输入59208、输出26817，共86025tokens，金额未知。此结论只针对6选页，不推及整份62页或真实续表质量。HEAD febf47eaf2fbff274aa5530e642a903b79a4ffb0＋上述未提交产品指纹；不提交推送。
