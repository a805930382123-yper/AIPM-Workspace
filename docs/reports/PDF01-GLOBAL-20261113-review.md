# PDF01-GLOBAL 独立验收（2026-11-13）

工程范围PASS；全62页真实分类草稿仍未完成、质量NOT_EVALUATED。B评分0/2/2/2=6，pdf_review规划独验、pdf_global_builder独立施工。HEAD8264aba50b58be6c415be0124499a8977f3197fb加未提交文件，不以HEAD冒充本轮已提交代码。

## 范围与指纹

rev7长报告一次全目录映射替代局部16标签追加；稳定短ID对应完整原标签、80码点原文导航和页/来源，完整wire80KiB独立帽。显式升级清理已完成且无writing/草稿的rev6，归档旧128索引并复用54清理；原证据包writer和正式确认事务不变。

- services/raw/pdf-cleanup.ts：0ff72a573969153c329de187b78dbb564eb4682b99b8f3b13e68f51e35f9feff。
- tests/pdf-cleanup-structured.test.ts：d33a30401c9e64260aa7d6c6e7b75d34b97417b987034f7629063e607ec8b42d。
- writer保持533daf0f9ac6d4c51d5b00cc19e89b904c4fb237523148d2820da7933ede2b8d。

## 独立实测与审查

实际执行 `node --import tsx --test --test-name-pattern='global PDF directory' tests/pdf-cleanup-structured.test.ts`，1/1 PASS，exit0，1875.95ms。逐条审读该测试：181标签strict完整键控，缺键/未知键/escaped等价重复键/非法标题/超过50均拒且不部分落索引；rev6原128索引逐字归档、清理批与attempt计数保留，Provider及basis变更拒；GET/重启不调用；成功目录后writer失败再显式继续只调用writer；待审草稿1002依据及尾页图来源保持；目录超80KiB前置失败，零新增Provider/attempt。fake只证明工程，不证明语义目录或真实质量。

实际执行 `node --import tsx --test --test-name-pattern='long PDF' tests/pdf-cleanup-structured.test.ts`，2/2 PASS，exit0，962.66ms。覆盖原rev5清理前缀升级兼容及原证据包原成员/来源/尾项完整性。

源码独审涉及revision读取、显式升级/原子归档、完整映射校验后保存、原long writer接线、错误处理及调用前容量。未见隐式迁移或丢弃未映射标签的分支。每标签导航是截取片段，只用于目录；写作仍读取原完整证据包，不能把导航当正文完整性证明。

施工报告组合38/38与范围tsc0作为施工自查记录，未冒充独立重复执行；本轮无UI代码变更，原来源展开与整体审核UI证据可复用其未变部分，尚无本轮真实草稿页面证据。全仓旧损坏测试未修，不称全仓绿。

亲读global7-offline-capacity.json：正式54批克隆、181标签全部目录请求，完整wire74300B/schema11183B/user56934B，307包1931原成员；24/36/50题情景9/9/13写作。情景不代表实际目录结果，不用情景跳过真实预算门禁。正式CP/账保持，原目录49题超限历史保留。

## 真实门禁

当前账130/150。工程局部目录实现缺陷已修复PASS，实际是否解决语义细碎必须由真实结果判断。root可按用户授权控制1次全局目录到131，首write必须在Provider前阻断；此处不代签尚未读取的预算工具。拿到真实181完整映射后精算实际writing批数<=19并审目录，才可写作。真实失败立停、不自动重试、不提高50、不删材料、不确认Wiki。完整草稿生成后逐候选审事实、归因、条件、来源与后半新增事实，才能裁整体质量。

## 目录工具放行独审

亲读pdf-formal-global7-directory.mjs及plan-global7-directory.json并核SHA：f9960b1f42fd032aafc098196d5b94ed7ee1fbed1e2709890890d236828b7d0a / e9066f5f595096185a2d5e111fbd256bd03b5661421d18a62e8f2706f9a2b3ba。130冻结账/CP/产品/manifest身份、全181原标签顺序及t1…t181、durable发送前计数、仅1目录至131、150帽、首write完整目录核后forwarded:false均符合门禁。工具独审PASS，已按root条件授权通知唯一执行方；这不是目录真实结果PASS。

## 第131真实目录与写作预算独核

第131 HTTP200/stop，18374输入+2635输出，181标签一次归38主题；首write账forwarded:false，写作0。亲读全部映射：原蒙牛早餐两题归一、39页数据和待核两题归一，报告说明/序言/寄语/研究方法27标签合一说明议题；八时刻、各品类和不同品牌案例仍独立。目录阶段合格，但报告说明包含多机构与定性/定量样本，最终正文必须分别归因，不能据标题判语义质量已完成。

