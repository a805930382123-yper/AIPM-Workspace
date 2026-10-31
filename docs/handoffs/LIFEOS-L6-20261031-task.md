# LIFEOS L6：只读周期回顾（2026-10-31）

## 授权与评分

用户明确授权阶段6周期回顾；此前方案的需求触发条件已由本次请求满足，不要求另行积累样本或访问真实数据。基线 `69dff0b9e84a588828aecb684eb0db31cc0bce2f`，L5整体独立PASS沿[状态](../status.md)及其报告；本卡依据[正式方案阶段6](../batches/LIFEOS-optimization-plan-20261031.md)。仅本批，通过提交同步即停。

评分需求0/耦合2/风险1/历史失败0=3，A标准：汇总规则明确；跨正式Wiki、当前待办、Prompt反馈及窄导航；仅读不改持久化/版本/删除，主要风险为错误口径/漏读/错定位，没有重大写入完整性风险。Astra规划，Sol High先审可执行性；准入后Terra High施工，Sol独立验收，不沿用上批B身份。主线程协调与统一同步。

真实Provider/config/.env/正式workspace访问0；全部实测用隔离虚构记录和真实服务/App。历史知识287/500、Prompt20/24、KB03 24/30沿报告，未重核、未消耗。不宣称用户已有真实使用反馈。无数据真实显示空，不补示例到正式库。

## 已核事实与范围

- `services/home/actions.ts`已把四类当前事项及分源状态确定性汇总；`server/home-api.ts`已有点击前版本/删除/错误预检。直接复用，不能维护第二套待办。
- `WikiRecord.created/updated`是正式记录元数据；新建created为ISO时刻，修改保留created。当前`WikiStore.files()`的readdir异常吞空，parse只解析Frontmatter，不能直接以list/allRecords当严格完整来源。
- Prompt顶层文件持有current/versions及可选feedback；反馈有usedOn、createdAt/updatedAt、promptVersion和revision。Prompt.activeFiles/existingRecords会吞目录/坏记录，不能直接凭list结果认定无反馈。
- App已有Wiki ID、HomeAction及Audit精确导航；PromptLibrary当前没有从外部指向某反馈/版本的入口；本轮用回顾内完整反馈明细和稳定ID/版本追溯，不新增深链。

本轮只在首页添加“周期回顾”主动打开入口及可关闭的回顾区域，不增加第七项导航。打开后按用户日期范围读取；关闭/普通首页不自动请求回顾。保留首页统计和行动事项原行为。无AI报告、定时任务、推送、偏好学习、效果归因、综合评分、趋势预测或新持久化。

## 时间与统计口径冻结

接口参数start/end均合法YYYY-MM-DD；**Asia/Shanghai的[start当天00:00,end当天00:00)，开始包含、结束不包含**。UI标签“开始日期（含）”“结束日期（不含）”，旁边明确时区和实际覆盖日期。start必须小于end，非法/不存在日期400不读取数据；默认上海本周一至下周一（周一开始），不取浏览器本地时区。允许自定义范围，无月报调度或长期历史快照。

| 区域 | 精确来源和筛选 | 呈现与排除 |
|---|---|---|
| 期间新增正式知识 | 当前`knowledge/wiki/<合法ID>.md`，按Wiki.created转上海日期后start<=date<end；每Wiki稳定ID一次 | 名称固定为“期间新增、当前仍保留的Wiki”，显示数与每条ID/标题/created/当前revision。不含Raw、draft、index.md、回收Wiki；不是历史净增/全部修改次数，不从日志补已删除页 |
| 当前待处理 | 直接调用同一homeActions(deps)，保留items排序、kind+id和四sources | 标题“当前待处理（不按周期筛选）”，展示本次读取时刻snapshotAt。不是周期内新增或周期末快照；切换日期不改变同一未变化数据的待办结果。错误源不算零 |
| 周期内使用反馈 | 当前有效Prompt顶层文件内feedback.items，按**用户填写的usedOn日期**start<=usedOn<end；不按录入/编辑日期筛选 | 标注“用户记录的使用体验”，列Prompt名称/ID、使用版本、日期、效果、观察与改进建议。四outcome数量为实际分类计数，不换算评分；同反馈(promptId,id)只一次。Prompt回收、已删除反馈排除；历史Prompt版本的反馈保留，仍归其原version |

