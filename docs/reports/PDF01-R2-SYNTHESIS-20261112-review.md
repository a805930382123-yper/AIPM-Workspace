# PDF01 R2 主题写作独立验收（2026-11-12）

结论：本轮工程修复 PASS；六页真实 R2 质量 PASS，27/30。R1 原质量 PASS 19/20 保持。第三轮条件已满足，但本报告仅提出 R3 范围，尚未施工。旧 revision 1–4 的失败结论和产物不覆盖。

## 版本、范围与工程证据

HEAD `febf47eaf2fbff274aa5530e642a903b79a4ffb0`，本轮未提交工作树，不以 HEAD 代表已提交本次代码。Astra 独验，Sol 施工/实际请求；沿 [任务卡](../handoffs/PDF01-R2-SYNTHESIS-20261112-task.md) 的 B 模式。Raw、R1、原件和旧清理/索引证据不改；新增有界主题写作复用成果级人工审核，无平行审批。

最终主要指纹：

| 文件 | SHA-256 |
| --- | --- |
| services/raw/pdf-cleanup.ts | 4295da5e04d968c6cec0add1c3fcc1a8b23190efb9a96e6852f9fd95e7dc2a7d |
| services/raw/pdf-topic-writing.ts | a3c8153e3258312adf04f666d590d9b3b7d708f5c910b8b046a273c9c0a2035e |
| services/wiki/render.ts | 0d3acb4ac429379d18bcb93bf0bb69516c4d132231820e0a3ee8f049b2ba14cd |
| tests/pdf-cleanup-structured.test.ts | 1b67b726781a1f964c9c0798eb942cf9feb186f8a398d21823310c331498cc0a |
| tests/pdf02-http.test.ts | ceed35fca07b83868359a32e0775c30e13c895ee062fdea055351752f5503707 |

独立初版专项 `node --import tsx --test tests/pdf-cleanup-structured.test.ts` 20/20。后续按真实反例逐次独验，最终 `node --import tsx --test --test-name-pattern='writing' tests/pdf-cleanup-structured.test.ts` 7/7；包含结构标题、时代上下文、元数据、同页粘连页码、表头/线级/人员样本/断行美元及对应错事实反例。施工最终专项25/25、严格范围 tsc 0。初版组合44/45，唯一旧否定断言裸数字命中随机UUID，改事实短语后定向1/1；不宣称最终全部组合重新执行。空 envDir 构建233模块通过；后续仅校验边界接线，复用未受影响构建和UI。全仓旧损坏测试未修，未宣称全仓绿。

第43–47次均为程序对合法整理、解析噪声或引用上下文的误拒；已保存响应逐字经相同 wire 的实际 adapter 和完整生产校验离线回放。未修改响应补字段、未绕业务保护、未重复付费。收入措辞差异另计质量边界，不用归一化全局等同关系符。

真实 Chrome 图文呈现见 [UI报告](PDF01-R2-SYNTHESIS-20261112-ui-builder.md)：合并事实段、不同预测、新增事实、完整多页来源和成果审核均实测；摘要引用串已窄修。图片见 `PDF01-R2-SYNTHESIS-20261112-ui-evidence/01-written-paragraph-and-distinct-forecast.png`、`02-all-source-material.png`、`summary/04-summary-without-citation-text.png`。后续守卫修正不改变这些合法内容的渲染。没有重复整站UI验证。

## 最终真实质量

独立读取最终23个 `maintenance.changes[].candidate.body`，逐项对照原冻结 gold 与已亲看的六页原图。样页1–6对应原4、10、11、59、61、62；不是全62页质量结论。

| 轴 | 分数 | 证据与扣分 |
| --- | ---: | --- |
| 数字/口径准确 | 5 | MAT渠道同比、2026预计724.2亿单/20%、平台22.9%、订单3倍、地域/品类/样本量保持；未见重大错数 |
| 重要信息覆盖 | 5 | 序言实质、方法/样本/时间、渠道范围与新增5亿用户、NIQ自述均保留 |
| 来源追溯 | 5 | 各整理段原页链接、AI来源身份、父依据保留；城市规模合段同时引用原11/62 |
| 推断边界 | 4 | 预测和推断分区、自述归因明确；“平均收入以上”写作“高于平均收入”保留为边界措辞细差，未给精确阈值，不判已证重大范围错误 |
| 噪声清理 | 4 | Logo/独立页码/轴刻度不再成事实候选；仍有仅说明来源或About页面的薄候选 |
| 重复归并/新增保留 | 4 | 城市/区县规模归为一段，保700万商户、1.2亿峰值和5亿用户；研究方法成为可读段。仍有全渠道同比两候选重复、淘宝主体简介与规模段重叠 |

总27/30，关键轴均≥4，无重大否决项。此次达到原门槛，不表示重复完全消失。原始业务材料全部可查，181归属为131 included、35 duplicate、15 metadata；最终23候选、147引用/136不同父依据。未因About整页略去新增事实。抽样没有真实跨页续表，不扩大该项真实质量结论。

## 请求与产物

累计48/50；163105输入+59932输出=223037 tokens，费用未知，剩2未使用。revision5只有42–48七个真实请求，22040输入+7220输出=29260；43–47缓存回放计0。正式 Wiki 写入0。未修改配置或用户原件，无提交推送。实际端点/模型沿用户配置，原响应仅TEMP。

最终 TEMP 根：`C:/Users/David.chen/AppData/Local/Temp/pdf-real-20261110-fefb94ed-dcae-4461-9fcf-698531a3680a/synthesis-replay47-run-tjjRsm`。

- R2：`e53534ec3b0032ef34a4fad6e8e13594cc961dfbbc1cb4ce2f372e688340ee27`。
- 草稿：`56329962e0b00d8f87fb2db2cb711d8193f746a4e3405d0c4e0167f7ad04acd8`，ID `7783e9d3-f2f2-45fa-85d4-5e13c7704081`。
- 累计账本：`8017f12c344cb239466d29fe3478231b00395c8abbbab3ad8402db3b168db4f5`。

完整运行命令、每次usage及冻结在 [执行报告](PDF01-REAL-SYNTHESIS-V5-20261112-execution.md)，工程细节在 [施工报告](PDF01-R2-SYNTHESIS-20261112-builder.md)。

## R3 最小建议（未施工）

收尾现有PDF入口和全过程体验：明确整份/选定范围与完成状态，统一理解→清理→成果审核的进度、失败原因和显式继续；页图/原文/整理依据跳转及返回位置；扫描PDF旧整理入口正确引导。复用既有整体审核、编辑、选中入库和版本门禁，不再造新的写作/清理流程。用TEMP混合/扫描/62页fake做完整App从导入到正式读回、取消/重启/失败继续验证，核用户理解当前处理范围。新增付费调用不在此建议内；真实六页结果作为质量基线。由root协调冻结后才实施。
