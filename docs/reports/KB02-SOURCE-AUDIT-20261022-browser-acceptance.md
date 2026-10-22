# 浏览器补验（零模型调用）

用户直接明确回复“允许使用 Playwright 完成验证”，解决此前cua不可用后的其它UI技术授权限制。本次使用已安装Playwright和真实Chrome headless，非jsdom。原最终报告先归档为 `browser-before-acceptance.md`。

原隔离数据完整复制到 `C:/Users/80593/AppData/Local/Temp/kb02-source-browser-j2ryU0`，初始全部文件SHA逐项一致；模型真实授权保持false，服务无API密钥，并装载禁止非localhost fetch的hook。未重试短文、未生成新草稿、未新建旧目标、未走更新预览。

| 实际操作 | 结果与证据 |
|---|---|
| 打开长文待审核草稿，读取14卡，查看06/07/14页并刷新重开 | 通过；`browser-long-all-cards.json`、`browser-long-region-06/07/14.png`、`browser-long-refreshed.*`。区域07显示17%，区域06显示16%，14页仍待审核，未正式确认长文。 |
| 打开短文失败Raw并刷新重开 | 失败状态如实展示；`browser-short-failed-refreshed.*`显示LLM_SCHEMA_INVALID、空白分隔符拒绝、0/1段和累计1次调用；未点继续提取/重新生成。 |
| 打开补充草稿3卡，勾选metric页，点击“确认写入 Wiki（1）” | 单页创建通过；`browser-create-confirm.json`为实际浏览器请求201，创建metric Wiki及Source，未确认其余两页。 |
| 刷新知识库并等待详情自动读取 | 通过；`browser-readback-auto.*`显示30%、旧20%及补充Raw来源。持久文件与浏览器回读API一致，Raw SHA不变。 |
| 再次点击当前已选中的metric | 新UI缺陷复现：详情清空；`browser-selected-reclick-empty.*`。切Source再回metric可恢复，`browser-readback-recovered.*`。 |

明确确认对象是补充资料的**单来源新页**，ID `a071f7c0-d77f-486f-95ab-07b480cdcfca`，sources仅 `f807808b-7414-4b69-a0ec-5450cedbd4ce`。并非短文→补充更新，不能声称双来源/人工备注/更新冲突闭环通过。原短文失败仍使完整更新链NOT_RUN，KB02整体未通过。

## 新旁支UI发现

**F-KB02-SOURCE-UI-01/P2：重复点击已选Wiki会清空详情。** 初次回读脚本在列表已自动选中metric后再次点击同项，30%断言失败；等待约30秒后仍为空，不把它解释成未等待加载。无写入最小复核：刷新等待自动详情30%出现→点击当前selected项→出现空详情→切Source再回metric→详情恢复，真实浏览器全部留证。

现有 `app/pages/WikiPage.tsx:160` 的chooseItem无条件setSelected(null)，同ID的selectedId不变，依赖selectedId的读取effect不会重跑。该文件本轮无修改，是本次真实UI补验发现的既有旁支问题；未修产品或扩张施工。建议主Agent另立小修复任务，保持点击当前项不清空已加载内容或显式重新获取，并覆盖重复点击与快速切换。新问题不影响已持久化的单页或Raw，但影响阅读可靠性。

## 收尾与边界

`browser-verification.json`确认原隔离root全部字节未变，三份Raw哈希未变，单来源新Wiki持久回读一致，真实调用增量0，累计146/200、本轮20/24、Prompt15/24。API/UI与两次Chrome实例全部关闭；外部请求hook记录0条，模型授权始终false。真实账本和历史失败证据保留。浏览器补验完成不改变短文真实FAIL，也不启动新返修。
