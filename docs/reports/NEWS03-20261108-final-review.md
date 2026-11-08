# NEWS03 最终独立验收

本轮FNEWS03-01收缩实现 **PASS，缺陷关闭**；结合已核对的原独立工程证据，NEWS03按最终冻结范围 **整体PASS**。F02～F06继续保持已关闭。本结论不追认旧日期推断方案正确，不覆盖[原FAIL报告](NEWS03-20261108-review.md)。

日期：2026-11-08。评分0/2/1/2＝5，B模式。最终施工为Sol High `news03_period_repair`；本报告为未修改产品的Astra Medium `news03_plan`独立验收。任务卡SHA256为`BE4FA33C6E4B751B9E0800FD091BE6C2683C3D3CDA3E3CE86E6162E0245C2345`。项目开工基线`7998f27d9b885fd275b77d0bbf29dbbbb3a000ee`；本次验收共享HEAD为`8a8d7741fc70755a6c0c16414c0badf9f10b8b13`，包含其他任务提交，NEWS03尚未提交，以文件指纹冻结。

## 本轮实测

独立读取实际period函数：只接受边界清楚、带冒号的单一统计口径标签和值；值必须完整匹配日期或日期区间，直接保留原文。预测修饰、混合年份、多标签及经营叙述不再推导数据期。未可靠识别显示“请以原文为准”，并不声称原文没有数据时期。支持格式有限，真实叙述可读但没有独立标签时为null，是已批准的功能收缩。

| 实际命令 | 结果 |
|---|---|
| `node node_modules/.cache/news03-review/period-final-astra.mjs` | 独立编写、从当前产品源码提取实际纯函数执行；10个正反例PASS，5条前轮真实完整excerpt精确回放PASS；7个未改受验文件SHA一致 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news03-repair.test.ts` | 独立重跑最终适配器回归19/19 PASS，包含原文/发布日期不变、预测、发布月、独立标签、歧义与普通叙述 |
| `node node_modules/typescript/bin/tsc -p node_modules/.cache/news03/tsconfig.json --pretty false` | 独立产品范围类型检查退出0；七份既有受损测试原件未改，不签全仓默认类型检查 |
| `node --import tsx node_modules/.cache/news03-period-repair-replay.mjs` | 审查后独立重跑施工离线夹具；Worldpanel HTML与NIQ测试PDF两路径共5/5 PASS，除dataPeriod变为null外对象逐字段完全相等 |

[独立原始结果与指纹](NEWS03-20261108-review-evidence/period-final-astra.json)记录全部案例及真实excerpt。NIQ即时零售白皮书第10页541字符中预测“2026年”不再被当作统计期；Worldpanel购物者427字符中的预计2026年与2025/2026Q1不再混为概括周期。另三份原文也保留且返回null。独立标签“统计周期：2025年1月至12月”等正例逐字保留；只有发布日期、普通真实经营数据、预测修饰、多时期均不推断。两路径回放核对标题、发布日期、原文、来源URL、PDF URL、页码、材料等级与抓取时间均未改变。

本次没有新官网请求。真实公开来源的目录→详情→HTML/PDF读取由前轮相同fetch/parse路径的实际HTTP证据证明；本次只变period，使用原实采完整摘录回放。NIQ离线适配器使用原文字生成的测试PDF，不能称为重新下载官方PDF。真实产品模型调用0、网络请求0，未安装依赖、未用正式资料/配置或用户服务。

## 复用与整批裁定

| 门禁 | 最终依据与结论 |
|---|---|
| N3-01 官方材料及口径 | 原Sol的双源真实读取、下载/页限、材料等级/空壳排除证据保持；原日期失败不复用。本次新函数、真实原文回放、直接标签正反例关闭F01。PASS |
| N3-02 精选 | 原main.json及定向证据中的365日、0/1/2篇、去重/排序、AI窗口、同日复用；相关service/types/sources指纹相同。PASS，复用 |
| N3-03 版本过渡 | 原HTTP旧当天升级、只读投影、legacy、仅新版fallback及旧文件不改证据；service/UI指纹相同。PASS，复用 |
| N3-04 Raw与预算 | 原HTTP保存逐字正文与来源、幂等/旧Raw保护、零模型和备份证据；raw-save及相关接口路径未变。本次适配器回放确认除周期字段外不变，null提示沿原同SHA实现。PASS，复用 |
| N3-05 UI与兼容 | 原1440/390、保存/查看/刷新、旧历史、空态/失败及备份、空envDir 231模块构建；UI等文件同SHA。PASS，复用；本次另实际类型检查 |

原证据详见[原报告](NEWS03-20261108-review.md)中的main.json、browser-one.json、browser.json、live-ui.json与build.json。前轮截图中的旧数据期取值不作为新标签准确性的证明，只复用同UI的布局、操作和状态证据；本次未重新开浏览器或构建。AI真实模型质量NOT_RUN，不属本批无模型快消门禁。施工早期默认envDir构建的既有披露保留，不声称整个施工从未读取配置。

最终适配器SHA256：`6BB13240544EFFADF5BA79EF6E9A4D9AF90E049C5621999E1A85386271ED2F34`；定向测试：`DB79E923749E65EF0085BB20AD3B78B83D24CF226BA31573A461C650E6AAB4FE`。其余指纹与前轮对应关系见独立JSON及[最终文件清单](NEWS03-20261108-review-evidence/final-manifest.json)。保护的未跟踪news01-sources.test.ts同SHA，不纳入提交。本验收仅写证据与此报告，无产品修改/提交，所有本次命令均退出，无自有常驻进程。

本批可以由主线程统一审差异、提交同步；仍须核对待提交文件与上述冻结指纹。没有未关闭的本批缺陷。未来如需自动理解所有报告的数据覆盖期，须另定方案与验收；本批不承诺语义理解或付费分析质量。

主线程交付关联：受验产品提交 ae053cc430b70dce378193f28d02b7932853d31a 。提交前已逐项核对最终清单，原有无关修改指纹不变；共享首页改动由其他批次独立提交。