独立比较54批清理与rev6归档JSON一致，181标签按ordinal唯一（PowerShell默认文化排序会合并两个含格式字符标签，故不用该计数误判）。实际global7-actual-writing-capacity.json以真实映射精算11写作/307包/1931成员，完整wire最大41670B，11<=剩19，预算门禁通过。无失败时累计142/150；仍需writer工具冻结独审。CP54eccaff40ede17f7f9a69559c32c51c87e14fda3804c7250cd26cdbc533cb79，账32eac9b2cf2d172d4045dfa29628b7946c860ae78b10ef8eb3e0560f92ab368c。

写作工具独审PASS：pdf-formal-global7-writing.mjs SHA0e46c00c73df316f8f0f859d7a808023a88929cf6b2af6817086b71a1ed0e00b；plan-global7-writing.json SHA4d5a5889e5cccdb439be4f67805b43011dcd115d271802120ea5eca87e21a17b。核11条完整wire SHA逐条等于实际capacity、仅pdf_topic_write、131→142且150硬帽、发送前durable及身份/检查点冻结。按root条件授权通知唯一执行方，首失败停；成功仅生成待审草稿，不confirm。

第132真实首write于10.685s报TypeError/UND_ERR_CONNECT_TIMEOUT，未获HTTP响应，属于连接超时，不是60s生成超时或内容校验失败；原目录完整保留、writing0。root授权同参数一次有限续。独核plan-global7-writing-retry132.json SHA b5c492a29940c3806ce0650e8591388254df57f20ba6282e0617cab9d9fcca5a，仅previous132/CP17d4af28…1153a/账e4f67505…10d7f三字段更新，11wire及工具SHA均不变，实际CP与账摘要相符。放行132→143一次有限续，150硬帽，首失败停，不改配置。

## 第133原响应窄修独验

局部误拒修复PASS；整体真实草稿仍未完成。独读原首wire与完整133的21段，并亲看原第1页PNG：2026是封面报告题名，非被删正文数值；青啤百年匠心为修辞，核心合作信息在；至少一种、定性至少3种/4位、时间/年龄/样本等原条件保持。只修结构与等价规范化，未改原响应/按ID放行。

最终cleanup SHA885297b5555934e327731d7f943580e955059b3174ede76b2fe5a373ec4db26e；writer 1aa9999f504fcb44e6bb0115ea46bca3181faa9ae96e6c0e1a6832fff66a70db；tests 058fbf742f28c820d6e9d0109c15a652cd43d1f442d512a5ed8b298202c0a634。HEAD保持原基线加工作树。

独立命令 `node --import tsx --test --test-name-pattern='long PDF writing|global PDF directory|topic writing' tests/pdf-cleanup-structured.test.ts`，8/8 PASS exit0，2337.97ms。新反例证明混有样本事实封面不能略、定性改定量/人数4改5/个改元/年龄45改46/人改件、错误表格年龄配额、负5改正5仍拒。代码独审确认layout仅供校验三路径，原完整wire不变；共享量词、年龄范围、人数单位及同页样本表对应规范化，确定性不误作定性。施工39/39组合及范围tsc0为复用自查，不冒充独跑。

亲读原样生产adapter离线脚本和global7-replay133-offline.json：原响应文件7e6b0b9a835d2d1d6fbc21379dd13951ea859bb01ab777a33d791434a1baed19，content 9c2749faf3806c42b94698f4a46a38f3f1e8c474cd7982507c6ab83db452e195，克隆保存21段且deepEqual原JSON，下一writer本地fake拦。正式账/CP不变，11wire全保持，未实际新增付费。

replay133工具独审PASS：f3c6f80e0be729e559aadd9ecd8ac06c829becea59328b7dbe4f7967899a28fd；plan4279db80e961a01b990212b9068173d4e077eceb3805feed68afc0a8b5b8f53c。首次须同完整wire及原contentSHA回放，记replay forwarded:false且不加付费count；下次付费前核首写作已持久且SHA一致，余10逐条等于原wire尾10，正式CP/账SHA匹配。按root授权放行133→143、150硬帽、首失败停；成功仅待审草稿，无Wiki确认。

## 主题级追溯根本修复独验

工程PASS。经root批准，rev7以当前请求同题完整来源校核新增事实，取消逐包逐段反向复述门禁；完整主题全部成员保存，metadata处置不删除依据，正文不再声称精确逐段来源。真正信息覆盖仍由真实内容审查判定，这项工程通过不等于全文质量通过。

