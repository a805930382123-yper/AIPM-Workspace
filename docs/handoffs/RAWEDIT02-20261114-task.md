# RAWEDIT02 人工编辑 Raw 原文

2026-11-14；用户明确要求可编辑 Raw 原始正文。覆盖旧“正文不可变”的人工操作限制，AI 仍只读。HEAD 8264aba50b58be6c415be0124499a8977f3197fb + 当前工作树，增量基线见同名前缀 baseline.json/目录。大量既有未提交工作保留，不提交、推送、部署。

评分：需求0、耦合2、完整性风险2、历史失败0，总4但重大来源完整性直接B。Astra /root/rawbody_lead 规划和独验，不改产品；Sol High 独立实例施工，工具创建结果另记。

## 冻结范围和接口

- Raw 详情明确“编辑原文”，只改 body；保存/取消/错误保输入，成功按返回 Raw 更新展示和父缓存。标题/来源/元数据不编辑，无模型调用，无正式 Wiki 写入。
- 保存需 expectedBodySha256（可再加简单单调版本防ABA），服务端对当前版本比较并返回409；编辑/删除/正式确认在既有 Wiki 写锁协调。保存前持久化完整旧Raw快照，可从普通UI查看修改前正文，保持ID、importedAt、来源、原件。快照成功后才原子替换当前文件；无变化不制造修订。
- 新人工修订元信息由服务端产生，普通导入拒绝注入。请求只接收正文和预期版本。会议桥 origin Raw 禁止编辑且说明从会议档案工作副本处理；普通 meeting 分类可编辑。不能清洗origin或修改原件SHA。
- PDF只编辑提取文本，PDF原件字节不变，旧页offset/页图AI证据不能冒充新正文。原件仍可读；修订后明确说明文本与原件不同，旧页派生/清理/草稿不可继续当成当前证据；最小禁止不适用的PDF文字页链即可，不重建页映射、不自动重跑模型。
- 复用现有bodySHA门禁：旧草稿确认拒绝、检查点不兼容、翻译不作为新正文展示、问答引用版本不匹配提示。保存展示来源变化提示，已有正式Wiki保持原样，不展开全库语义维护。
- 禁止付费模型、正式workspace或真实配置/.env读写；全部TEMP/fake。保留用户5151/5173服务、62页38主题草稿。旧全仓损坏测试单列、不修。

## 文件所有权

施工：services/raw/store.ts、server/index.ts、server/validation.ts、app/api.ts、app/pages/RawPage.tsx；必要的PDF来源门禁 services/raw/pdf-pages.ts/app/PdfPages.tsx；新 tests/rawedit02-* 和 tests/acceptance/rawedit02-*，施工报告/证据。其余最小必要文件先报告依据获得协调者范围裁决，已有RawOutcomeReview/StructuredNoteEditor不改。共享工作区，不覆盖其他工作。

规划/验收：本任务卡/基线、独验报告证据、docs/status.md、docs/agent-control.md、docs/architecture.md最小新增说明。施工交接后停写。

施工前最小扩展已批准：app/App.tsx 仅保存成功后的父缓存更新回调与既有世代协调；server/raw-pdf.ts 与 services/raw/pdf-cleanup.ts 仅 PDF 启动共用现有 Wiki 锁/运行状态查询，防止运行中原文变化。施工者改前追加三文件基线。接口冻结 PATCH /api/raw/:id/body {body,expectedBodySha256,expectedBodyRevision}，旧记录版本0；GET /api/raw/:id/body-history/:revision 查看完整修改前记录；knowledge/raw/history/<id>/<旧版本>.md 保留修改前原字节。单调正文版本用于避免回改原文后旧编辑窗口覆盖。

边界澄清：原件下载验收覆盖现有 PDF original HTTP入口；普通TXT/DOCX暂无下载API，不为本批新建，按原文件字节和关联实测。批准 services/wiki/commits.ts、server/llm-api.ts 最小人工修订PDF草稿预览/确认门禁，禁止其当作当前页证据继续写入；即使人工恢复同字节，PDF修订标记仍要求区别文字与原件。普通文本恢复完全相同字节可复用既有SHA证据语义，编辑窗口仍用bodyRevision防ABA。已完成幂等结果只读返回不重写。

首轮自查后的实际缺口：旧 deferred 草稿在正文变化后 deferAvailable=false，继续/放弃都被界面禁用；成果原句跳转曾采用当前Raw SHA，可能把旧引用冒充新版本。批准 app/pages/RawOutcomeReview.tsx 两处必要增量：失效且稍后处理的成果可显式放弃、仍不能确认；引用跳转使用服务端暴露的真实草稿 rawSha256。只修上述行为，保留RAWEDIT01所有成果编辑；增加定点回归并再冻结。该文件开工基线已保存。

## 必选验收

1. 真实HTTP编辑成功、稳定身份和元数据、历史完整可查；取消0写；无变化0新增；两并发旧版本只有一成功，失败保输入；非法/超长/系统字段拒绝。
2. 原件SHA/字节不变；PDF修改文本成功，页链及旧PDF草稿不能误复用；普通原件下载仍成功。
3. 已有草稿旧SHA无法正式确认，审核或提取旧检查点拒绝/明确失效；翻译及问答引用不静默错绑；保存不自动AI、不改正式库。检查活跃提取和commit的实际并发边界，必要时拒绝编辑以保一致。
4. 会议来源最小限制和来源身份保持；旧普通meeting仍可编辑。
5. 实际Chrome完整App：编辑/取消/保存/刷新/查看旧原文、409/失败保输入/重试、PDF区别、旧成果提示。独立验收亲看截图；无外网或真实模型。
6. 范围严格tsc、空env构建、受影响既有回归；每个实际命令与stdout存证，记录最终SHA，临时服务全部清理。全仓旧失败不算本批成功。

施工交接后由Astra独立检查实际增量并执行核心HTTP/UI；局部缺陷关闭与本批整体分别裁决。不推进下一批。
