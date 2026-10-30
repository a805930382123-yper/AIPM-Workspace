# 项目交付说明

## KB03 深度笔记使用与验收边界（2026-10-30）

R1–R4已独立通过契约、深度整链、编辑与正式确认验收；R5工程回归613/613、tsc/build及独立工具10/10通过；真实固定样例抽取成功后规划连续两次60秒超时，无草稿，反例未执行、质量未评分，KB03整体未通过。真实请求4/12，现已停止；下一步先诊断规划超时。见[R5独立验收](reports/KB03-R5-20261030-review.md)。普通文章/报告正文不超过30000字符时默认深度整理，可在Raw页显式选择标准整理；超过30000字符默认标准，深度不可选，不截断原文。Meeting来源仍不允许进入知识提取。Raw正文不会由AI改写。

深度整理依次提取事实、规划知识页、编排大纲、写结构化笔记、只读质量检查。N个分块正常需N+4次Provider调用；单块为5次。失败、超时或连接中断也计入累计调用；刷新和重启不自动重发。检查失败原因后使用“显式继续提取”沿原任务、原模式和已验证检查点恢复；“明确重新生成”是用户另一个动作，不能抹去验收工具累计总账。检查点损坏或原文/规则/Provider变更会保留现场并拒绝直接续跑。

草稿中可编辑章节、段落、列表、表格和关系图，逐叶核对角色与真实fact ID；引用位置可打开原文高亮。删除承载事实的内容后，覆盖会变为未覆盖；只有明确填写排除理由才能排除。人工修改会清除人审批准，旧质量报告保留为“历史/过期”，需要重新逐页及笔记审核。有限数值token检查和模型报告都不能替代主体、时间、条件、否定、单位及补充边界的人工核对。

正式创建必须先保存，完成全部知识页HUMAN审核、笔记及引用/覆盖/待确认问题核对，并明确知悉当前警告和历史报告，然后点击确认。勾选卡片只决定本次创建哪些卡；全部不选可仅创建Source，仍须完成全部审核。深度笔记暂不支持更新已有知识卡；同Raw已存在Source时明确冲突，不覆盖旧Source。部分正式写入恢复沿原冻结快照，不从后来编辑的草稿重造内容。正式Source保留确定性深度笔记、人工修改标记、排除理由和历史报告，网格表格按安全文本阅读；可切换Markdown原文做精确选段。

备份前停止服务，使用下方现有backup CLI导出；恢复只允许新根或空目录。用恢复根设置`FMCG_DATA_DIR`后启动，核对Raw SHA、Source笔记和知识卡，再继续使用。R4已对完整App实际产物做同根重启与备份新根阅读验收，见[R4验收](reports/KB03-R4-20261030-review.md)。

R5工程入口（项目根，prepare/fake不读真实配置，不发真实请求）：

```powershell
node --import tsx tests/acceptance/KB03-R5-20261030-real.mjs prepare
node --import tsx tests/acceptance/KB03-R5-20261030-real.mjs fake <prepare输出的TEMP根>
```

prepare只复制本轮已授权的固定Raw及冻结虚构反例到TEMP，并生成版本/输入SHA与未批准release模板；不会读取参考笔记或独立评分oracle。fake使用实际Provider适配器和runner，但返回人工固定的工程响应，不能作为真实质量得分。真实run仅由独立验收依据现有授权释放，固定同一账本，预算严格5+5+2=12，失败/未知请求先耐久记账，跨进程/修复版本不清零。详见[R5施工记录](reports/KB03-R5-20261030-builder.md)。

## 本机试用（2026-10-30）

本机 Windows 的 Node 为 v24.18.0，npm 为 11.16.0。在项目根运行 `npm install`（依赖已安装可跳过）和 `npm run dev`，打开 <http://127.0.0.1:5173/>。默认数据目录为项目 `workspace/`；试用可先运行 `$env:FMCG_DATA_DIR = "D:\FMCG-Trial"` 使用独立目录。停止服务后按下方备份命令导出并恢复至新空目录。手动 Raw、Wiki、Prompt 不需 Provider；真实 AI 功能需用户自行配置并主动发起。

本轮隔离 HTTP 验证手工创建、读取、重启持久化和备份恢复后读取，UI 首页 HTTP 可访问；未操作浏览器界面，也未调用真实 API。见[施工记录](reports/LOCAL-HANDOVER-20261030-builder.md)。下方旧条目的 Provider 阻塞是当时结论，当前 B09 以顶部记录及[矩阵](reports/B09-RESUME-20261029-matrix.md)为准。

