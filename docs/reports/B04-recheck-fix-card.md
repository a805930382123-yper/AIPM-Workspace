# B04 第二次返修卡（2026-10-05）

本轮独立复验仍 **FAIL**。原11项根因中8项关闭，F04-04/F04-05/F04-11为部分修复、尚未关闭。下一次获授权的施工只处理以下3项残留，保持已通过能力；B05未授权。

先读AGENTS、status、本卡；查询细节时读 [返修独立报告](B04-recheck-acceptance.md) 的“三项残留最小复现”。[冻结B04契约](../handoffs/B04-deepseek-prompt.md)继续有效；[浏览器报告](B04-recheck-browser.md)说明正常UI路径已通过。独立脚本/报告/历史证据由验收方保管，施工新增测试和交接使用新文件，不改旧独立证据。

## 3项关闭标准

| 原ID / 残留级别 | 最小实际复现与定位 | 必须满足的结果 |
|---|---|---|
| F04-04 / P2 | 先确认 `[p1]` 成功，同草稿同key重试 `[p1,未知UUID]`，实际201 reused。`services/wiki/commits.ts:111` 比较前过滤未知ID，掩盖请求变化。 | 确认首次和重试均先验证所有传入ID，未知ID明确400 UNKNOWN_PAGE或409内容冲突；原始不同请求不能被静默缩减成成功。回归同key/异key同payload复用operation/IDs；同key/异key不同有效选集409，文件/Log不增长。 |
| F04-05 / P2 | 新草稿全部false，PATCH只改p1标题、不改selected；confirm当前revision、`selectedPageIds=[p1]`。Source链接p1，但同正文称p1“未创建”，Key Takeaways“暂无”。`commits.ts:98` skipped按旧flag，`drafts.ts:72`再次过滤旧flag。 | 自动派生Source所有段落统一以本次确认选集为准：selected与skipped互斥且覆盖全部建议，p1定义进入Key Takeaways，仅实际创建页建立Wiki链接。覆盖直接HTTP选择与草稿标记不同、普通UI先保存、改名、Source复用和用户主动编辑Source正文的既有快照语义。 |
| F04-11 / P2 | 27,200中文四块、每块quote唯一、摘要不同；Provider合法省略可选start/end，产品草稿定位正确，但真实额外汇总输入事实evidence只含id/quote，缺全局位置。`service.ts:313–318`使用原Provider对象而非已规范化`entry.pages`。 | 汇总使用已校验/规范化的每块结构化数据，事实引用的证据保留对应Raw及全局UTF-16 start/end。实捕额外汇总请求，对有/无Provider位置hint两种合法输入逐字段与规范化块证据/完整Raw比对；其余事实/整理/推断/问题字段、尾部覆盖、并发预算和Raw不变保持通过。 |

三项均有公开HTTP实际证据，不需要修改产品才可复现。闭环标准是新版本对失败断言全部通过，并运行相关幂等/Source/长文回归与build、自测；交接新 `B04-repair2-build.md`，逐项记录预期/实际、运行命令、证据、产品指纹及未测边界。运行npm test前归档当前 `B04-http-evidence.json`，它会被原脚本重写。

F04-01/02人工编辑、03默认选择、06来源元数据、07合并、08竞态/取消、09部分提交/恢复、10测试Key保护本轮已关闭；仅在变更影响时补其关键断言，不反复重跑无关完整场景。真实产品Provider仍缺配置，继续BLOCKED；fake不能替代真实成功/质量。最终门禁由独立验收裁决。
