# RAWEDIT02 独立验收（2026-11-14）

**本轮缺陷关闭 PASS；RAWEDIT02 整体 PASS。** 用户可从 Raw 详情人工编辑正文、保存或取消、查看修改前正文。AI 仍不得改写 Raw。此次通过仅覆盖[冻结任务卡](../handoffs/RAWEDIT02-20261114-task.md)，不表示全仓和历史批次全通过。

## 身份、版本与范围

评分需求0/耦合2/风险2/历史失败0，总4，来源完整性重大风险直接B。Astra Medium `/root/rawbody_lead` 规划和独立验收；真实创建 Sol High `/root/rawbody_lead/builder` 施工。两者不同实例，验收者未修改产品。施工交接停写后，验收者审核实际增量和脚本，在两个全新TEMP执行公开HTTP及完整App Chrome，未复用施工数据。

HEAD `8264aba50b58be6c415be0124499a8977f3197fb` 加未提交工作树；无本轮提交。17项开工基线中12产品文件变化、5不变，新增3验收脚本。RawOutcomeReview仅增加失效暂缓草稿结束入口及旧引用SHA修正，RAWEDIT01成果编辑保留；StructuredNoteEditor完全不变。产品与脚本20项最终SHA逐项符合施工冻结，17项验收前后不变，见[增量对照](RAWEDIT02-20261114-review-evidence/baseline-diff.json)、[最终指纹](RAWEDIT02-20261114-review-evidence/final-sha.json)。最终指纹清单文件SHA：`2b4379b473dd61881a123ce5d074e51137ab6bcabc5022cf138a9efbdcbbc633`。

## 独立实测

| 冻结项 | 结论及证据 |
| --- | --- |
| 人工保存与历史 | PASS。公开PATCH保存空格/换行/分隔符/emoji原样正文，ID、导入时间、来源与原件元数据不变；旧完整Markdown原字节保留，GET历史与原记录一致。无变化不新增版本。真实快照目录写失败和不一致历史均保原文、不覆盖旧证据。 |
| 并发及输入边界 | PASS。两个旧版本并发仅一成功；过期请求409；改回原SHA后旧revision仍409。空正文、超长、孤立代理字符、缺失/非法版本、元数据注入、导入伪造人工修订字段均拒绝。Chrome 503与409保输入，读取最新原文后须显式核对再保存。 |
| 原件与来源 | PASS。PDF公开original入口200且逐字节与原件相同；TXT本地原文件逐字节不变、关联不变。PDF编辑明确区分人工提取文字与原文件，旧页位置/图片派生/理解/清理/按页草稿不能继续当当前证据，即使改回同字节。会议登记Raw403且原文与origin不变；普通meeting可编辑。 |
| 旧派生失效 | PASS。旧草稿preview失效且确认RAW_CHANGED；旧提取检查点409且文件不变；旧译文拒复用；公开问答引用原先成功、编辑后409。Chrome旧成果原句即使同位置保留同文字也不误标，使用草稿原SHA。旧暂缓草稿可两步显式结束，取消结束仍保留，随后恢复当前文本整理入口。 |
| 运行中与正式库 | PASS。实际启动提取与PDF页理解，运行中编辑409；取消后可编辑。启动/编辑/确认复用现有Wiki锁，未增加调度平台。所有正文保存不调用模型，不改变已有正式Wiki。HTTP两次fake请求仅为测试显式维持在途任务；浏览器编辑阶段模型调用0、外网0。 |
| 完整App与检查 | PASS。实际Chrome6/6，包含取消零写、预填原文、503/409恢复、PATCH成功后父GET503仍显示新版本、刷新读回、历史查看、PDF原件入口、翻译和两类会议。空env构建233模块、独立严格tsc退出0、受影响核心UI/维护回归11/11。 |

独立命令（输出均在 review-evidence）：

