# B06 首轮独立返修卡（2026-10-07）

施工已冻结，51个产品文件见B06-first-frozen.json。独立build PASS、112/112测试PASS；首次独立HTTP 11/13，通过后补充同冻结版本恢复完整性检查0/2。首次证据B06-first-http.json、B06-first-extra-integrity.json、B06-first-lint.json均保留。浏览器尚未运行，将在返修冻结后验收完整闭环。真实Provider质量BLOCKED另列，以下是确定性缺陷。

| ID | 实际失败/复现 | 关闭标准 |
|---|---|---|
| F06-01 冲突恢复清单被删除 | E06-06b：Index rename EIO后，用户API再改Wiki到revision3，重启不覆盖人工编辑且Audit仍open，但state/audit-operations清单被rm，独立读取ENOENT；已确认失败操作丢失证据。 | 原operationId的清单保留为conflict，包含可读原因与关联Wiki/Audit；可通过Audit详情/API/UI获知冲突；不把失配的prepared记录静默删除。已完成清单不重执行。 |
| F06-02 恢复只比较revision、未核对实物 | E06-06d：Index EIO后直接编辑隔离Wiki正文但frontmatter revision仍2，重启Audit误标resolved。E06-06e：相同中断后改实际Raw正文且不改其旧hash字段，重启也误标resolved。证据B06-first-extra-integrity.json。 | 清单持久化目标实际内容摘要/预期正文与Raw实际SHA快照；恢复必须核对实物与来源。发生变化保留conflict、Audit留open、人工内容不覆盖、不补签resolved。正常中断仍完成原operation，Wiki/Index/Log/Audit/draft状态一致且幂等。恢复仅接受已授权且内容吻合的提交。 |
| F06-03 Lint非列表事实漏检 | E06-08：有效sources下正文`## 来源事实\n铺货率增长99%，无来源定位。`没有UNSOURCED_FACT；因为仅识别带`-/*/+`的事实行。 | 来源事实节的非空实质陈述，无论普通段落或列表均需可核验引用；明确待确认占位可排除。每条结果定位真实文件行，11类fixture均命中，有效证据不误报。 |
| F06-04 B04长引文显示被误报 | B06-first-lint.json：长引文fixture`ev-long-b06`报UNSOURCED_FACT。B04 render.ts保留全局[start,end)却只显示90字符+省略号；现Lint拿含省略号quote验证Raw前缀失败。 | 兼容真实B04渲染格式：依有效Raw、全局offset范围与显示前缀核验完整引用，不把显示省略号当原文字面字符；越界/伪前缀仍报错，不以随便删省略号绕过校验。短/长B04、B05和新显式格式有效证据正例通过。 |

范围：原GPT-6 Luna High修复以上根因及必要回归，不改主Agent独立测试/报告/status/正式workspace。根因可合并实现，明确记录关闭证据；完成build/受影响tests后写B06-repair-build.md，冻结产品停止写入并交接。主Agent负责重新冻结复验全部HTTP、实际浏览器及受影响B05回归；不要求为了测试改变合法Provider schema（rationale允许空字符串；Raw quote定位仅核验来源/文本，未承诺唯一offset，不把这点冒签真实语义质量）。

## 第二轮：实际浏览器发现 F06-05

前四项返修后独立build、113/113测试、15/15 HTTP及B05 11/11回归已通过。浏览器整页/段落、四决议、保存/刷新/重启、Lint和日志正常；多页面切换发现新缺陷，当前不能签确定性整项PASS。

- **F06-05（P2）：Wiki切换后Audit详情仍属于上一页。** 先打开`B06浏览器冲突恢复复验`及其warning Audit，再点击`B06浏览器铺货率`：当前标题、正文、来源和Audit列表已切换，但详情仍显示前页冲突operationId、旧AI预览及可点接受按钮。存在误判处理对象的风险。实测证据：[B06-first-browser.json](B06-first-browser.json)最后一项、[截图](B06-first-browser-switch-fail.png)。
- 关闭标准：Wiki身份变化立即清理旧Audit选择/详情/预览/理由/状态及选择文本；当前页面只能显示、处理它自己的Audit。异步旧页列表/详情/建议/保存/决议响应不得把旧状态写回新页。同页切Audit时也不能残留上一条预览/理由。正常同页刷新仍可从持久化记录恢复。
- 原Luna High仅修此根因及必要回归，在`B06-repair2-build.md`记录变更/验证，停止写产品后交接。主Agent保留当前隔离样本，独立实测双向切页、同页切记录及确认闭环。主Agent不改产品代码。

## 最终关闭记录

2026-10-07主Agent独立复验：F06-01–F06-04由[B06-acceptance-http.json](B06-acceptance-http.json)15/15组及[B05回归](B06-regression-b05-http.json)11/11支持；F06-01的冲突操作原因另在真实浏览器可读。F06-05由[B06-acceptance-browser.json](B06-acceptance-browser.json)同一隔离样本双向切页/同页切记录及两次真实HTTP fake延迟响应支持，旧详情不残留、迟到响应不污染当前选择；返回原Audit能恢复草稿并人工确认。

累计5项确定性缺陷全部CLOSED。最终独立build PASS、113/113 tests PASS，51产品文件冻结一致、38后端文件与有效HTTP验收版本一致，正式workspace全部2文件集合/SHA不变，自有隔离服务关闭。完整结论：[B06-acceptance.md](B06-acceptance.md)。B06整批仍BLOCKED真实产品Provider成功/质量，不签虚假PASS。