最终cleanup6a5917f32a709e9a4cedcd3b45f1eb0bb7d66a39a3b81317a52a07a1767b5796；writer89b9da51bba3e2a75946c1cd47ccb29d13aa5431f8a061fdab1a9c334c0869f3；render8a9fd6327489c60dc35d1727d0948824cd23c07734d1b3dda20bab4f769dd942；测试073e027e68d6b12c81e2f760868b3af8ecd2b76950f3fc2bd2e9b35e7440ba23。

独立执行 `node --import tsx --test --test-name-pattern='global PDF writing|global PDF directory|long PDF|topic writing' tests/pdf-cleanup-structured.test.ts`，11/11 PASS、exit0、2765.97ms。新反例覆盖同题无依据数、实际改预计、人数单位改户、线下改线上、跨题coverage及越界引用仍拒，旧版兼容和目录完整性通过。施工40/40、范围tsc及233模块空env构建为复用自查，未重复整站验证。

亲读global7-replay133-134-topic-offline.json和真实Chrome browser-result.json、亲看02/03/04截图：正文181预测/175实际分段无伪精确来源，末尾明确“本主题依据”、合并1–4页链接，1042依据全部及尾875样本可展开；操作记录实际打开PDF第2/4页、无外部请求/正式确认。UI证据为隔离合成输入，不是62页真实质量。代码独审仅rev7启用，原133与134响应原样离线生产adapter存两批，11wire不变。

replay134工具cf6591b6a2d15c0e9666faddd7ec98fb96970c083dadecb3e598e5a84e68dfe5，plan6bd6e952990fc2b4f5ef15454dea4298ab5c40f87265ff0e23dfffc91253ce43独审PASS。冻结原133持久SHA与原134 content f41a376024bf616694a4b8f80d8e4643910e6649971c6cd7073cb7915c6334a5，第二批持久校验后才新请求；实际CP/账匹配，尾9wire逐条等于原计划。已按root授权放行原134零付费回放后134→143，cap150首失败停。真实全文质量继续待验。

## 第135纠正生成前独验

独验亲看第12/14/16原图，确认135的裸年龄柱补%及原+4%换算4pp未标推算，原响应不予通过；增加3%与+3%、百分区间横线则属等价。仅rev7统一符号/百分区间token，并在writer提示禁止补单位和自行计算代替原标。原135留证，不手改、不回放成PASS。

最终cleanup baf4cc886c9f9be1e41267a1570d5e12875043b6b43fea6bfc6082f6a246584c；writer b29dfff502b849edf1831be16845a4bb5b64fe54b85e5df08a9c0585018e4b8e；测试9e150afaeb1108a39f8cb17a3012f96674adb4f0287f75fbfd05fbffa3126141。独立 `node --import tsx --test --test-name-pattern='global PDF writing|global PDF directory' tests/pdf-cleanup-structured.test.ts` 3/3 PASS exit0，1688.28ms；反例覆盖增加改下降、%改百分点、裸数补%或人数、上下限丢失/翻转、区间端点/符号翻转、高出改低于仍拒。施工41/41与范围tsc0为复用自查。原2批离线重验保持，135仍因新增事实拒绝，不弱化到假PASS。

global7-135-fix-wire.json原135文件摘要c1aae08b327fb381d546db219866ffcefe428ae1e2857b460ef805e4b1491507；前2写作摘要a8fdb55ae667502394cfffb456853695f908d6474b8c287d4423c8da1898b0c9。9新wire已因提示变化重冻。工具2b2eae9867afe0d6bce48662e61a9f8a25fd58c5eee2033eb40d6f2c50aa096a / plan01a06c848ce0c8ed6aaea1c8f5ba2e8ad9f3d4a76e8c7eacc77bd16f2e7cb437独核PASS：只135→144，实际CP/账匹配、前2摘要冻结、9wire逐条等于remainingWireSha256，无缓存135逻辑。已按root授权放行唯一纠正生成第三批后续8，150硬帽首失败停。局部工程PASS，真实整份草稿仍待产出与质量审核。

## 第141孤立输出引用错误

第136–140五次成功、已存7/11；第141唯一错误为音乐经济/百事主题g-p42-text-1声明included blockIndexes [0,4]，该题只有4段（0–3）。独读全部四题正文及metadata/coverage，Sol继续全保护扫描未见其他数值条件错误；原响应保留，未修改、未缓存通过。产品与提示保持，未重跑无关工程测试。

