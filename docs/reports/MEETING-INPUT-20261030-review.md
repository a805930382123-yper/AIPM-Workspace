# 会议备注与本地纪要上传独立验收（2026-10-30）

本轮工程已覆盖项通过，发现的Raw关联响应附件隐藏遗漏及尾空格已返修关闭；**本轮整体 BLOCKED／待UI验证**，不能签整体PASS。MI02、MI03的实际浏览器DOCX/PDF上传、创建后上传失败重试未完成，MI07实际UI门禁因此未闭合。

B09整体与本轮分开：维持2026-10-29既有109 PASS / 0 FAIL / 0 WAIT的历史适用结论；这不包含本轮新增行为，也不是本轮重跑109项。既有模型失败、输出质量限制保留。本轮真实Provider调用0，不改原预算；未部署。

## 范围、版本与实际检查

依据 `docs/handoffs/MEETING-INPUT-20261030-task.md` MI01–MI07及施工报告验收；收到Terra停写确认后检查实际diff和相关实现。本验收者与施工者为不同实例，仅新增本报告，未改产品、未提交。基线HEAD `d3d3caae8f879b20c178aa4c094551c771badd8e` 加本轮未提交差异，Windows/Node v24.18.0。AGENTS与AGENT-ROUTER包装报告不属于本轮产物。

修改保持现有单会议JSON原子写入、meetings备份白名单和原minuteDigest算法；Raw解析模块未改，复用已有DOCX/PDF解析。写入与读取均仅为description放行LF/CR/TAB；已有备注CSS包含pre-wrap。附件摘要独立于正文摘要，旧MD无base64记录继续可读，不伪造原文件。

最终还只读核对M05-usage.md增量：四格式/2MiB/旧DOC转换/扫描PDF无OCR、新建分步上传、详情顶部安全策略与独立授权位置均与实现一致；文档变更后再次diff检查exit 0，产品代码未变，不重跑运行验证。

## 独立执行与结果

