# 会议备注与本地纪要上传（2026-10-30）

状态：规划冻结，待施工与独立验收。用户授权修复三行备注无法保存，并新增本地上传；已明确 Word、PDF、Markdown、纯文本。采用 DOCX/PDF/MD/TXT，旧 DOC 明确提示另存 DOCX，不增加转换依赖。当前 B09 109 PASS 是历史适用结论，本轮不借此签新增行为通过。

## 调度与范围

评分：需求明确度0、模块耦合2、修改风险2、历史失败0，共4；A标准，Astra Medium规划、Sol High先审计划、Terra High施工、独立Sol High验收。涉及原件/版本/备份兼容，实施限定为既有单记录原子存储，不引入跨文件事务；若实施必须改变该边界，重新评估数据完整性风险及B模式。施工者不独立签收，交接后停写。主Agent统一提交同步。

施工所有权：app/pages/MeetingPage.tsx、app/MeetingMinutes.tsx、app/meeting.css、app/api.ts、server/meeting-api.ts、services/meeting/{policy,store,types}.ts及直接相关会议测试/接口文档。services/raw/parse.ts优先原样复用；确需改动须解释普通Raw行为影响。共享工作区不覆盖他人修改。正式workspace、真实配置、Provider调用、部署不在范围。

## 调查与最小方案

1. 备注根因：policy.ts的通用text拒绝全部C0字符，description使用它；store.ts读取也对description使用单行validOptionalText。仅备注允许LF、CR、TAB，保持2000字符、现有首尾trim/null约定；写入与落盘读取同步调整，其他字段原限制保持。详情按换行显示。
2. 新建界面目前只有HTTPS来源，上传在详情MeetingMinutes且受能力控制。新建增加清晰的“保存并上传本地纪要”入口；保存成功后导航同一会议的本地纪要区，未授权则引导现有策略确认，随后直接上传。明确这是分步操作，不声称会议和文件原子创建；失败保留已建ID和可恢复输入，重试不再创建会议。普通保存仍可用。
3. 复用现有multipart导入路由、revision/requestId/重导入确认、版本与工作副本机制。复用services/raw/parse.ts的detectFileFormat及DOCX/PDF extractBody；现有依赖mammoth/pdfjs-dist已具备，无需安装新解析器。MD/TXT使用严格UTF-8、ignoreBOM:true解码，避免公共extractText剥BOM破坏现有会议原件约定。错误文案改为会议语境，不能写“未创建Raw”误导用户。
4. DOCX/PDF提取文字不等于原文件。新上传版本保存原文件字节的规范base64、文件名、格式及file_sha256；放在现有会议JSON的版本中，与正文一次原子提交，沿现有备份白名单恢复。提供显式下载原文件（附件，不以内联HTML执行），普通列表不返回附件。imported_minutes是不可改写提取正文，editable_minutes才是工作副本；original_sha256仍为正文摘要，file_sha256为原文件字节摘要，不混用。MD/TXT新上传也保存原字节；旧版本无附件字段继续读取，不伪造历史二进制。
5. 保留上传2MiB、正文500000字符、会议JSON32MiB上限；base64计入实际JSON大小，超限不得部分写入。解析失败、图片型/无文字PDF、损坏、扩展名不符、非UTF-8文本应明确失败，旧纪要保持；不加入OCR。旧DOC说明转换为DOCX后重试。
6. 策略不放宽：Public+local_archive允许；Internal/Sensitive需独立本地授权；Restricted禁止正文；cloud_index不能上传。权限在正文解析前和提交时检查，上传不是授权。外部AI保持禁用，上传不自动登记Raw、不触发Provider；原件删除、重导入、降能力策略阻塞维持既有语义。

## 冻结验收

| ID | 必选行为与证据 |
|---|---|
| MI01 | 创建/编辑含三行中文、LF/CRLF/TAB备注成功，刷新和同根重启读回；详情保持行结构；NUL等其它控制字符及其他字段换行仍拒绝。 |
| MI02 | 实际浏览器从新建入口到同一会议上传完成；默认未授权策略可清晰完成独立确认；创建成功后上传失败可重试且会议不重复。 |
| MI03 | 四格式各一个真实本地fixture通过HTTP上传并读回正文，浏览器至少验证新建后DOCX及详情PDF；MD BOM/CRLF/尾空格保持，TXT中文正确。 |
| MI04 | 每格式原文件下载SHA与上传字节一致，编辑工作副本不改原件/提取正文；重导入保留旧版本，新旧字段兼容；至少DOCX/PDF经重启及导出到新空根恢复后SHA一致。 |
| MI05 | 未授权Internal/Sensitive、Restricted、cloud_index不能上传；显式授权才成功；Provider零调用、无自动Raw；已有策略撤权/删除确认相关测试通过。 |
| MI06 | 旧DOC、格式不符、损坏/无文字PDF、非UTF-8、超大小失败均不产生成功版本、不破坏旧数据；同requestId重试/冲突及原有MD幂等有效。 |
| MI07 | 定向会议元数据、纪要、备份及受影响Raw登记回归与build通过；报告实际命令、结果、版本/指纹；新UI有实际操作证据，不能仅以HTTP代替。 |

独立验收者检查实际差异及上述关键行为，报告区分本轮修复/新增结论和B09整体证据适用性；失败返修受影响项，未实测不标PASS。真实API预算不动。完整测试是否必要由受影响边界决定，不要求重跑109项。