Wiki.created允许合法带时区的ISO时刻，或已有合法YYYY-MM-DD日期（视为登记日，保留日精度）；不得把无时区模糊时间、缺失/非法日期猜成今天。缺少日期的正式旧记录从周期数量排除并列“时间缺失或无效，无法归入周期”明细和数量，仍能追溯；结构损坏/身份不符是来源读取错误，不能当作无日期。反馈date由L5严格schema保证，损坏走错误。正式操作事实、用户反馈、确定性计数分别标识。

本轮不声称Wiki数字等于首页“本周新增”：首页该值还含Raw，新回顾明确只含Wiki；对同一有效Wiki使用相同上海创建日期边界。当前待办则要求在数据未变时与首页同源items/来源错误一致。删除后的当前存量视图无法反推过去总量，UI必须说明这一点。

## 只读聚合接口与错误

新增`GET /api/home/review?start=...&end=...`，响应至少含period(timeZone/start/end)、snapshotAt、knowledge(status/items/undated/count)、pending(homeActions结果)、feedback(status/items/counts)，源错误用安全message。数量只由返回完整明细算出，不设置静默截断；若沿用扫描上限导致partial/overflow，必须标相应来源error，不能冒充完整结果。

新增`services/home/review.ts`窄只读聚合，使用已初始化的wiki/prompts/runner实例。严格枚举当前Wiki顶层合法ID.md和Prompt顶层合法UUID.json；只忽略index/临时/非目标扩展/子目录，不遍历recycle或versions计为新对象。readdir只把ENOENT当合法未建立空目录，其他错误显式来源失败；每文件使用现有get/getFeedback读取并在聚合边界检查需要的身份/标题/created等字段（记录ID须与文件ID匹配）。枚举后文件消失，作为该源读取失败提示刷新，不悄悄忽略。Prompt.get失败/坏feedback不能被list吞掉，反馈源error；未提供feedback的旧Prompt为零反馈且不写盘。对旧合法Prompt正常GET不迁移。不得为聚合请求initialize/reconcile/rebuildIndex/provider或改现有store.list默认语义。

knowledge或feedback读取不完整时该区域显示“读取失败，无法确认本周期记录”，不显示0或假完整计数；另一正常区域和pending保持可见。pending的四分源错误照原样显示，已读取事项不能称全量。各源都完整且为空才显示对应“本周期无记录”；无反馈明确“本周期没有使用反馈”，不推断效果好坏。刷新只显式执行；请求失败/日期切换/离开后的迟到结果不得覆盖新范围或打开错误对象。

## 可追溯明细与导航

- Wiki行点击读取当前Wiki ID并检查列表revision；删除或版本变化明确提示刷新，不默默开另一页；重新读取最新列表后可进入。复用现有Wiki页面ID入口。
- 当前事项沿原`/api/home/actions/:kind/:id?versionToken=`预检和App openHomeAction，不另写规则。
- 反馈行可展开完整记录：显示Prompt名称/稳定ID、使用版本、反馈ID/revision、usedOn、效果、observation、nextImprovement；全部来自聚合读取时的L5记录，不AI改写。该明细本身即追溯依据，不新增跨页面反馈深链或复制CRUD。显示“截至本次读取”，显式刷新后更新/移除已修改或删除反馈；禁止把旧快照称为实时现状。

Wiki/待办导航只读，其他既有人工编辑仍由用户单独操作。回顾区域采用既有Operate卡片/列表，标题、日期、口径、明细优先，不加装饰图表。按需详情可折叠但数字必须能展开对应记录。

## 文件所有权

