# LIFEOS L5 独立验收（2026-10-31）

**本轮缺陷结论：无未关闭产品缺陷。L5-01–03本批整体独立PASS。** 仅评价本卡Prompt使用反馈，未测试真实模型质量，不推进阶段6。两个验收准备错误保留如下，不伪装首次整程成功。

B模式，评分0/2/2/0=4，持久化/版本/回收与恢复完整性风险直接B。Astra /root/lifeos_planner规划及独立验收，Sol High /root/lifeos_reviewer施工。验收者未改产品，只编写独占浏览器脚本及本报告；施工停写后核对实物。

## 版本与实物

受验基线 `67e136268b1eaf1b63b3baa868f6a69e00296a6d` 加[施工报告](LIFEOS-L5-20261031-builder.md)列出的12个文件；PowerShell逐项Get-FileHash与报告12SHA比对，**12/12一致**。施工报告SHA `C278483A6A902D3F4FF513CFB2FB38C28CE08A3AFF6117515E2234BCF4C54351`。任务卡SHA `87E356115E6CF1FEEDF186693BAE5BD7FC71F8F2D83662863CFBACCD0270DF76`；独立脚本SHA `F516AA46E62BDC3DA6B749B316A65A2970A049C71794862B8762B8D0A210AD11`。最终提交由主线程绑定，不把基线冒充交付commit。

静态复核服务和UI：feedback仅PromptFile顶层可选数据；边界校验损坏不清空、不污染Prompt计数；CRUD共用既有串行队列/原子写；版本/身份不可改，creationHash和deletedIds处理重放；普通update/AI追加版本spread保全；删除沿原整文件rename。旧测试`tests/prompt-ui.test.tsx`仅新增一行反馈GET空items映射，原断言未改变，符合主线程额外授权。备份/统计实现未改。

## 实际命令与结果

1. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l5-feedback.test.ts tests/lifeos-l5-feedback-ui.test.tsx tests/lifeos-l5-backup.test.ts`：独立**7/7，exit0，1153.1675ms**。覆盖版本绑定/幂等/冲突/损坏保全、真实HTTP原子rename失败、UI输入与迟到隔离、统计搜索日志、真实v1备份恢复兼容。
2. `node --check tests/acceptance/lifeos-l5-browser.mjs`：exit0，之后根据真实标签及故障控制完善脚本；最终执行如下。
3. `node --import tsx tests/acceptance/lifeos-l5-browser.mjs C:/Users/80593/AppData/Local/Temp/lifeos-l5-VV6igI/isolated-session.json`：真实Chrome **7组检查、success=true、整程exit0**。Chrome156.0.8078.76，完整React App/真实Prompt路由与Store，无真实配置入口。
4. `node --import tsx scripts/lifeos-l5-isolated.ts --root C:/Users/80593/AppData/Local/Temp/lifeos-l5-independent-backup-qwmeGB/restored`：恢复根独立新进程启动，不重新seed。随后 `node --import tsx tests/acceptance/lifeos-l5-browser.mjs C:/Users/80593/AppData/Local/Temp/lifeos-l5-independent-backup-qwmeGB/restored/isolated-session.json --readback C:/Users/80593/AppData/Local/Temp/lifeos-l5-VV6igI/lifeos-l5-independent/result.json`：**1组恢复浏览器检查、success=true、exit0**。
5. `git diff -- tests/prompt-ui.test.tsx`、12施工SHA比对、四保护文件Get-FileHash、精确PID/CommandLine核验和清理：实际执行。未重复全仓测试。同版施工40/40组合、AI确认相关2/2、tsc与空envDir build、detect空结果复用施工报告，依据12文件指纹未变及独立定向/完整UI通过。

补充必选导出核验：PowerShell here-string经 `node --import tsx --input-type=module`，将受验main Prompt复制至TEMP `lifeos-l5-export-XvwLts`并只移除副本feedback，分别调用真实PromptStore.exportMarkdown，断言markdown完全相等且排除反馈observation；exit0，markdownSame/feedbackExcluded均true，源文件不改。最终脚本仅清理EOF空行并更新SHA，未改已运行逻辑，无需重跑。

## 验收映射

| 项 | 独立证据与裁决 |
|---|---|
| L5-01 | 7项定向测试含v1/v2→后续版本、手动/收藏/AI确认保全、创建重复/冲突、过期修订/无变化/删除重放/坏反馈。浏览器当前v2创建与历史v1创建编辑，v2删除后刷新仍保留v1；实际注入目标原子rename EIO，HTTP500/PROMPT_WRITE_FAILED、原文件字节不变、表单输入保留，显式重试成功。历史版本关联和迟到GET跨Prompt隔离均实际通过。PASS。 |
| L5-02 | 实际下载反馈JSON含两个版本，排除内部hash/deletedIds。原Prompt删除UI说明反馈随回收，删除后整个文件字节与回收文件相同。浏览器脚本真实调用exportWorkspace/restoreWorkspace，将全部active/recycle Prompt文件集合/SHA逐项比较一致；另一个进程启动恢复root，Chrome实际打开v1反馈读回，原回收Prompt反馈接口404。旧无字段归档读不改字节由独立定向测试通过；另实际比较原文件与隔离去feedback副本的exportMarkdown，输出完全相同且不含反馈文本。PASS。 |
| L5-03 | 浏览器CRUD前后current/versions/creation/aiConfirmations深比较不变，stats全对象、knowledge目录集合/字节SHA及调用计数不变。独立服务测试另验证Wiki搜索及日志不变。Provider计数0；config未接入隔离入口，**不是把固定not-connected字段当实际调用探针**。不存在反馈触发AI或新Prompt版本。PASS。 |

独立实看最终1440当前反馈与1024历史反馈截图：版本绑定清楚，输入/结果分组可读，按钮与3px键盘焦点可见，1024 scrollWidth=1024，无布局阻断。反馈文本是用户记录而非AI质量评分。

## 原始证据与准备错误

- 最终主根：`C:/Users/80593/AppData/Local/Temp/lifeos-l5-VV6igI`，`lifeos-l5-independent/result.json`、`feedback-export.json`、`01-current-feedback.png`、`02-history-1024-focus.png`、`03-parent-deleted-library.png`。
- 实际归档：`C:/Users/80593/AppData/Local/Temp/lifeos-l5-independent-backup-qwmeGB/archive.json`；恢复根为同目录`restored`，读回证据`lifeos-l5-independent-readback/result.json`及`restored-historical-feedback.png`。
- 首轮根`lifeos-l5-rtkT6i`已实际通过前六组，但脚本误将fixture中已回收的recyclePromptId当active去点删除，404退出。保留该result.success=false；修正脚本改用otherPrompt进行父删除，在fresh VV6igI完整重跑通过。不是产品缺陷，也未据局部结果先签整体验收。
- 恢复启动首次harness按active名称推导otherPrompt失败，因为独立测试已正确把它删除到recycle。复制源根fixtures.json到恢复根作为**测试元数据**后启动成功；不改归档业务文件，不将fixtures塞入产品备份。业务Prompt树已在复制前逐字节比较通过，恢复浏览器随后实测通过。此为测试启动准备错误，未修改产品/harness规避断言。

## 边界、保护及收尾

真实Provider请求0、真实配置读取0、正式workspace访问0；历史调用额度未消耗、不重新核账。反馈写入仅隔离目标Prompt文件；备份/测试证据在TEMP，完整资料不提交。

四他人文件独立末次SHA：AGENTS `5647F001E492A5A8C63C8D9A2F47C762CB65B29B04C6FD81699D19E8C34EB9D3`；B04-http-evidence `8A64E61CDDD469825203ACF8F7320636057F0D2B6DA13D9D3C3A15C4F48352DD`；KB02-R1-builder-merge `3431B7E96047CFF493B7A70B011D893E9E502622BE4440E5581DB8FF6FCC49F0`；AGENT-ROUTER包装报告 `AC1AA7F6503BC81F18C3219FF706CAF383637E6C4A509F3B467C07B309BA7D90`，与主线程/施工接手保护值一致，不纳入本批提交。

只清理经Win32_Process核CommandLine为本轮harness的PID8608（UI5173/API50531）、2588（5174/58804）、2760（5175/54022）。浏览器均finally关闭；TEMP证据保留。KB03限定PASS、会议上传UI独立BLOCKED和历史收据缺口不由本轮关闭。主线程可完成版本绑定/提交同步后停止，阶段6未启动。