当前记录（2026-10-29，R13修复完成）：R13独立M01–M06 PASS，当前109项全部通过。合并保留原页字段组、原类型与来源，编辑/合并后重新审批；真实API新增0，原四链与恢复按版本复用。产品提交 53c16918a9c284a1c18fd7e47f468d9b960a1c89；详见[R13独立验收](reports/R13-MERGE-AUDIT-20261029.md)、[矩阵](reports/B09-RESUME-20261029-matrix.md)及[README](../README.md)。本结论限现行B09标准，不表示部署、跨平台或所有模型输出质量已保证。

前轮记录（2026-10-29，R13修复前）：本轮模板更新UI与Prompt必要上下文修复提交 c6474fe98c63440d7b9cbdb7fe15e98eb8b6aba8；四链真实样本、同根重启与新空根恢复已独立通过，23文件逐SHA一致。R13带字段候选合并仍未满足，B09整体未通过。当前运行方式/Provider范围见[README](../README.md)，当前逐项裁决见[109项矩阵](reports/B09-RESUME-20261029-matrix.md)，实测/复用边界见[独立集成报告](reports/B09-INTEGRATION-AUDIT-20261029-stages.md)。以下2026-10-14及更早条目为历史时间点，不代表今天仍未运行真实Provider。

历史记录（2026-10-14）：CFG01本机通用Provider配置入口PASS，同GPT-6 Luna Max施工、主Agent独立两轴验收。保存/保留/替换Key、明确测试/确认清除、env只读与请求快照隔离完成。HTTP27、edges9、R2三组、组件4、安全100、实际桌面/窄屏浏览器13全部通过；最终build及字节相同可写副本完整215/215。原workspace继承ACL导致rename EPERM未通过，未改ACL或断言，详见[报告/校准](reports/CFG01-20261014-acceptance.md)。正式数据/实际.env.local及1296历史文件未变，自有服务关闭。当前Windows/Node v24.20.0；未真实Provider/部署，36项仍BLOCKED。下面早期记录为历史。

历史记录（2026-10-13）：S-03/S-04安全返修已由Luna施工、主Agent独立复验关闭，本批PASS。六条AI输出链统一检查已知长/短/多凭证、解析后JSON键/值及转义；错误脱敏和失败资产保护实测通过。build及204/204完整测试、有效HTTP98/98、Audit2组、多凭证服务113/113、知识回归11/11、两轴审查与历史/正式数据保护通过。[本批报告](reports/SEC-20261013-acceptance.md)、[当前109项矩阵](delivery-matrix.md)。M01–M05会议本机阶段PASS，备份现包含meetings；新会议来源仍local_only。全项目仍未签PASS，36项真实Provider成功/质量仍BLOCKED；未部署、未配置真实Provider、未新签浏览器。下文2026-10-10及B09描述均为历史交付范围。

历史记录（2026-10-10）：全项目审查发现的 S-01/S-02 与 D-01/02 已返修并独立复验关闭。Audit 凭证回显在草稿保存前拒绝；Raw 正文摘要不符、缺失或非法时明确返回 `RAW_INTEGRITY_ERROR` / HTTP 409，不消费该正文、不自动修正。更新/综合/Audit 的来源冲突与恢复机制保持。build、155项测试和64项专项/关联场景通过，正式数据和历史证据未变。详情见 [本轮独立报告](reports/FULL-20261010-repair-acceptance.md) 与 [当前109项矩阵](delivery-matrix.md)。真实 Provider 仍未配置，36项真实成功/质量门禁保持 BLOCKED；本次没有新的实际浏览器验收。

## B09 交付记录（2026-10-08，历史）

本文记录 B09 最终交付的运行方式、施工自测、主 Agent独立验收结果与限制。同一 GPT-6 Luna High 完成施工及返修，F09-01–04 全部 CLOSED，确定性实现通过；真实 Provider 成功和质量仍 BLOCKED，整批不补签真实 AI。四条实际浏览器 AI 机械链路使用独立本地 fake。最终报告见 [B09-acceptance.md](reports/B09-acceptance.md)，109 项独立矩阵见 [B09-delivery-matrix.md](reports/B09-delivery-matrix.md)。

## 已实现

