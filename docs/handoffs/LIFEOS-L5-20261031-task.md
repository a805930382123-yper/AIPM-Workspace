# LIFEOS L5：Prompt使用反馈（2026-10-31）

## 授权与职责

用户已明确需要并授权[方案阶段5](../batches/LIFEOS-optimization-plan-20261031.md)，需求触发满足；完成本卡、必要验证与独立验收后提交同步即停，不推进阶段6。基线 `67e136268b1eaf1b63b3baa868f6a69e00296a6d`，L4整体工程PASS沿[状态](../status.md)及其报告，不扩大历史质量结论。

评分需求0/耦合2/风险2/历史失败0=4，因新增持久用户数据涉及Prompt版本、删除回收与备份兼容的完整性风险，直接B。Astra /root/lifeos_planner规划并在施工停写后最终独立验收；Sol High /root/lifeos_reviewer本批施工（虽曾验收L4，本批不自验）；主线程协调、版本绑定及统一提交。施工与验收不同实例。

本轮不读取真实配置/.env/正式workspace、不调用真实Provider。隔离真实stores/API/App和虚构数据；Provider/config探针应为0。历史预算沿用：知识287/500、Prompt20/24、KB03 24/30，仅报告值、不新核账、不消耗。本轮反馈不自动外发、调用Optimizer、学习偏好、改Prompt或生成新版本。

## 现有实现与存储决策

`services/prompt/store.ts`当前单个`prompts/<id>.json`持有current、全部versions不可变快照、creation及可选aiConfirmations；update和AI追加版本使用...record保留顶层字段，delete在同一串行队列中rename整个文件到`prompts/recycle/<id>.json`。Prompt计数仅合法顶层UUID文件。`scripts/backup_workspace.ts` v1白名单包含prompts且递归备份，已覆盖回收文件。PromptLibraryPage当前/历史版本分离并有选择世代保护。

冻结为PromptFile顶层新增可选`feedback`，与current/versions并列，**不放入Prompt或PromptVersion.snapshot**。复用现有PromptStore串行队列和writeJsonAtomic，单文件保存，不新建跨文件事务/索引/数据库/恢复引擎。旧文件缺字段等同空，GET不补字段、不迁移写盘。后续保存Prompt、收藏、AI新版本、旧请求重读均保留feedback；反馈CRUD不得修改current/versions/creation/aiConfirmations或Prompt更新时间。

反馈读取/写入在自己的边界校验一次，坏feedback返回明确FEEDBACK_CORRUPT且原字节不覆盖，不伪装无记录；不因可选反馈损坏就把本来有效的Prompt从计数/列表消失，不扩大isRecord使附属数据损坏污染Prompt有效性。普通Prompt更新保留不透明feedback原值，不擅自修复；首次无字段仅显式创建反馈时增加。

## 最小schema与规则

`feedback = { schemaVersion: 1, items: Feedback[], deletedIds: string[] }`。deletedIds只留已删除反馈UUID，用于阻止网络重放复活；不保留已删除内容，不引入通用审计日志。

`Feedback`字段：

- `id`：客户端新表单会话生成UUID，兼作创建重试键；`promptId`：所属文件ID；`promptVersion`：正整数，必须存在于versions快照。
- `usedOn`：真实合法YYYY-MM-DD，用户选使用日期；初始值按Asia/Shanghai今天，不伪造使用事实，允许用户改。`scenario`：非空修剪后最多200字符。
- `outcome`：helpful / needs_revision / not_applicable / unverified，对应“有帮助/需较多修改/不适用/尚未验证”。默认unverified，不转分数。
- `observation`：具体问题或有效部分，允许空，最多4000字符；`nextImprovement`：下次改进建议，允许空，最多4000字符。
- `revision`：从1开始的反馈编辑版本；`createdAt`/`updatedAt`服务端ISO时间；`creationHash`：服务端对首次规范化业务输入（包括promptId/promptVersion）生成SHA256，用于创建重试一致性，不外发也不作为效果指标。

ID、promptId、promptVersion、createdAt、creationHash创建后不可修改；编辑只改日期/场景/效果/两段文本，并要求baseRevision。版本选择错误时明确删除后重建，不偷偷挪归属。保存相同编辑内容为no-op，不增revision/时间。创建验证目标版本存在，不强制必须是当前最新版；用户查看历史版本也能记录“该版本的反馈”，历史Prompt内容仍只读。

