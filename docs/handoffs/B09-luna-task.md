# B09 Luna High 施工任务

2026-10-08用户明确授权继续由GPT-6 Luna High子Agent完成B09，之后由当前主Agent独立验收。B01–03/B07 PASS；B04–06/B08确定性实现通过但真实产品Provider/质量仍BLOCKED。用户本次授权允许继续B09实现，不等于补签前批。只交付B09，禁止自主发布/联网部署/修改正式数据或密钥。

读AGENTS、status、B09、architecture、coordination、acceptance按B09与未闭合R项、PRD §31/50–60。只查询所需模块，历史证据按需复用，不在每轮重读全文。所有施工和必要返修由你进行，主Agent只做冻结、独立测试和报告。

## 必做与接口冻结

### 1. 首页闭环

保留五项主导航与安静桌面布局。首页六计数按现有真实统计口径：Raw/Wiki/本周Raw+Wiki创建/待确认知识/Open Audit/有效Prompt。补齐五个显式快捷入口：导入资料、新建Wiki、生成Prompt、新建Prompt、检查知识库(Lint)。进入准确表单/Generator/Lint而非仅跳泛列表，重复使用可靠。最近导入/最近知识变更点击应打开对应真实对象；删除后失效关联明确提示，不能串到任意第一条。Prompt保存不成为知识日志；待确认只统计知识审核，Prompt草稿不混入。修复本批引出的统计/路由问题，不重写成熟模块。

### 2. 显式教学数据

设置页给出“导入演示数据”可执行入口，点按即用户明确操作；无自动seed、启动/初始化不灌入。GET `/api/demo`返回version/imported/已有演示清单和示例任务；POST `/api/demo/import` `{confirm:true}`显式导入，返回创建/复用/缺失或冲突信息及ID，错误必须明确。重复点击/并发/重启不能重复或覆盖用户编辑的demo记录；用户删掉的演示不在下次启动或重复导入时偷偷复活，说明重新获取的边界。采用稳定manifest与可恢复进度，实际落盘失败可重试，不伪称全成功。复用store校验/串行/原子写入，不能批量硬塞不合规JSON。

PRD固定少量样本：Raw《快消行业基础知识示例》；Wiki“快速消费品 FMCG”“动销”“快消行业渠道体系”“门店补货流程”“库存周转率”；Prompt“快消术语学习”“业务流程拆解”“客户会议总结”“AI机会识别”；Generator示例“第一次访谈经销商负责人，了解订货流程和AI机会”。所有为虚构教学，不含真实公司/业务数值冒充事实。

每个演示Raw/Wiki/Prompt/任务入口均有可持久化isDemo或等效明确标识、可见“演示数据”提示，正文/导出也可辨识；标签不只留在设置页。Raw不可变，示例Wiki不要冒充已核验：适当needs_verification/source_level D，来源链可读。如增只读isDemo字段，兼容旧记录默认false，不让普通客户端随意伪造系统来源；保留Prompt旧版本/字段白名单。用户编辑演示后标识保留。关联到演示来源时可回读演示来源提示。示例任务入口显式打开Generator并填入可编辑任务，不直接调用Provider或保存。

### 3. 可恢复备份

新增独立Node/tsx CLI `scripts/backup_workspace.ts`，README给准确命令：

`node --import tsx scripts/backup_workspace.ts export --data-root <root> --output <file>`

`node --import tsx scripts/backup_workspace.ts restore --input <file> --data-root <new-root>`

输出可移植JSON归档，例如 `{format:'fmcg-workspace-backup',version:1,createdAt,files:[{path,size,sha256,base64}]}`。路径固定为相对正斜线；知识Raw/原件assets/Wiki/Index/Log/Audit、Prompt current/history/recycle、drafts/state等用户资产需完整备份，保留字节与ID/来源/版本/时间。不备份仓库源码、node_modules、.env/Key/配置和验收报告。只备份dataRoot的knowledge/prompts/drafts/state白名单目录，拒绝符号链接、越界/重复路径、非法base64/校验和、未知version与格式；总量/单文件有可查合理上限，超限明确失败。

导出不修改数据；正式一致备份文档要求先停止写入服务，读取前后核对集合/摘要，检测改动即失败，不悄悄导出撕裂状态。不能依赖外部Agent/Obsidian/Python。恢复只允许不存在或空的新目录，不覆盖非空目标；完整校验之后才写入临时新目录并提交，失败不留下伪完成资产或损坏已有目标。输出/目标必须与dataRoot互不包含，防止递归归档与源被覆盖；错误退出码非0，成功提供路径/文件数。不会删除已有用户目录。UI设置可以提供备份说明或下载入口；CLI闭环必做，不强制在线恢复覆盖现工作区。