```text
node --import tsx tests/acceptance/rawedit02-http.mjs docs/reports/RAWEDIT02-20261114-review-evidence
node --import tsx tests/acceptance/rawedit02-browser.mjs docs/reports/RAWEDIT02-20261114-review-evidence
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --resolveJsonModule --isolatedModules --jsx react-jsx --strict --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --skipLibCheck --types vite/client,node app/main.tsx server/index.ts vite.config.ts tests/rawedit01-ui.test.tsx
node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawedit01-ui.test.tsx tests/pdf02-ui.test.tsx tests/lw01-maintenance.test.ts
```

四条退出0。[HTTP 7/7与清理](RAWEDIT02-20261114-review-evidence/http-result.json)、[Chrome 6/6与清理](RAWEDIT02-20261114-review-evidence/browser-result.json)、[HTTP stdout](RAWEDIT02-20261114-review-evidence/http.stdout.log)、[浏览器与构建stdout](RAWEDIT02-20261114-review-evidence/browser.stdout.log)、[严格类型stdout](RAWEDIT02-20261114-review-evidence/tsc.stdout.log)、[11/11回归stdout](RAWEDIT02-20261114-review-evidence/regression.stdout.log)。核心回归Node计时2907.9989毫秒。空env构建由浏览器脚本显式 `configFile:false`、空envDir执行，无真实配置读取。

亲看独立四图：[编辑原文](RAWEDIT02-20261114-review-evidence/01-original-editor.png)、[导入原文历史](RAWEDIT02-20261114-review-evidence/02-original-history.png)、[冲突保留与核对](RAWEDIT02-20261114-review-evidence/03-conflict-preserves-text.png)、[PDF原件和人工文字区别](RAWEDIT02-20261114-review-evidence/04-pdf-original-remains-readable.png)。入口清楚，字段、历史及冲突核对内容可读，保存/取消操作可见。保持现有样式。

## 复用与限制

复用同版施工[50/50受影响回归](RAWEDIT02-20261114-builder-evidence/regression.targeted.stdout.log)，已核对原始日志与最终指纹，包含PDF02 HTTP8项和Raw、完整性、会议来源、导航；独验另跑其中核心11项，不把重叠项相加冒称更多独立场景。施工[报告](RAWEDIT02-20261114-builder.md)保留首轮脚本错误和旧测试损坏记录。

旧 tests/lw01-raw-ui.test.tsx 已知首字符损坏；本轮探索回归另发现 tests/rawzh01-ui.test.tsx 同样1:0不可解析，均未修改，未跑全仓、不宣称全仓绿。正在清理的PDF和未完成确认分支本轮仅代码检查既有锁/状态门禁，未另做故障注入；当前原子替换失败后的重试沿用现有文件原子写实现，实测的失败注入覆盖历史写入失败与历史碰撞。不扩为通用事务或版本平台。

PDF人工修订后旧按页链不适用，仍可打开完整原PDF；结束失效草稿后可显式按当前文字整理。普通TXT/DOCX原本没有下载HTTP，本批未新增。历史仅查看，不提供回滚按钮。正式Wiki不会自动跟着改文；需用户后续明确处理。模型质量不属于本批，没有真实模型调用。

独立HTTP TEMP `rawedit02-cD1zL0`，API61178/fake61177；Chrome TEMP `rawedit02-2eckwy`，API54849/UI50854。API进程均退出、fake/预留端口/UI/Chrome关闭，脚本末尾验证API健康已不可连接。正式workspace、真实配置、用户5151/5173及62页38主题草稿未操作。原有未提交改动和旧删除证据保留，未提交、推送、部署。

本轮新发现的失效暂缓阻塞和旧引用SHA误绑已修复并独立实测关闭；RAWEDIT02全部必选标准满足。停止本批，不启动下一批。待用户业务决策：无。

运行交付限制：用户当前API/UI服务未重启，本轮有后端变更，需要API进程加载新代码后才能使用。未核验其是否启用watch，不能宣称当前运行后端已热更新。独立临时实例已经实测新代码，最终主线程应明确提示此差别，不擅自重启用户服务。