- 首页显示 Raw、Wiki、本周新增、知识待确认、Open Audit、有效 Prompt 六项真实统计，并提供导入资料、新建 Wiki、生成 Prompt、新建 Prompt、检查知识库五个快捷入口。最近 Raw 与 Wiki 按对象 ID 打开；最近变更为已删除的 Wiki 时给出失效提示。Prompt 的保存不会写知识 Log。
- 设置页提供用户点击后才执行的“导入演示数据”。首次计划和逐项进度保存在 `state/demo-manifest.json`；导入 1 Raw、5 Wiki、4 Prompt。演示记录使用 `isDemo`，Raw/Wiki/Prompt 列表、详情及导出内容带有演示提示。启动不自动灌入。重试复用现存记录、保留用户编辑，删除条目不会复活。示例任务只预填 Generator，不自动请求 Provider 或保存。
- 新增 `scripts/backup_workspace.ts`。JSON 归档逐文件保存相对路径、字节数、SHA-256、Base64；仅包含数据根下 `knowledge/`、`prompts/`、`drafts/`、`state/`。导出前后比较资产路径、长度和摘要，导出源根不存在或读期间变动会失败。恢复先完整校验，写入同级临时目录，目标只允许不存在或空目录，不能覆盖非空目录。
- 更新 README 和开源复用记录，并提供 A01–A63 / R01–R46 逐项施工矩阵。

## 启动、地址和数据

需要 Node.js >=22.13。已记录的本机实际环境为 Node v25.2.1 / Windows。安装依赖后在项目根运行：

```powershell
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/`；API 默认在 `http://127.0.0.1:4317/`。默认数据根为项目 `workspace/`。通过 PowerShell 的 `FMCG_DATA_DIR` 指定其它根，通过 `FMCG_PORT` 指定 API 端口。产品可在无 Provider 时启动，手动 Raw、Wiki、搜索、Prompt 和 Lint 仍可使用。

LLM 配置来自服务端 `FMCG_LLM_BASE_URL`、`FMCG_LLM_MODEL`、`FMCG_LLM_API_KEY` 或被忽略的 `.env.local`。客户端只读取掩码状态。此段为 2026-10-08 历史配置状态；此后真实样本验证结果见顶部当前记录。开发 Agent 的模型凭证不属于产品配置。

## 离线备份与恢复

导出前先关闭本地服务，确保没有并发写入。`--data-root` 必须指向实际使用的数据根；以下示例对应上面的 `D:\FMCG-Trial`，若使用默认目录则改为 `.\workspace`：

```powershell
node --import tsx scripts/backup_workspace.ts export --data-root D:\FMCG-Trial --output D:\FMCG-Backups\workspace.json
```

恢复到空的新数据根：

```powershell
node --import tsx scripts/backup_workspace.ts restore --input D:\FMCG-Backups\workspace.json --data-root D:\FMCG-Restored
```

CLI 当前上限为单文件 64 MiB、总数据 256 MiB、20,000 个文件。拒绝符号链接、Windows 不安全路径、重复路径、非法 Base64、SHA/长度不符、未知格式/版本、非空恢复目标以及源输出包含关系。CLI 自测实际检查二进制原件及普通 JSON 文件的源/恢复字节相同。跨平台运行未测。

## 四条桌面链路

1. 进入 Raw，导入 Markdown、TXT、DOCX 或有文字层的 PDF；在详情中点击 AI 整理、审核建议并确认 Wiki。无 Provider 时此链路在 AI 请求明确失败，手工建 Wiki 与来源、搜索、导出仍可使用。
2. 在 Wiki 选择页面，提交 Audit；配置 Provider 后生成建议，人工编辑并确认修订，检查状态变为 resolved。无 Provider 时 Audit 的手动反馈与人工决议可用，AI 建议会明确失败。
3. 进入 Prompt 工作台的 Generator，输入任务、编辑 Brief、选择 Wiki、请求预览并显式保存到 Library。无 Provider 时 Brief/预览请求明确失败；手动 Prompt Library 可用。
4. 在 Library 选择旧 Prompt 后进入 Optimizer，检查、修改建议并显式保存新版本。无 Provider 时 AI 检查/优化明确失败；原模板、变量、复制和历史仍可使用。

