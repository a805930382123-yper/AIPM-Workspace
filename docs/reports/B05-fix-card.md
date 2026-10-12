# B05 首轮独立返修卡（2026-10-07）

冻结指纹 `B05-first-frozen.json`。独立构建PASS，104/104测试PASS，HTTP首轮8/9（恢复状态新增断言另1FAIL）。主Agent实际浏览器补充两项可复现失败。产品Provider真实调用/质量BLOCKED另记；以下为实现缺陷，不能由缺配置解释。

| 根因 | 最小复现/实际 | 关闭标准 |
|---|---|---|
| F05-01 非法综合schema | POST syntheses，fake返回category=`not-a-real-category`；返回201存非法草稿，确认时将综合分类换成第一个枚举，Source仍可能带非法枚举。证据 `B05-first-http.json` E05-09。 | 生成前严格校验综合必需title（非空/长度）与category枚举、数组元素和引用；非法输出502无草稿/正式写入，无默认分类伪成功。PATCH/confirm也保持必需schema门禁。 |
| F05-02 草稿恢复入口缺失 | 浏览器B04草稿→更新预览→修改/保存→刷新：回首页；Raw只有原提取草稿“继续审核”，无法找到已保存更新。内容仍在workflow文件中。证据 `B05-acceptance-browser-first.json`、`B05-first-browser-files.json`。 | 更新与综合保存后，刷新和同目录服务重启均能从正常UI恢复同ID及编辑，不重新调用Provider产生新草稿。实现清晰待审核列表和/或持久化导航，取消/确认更新列表。多个草稿可找到，不要求用户记UUID调用API。 |
| F05-03 更新标题编辑丢失 | 更新预览标题填“铺货率 浏览器确认更名”，建议增加填“浏览器确认内容”，确认成功；正式body有人工内容，但title仍“铺货率”。workflow记录title为更名。证据 `B05-first-browser-files.json` updateTitleLost=true。 | 预览标题和正式保存一致；更新更名保留原标题别名及原metadata/来源/正文，revision+1。若产品明确不支持更新标题，应在该UI设只读且服务端拒绝编辑，不能允许编辑后忽略；优先实现现有可编辑契约。 |
| F05-04 恢复后草稿状态未收敛 | syntheses确认注入index rename EIO；解除故障同目录重启，manifest completed、正式Source/Synthesis齐全，但GET workflow仍pending_confirmation。独立补断言证据 `B05-first-recovery-finalization.json`。 | 重启恢复完成同步workflow.confirmed、operation/wikiID与版本，待确认统计收敛；已有confirmed记录重启幂等，冲突状态如实可读、人工新编辑不覆盖。只更新状态，不重新生成页/Log。 |
| F05-05 实际Raw正文未复核 | 综合草稿生成后在隔离Raw文件追加正文（frontmatter bodySha256不改），confirm仍201。补充探索证据 `B05-first-extra-integrity.json` E05-12；此探索发生于返修中，不作为首次冻结版本的最终计数。 | 生成/确认/恢复校验实际正文sha256与快照，而不是只比较可过期frontmatter字段；任何来源变化409、零正式副作用，引用重新定位验证。 |

F05-04同时复核completed重试：综合确认成功后人工修改正式综合页，再重试同草稿同payload不同key；应直接复用已完成operation且不写任何正式资产。当前补充探索E05-11会重执行completed清单并把它变成conflict。保护已完成manifest终态，恢复仅处理prepared/committing。补充证据发生于返修中，最终必须在重新冻结版本重跑。

顺手修正B04审核页提示“旧页更新属于后续批次”，替换为当前三决策说明；同名显式新建提示可能造成关联歧义。

范围限以上根因与关键回归，仍由原 GPT-6 Luna High 施工者修复。主Agent不改产品；独立脚本与历史报告保留。先说明修复范围，再施工/selftests，写 `B05-repair-build.md` 并重新冻结交接。主Agent复验全部受影响HTTP场景、浏览器保存恢复/更名/综合与关键回归。真实Provider缺配置继续BLOCKED；不开始B06。

## 最终关闭（2026-10-07）

返修重新冻结后主Agent独立复验，F05-01–F05-05全部CLOSED，确定性实现PASS。上述初验失败叙述是保留的历史证据。完整结论见 [B05-acceptance.md](B05-acceptance.md)。

| ID | 最终证据 |
|---|---|
| F05-01 | B05-acceptance-http.json E05-09：非法schema/quote拒绝 |
| F05-02 | B05-acceptance-browser.json：更新/综合均经正常UI恢复同ID及保存编辑，含同目录服务重启 |
| F05-03 | HTTP E05-03＋B05-acceptance-browser-files.json：更名落盘、原名别名与人工内容保留 |
| F05-04 | HTTP E05-06/06b/11：恢复confirmed、保护人工编辑、completed重试零改写 |
| F05-05 | HTTP E05-12：实际Raw正文变更409、零正式副作用 |

最终build PASS、107/107测试、11/11独立HTTP场景通过；真实Provider成功与质量继续BLOCKED。施工者与验收者职责保持独立。