重复提交：同ID+同首次输入返回同一已有反馈（当前编辑状态）并标reused，不产生第二条；同ID不同首次输入409。已删除ID再次POST返回410，不复活；DELETE重复请求返回成功且不重复写，编辑/创建不存在Prompt或已回收Prompt返回404/410。不存在反馈的删除可幂等成功；合法已存在反馈删除需匹配baseRevision，冲突409不删。删除实际移除item文本并加入deletedIds，同文件原子写。

更新反馈过期revision返回409并保留用户输入，提示刷新；不自动覆盖。只使用现有单进程串行语义，不为未要求的多进程部署加锁框架。普通原子写失败必须明确失败、原Prompt/反馈文件完整可读，不能在UI伪称已保存。

## API、删除与导出

复用PromptStore装配实例，`server/prompt-api.ts`增加以下窄路由，明确保存才写：

- GET `/api/prompts/:id/feedback`：返回全部有效反馈（updatedAt降序，ID稳定次序），可接受version正整数过滤；缺feedback为空。DTO不暴露creationHash/deletedIds。
- POST同路径：接受id、promptVersion、usedOn/scenario/outcome/observation/nextImprovement，promptId由路由确定；201新建/200重用。
- PUT `/api/prompts/:id/feedback/:feedbackId`：baseRevision及可编辑字段；拒绝不可变字段/未知字段。
- DELETE同item路径：baseRevision；删除规则如上。
- GET `/api/prompts/:id/feedback/export`：只读下载JSON，`schemaVersion:1,promptId,items`，各item保留稳定ID/使用版本及日期/效果/文本/修订时间；不包含内部creationHash/deletedIds。UI明确“导出使用反馈（全部版本）”。这是可读数据导出，**不是恢复归档**，不新增导入接口。

原Prompt Markdown导出内容保持，不自动夹带个人反馈；完整恢复使用既有workspace备份。删除Prompt仍原rename，反馈随文件进入同回收路径，版本归属不丢，不做级联永久删除；Library不再展示或编辑已回收对象，反馈API不访问回收文件。删除确认文案补充“使用反馈随Prompt进入回收区，备份会保留”，不能谎称永久清除。不新增回收管理UI或单独还原接口。

备份恢复v1原格式/白名单无需改变：实际备份含active与recycled的反馈及全部Prompt快照，恢复到全新隔离root后字节一致；旧无feedback归档仍可读且不自动改盘。回收Prompt恢复归档后仍在recycle，不自动复活。直接旧版本应用写入新feedback文件的降级兼容未授权，不宣称支持。

## UI最小交互

当前Prompt详情与历史版本详情附近新增“使用反馈 · 第N版”区域。空状态“该版本尚无使用反馈”，点击“记录使用反馈”后显示使用日期、场景、效果、问题/有效部分、下次建议；明确显示绑定Prompt名称/第N版。支持查看、编辑、明确删除，表单保存中禁止重复操作，错误保留输入；取消不写盘。当前/历史切换只显示对应版本反馈，当前版本变化不重绑既有记录。

创建表单绑定打开时的id/version；切换Prompt或历史版本后关掉旧表单并使旧请求响应失效，不能将A反馈显示为B反馈，也不能把旧保存成功提示贴到新对象。延迟成功可落盘到原绑定对象，不能写新对象。刷新/重启通过持久化读回，读取失败显示错误而非空。导出全部版本按钮与版本列表区清楚区分。

记录改进建议仅存文字，本轮不增加“自动优化/发送反馈/生成新版本”。不改知识库搜索、日志、首页行动事项或周期回顾；反馈数量不计入Prompt数量。沿既有Operate布局、prompt.css与可访问表单样式；impeccable context已加载，编辑前craft-floor、最后detect一次；桌面1440/1024实际核布局与键盘焦点。

## 文件所有权

Sol施工：`services/prompt/store.ts`（字段/窄CRUD/导出）、可选新增`services/prompt/feedback.ts`（有独立职责的schema及边界验证，不造通用框架）、`server/prompt-api.ts`、`app/api.ts`、`app/pages/PromptLibraryPage.tsx`、可选新增`app/components/PromptFeedback.tsx`（当前和历史两处复用）、`app/prompt.css`、新增`tests/lifeos-l5-feedback.test.ts`、`tests/lifeos-l5-feedback-ui.test.tsx`、`tests/lifeos-l5-backup.test.ts`、`scripts/lifeos-l5-isolated.ts`、`docs/reports/LIFEOS-L5-20261031-builder.md`。备份实现/统计实现原则不改，必要变动先给证据由主线程裁决。已有测试断言不放宽。

