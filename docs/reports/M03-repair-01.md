# M03 首轮独立验收返修卡

冻结首版：M03-initial-frozen.json。build PASS，完整175测试174PASS/1FAIL；纪要HTTP20PASS/1FAIL、基础HTTP23/23、实际HTTP组件18/18、旧手动链7/7通过。首版证据保留M03-initial-*，非最终PASS。

- F03-01（P2）：Sensitive/local_archive/有1个import时，PATCH policy {baseRevision,local_storage_authorized:false} 返回403 POLICY_FORBIDDEN；要求409 LOCAL_COPIES_PENDING和details.localCopies=1，保留全部原件/工作副本。原因changePolicy中“local但无授权”先于副本冲突。四级规则不放宽；有副本时优先告诉用户需明确清空，再撤权/切云/升Restricted。无副本的非法local状态仍403。root复现H10，参见M03-initial-http.json；其它两个cloud/Restricted副本冲突已通过。
- F03-02（P2验证阻断）：旧tests/meeting-ui.test.tsx模拟GET详情只给MeetingSummary，缺少M01以来已有的imports/active/raw/capabilities，挂载新纪要区报undefined.find，完整tests失败。允许Luna仅补齐此测试真实详情夹具并分别保持列表摘要不含正文；保持丢响应双POST/same requestId/标题等原断言，不跳过测试或用产品fallback伪装协议损坏。此处为旧夹具契约缺失，实际18项HTTP组件已通过，不将其描述成产品API回归。

产品所有权仅当前Meeting store必要策略顺序与上项测试夹具。定向验证后停止；root重新冻结并重测H10/基础策略/完整测试。root不改产品。用户授权M03闭环，不进入M04/M05。

追加F03-03（P1，真实备份恢复失败）：M03已允许接近32MiB的多版本会议JSON；独立CLI export成功（45,399,486字节归档），restore却返回`Maximum call stack size exceeded`，未产生恢复目标。根因scripts/backup_workspace.ts:104中嵌套重复分组的base64正则在合法大文件时栈溢出。这是旧校验器在新支持容量下暴露的问题。允许Luna仅修改该base64验证，使用有界、线性检查加现有base64重新编码/长度/SHA256校验；保留路径/白名单/大小/总量/目标保护。可新增tests/meeting-minutes-backup.test.ts验证大纪要真实export/restore；不放宽恶意归档校验。失败证据M03-initial-backup.json，复现归档目录在该JSON的base；root另一次实际CLI诊断同样失败。修复后root重跑真实全版本备份与9恶意会议归档。

追加F03-04（P2，实际浏览器）：安全策略弹窗仍显示“本批不提供纪要导入、Raw登记或AI处理”，与已交付纪要区矛盾；请最小更新为本批实际能力，不开放Raw/AI。有副本的策略拒绝还应在弹窗显示受控整数localCopies，不能仅展示泛泛“存在本地副本”。允许原任务所有权内的MeetingPage策略提示修改，定向UI验证；证据M03-browser-observations.json的F03-04。保持原策略提交/晚到响应保护。

2026-10-12最终闭环：F03-01–04全部CLOSED，M03阶段PASS。独立最终H10、177/177完整测试、真实大归档恢复5/5、浏览器B12/B13/B33a分别验证，首轮失败证据保留。[最终独立报告](M03-acceptance.md)。