主 Agent已使用实际桌面浏览器和隔离本地 fake 完成四条机械闭环；fake 只验证操作接线、草稿/确认、对象 ID、持久化和版本行为，不能证明真实模型调用成功或内容质量。真实 Provider 未配置，模型成功和质量仍为 BLOCKED。首轮浏览器记录含 39 个观察，其中 36 PASS、3 INVALID_EXPECTATION；Source 英文标题、AX 空格、新 Wiki 文案三条原始观察保留并以修正后的预期复验，不是产品 FAIL。无 Key 手动链路另有 12/12 PASS。原始证据：[首轮浏览器观察](reports/B09-acceptance-browser.json)、[无 Key 手动链路](reports/B09-acceptance-browser-manual.json)、[重启持久化](reports/B09-acceptance-browser-files.json)、[无 Key 导出与演示 Prompt](reports/B09-acceptance-exports.json)。首轮冻结后发现的 F09-03（Audit 已创建但 Home 计数未更新）已最小修复；后续 [12/12 针对性浏览器检查](reports/B09-repair1-acceptance-browser.json) 与[持久化重启文件核对](reports/B09-acceptance-browser-repair1-files.json)通过，F09-03 CLOSED。

## 本轮实测与未完成项

| 检查 | 结果 | 说明 |
|---|---|---|
| B09 demo / backup 隔离自测 | PASS | `scripts/b09_selfcheck.ts`：未自动 seed、单次写盘故障后恢复、并发导入、编辑保留、删除不复活、二进制恢复、非空目标/恶意路径拒绝。 |
| 实际 CLI 导出/恢复 | PASS | 最终施工记录见 `docs/reports/B09-build.md`：含空格路径实跑，导出退出码 0 / 267 ms，恢复退出码 0 / 193 ms；2 文件 / 22 字节；二进制 asset SHA-256 源与恢复相同。 |
| 主 Agent独立 build / test | PASS | 首版冻结版本 build 1.03 秒、`npm test` 152/152 PASS（17.369 秒）。F09-03修复版主 Agent build 45 modules/982 ms、37/37 UI交互/Raw审核/Prompt异步回归 PASS（11.055 秒），见 [repair build](reports/B09-repair1-acceptance-build.log) 与 [UI log](reports/B09-repair1-acceptance-ui.log)。施工端 `npx tsc -b` PASS（退出码 0，5.011 秒），提升环境 `npm run build` PASS（退出码 0，4.408 秒，Vite 45 modules/934 ms）。未因小修重跑无关的全量152 tests。 |
| B09 浏览器四条机械链路 | PASS（隔离 fake）；真实 Provider BLOCKED | [首轮浏览器记录](reports/B09-acceptance-browser.json)：39 个观察，36 PASS、3 INVALID_EXPECTATION；三条修正预期复验通过，无产品 FAIL。[F09-03修复版定向浏览器检查](reports/B09-repair1-acceptance-browser.json) 12/12 PASS。AI 请求使用隔离本地 fake，仅证明机械链路。 |
| 无 Key 手动链路 | PASS | [实测记录](reports/B09-acceptance-browser-manual.json)：Settings 显示未配置；Raw→Wiki→中文搜索→来源回跳；Prompt 变量→真实复制粘贴→两个版本与历史，12/12 PASS。 |
| 公开导出及演示 Prompt 标识 | PASS | [导出证据](reports/B09-acceptance-exports.json)：无 Key Wiki/Prompt 导出、编辑演示 Prompt 后导出及版本历史保留 `isDemo`。 |
| API 重启、页面 reload 与统计 | PASS | 两个独立 TEMP 环境，同目录 API 重启和页面 reload 后 knowledge/prompts/drafts/state 文件集合与 SHA 完全一致（[主环境](reports/B09-acceptance-browser-files.json)、[手动环境](reports/B09-acceptance-browser-manual-files.json)）。主环境计数 Raw 2 / Wiki 7 / 本周 9 / pending 0 / Open 0 / Prompt 5；手动环境为 1 / 1 / 2 / 0 / 0 / 1。F09-03 修复后 create→Home Open=1，deferred 仍 1，rejected 后 0；另一个 Audit 的 fake 建议未改 Wiki revision，人工编辑接受后正式 revision=2/正文及日志正确，Home=0；Prompt 新增后 Home Prompt=1、Wiki仍1，API重启和页面 reload 后仍 Open=0/Prompt=1，人工确认正文保留，详见 [F09-03浏览器检查](reports/B09-repair1-acceptance-browser.json) 与[文件核对](reports/B09-acceptance-browser-repair1-files.json)。 |
| 备份完整性与安全边界 | PASS | [修正fixture后的全资产备份/恢复](reports/B09-acceptance-backup-fixture-corrected.json)：20 文件 / 23,603 字节；18 类恶意归档，以及 junction、非空目标通过；late-file 恢复竞态见[独立注入](reports/B09-acceptance-backup-race.json)，导出期间源变动见[注入记录](reports/B09-acceptance-backup-change.json)。原始 `B09-acceptance-backup.json` 保留了一个误期待仍可通过 versions API 读取已回收 Prompt 的无效断言（实际正确返回 404）；修正fixture后 E09-04 通过，不是产品缺陷。 |
| B09/B08/B07 独立 HTTP 与回归 | PASS | [最终 B09 HTTP](reports/B09-acceptance-http-fixture-corrected.json) 7/7、[B08 HTTP](reports/B09-regression-acceptance-http.json) 15/15、[B07 HTTP](reports/B09-regression-acceptance-b07-http.json) 11/11；四类损坏记录+重启通过。原始无效预期输出保留，最终证据以独立报告为准。 |
| 首页视觉与桌面操作 | PASS | [首页截图](reports/B09-acceptance-home.png)、[统计返修截图](reports/B09-repair1-acceptance-home.png)、[失效入口最终截图](reports/B09-repair2-acceptance-stale-wiki.png)。最终 Wiki 选择修复独立构建 PASS，45 modules/980ms；[10/10 实际浏览器复验](reports/B09-repair2-acceptance-browser.json)通过。 |
| F09-03 Audit 计数刷新 | PASS；F09-03 CLOSED | [修复版浏览器检查](reports/B09-repair1-acceptance-browser.json) 12/12 PASS，覆盖 create→Home Open 1、deferred仍1、reject后0、fake提议不修改 Wiki、人工编辑接受更新正文/revision/log、Prompt/Wiki统计隔离以及 API 重启/reload。文件集合/SHA 核对见 [repair1 files](reports/B09-acceptance-browser-repair1-files.json)。 |
| F09-04 最近失效 Wiki 不串页 | PASS；F09-04 CLOSED | [原始失败](reports/B09-initial-stale-wiki-browser.json)保留；[最终独立10/10](reports/B09-repair2-acceptance-browser.json)：删除及旧新建历史不显示其他页详情/导出，手动选有效页恢复，非首条准确ID、搜索、普通知识库、重复新建入口正常，F09-03创建/解决计数保持。 |
| 真实 Provider 成功和质量 | BLOCKED | 当前无产品 Provider 配置。 |

