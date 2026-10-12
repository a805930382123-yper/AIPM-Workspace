# B06 Luna High 施工契约

用户已授权本批；施工者gpt-6-luna/high，验收者为主Agent。先读status、B06任务卡、architecture/coordination、acceptance的A25–34/R25–29；PRD只读§25–29、53。B04/B05确定性PASS、真实Provider BLOCKED保留，本批结束不推进B07。

## 交付与接口

实现services/audit、只读Lint、对应server/API与Wiki/Home UI，复用产品已有OpenAI-compatible服务端Provider与Wiki写入路径。以下为逻辑接口，可按现有风格组织，开始实现后先回传冻结的URL与请求/响应形状供独立验收使用。

- Audit create/list/get：整页或段落、四类severity（error/warning/suggestion/supplement）、comment必填，UUID、Wiki ID、创建revision、before/text/after三段anchor、created/status/open及不可丢失决议历史。整页明确范围。段落anchor由实际正文验证，不信任虚构文本；偏移按JS字符记录，定位靠三段文本而非行号。
- 定位：原文唯一精确匹配可重定位；上下文可区分重复文本。多处无法唯一判定、目标删除/改写、整页正文变动均返回不确定，阻止生成/接受写入并提示人工重新定位；提供显式重定位操作，保留原anchor历史。不得使用首次substring命中冒充可靠定位。
- propose：读当前Wiki、有效对应Raw全文及反馈，经产品Provider生成结构化replacement/rationale/evidence草稿。保存Wiki revision、实际Raw正文SHA、引用；未确认不改Wiki。失败503/502等可见，无假成功。草稿保存/编辑/放弃/刷新重启恢复。
- resolve：accepted/partial需要明确用户确认、有效草稿和对应版本；替换定位到的片段，整页则替换明确正文；用户partial编辑需有实际预览，保留其余正文和metadata/source及历史。rejected必需理由、resolved且零Wiki改写；deferred留理由/历史、保持open。过期Audit/draft/Wiki版本409；已完成重复提交幂等；失败后保留operation证据且可恢复，不因Index/Log失败错误标resolved。保持单次Wiki revision/Log与Audit状态一致。
- Lint：扫描磁盘真实wiki文件，不经list过滤损坏页面；11类结果具code、对象ID/文件、可读原因和定位。坏链（不存在/歧义）；孤儿定义冻结为无有效入链或出链的非Source页（Source不算孤儿）；Index缺失含页面未被Index收录；Frontmatter缺失；Source缺失（sources无效/空、引用Raw不存在）；knowledge_status/confidence/source_level缺失；无来源事实（source_supported/verified却无有效Raw，或显式“来源事实”节存在无可定位来源的事实）；open Audit；规范化重复标题。只读，不修复或重建Index，不吞掉损坏文件。冻结具体codes/定义在规则与施工报告。
- 首页Open Audit为实际open数量，最近变更来自真实知识操作日志；Wiki提供整页/段落纠错、列表、定位状态、AI提议与四决议审核；UI可实际运行Lint并定位结果。手动纠错/reject/defer/Lint无Provider可用。
- 提供scripts/audit_review与wiki_lint的独立可运行入口（TS/Node可用，无需Python/Obsidian/Agent CLI），明确只读脚本与产品写入边界。

## 版本/复用与所有权

先核验 https://github.com/lewislulu/llm-wiki-skill 的audit-shared/src/{anchor,schema,id,serialize}.ts、llm-wiki/scripts/{audit_review,lint_wiki}.py、audit-guide及实际许可证/精确版本。README声明MIT不等于已找到LICENSE；找不到实际授权文件时采用思想参考的独立实现，记录文件版本/差异，避免复制实质代码。更新docs/open-source-reuse.md；若复制则保留许可证和标注。网络不可用如实记录，独立实现可继续。

施工者拥有产品app/server/services/rules/scripts、必要tests/*.test.ts(x)、README、docs/open-source-reuse.md及docs/reports/B06-build.md与返修施工报告。主Agent拥有docs/status.md、B06任务卡/交接、所有B06独立验收脚本和报告（tests/acceptance/b06-*、docs/reports/B06-acceptance*）。不改用户workspace/真实密钥、B01–05历史报告或主Agent证据。读已有文件再改，B04/B05模块仅作必要接口集成，保存通过的行为。

## 施工交接完成标准

实际交付全部上述功能，npm run build/npm test通过，覆盖锚点三种负例/版本/四决议/11种Lint、Raw不变量与提交恢复；在隔离目录自测。报告变更文件、API契约、固定Lint定义、Provider schema与fake/真实边界、复用版本、命令结果/耗时、残留风险。真实Provider缺配置单列BLOCKED，禁止标实测PASS。交接时停止产品写入，告知主Agent可冻结独立验收；收到返修卡后仅修必要范围。不得委派更多子Agent。
