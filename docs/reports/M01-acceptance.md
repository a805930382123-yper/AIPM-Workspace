# M01 独立阶段验收

2026-10-11，结论 **PASS**，仅 Meeting Hub 基础服务 M01。Luna High 实际子 Agent 施工/返修，主 Agent独立审查与实跑。M02–M05 NOT_RUN、未获继续施工授权；本次不改变原全项目 S-03/S-04 FAIL 或36项真实 Provider BLOCKED。

## 版本、范围与环境

Windows / Node v25.2.1。工作区无 Git 元数据，版本用 [冻结指纹](M01-frozen.json) 标识；基线 [M01-baseline.json](M01-baseline.json)。产品新增5文件（meeting四模块与API），现有仅 server/index.ts、scripts/backup_workspace.ts 改动；新增 tests/meeting.test.ts，原41个单测/支持文件不改。UI、旧业务服务、依赖未改。

所有运行使用自建临时 FMCG_DATA_DIR 和独立 localhost 端口。M01专用检查的目录、时长、断言、Provider调用和服务关闭结果记录在各 JSON；正式数据不参与测试。旧链/旧备份回归使用既有隔离夹具，输出改为新的M01证据，历史脚本和报告不改。旧备份检查仅将合法白名单断言从四根扩为五根，18类恶意档案断言不弱化。

## 实测

| 检查 | 命令/结果 | 证据 |
|---|---|---|
| 构建 | `node tests/acceptance/m01-quality.mjs` 调用与npm build相同的 tsc -b、vite build；PASS，5.61s+2.00s | [quality](M01-quality.json)、[build日志](M01-build.log) |
| 完整测试 | 同一脚本执行与npm test相同的 Node/tsx/css-stub --test；171/171 PASS，18.58s | [tests日志](M01-tests.log) |
| M01 HTTP | `node --import tsx tests/acceptance/m01-http.mjs`；23/23 PASS，2.80s | [HTTP](M01-http.json) |
| 专项边界 | `node --import tsx tests/acceptance/m01-privacy.mjs`；18/18 PASS，2.68s，含12种持久语义损坏与4种目录损坏 | [专项](M01-privacy.json) |
| 会议备份 | `node --import tsx tests/acceptance/m01-backup.mjs`；5/5组 PASS，5.82s，含9个恶意会议归档 | [备份](M01-backup.json) |
| 旧手动/演示/恢复链 | `node --import tsx tests/acceptance/m01-legacy-http.mjs`；7/7 PASS，实测约6.77s | [旧链](M01-legacy-http.json) |
| 原备份保护 | `node --import tsx tests/acceptance/m01-backup-regression.mjs`；3/3组 PASS，含18类恶意档案，实测约7.07s | [备份回归](M01-backup-regression.json) |
| 备份并发 | `node tests/acceptance/m01-backup-race.mjs`、`.../m01-backup-change.mjs`；2/2 PASS，分别约0.61s | [恢复竞争](M01-backup-race.json)、[导出变化](M01-backup-change.json) |
| 文件完整性 | m01-integrity restore/check；全部一致，冻结后产品/单测不变 | [完整性](M01-integrity.json) |

合计58个独立场景/检查组 PASS，另外171个自动化测试；不将组内每个坏档案变体重复计为独立总数。新旧备份均跑实际CLI，验证字节SHA与恢复后实际服务读取，非只看退出码。并发恢复目标新用户文件保留，导出源变化不产出归档。

## 任务卡逐项判定

| ID | 结论与直接证据 |
|---|---|
| M01-01 | PASS：HTTP01/02，最小创建无链接/附件，Sensitive/cloud/三false；八类型初始且无标签/会议 |
| M01-02 | PASS：HTTP03/04/15/16，幂等、不同载荷409、并发赢家1、过期revision、确认删除、同目录重启字节不变；专项P08停用后重试同ID |
| M01-03 | PASS：HTTP07/10–13，四等级、独立确认、禁止降级/外部AI、Restricted确认清空；P01/02/09–11补查绕过、隐藏字段清除、授权状态一致 |
| M01-04 | PASS：HTTP05/06/08/09，20种创建及目录字段拒绝、HTTPS、名称、稳定ID/停用；P17默认类型改名重启，P18容量不会写坏目录 |
| M01-05 | PASS：HTTP17–22语法/结构/ID/目录junction及真实EIO；P03–07/12–16不回显、严格读盘、目录缺失拒绝重种、目录与已有记录EIO保留revision、记录路径junction拒绝 |
| M01-06 | PASS：HTTP14/23三能力false、未来路由404、会议操作不改knowledge/prompts/drafts/state；M01 HTTP与专项Providercalls=0 |
| M01-07 | PASS：实际CLI5组与旧备份3组及并发2组；新含meetings/旧不含均恢复，路径/摘要/联接/非空目标防护保持 |
| M01-08 | PASS：构建/171测试/旧链7组/文件指纹；[接口交接](../meeting-hub/M01-interface.md)、status/架构/README更新，后续不冒称已交付 |

## 首检问题与关闭

首次冻结 [initial-frozen](M01-initial-frozen.json)，[HTTP](M01-initial-http.json) 21 PASS/2 FAIL，新增 [专项](M01-initial-privacy.json) 0 PASS/11 FAIL。保留原失败证据，未覆写为通过。

| 缺陷 | 关闭证据 |
|---|---|
| F01 Restricted、本地授撤权及cloud Raw状态绕过 | CLOSED：HTTP13 + P01/P09/P10/P11 |
| F02 Restricted清空后creation原输入仍留私密字段 | CLOSED：P02整记录磁盘不含测试片段；仅存SHA256 |
| F03 JS类型校验不足、损坏字段/URL/策略被返回 | CLOSED：HTTP17/18 + P03–05/P12/P13；不回显不覆写 |
| F04 未知请求键进入错误响应 | CLOSED：P06，无测试片段且目录SHA不变 |
| F05 已有记录丢目录后重种使引用脱离 | CLOSED：P07，409且不生成目录 |
| F06 类型停用后同原始请求不再幂等 | CLOSED：P08返回200、同一ID；HTTP08新选择仍拒绝 |

静态复核发现返修中的默认名称必须永久保留约束与第501项目录容量校验缺口，Luna在最终交接前纠正；P17/P18独立通过。未降低原任务卡标准。

## 证据限制与保留状态

Windows创建普通文件符号链接返回EPERM，原 [环境失败](M01-privacy-file-symlink-env.json) 保留。P16改为在记录文件路径放Windows junction，实际lstat为链接、HTTP409且外侧数据不变；普通文件symlink及其它操作系统 NOT_RUN，不写成通过。目录junction与备份junction另有实际通过证据。这是平台夹具调整，产品冻结指纹不变。

M01没有新增UI，本轮不标新浏览器PASS。M01无Provider依赖且专用HTTP/专项零调用；旧备份测试的AI草稿仅本地fake契约，不证明真实AI质量。本批没有正文、Raw或跨文件处理，后续必须扩展相应严格类型/校验和来源限制，不以本批PASS代签完整Meeting Hub。

正式workspace两文件、927个受保护历史/要求/脚本文件SHA未变；完整测试覆盖的两份B04旧报告已恢复，新输出留在M01-generated-*。冻结后的76产品文件与42单测/支持文件不变。仅交付本批，M02需要用户授权后才能开始。