施工方的沙盒受限记录与主 Agent独立结果是两个不同执行环境，分别保留。真实 Provider 的成功和质量未验证；不得把 fake 的确定性闭环描述为真实模型 PASS。

施工平台未提供子 Agent token 计数，记为不可得。

## 风险与限制

- PDF 只解析有文字层的文件；扫描件不做 OCR。DOCX/PDF 旧验收实测过有限样例，不能代表所有格式版本或异常文件。
- 中文搜索使用归一化和文本匹配；没有分词引擎/qmd 前置，跨语言语义召回未验证。
- 去重只提供候选与理由，近似重复、同名决策及合并质量仍受数据和规则影响。
- 长文提取有分块、重叠、期限和 50 条建议上限；Provider 未配置，实际模型长文覆盖和质量 BLOCKED。
- API 会明确返回结构化错误，既有批次有错误注入证据；施工沙盒的 B09 HTTP runner 未完成，首版冻结版本由主 Agent独立完成 B09 HTTP 7/7。F09-03修复版首页统计刷新经 12/12 针对性浏览器检查通过。
- Prompt 的模板结构、变量替换和版本持久化由确定性逻辑实现；Prompt 内容质量需真实 Provider 和人工评审，当前 BLOCKED。
- Wiki 背景仅按用户选择提供，并有上下文预算策略；浏览器 fake 已验证选取背景后的机械闭环，真实模型上下文使用效果和输出质量仍未完成。
- Wiki/Raw/Prompt 关联以稳定 ID 解析；F09-04 已独立 CLOSED，失效最近记录明确报错且不自动打开另一页；其它错误或过期引用仍需用户检查。
- 演示数据是明确虚构示例；它们计入真实文件统计。用户可在设置页重试未完成导入；删除的演示条目不会自动复活。恢复到新数据根时，演示清单与数据文件一起迁移。


主 Agent文档收尾：最终仅 WikiPage 选择保护改动，独立最终 build PASS（45 modules/980ms）。先前冻结完整152/152、F09-03修复37/37 UI和12/12实际浏览器证据按不变SHA复用，没有冒称最终修复又运行完整套件。`docs/delivery-matrix.md` 由主 Agent将109项最终 DOC/RUN 状态与独立矩阵同步；施工报告仍保留各轮当时的待复验状态，不改历史原件。
