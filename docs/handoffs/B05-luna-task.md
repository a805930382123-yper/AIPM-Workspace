# B05 施工交接（2026-10-07）

用户指定 `gpt-6-luna` / `high` 施工，只做 B05，交接后主 Agent 独立验收。先读 status、B05、architecture、coordination；PRD 仅 §17、22–24，acceptance 仅 A18/A22–24、R20/R24，增量 A06/R19。B04确定性缺陷已关闭；真实产品Provider缺配置，继续如实BLOCKED。产品沿用服务端已有API配置；施工模型不是产品模型。

## 交付闭环

1. 在 B04 结构化草稿审核中，对待入库建议提供已有Wiki候选；NFKC/中文大小写规范化后检查标题、别名、分类、标签、内容五维，返回各维匹配及理由/分数，称为可能重复。类别单独命中可低分，不当事实判断。候选必须在创建确认前可见；编辑后重新计算；未明确决策不自动覆盖。
2. 每个建议允许更新已有、创建新页、暂不处理。暂不处理不写该建议；新建仍经人工确认，命中同名/别名时允许用户明确选择创建独立ID（关联歧义照实提示）或改名；普通B04未授权确认保留原冲突门禁。更新跳转预览草稿，保存目标ID及baseRevision。
3. 更新通过既有服务端 Provider 产生结构化预览：现有全文、新来源正文/引用、建议增加、冲突、推断、待确认。旧文保留，以追加可审阅内容方式更新；旧来源、新来源、相反指标公式及出处均保留，不选择一个覆盖另一个。冲突和问题写进正式内容。AI的事实引用必须匹配原Raw；推断单独标记。允许用户编辑预览，保存后刷新/重启仍可继续；取消不改正式Wiki。
4. Raw/Source列表或知识库提供多来源综合入口。用户可选Raw或Source（Source必须映射其真实Raw），按Raw ID去重后至少2来源，输入重复Source/Raw不能充数。读取真实正文，产生单独Synthesis草稿，来源/一致观点/冲突/推断/问题分栏，用户编辑、取消、确认后才写。所有来源Raw可追溯；已有Source复用，缺Source则确认时生成，确认前零正式写入。
5. 确认期间串行Wiki锁内复查草稿revision、target baseRevision、所有Raw存在与hash。过期409无覆盖；确认业务payload持久化，跨幂等key相同payload同operation/IDs/log，变更payload拒绝。Source/Wiki/Index/Log使用prepared持久化清单、冻结ID、atomic写入与恢复；失败准确报告部分提交/可恢复。恢复不能覆盖确认后的人工新编辑，遇到新revision停止并报告冲突。

## 接口与实现边界

复用 `WikiStore.withLock`、`writePageLocked`、`appendLogLocked`、`rebuildIndexLocked` 和 B04 Provider/evidence/schema/提交清单原则，保持旧草稿兼容。可以新增 `services/wiki/knowledge-workflows.ts`、B05 drafts/commits、`services/search/duplicates.ts`、`services/llm/knowledge.ts`、`server/knowledge-api.ts`、B05 UI；按实现需要调整命名。开始编码前向主Agent简短汇报最终API路径与请求字段，确定后统一UI/测试/README。API至少覆盖：读取候选、生成更新预览、生成综合、读取/编辑/放弃草稿、显式确认、读取提交状态。B04审核到更新/新建/暂不处理必须贯通，不只实现独立无入口API。直接confirm API也遵守决策和来源/证据门禁。

产品运行仍只依赖Node/React/文件/服务端Provider；不加入Agent CLI、Codex或外部数据库。产品错误使用中文及机器code；密钥沿用脱敏策略。缺配置明确错误，不能离线模板伪称AI；测试可注入HTTP fake，报告单独标明。长文沿用既有限制，若B05限制更小须明确拒绝，不静默截断。已有B04不可变Raw、默认不选、选中Source摘要、证据定位、秘密脱敏、幂等与恢复保持。

## 文件归属与验收

施工者：本批产品代码/rules/必要README/相关单测，施工证据 `docs/reports/B05-build*`、隔离fixtures（标测试）。主Agent：status/B05卡/此交接、`tests/acceptance/b05-*`、`docs/reports/B05-acceptance*`/浏览器证据。历史报告和验收脚本保留，正式 `workspace` 不操作；使用显式临时 FMCG_DATA_DIR 与空闲端口。运行旧 npm test 会重写 `B04-http-evidence.json`、`B04-repair3-merge-payload.json`；主Agent会归档原件，施工者输出归档为B05-build前缀，勿改历史独立报告。

主Agent逐项实际检验：

- E05-01 五维各独立fixture，包括中文别名/Unicode；分数理由可见；候选误报低分和无候选样本。
- E05-02 B04建议完整三决策；更新/新建不同后果，暂不处理零建议落盘；没有授权不更新。
- E05-03 两来源补充/相反指标公式；五栏预览可读，编辑/取消/确认；确认前旧页hash不变，确认后两公式与全部来源/问题保留，Rawhash不变。
- E05-04 旧revision拒绝409；草稿过期、无效ID/来源/evidence也拒绝；无正式副作用。
- E05-05 两Raw、两个Source、混合来源综合；重复来源与少于2拒绝；一致/冲突/问题/来源及推断存储区分。
- E05-06 幂等重试、刷新与同目录重启；Index/Log一致；真实磁盘故障、恢复同ID，不覆盖人工编辑。
- E05-07 实际浏览器入口→候选/三决策→更新/综合编辑保存取消确认→刷新持久化；孤立接口和jsdom不代替浏览器。
- E05-08 build/必要单测及受影响B04回归；真实产品Provider成功与质量若无配置记录BLOCKED，fake不能签该项PASS。

结束交接：变更文件、最终API与schema、操作入口、已运行命令/结果、测试数据目录/自身进程清理、限制/未完成和风险；写 `docs/reports/B05-build.md`。不得自行给整批PASS或启动B06；有接口歧义向主Agent发消息，完成独立工作继续推进。