Astra唯一写本卡，冻结后停写。Terra：新增`services/home/review.ts`、`app/components/PeriodReview.tsx`；`server/home-api.ts`与`server/index.ts`窄装配；`app/api.ts`、`app/pages/HomePage.tsx`、`app/App.tsx`的既有Wiki/待办导航接线；`app/styles.css`必要首页局部；新增`tests/lifeos-l6-review.test.ts`、`tests/lifeos-l6-review-ui.test.tsx`、`scripts/lifeos-l6-isolated.ts`、`docs/reports/LIFEOS-L6-20261031-builder.md`。现有Home/Prompt测试若仅需新增可选prop/stub适配，可在交接列具体变化，不削弱断言；其他服务/持久化修改须先给证据由主线程裁决。

Sol独占`tests/acceptance/lifeos-l6-browser.mjs`与`docs/reports/LIFEOS-L6-20261031-review.md`，先审/独验不改产品；主线程管理状态、版本绑定与提交。保护四文件SHA：AGENTS.md、docs/reports/B04-http-evidence.json、docs/reports/KB02-R1-20261015-builder-merge.json、docs/reports/AGENT-ROUTER-20261023-packaging.md，前后不变，不覆盖他人工作。

## 冻结验收 L6-01–03

- **L6-01 时间/计数/追溯**：以2026-10-26至2026-11-02验证上海周：Wiki created=2026-10-25T15:59:59.999Z排除、16:00:00Z包含、2026-11-01T15:59:59.999Z包含、16:00:00Z排除；合法纯日期按日，缺日期列undated不计，非法模糊日期不猜测。反馈usedOn=10-25/10-26/11-01/11-02分别排/含/含/排，createdAt/updatedAt故意放另一周期仍按usedOn。非法日期/start=end/倒置400。与同源homeActions做深比较，包含周期外仍待处理事项并保留原排序/分源错误。数字等于明细及四效果分类总和。真实Chrome日期切换、Wiki/当前事项导航准确，展开历史版本反馈核完整内容及id/version；Wiki/待办列表后版本变化/删除明确提示，反馈刷新后反映修改/删除；迟到日期请求不覆盖新周期。
- **L6-02 删除/空/错误兼容**：active与recycled Wiki/Prompt、已删除反馈、旧无feedback、无任何记录分别构造；排除回收和已删反馈，历史版本活跃反馈仍显示；无记录真实空，无数据不会补造。分别使Wiki目录ENOTDIR、坏Wiki Frontmatter/身份、坏Prompt/feedback、homeActions单源坏JSON，正常区域仍可用，失败源不显示零；读取结束前消失记录提示刷新。组件+真实服务测试覆盖，Chrome展示单源失败/刷新恢复、空反馈及Prompt回收后刷新移除其反馈。L5产品文件不改，不重跑无关CRUD。
- **L6-03 零副作用**：初始化/fixture准备完成后，对隔离knowledge/prompts/drafts/state/meetings业务树文件集合与字节SHA拍基线；普通首页未主动打开回顾无review请求，用户打开/改日期/刷新/明细只读导航后树一致。Provider入口设实际计数/抛错探针为0，配置加载器未接入如实记录，外网拦截0；损坏/空源读取也不自动修复/迁移，禁止任何AI/保存/恢复API自动POST。旧Prompt无feedback读前后字节不变。服务启动原初始化副作用在基线前，不能混称整个生命周期零写。

必要命令建议：

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l6-review.test.ts tests/lifeos-l6-review-ui.test.tsx
npx tsc -b
```

结合实际导航修改选最小L3/Prompt UI回归，交接列精确命令；不扩全仓。构建用空envDir。impeccable context沿本会话，编辑前craft-floor、完成后detect一次，不新建PRODUCT/DESIGN。隔离harness完整React App+真实新增聚合API/已有stores/homeActions，虚构边界数据；不接配置加载器/真实Provider，支持输出session(root/url/api/fixture IDs/counters)，Chrome/Playwright已可用。1440/1024实看日期范围、口径与明细/错误、键盘焦点；JSDOM不代替实际浏览器。

施工交接实际命令/结果、版本/文件SHA、source口径/请求与写入探针、四保护文件SHA和未测项，随后停写。Sol先审准入后施工、交接后独验，分别裁决本轮缺陷和L6整体；三个必选项全部有证据才PASS。缺口FAIL/BLOCKED如实记录，不以局部时间单测签整批。通过后主线程提交推送核远端一致并停止，不额外安排新功能或长期监控。
