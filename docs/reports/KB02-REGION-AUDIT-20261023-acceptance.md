# KB02 REGION 独立最终验收

**本轮原长文跨区域归属缺陷F-KB02-FIELDS-LONG-01：在指定原样本内通过。KB02整体：未通过。** 新补充样本仍将仅有未来边界的AI陈述独立建页；本轮原短文未生成metric目标，通用concept更新成功不能替代该特定门槛。停止外发和重试，不推进下一批。

Astra独立验收，未施工产品/default tests。基线HEAD `5be06023bb8200e82cb0131b0588601632c4e941`，施工前产品提交 `a836270f53f0fc5bb802695e3f4101cf182ee3b9`；当前未提交代码绑定[冻结180文件](KB02-REGION-20261023-frozen.json)，SHA256 `0ae132b7f6da31017f58326d1aaacc5b6692e3d10a28b12ba4e70ae639dd9d21`。主Agent提交后补实际提交关联。

## 逐项裁定

| 门槛 | 本轮结论与证据 |
|---|---|
| K2-01精简事实/严格契约 | 通过工程及本轮样本：原文切片和引文位置精确，事实/问题分别保存；未改Raw、未补写正文。完整默认393/393及安全回归见[工程报告](KB02-REGION-AUDIT-20261023-engineering.md)。 |
| K2-02主题规划/兼容组装 | 未通过整体质量。原长文76事实+25问题、55unit/101原ID各一次、split0；14主体各自2026年9月、100目标门店、11%–24%及未知/未来边界均归对应主题。新增补充AI边界独立页仍违反不独立灌水要求。 |
| K2-03检查点/显式恢复 | 工程通过：revision10拒绝、零调用/写入、保字节、显式restart及旧草稿等回归已实测。真实长文客户端轮询失败后，原后台job自行正常完成；仅GET读回，不重发提取。不能将此称为重新启动恢复试验。 |
| K2-04真实质量/进度/预算/浏览器闭环 | 安全、长文Chrome和通用更新链通过；整体门槛未过：补充质量失败且本轮metric目标更新未完成。真实浏览器已实测，不用HTTP冒充UI。 |

原长文实际生成14页只是观察值，不是通过依据。[完整质量矩阵](KB02-REGION-AUDIT-20261023-quality.json)、[逐区域人工语义裁定](KB02-REGION-AUDIT-20261023-long-semantic-review.json)、[固定unit/原ID覆盖](KB02-REGION-AUDIT-20261023-same-source-split.json)及[Chrome全部卡片](KB02-REGION-AUDIT-20261023-browser-long-all-cards.json)共同支持有限通过。原seq180为79事实+21问题，本次全新提取为76+25，不混用旧总数。每区边界都仍存在，没有靠删除问题达标；没有泛化跨区域页。独立实际视检区域07截图及刷新，全部卡片字段采集保留。此不证明提示已根治或模型普遍稳定。

## 剩余问题与更新结果

**F-KB02-REGION-SUPPLEMENT-01/P1**：seq202生成“AI异常提示机制（未上线，未来建议）”，concept/ai_application，唯一unit `fu-139-160-fact`、source `s-139-160`、原ID `f-c1-4`。唯一原文 `[139,160)` 为“AI异常提示为未来建议，无上线或收益事实。”，没有独立定义、触发条件或流程支持“机制”主题。应作为相关业务事实主题的边界保留，不应删去事实。该页未正式确认。[精确请求响应/上下文证据](KB02-REGION-AUDIT-20261023-supplement-defect.json)。它是新样本的同类语义残余，不是原长文再次跨14区域合页，也不是unit分裂。

原短文seq184–185保4事实/1问题，规划为一页concept/sales“虚构饮料甲2026年9月甲桥区域铺货情况”。原探针 `Missing metric knowledge` 失败保留，未重试或人工改type。任务卡metric目标未达是确定事实；不能据此断言schema非法或concept必然不合法：product-spec §13允许铺货概念，§16指标含计算方式，本页同时含经营情况、指标定义和业务边界，合理分类有解释空间。本轮不将脚本类型断言直接升级为普遍产品缺陷。

主Agent明确放行通用concept分支后，真实Chrome勾选原页并确认201、保存人工备注200、刷新及重复点击通过。补充metric草稿明确选择该旧concept目标，seq203预览201。独立逐条核对双方输入：100目标门店与AI仅未来无上线收益均双侧直接支持；新30家30%与旧20家20%分别保留；差异原因仍待确认，可能原因单列AI推断；财务每周核对回款只列新侧。[语义审核](KB02-REGION-AUDIT-20261023-semantic-review.json)绑定sections SHA `19aec2883f7f065e99181d285f2c985d7eda118b81e2bffa64210b9c1138dea4`。

