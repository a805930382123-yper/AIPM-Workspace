# R13 独立验收

2026-10-29。实际验收模型 GPT-6 Astra，reasoning medium；独立于 Sol High 施工。沿冻结 B 评分 0/2/2/1=5 与 [任务卡](../handoffs/R13-MERGE-20261029-task.md)。基线 `f9e560974408d5974141b1fcf3ed81d72b6a0659`；本轮受测产品已关联提交 `53c16918a9c284a1c18fd7e47f468d9b960a1c89`，主线程交接确认提交后产品字节未变。受测冻结 `b66943d1168155bc2dbc1713f2f07a7efb0eacc8d2833a4df3976aa34a1c0974`，独立核对冻结清单102文件全部SHA一致。

**本轮 R13 缺陷修复 PASS：M01–M06均通过。** 同型、跨型、再次合并及后续编辑/提交/update均保留原页字段组；没有通过清空字段绕过限制。结合既有108项PASS及矩阵影响复核，未发现新增批次阻断；B09最终109项汇总由独立矩阵报告与主线程统一关联提交，不以本报告单独替代全部历史证据。

## 证据与裁决

| 标准 | 独立结果 |
|---|---|
| M01 | PASS。Concept、Process分别同型合并，两4000字符AI项独立保留；不同栏目保留、明确删除组内AI不连带删除人工说明。原Raw、unit目录、basisDigest不变，全部页审批清零。 |
| M02 | PASS。两个首目标方向跨型、第三页再次合并；组扁平保留原类型与引用目录。同名证据不同原位置没有串引；首目标字段引用按Raw坐标映射。 |
| M03 | PASS。组编辑/重新加载、人工修改标签、全页失审；元数据与目录注入拒绝，未审/未解决阻断。空事实的合法人工组保持；实际UI快照超3MiB原子拒绝，原文件不变。 |
| M04 | PASS。合并后正式Wiki/Source正文保留组；fake update输入捕获、附录、明确确认及幂等日志通过；原输入修改使旧update失效。证据快照精确6键，旧occurrences不误入封闭结构。 |
| M05 | PASS。独立执行新增服务8项与React/正式HTTP1项，9/9通过。审查既有回归改动仅撤旧merge拒绝断言及更新文案，类型切换/移归引用拒绝仍保留；复用施工52/52及build，不重复全量。 |
| M06 | PASS。复用主线程真实完整App CUA证据01–12，独立比对隔离根与导出。先3/3审批，同型合并失审0/2；跨型失审0/1；编辑组人工/AI文字再次失审，刷新保持，重新审批后明确确认。实际浏览器只做Concept首目标方向，反方向由服务测试覆盖。 |

代码审查范围为7产品文件及新增服务/UI/fixture/入口；核对原页目录锁定、全局humanReview派生、merge专用重绑、存储边界、update捕获和共享渲染。提交事务保存实际渲染正文；既有humanReview完整内容摘要覆盖组编辑，不以旧payload中缺独立组字段绕过审批。共享record-validators新增分支仅extraction draft组校验；Raw、备份白名单、Prompt上下文与搜索/lint引擎未改。旧四链23文件恢复、真实综合/Audit/Prompt质量及其版本证据继续适用；本轮不重做真实调用或机械备份搬运。

## 实际命令与结果

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --test tests/r13-merge.test.ts tests/r13-merge-ui.test.tsx
```

初次沙箱执行9项均在fixture初始化原子rename处EPERM，未进入行为断言；升级正常本机环境后同一命令 **9/9 PASS，exit0，1771.8171ms**。没有改产品来绕过环境错误。施工组合52项及后来单独新增1项不混称一次53项；独立本次9项包含最终新增测试。

另用只读Node断言：读取 `r13-freeze.json` 对102文件逐SHA；读取 `05-before-confirm.json`、`12-final-export.json` 和隔离根，对8资产逐SHA；比较Raw/bodySHA、unit目录SHA、审批/对象数、组字段逐文本、manifest渲染正文、日志及下载Markdown。最终exit0。第一次辅助断言误用Wiki.version得到undefined；按实际schema改为revision后通过，属于验收脚本字段误写，不是产品失败。

隔离根 `C:\Users\80593\AppData\Local\Temp\r13-merge-20261029-2UhW57`：Raw `d7baedd6-2bf3-49aa-9f57-fe28d1364123` 全文94字，SHA `26a030f6db406584436fbbe661780e26ff701585cec24dac274df6ef37670564`；3个不可变unit目录SHA `b2f92f3c49eb4ad4bac05d196f1fe8e63ca3e62c9647db82f027170d20108f2c`，均与prepare一致。确认前正式Wiki0、审批0；确认后草稿confirmed、1合并页、2原页组、1审批。

operation `d8578039-8d25-40da-a1d6-801e1bd4ea79` completed；Source `3c5cef19-2c07-475c-bd95-10ca2512c850` 与Concept `ca3a2f8f-ed8d-4db5-90be-695eab23a420` 均revision1/source_level D，恰2条create日志。两正文保留Concept2 definition和Process3 steps、人工说明及人工修改AI文本；“尚未发货”与成本待确认保持。下载 `merged-wiki.md` SHA与正式Concept磁盘文件相同，`46c9482eaa84920b896ee086e909fd4a47b493fcfb27d6ae7f0e9848e33dcedb`。

## 限制与交接

本轮数据明确离线虚构，Provider入口禁用；fake update不代表新的真实模型质量测试。验收者未启动服务/操作浏览器/外发请求，CUA行为归主线程，磁盘核验由本实例独立完成。真实API0，累计知识263/500、Prompt20/24保持。未对最低Node版本或跨平台作新声明。只写本报告，不改产品、不代主线程提交。
