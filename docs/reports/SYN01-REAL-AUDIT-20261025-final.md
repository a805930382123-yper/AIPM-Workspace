# SYN01 真实双来源综合独立裁决

2026-10-25，Astra medium，B 模式。**R03 模型原稿 FAIL；SYN01 真实闭环 FAIL；R04 未执行；全产品/B09仍未通过。** R01/R02 新增工程沿用独立工程 PASS，本轮没有产品修复，不能声称缺陷已修复。真实失败已按卡停止，不重试、不换样本、不以人工补字段或改引用掩盖原稿失败。

受测产品提交 `60f83adba102d887fcd925df13a8021ff7669de1`；本轮工程交付/实际 HEAD `d09fd7b16bb26c36c4d2d066d1eb683c6f21a4ba`。独立者只读脱敏证据、必要源码及固定 oracle，执行一次离线结构/引用核验；未读配置或私有 response，未调用模型、复跑工程测试或修改产品。

## 证据与直接原因

- [脱敏导出](SYN01-REAL-20261025-export-1792936917825.json)，SHA256 `17b8eb6db27db107f01cca85addbf56c7f476d977a44682530b1beffeca21978`。会话 `08b79756-cdb8-4b91-88a6-1dedb5804126`，隔离根 `.scratch-SYN01-REAL-20261025-c8B9EE`。
- [Chrome失败截图](SYN01-REAL-MAIN-20261025-chrome-failure.png)：独立查看可见两来源勾选、`LLM_SCHEMA_INVALID`，停留在 Raw 多来源选择界面。主 Agent 报告只单击生成一次，未进入审核页。
- [此前独立工程证据](SYN01-REAL-AUDIT-20261025-acceptance.md)继续有效，其当时 Chrome 阻塞/真实未运行结论由本报告的真实失败证据更新；测试结果不冒称本轮重跑。

导出显示真实调用1、fake0、配置读取1、知识242/500、Prompt15/24，Provider为 `open.bigmodel.cn / GLM-5.3-Flash`。不可变 attempt 保留 `pending-counts-if-unknown` 预占记录，独立 result 为 `failed / LLM_SCHEMA_INVALID`；不得据预占状态误认为仍可再次尝试。response 为合法 JSON、finishReason为stop，但缺少必填 `suggestedAdditions`。

生产 `services/wiki/knowledge-workflows.ts:208` 首先校验 `suggestedAdditions` 等五个数组；缺字段必然在此产生 `LLM_SCHEMA_INVALID`。所以本次直接原因是模型未履行输出结构契约，尚未进入标题/分类和引用校验。未另行核验 category 是否在 schema 中，不推测其他运行时错误。

## 原稿与 oracle 逐项对照

| 项目 | 独立结论 |
|---|---|
| 两来源与 Raw 保真 | 两独立 ID 均在请求和原稿出现；导出两正文与 fixture 完全相同，重新计算 SHA256 均等于记录值。 |
| 共同值 | 文本保留2026年9月、虚构清禾区域、100家、在售/目标门店计算公式，两来源分别列证。 |
| 冲突 | 保留A的20家/20%及B的30家/30%，未平均或静默覆盖。两条冲突文字均陈述双方，各自引用对应单方原文；集合保留双方，但单条引用不独立支持复合句全部断言。 |
| 未知与未来 | 负责人未知、采样日是否一致未知进入openQuestions；AI仅未来建议、未上线、收益未知保留在agreement。 |
| 推断 | 20/100与30/100自洽、可能统计时点不同放入inferences，且明确采样日未确认；没有把可能原因写成已证实事实。 |
| 结构 | FAIL：缺少suggestedAdditions；因此没有合法综合草稿可审查。 |
| 引用定位 | FAIL：8条quote文本均能在对应Raw找到，但8/8的end均比UTF-16左闭右开正确值少1，全部不满足body.slice(start,end)===quote。 |

引用核验详情（每节索引从0开始）：

| 原稿字段 | 来源 | 输出[start,end) | 原文实际[start,end) |
|---|---|---|---|
| agreement[0] | A | [0,22) | [0,23) |
| agreement[1] | B | [0,22) | [0,23) |
| agreement[2] | A | [43,61) | [43,62) |
| agreement[3] | B | [43,61) | [43,62) |
| agreement[4] | A | [74,98) | [74,99) |
| agreement[5] | B | [79,103) | [79,104) |
| conflicts[0] | A | [23,42) | [23,43) |
| conflicts[1] | B | [23,42) | [23,43) |

以上引用问题来自原稿离线核验，不冒称运行时已走到EVIDENCE_INVALID。原稿部分语义正确不能抵消结构与证据契约失败。

## 实际核验命令和结果

执行 `Get-Content services/wiki/knowledge-workflows.ts | Select-Object -Skip 159 -First 113` 读取上述生产校验顺序；`git rev-parse HEAD` 返回本报告工程提交。一次离线核验实际通过 PowerShell here-string 管道送入 `node`，脚本如下；exit0表示核验完成，输出明确显示质量失败，不是产品测试PASS。

```javascript
const fs=require('fs'),crypto=require('crypto');
const p='docs/reports/SYN01-REAL-20261025-export-1792936917825.json'; const exp=JSON.parse(fs.readFileSync(p,'utf8'));const out=JSON.parse(exp.artifacts.response.text);const fixture=JSON.parse(fs.readFileSync('tests/acceptance/SYN01-PREP-20261025-fixtures.json','utf8'));
console.log(JSON.stringify({exportSha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),missing:['title','category','agreement','conflicts','inferences','openQuestions','suggestedAdditions'].filter(x=>!(x in out)),raws:exp.raws.map(r=>({id:r.id,fixtureEqual:fixture.raws.some(f=>f.title===r.title&&f.body===r.body),shaMatches:crypto.createHash('sha256').update(r.body).digest('hex')===r.bodySha256})),evidence:['agreement','conflicts'].flatMap(s=>out[s].map((e,i)=>{const raw=exp.raws.find(r=>r.id===e.rawId);const pos=raw.body.indexOf(e.quote);return {section:s,index:i,rawId:e.rawId,start:e.start,end:e.end,quoteLength:e.quote.length,sliceEqual:raw.body.slice(e.start,e.end)===e.quote,actualStart:pos,actualEnd:pos+e.quote.length}}))},null,2));
```

## 人工审核、闭环与收尾

人工修改：**NOT_RUN**，无人工改写、保存、明确确认；不存在人工纠正后版本可评PASS。导出wiki为空，主Agent报告未产生candidate。R04正式Source/综合页确认、刷新回读与真实幂等均未执行；既有fake工程不能替代真实闭环。Raw保真在导出与固定fixture对照中成立。

局部结论：已有R01/R02接线工程PASS；此次真实样本结构和引用契约FAIL，未进行返修，缺陷未关闭。整体结论：SYN01闭环FAIL，A18/R20及R07综合实测缺口未关闭，全产品/B09继续未通过，其他历史阻塞不变。

主Agent报告Chrome标签已关闭、控制入口stop返回closing:true、服务session73976最终exit0；这些收尾操作由主Agent执行，独立者未重复启动或探测服务。R05最终范围检查、提交和远端一致核对仍由主Agent负责。

现有证据足够定位并交付失败，不需追加检查或真实调用。下一步建议仅以本次固定输入/输出做零调用的结构与引用契约修复准备，另行明确范围后施工；本报告不授权产品修改、自动补JSON、重写原稿或外发重试。知识预算停在242/500，Prompt15/24不变。