Astra验收独占新增`tests/acceptance/lifeos-l5-browser.mjs`与`docs/reports/LIFEOS-L5-20261031-review.md`，不改产品。主线程状态/交付记录及提交同步。他人四文件前后SHA保持且不纳入提交：AGENTS.md、docs/reports/B04-http-evidence.json、docs/reports/KB02-R1-20261015-builder-merge.json、docs/reports/AGENT-ROUTER-20261023-packaging.md。共享工作区不回退别人修改。

## 冻结验收 L5-01–03

- **L5-01 版本/CRUD/完整性**：真实隔离PromptStore/API创建Prompt v1及v2，各存反馈；升级v3后重启store/服务，原反馈仍归v1/v2。覆盖正常新增编辑删除、同ID同输入重复、同ID异输入冲突、删除后旧POST410、删除重放、旧revision409、无变化编辑no-op、缺版本拒绝、immutable字段拒绝、坏feedback显错不改盘。比较反馈CRUD前后current/versions/creation/aiConfirmations语义SHA及Prompt updatedAt完全不变。核手动update、favorite更新、AI confirm version、创建重放不丢feedback（AI确认可用既有store方法+虚构输入，不调用模型）。注入一次实际原子写失败，原文件仍完整、响应非成功、UI保留输入。浏览器实际完成当前/历史两版本创建、查看、编辑、删除、刷新/重启读回，切换Prompt/版本迟到响应隔离。
- **L5-02 删除/备份/导出兼容**：active Prompt带两版本反馈，另一个带反馈Prompt执行原delete，核回收文件保留全部历史和反馈；反馈HTTP不再接受回收对象。使用真实exportWorkspace/restoreWorkspace到全新root，比对active/recycle文件字节、反馈ID/version/文本及Prompt历史，重启后active可读，回收不复活。旧无feedback文件/归档GET前后SHA不变且可正常创建反馈。反馈JSON导出含全部版本正确字段、排除已删内容和内部字段；原Prompt Markdown导出不混入反馈且与未修改模板一致。实际浏览器点下载核下载内容，备份恢复可由真实脚本取证并浏览器打开恢复root补读。
- **L5-03 无污染/无外发**：同一隔离库CRUD前后Prompt数量、Wiki数量与搜索结果、knowledge日志文件集合/字节均一致，Prompt版本不变；删除Prompt的数量减少仅由原delete产生，不归为反馈污染。Provider/config工厂设计数/抛错探针，浏览器记录/编辑/删除/导出反馈全程0调用，业务写仅目标Prompt文件；读列表/导出不写。明确用户反馈/效果选项，不展示自动评分/AI质量结论/自动保存新版本。

建议必要验证：

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l5-feedback.test.ts tests/lifeos-l5-feedback-ui.test.tsx tests/lifeos-l5-backup.test.ts tests/prompt.test.ts tests/prompt-ui.test.tsx
npx tsc -b
```

Prompt AI确认保全按受影响方法跑必要定向回归，报告精确命令；build用空envDir，不读.env。隔离harness复用L4模式完整React App/真实Prompt API与stores，无真实配置加载器/网络，输出root/url/api/fixture IDs/计数，支持--root重启不重seed。实际Chrome/Playwright已可用，JSDOM不替代真实浏览器；保存真实截图与下载、恢复证据，绑定受验文件SHA。测试只覆盖本轮与真实风险，不扩大无关全仓。

## 交接与裁决

Sol交付实际命令/结果、版本/文件SHA、schema及所有写路径保全证据、四保护文件SHA、调用计数、未测项后停写。Astra独立复核和实际验证，不以Sol自查签收，分别给本轮缺陷关闭与L5整体结论；三项必选全部通过才整体PASS。未测/环境缺口明确BLOCKED，实际FAIL留证返修；不得以局部CRUD通过掩盖恢复/版本问题。必要范围内返修后独立复验，完成主线程统一提交推送核远端一致即停，不推进阶段6。