1. 以下命令exit 0，40/40 PASS，测试耗时3.742秒。覆盖新四格式真实fixture上传、下载原字节、MD BOM/CRLF/尾空格、备注持久化、工作副本隔离、新空根恢复；及既有元数据/幂等/策略/损坏存储/备份/Raw登记与UI组件回归。

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --test tests/MEETING-INPUT-20261030.test.ts tests/meeting.test.ts tests/meeting-minutes.test.ts tests/meeting-minutes-backup.test.ts tests/meeting-raw-m04.test.ts tests/meeting-ui.test.tsx tests/meeting-integration-m05.test.tsx tests/meeting-raw-ui-m04.test.tsx
```

2. 独立stdin模块通过 `node --import tsx --input-type=module` 运行（工具记录d84b06），exit 0，1.913秒：新建TEMP数据根与Express动态端口，上传DOCX；同requestId重放返回200且只有1版本，不同内容返回409。逐一提交旧DOC、格式不符PDF、损坏DOCX、扫描无文字PDF、GBK、超过2MiB、超过500000字符，7项全部拒绝且旧版本数量不变。Internal/Sensitive/Restricted三种未授权策略均403。备注编辑后新Store读回、DOCX原件恢复字节、下载attachment响应头及普通详情隐藏base64均通过。输出：`failuresRejected:7, deniedLevels:3, modernRetry:PASS, conflict:PASS, metadataEditReload:PASS, docxRestartAndRestore:PASS, downloadAttachment:PASS, detailHidesBytes:PASS, realApi:0`。此项“Restart”仅指重建Store；真实进程重启证据见第4项。

3. 独立stdin模块同上入口（工具记录8808c1），exit 0，7.561秒：新建TEMP根，以每版500000字符TXT及其原件base64实际累积写入20版，落盘33348266字节；下一版明确MEETING_JSON_TOO_LARGE，前后文件字节完全一致，重建Store仍读取20版。验证32MiB包含base64开销及失败不部分写入。

4. 独立stdin模块同上入口（工具记录a8cfc1），exit 0，3.742秒：通过既有b07-harness启动真实server/index.ts隔离进程，HTTP创建Public会议并显式改local_archive；上传真实DOCX/PDF fixture，停止API再同根启动，两次HTTP原件下载与上传字节完全一致；再次停服导出归档，恢复至不存在的新根，以恢复根启动真实API，两次下载仍字节相同。输出 `processRestartDownloads:2, restoredRootHttpDownloads:2, byteEquality:PASS, realApi:0`。

5. 返修后仅重测受影响用例：`node --import tsx --test --test-name-pattern='meeting registration HTTP contract' tests/meeting-raw-m04.test.ts`，exit 0，1/1 PASS，0.719秒。带新附件版本的Raw登记POST与解除关联DELETE均不返回file_base64。此前其余39项不受此次响应隐藏改动影响，复用第1项结果。施工方另报修后该文件13/13 PASS，独立结果与施工结果不混计。

6. `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check` 最终exit 0，仅换行提示。`npm run build`复用施工报告exit 0，非本验收者重跑；后续改动仅为两处响应改用已存在expose及尾空格，未改变UI构建接口。

第2–4项stdin脚本均通过mkdtemp建立独立临时目录，结束关闭自有HTTP/API进程，并验证删除目标处于TEMP后清理。第4项设置不存在的FMCG_LLM_CONFIG_FILE，harness清空Provider变量。未读取真实配置，正式workspace不作输入或输出；不声称做过正式库全量SHA扫描。主线程5198/64320 UI验收服务不由本验收者管理，关闭由主线程确认。

## 分项裁决及UI证据边界

| ID | 结论 | 证据与限制 |
|---|---|---|
| MI01 | 已覆盖项通过 | 创建及编辑多行备注读回、LF/CRLF/TAB、非法控制字符及标题内换行拒绝；主线程实际UI创建三行备注成功。刷新/重启后的实际页面操作未新增实测。 |
| MI02 | BLOCKED | 主线程实际新建后仅1会议，Sensitive独立授权成功；实际文件上传及失败重试尚缺浏览器证据。HTTP/组件幂等通过不能替代此门禁。 |
| MI03 | HTTP PASS，UI BLOCKED | 四格式上传与文本读回、MD空白保持、中文TXT通过；浏览器新建后DOCX及详情PDF实际上传未完成。 |
| MI04 | 工程PASS | 四格式下载字节、工作副本不改原文、重导入历史、旧MD幂等兼容及新根恢复通过；DOCX/PDF真实进程重启与恢复后HTTP下载逐字节一致。 |
| MI05 | 工程PASS | 策略正负向与原撤权/删除确认回归通过；主线程Sensitive独立授权实操；上传不自动Raw、不调用Provider。 |
| MI06 | 工程PASS | 第1–3项覆盖错误文件/编码/字节与字符上限、32MiB总记录上限、请求重试冲突、旧MD幂等，失败资产保持。 |
| MI07 | 工程通过，UI待验证 | 独立40/40及返修定点1/1；复用施工build；实际UI上传门禁缺失。 |

主线程会话提供的实际UI证据（复用，非本验收者操作）：5198隔离空根，新建“隔离验收：三行备注与本地纪要”，备注为“1.觅果产品进度对接\n2.东莞客户服务\n3.潜在客户拓展”；点击保存并上传后列表1条，详情完整三行、revision1；Sensitive切换local_archive并独立确认后revision2；上传控件显示DOCX/PDF文字层/MD/TXT及2MiB。随后文件chooser setFiles被Chrome扩展file URL权限阻断，native回退也被CUA强制停止，当前URL未能确认，无截图落盘。不得补造截图或将控件存在当作实际上传成功。

## 发现与关闭

初验Raw关联POST/DELETE仍展开原始meeting，导致附件base64随imports返回，与接口文档“响应不包含”及施工说明不符。Terra改为复用expose并新增两处响应断言，停写后第5项独立验证通过，CLOSED。store.ts行尾空格导致初次diff检查失败，清理后第6项通过，CLOSED。当前未确认仍存在的产品功能失败；整体阻塞来自必选浏览器证据缺口。

最终关键文件SHA-256：

| 文件 | SHA-256 |
|---|---|
| app/MeetingMinutes.tsx | 5C8E64D3ED0FD333FF29C662CE9BE63534B64514A342ACF5B19104394DBD9E00 |
| app/pages/MeetingPage.tsx | BD4E9ACCD4F25F67F733B7220045BC2D85A21F50CEED5922EAB2FF91B87FB721 |
| server/meeting-api.ts | 47B9ACEA1B35E9FAC44F22F275ECA263D530E3F6EBE068150AACCBD66A920F4F |
| services/meeting/policy.ts | 7481334E3BAF3D11EDAF5A6384743C7ED9A7295611257DE1D333B2F6F0D6753F |
| services/meeting/store.ts | 08ACA49CBF07A24A8A82A1AEB464919953BB8224E9D1C9D6F5937122B57FB0B2 |
| services/meeting/types.ts | 38CB6E0CAF7D9086BB8E260E4698D0468189EBD4FE281E4CB7D99B2911A8F57F |
| tests/MEETING-INPUT-20261030.test.ts | 7347692BBACA0E8F23CCB1FBF0F755B7ED69FC299FAC810A20F7DD4BF8CD81C5 |
| tests/meeting-raw-m04.test.ts | D1CE78468D8039D5199D209728C13C5E405352DAC4F6F7359A9DBF80AE5366EF |

下一步仅补既定UI门禁：新建同一会议上传DOCX、失败保留输入重试且不重复会议、详情PDF上传；必要时补备注刷新后页面读回。无须重复已通过HTTP或扩大模型测试。子Agent实际token计量不可得。