### 4. 运行与交付文档

更新README，纠正B07仍说Generator/Optimizer未实现等过期段落。准确说明npm启动/浏览器地址、数据目录/端口、实际Node/Windows版本、现有Provider配置/掩码、无LLM手动模式、演示显式导入、导出备份/空根恢复、错误/中断恢复与数据风险；不要写未经验证的跨平台运行PASS。

更新 `docs/open-source-reuse.md`：逐一列两个上游的本地实际文件、逻辑、修改与未复用范围、所读版本/证据边界，区别规则改编/思想参考/代码复制。可复用此前核验记录；不能将main活动链接冒称固定commit或把README MIT声明冒称已读LICENSE。无必要不得新增实质源码复制；若复制必须先核验精确版本并保留许可证版权。既有LICENSE和历史报告不改写。

新写 `docs/delivery.md` 与 `docs/delivery-matrix.md`：真正实现、启动/打开/数据、四条链路操作步骤、实际自测、未完成/BLOCKED/NOT_RUN、风险（PDF/DOCX/LLM格式/中文搜索/去重/长文/API错误/Prompt质量/Wiki背景/关联）。矩阵逐行A01–A63及R01–R46，引用已存在历史证据并写清整项/子条件；施工自测不是独立签收，真实AI相关行保持BLOCKED，四链路fake只能签确定性接线。最终主Agent另写独立矩阵/验收报告。

## E09 主Agent独立验收门禁

- E09-01 干净数据根启动为空，五入口各到正确操作，六统计真实，最近记录定位对应ID。
- E09-02 显式导入1 Raw/5 Wiki/4 Prompt/1任务样本；标识贯穿列表、详情、正文、导出；重复/并发/重启不增量，不覆盖编辑，不复活删除项。
- E09-03 单次实际写盘故障不假成功；恢复重试完成原manifest，原资产/Raw字节不变。
- E09-04 备份全部可承诺资产/二进制/历史/草稿/状态/回收；新根restore字节/集合/ID一致，启动后可查询与计数；正式源不变，重复启动不生新seed。
- E09-05 恶意相对/绝对/Windows路径、重复/符号链接、错格式/hash/base64/过量、非空目标、源输出互包含均明确失败，目标/已有数据不变。
- E09-06 无Key实际手动Raw→Wiki→搜索/来源/导出、Prompt变量→复制/历史可用，AI明确失败不造空资产。
- E09-07 四链路以实际浏览器打通：Raw→AI审核→Wiki；Wiki→Audit→提议/人工确认→resolved；任务→Brief→Wiki→预览→Library；旧Prompt→检查→优化→新版本。缺真实Provider则真实成功/质量BLOCKED，独立fake只检验接线/人为保存/ID/版本/日志/Raw不变。
- E09-08 首页pending/open/recent/count随真实审核/Audit/保存变化；Prompt日志隔离、版本不当新对象。
- E09-09 长文桌面操作可用/不越界，失败重试与重启持久化，既有B07/B08关键异步修复保持。
- E09-10 README运行/备份命令可复现、两个上游逐文件/许可边界准确、完整矩阵与风险不隐瞒。

## 文件所有权和交接

你可修改B09新增demo/backup模块、必要API注册/CLI/package scripts、Home/Settings/App及各既有页面最小入口/演示标识接线、必要store/types/validator/样式、相关自测、README、docs/open-source-reuse.md、docs/delivery*.md。不得改AGENTS、status、本任务卡、architecture/coordination/acceptance、其他批任务卡、独立tests/acceptance、任何历史报告或正式workspace/密钥。新施工报告只写docs/reports/B09-build.md和B09-builder-*；返修另名。

先检查已有文件再改，最小化成熟存储协议变更。测试仅临时独立FMCG_DATA_DIR/端口，服务Windows hidden，结束只关闭自己的PID，保留fixtures。全量tests会改写B04-http-evidence.json和B04-repair3-merge-payload.json：主Agent已先备份，施工新输出另存B09前缀，旧原件恢复；不能覆盖B08/早期原件。

完成必要构建/完整测试、demo/backup实际CLI自测；没有浏览器则明确NOT_RUN由主Agent补齐。报告文件/API/归档/预算/幂等与恢复细节、实测命令退出码/耗时、配置状态与SHA。平台不提供token则记不可得。完成后冻结产品写入并通知主Agent，不把自测标成最终PASS，不自主开下一批或新子Agent。