root授权同参数一次有限重试。工具pdf-formal-global7-retry141.mjs c1080efeb5d581c8a3b295d1ce67b4a3102ad52576f88363815a359a5c0a1771，plan335f1a5813ae1870cf01c84cbd81d7a07bdd77a5e7cc21e0a4d40eae55ebfd67独审PASS；唯一代码变化为冻结已存写作期望2→7。4wire逐条等于原135计划尾4，产品/CP/账实SHA相符。放行141→145（150帽），首失败停；不把这次输出格式错误当产品核心归并失败，也不因此扩大规则。

## 最终真实交付独立验收（2026-11-13）

**本轮工程缺陷修复PASS；完整62页分类待审草稿交付PASS，真实质量26/30。** 62/62读取、54/54清理、181标签→38主题、11/11写作完成，草稿a308bcd9-c4d0-44b2-87cd-99813e0ef1db为pending_confirmation。没有确认正式Wiki，不自动继续用余额调用。前文“尚未完成”均为历史阶段结论，此节为最终结论。

### 实际审读范围

独验读取全部38个maintenance.changes[].candidate.body全文，包括AI整理、推断、问题和主题来源；不是只看标题/摘要。用PowerShell逐题读取并补读首次输出截断的第3/4题。全目录覆盖报告说明、市场/用户/渠道、八时刻、品牌案例、方法论及后半11品类，末尾3C和户外完整。原图亲看范围是第1、12、14、16、54、55、60、61页；另核首133/134/135/141原响应与对应请求文本。不声称重新逐像素核完全部62页，也不以工程守卫证明自然语言全部等价。

- 数字/口径5：第12页年龄裸数保留“图中未标单位”，原+4%保留，4个百分点计算置AI推断；第14/16价格范围与原标保留。第60定量2551与第61定性8人、至少1/3种服务、年龄、收入、本地居住等分别保存。预测/实际、同比/环比与品牌经营数据归因未混。
- 重要覆盖4：原前后章节和11品类均成稿；原54/55图的商品组合、兼容性/接口/权益、内容与衡量指标完整进入对应正文。对全稿审读未见重大缺失，原图仅抽核，非全部数表逐格复核。
- 来源追溯5：独立将草稿pdfEvidence的unitId与清理所有非skip项比对，2008条/2008唯一，期望2008，遗漏0；38题全部有本主题依据。1931可写成员/307包之外的表格、推断、问题仍在其既有路径。原manifest SHA保持；来源明确是主题级，未伪称逐段精确支持。
- 推断边界4：事实整理、AI推断与待核分区，机构意见和平台经营数据归因明确。少数旧页级推断/问题未全局消解，例如“方法论尚未展开”“八时刻具体哪些”在完整主题中已被其他正文回答，应在用户编辑时精简。
- 噪声4：封面/纯结构没有逐项生成独立知识；说明题仍保品牌排列、致谢品牌清单及一处仅表头的表列，偏冗余但非事实失真。
- 归并/新增保留4：蒙牛早餐和同页重复数据已归并，后半新增品类完整；仍有一题仅含第39页两条待核，以及案例与画像重复部分场景描述。可将该薄题问题并入尝鲜题；无需为此再次付费或开发。

总26/30，各轴>=4，未发现重大否决项。以上局部编辑建议没有修改用户草稿；不要求资料逐字复刻，不把营销修辞省略判事实遗漏。整份草稿可交用户整体审阅，正式入库仍由用户明确确认。

### 实际UI与完整性

亲读实际UI browser-result.json、亲看03/04截图：真实草稿38卡，美妆完整正文可展开，“本主题依据”第50页及44条原依据明确可查。执行代理GET-only浏览器阻止全部mutation，来源PDF返回200；没有点击确认。[实际UI证据](PDF01-GLOBAL-20261113-real-ui/browser-result.json)。此证据对应真实草稿，不再只复用合成UI。

最终累计145/150，681526输入+205277输出=886803已知tokens，5次usage未知、费用未知。原133/134回放0新付费；135/141失败响应保留，最终纠正生成分别通过。剩5未使用，不继续请求。

最终SHA：draft b80b0c6e3e1b4c13e2f607b1f34ed389ee5ac8e1b8e58c4ee3bb26bc293871b8；checkpoint11bcea7bdc5b293fac07d0dc947b3027bbddeacc57141ca9c4bba239cc8dd200；ledger ba711eb220ec5f25733b2d45622ba426571035d1dc46f70f9889f77c1b0dc538；manifest3025c68d1a2d0f0aa294a121d42458d29c88671d965e27a43d1876e48ec71396保持。HEAD8264aba50b58be6c415be0124499a8977f3197fb加最终产品文件SHA（上节）绑定，未提交。完整账汇总TEMP global7-final145.json。正常API5151/UI5173由执行方恢复，未确认Wiki，无新增模型/配置改动，无提交推送。