审核后Chrome明确确认201，目标rev2→3，type仍concept；刷新/重复点击稳定，旧正文每条非空行、KB02_HUMAN和双Raw保留。相同幂等键重复确认200、无再改，磁盘WikiStore重开与API一致。[最终检查](KB02-REGION-AUDIT-20261023-update-final-check.json)。此通用链通过，不冒称metric目标更新通过，也不抵消补充独立页失败。

## 实际命令与异常记录

工程完整命令、393/393、build、Node24.19的51/114及历史/新增边界见[独立工程报告](KB02-REGION-AUDIT-20261023-engineering.md)，均由本轮独立执行。

| 本轮实际命令/操作（项目根） | 实际结果 |
|---|---|
| `node --import tsx tests/acceptance/KB02-REGION-AUDIT-20261023-lab.mjs` | 隔离API64473/UI64474；最终exit0，服务关闭 |
| `node --import tsx tests/acceptance/KB02-REGION-AUDIT-20261023-real-http.mjs SHORT` | exit1：任务成功但无metric；seq184–185，原失败保留 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-browser.mjs` 控制1/2/3/4/5 | 实际Chrome短文审核、长文全卡/刷新、候选/预览、确认、刷新重复点击均通过，最终exit0关闭 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-generic-target.mjs` | exit1：探针未等卡片加载，count0；确认前失败，无写入，无模型调用，浏览器关闭 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-generic-target-r2.mjs` | 补waitFor，另存脚本/证据后exit0；实际创建concept/备注/刷新，浏览器关闭 |
| `node --import tsx tests/acceptance/KB02-REGION-AUDIT-20261023-real-http.mjs LONG` | exit1：本地轮询fetch failed；当时在途请求使账本3/trace2即时断言失败。原后台job未重启，最终14块/15次正常completed |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-long-readback.mjs` | exit0：只读接续原job `a60135d4-afba-4b96-9572-442bc875e21c`，完整Raw/引文/区域数据通过，新增调用0 |
| `node --import tsx tests/acceptance/KB02-REGION-AUDIT-20261023-quality.mjs` | exit0保存完整成员矩阵；语义由随后独立逐区域裁定，非exit0自证 |
| `node --import tsx tests/acceptance/KB02-REGION-AUDIT-20261023-browser-prepare.mjs` | exit0，seq201–202提取/规划；整体语义仍有上述补充缺陷 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-preview-review.mjs` | exit0，提取seq203输入输出/待审hash；之后独立逐条审批 |
| `node --import tsx tests/acceptance/KB02-REGION-AUDIT-20261023-update-check.mjs before` / `after` | 均exit0：预览未写旧文；确认后双Raw/原文/备注、幂等200和磁盘读回通过 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-final-evidence.mjs` | exit0：20账本/20trace一致，长文55unit/101ID无分裂，绑定逐区域语义证据；不代表整批通过 |
| `node tests/acceptance/KB02-REGION-AUDIT-20261023-closure.mjs` | exit0：三Raw原hash不变、全20响应200/stop、真实门禁关闭、服务浏览器关闭 |

长文Chrome控制首次自动审批超时未执行，按工具允许重试一次成功；不是产品失败或模型重试。未覆盖SHORT/LONG首败报告。施工874文件历史对比缺逐文件hash、原副本已清理的限制保留；独立当前180冻结和实际隔离测试提供本轮工程证据。

## 封账、保护与下一步

本轮20/24，seq184–203，累计203/500、余297；未用4封账，Prompt15/24不变，无自动重试。Provider为现有只读open.bigmodel.cn / GLM-5.3-Flash，所有数据虚构隔离。三Raw逐字hash、无长文正式Wiki、所有自有浏览器/API/UI关闭见[closure](KB02-REGION-AUDIT-20261023-closure.json)。最终 `node ...-integrity.mjs` exit0：180冻结文件、3397保护项、正式workspace/config无变化，scope精确；`node --import tsx ...-local-safety.mjs` exit0：94份本轮证据无已知密钥泄漏，20账本/trace一致。见[完整性](KB02-REGION-AUDIT-20261023-integrity.json)、[秘密扫描](KB02-REGION-AUDIT-20261023-local-safety.json)。审查者未触碰正式workspace/config或历史资产。

建议停止同类提示叠加盲试，下一轮先由Sol针对seq202这个精确反例离线诊断，Astra再判方案/模式及metric目标门槛如何实测；本轮不派发、不启动下一批。原搜索乱序旁支未纳范围、不宣称修复。由主Agent统一状态和GitHub同步，补提交关联。
