# REVIEW01 独立验收（2026-11-21）

**本地功能验收**　周报事实快照、隐私隔离、模型起草、人工编辑保护和双尺寸界面通过。真实 Provider 读取本批合成快照一次，返回 HTTP 200；7 条事实、1 条风险中的全部 26 个引用可在快照中核验。全量首轮出现的 EVAL01 历史恢复兼容问题另行复验。

本轮由 Astra Medium 规划与独验，Sol High 施工。基线为 `75363cd2b71ae4041e3f6a60542f7c8f9d3686da`。受验 Git blob 为周报任务 `6f3ebd22d137dc078a8cb9ea70ef41d631bb5f50`、快照 `7955cb5c1ec4629edca22d716c3a8df8bb651e8f`、草稿存储 `b6de96a3f8691d8ec94a17b6e58d91c0edd96f51`、周期回顾 UI `515f9d62ad43ea41a2e9dc6a204d4c27d890222e`。以下 `node` 均指项目 Node 22.23.5。服务、生产构建及持久化使用 TEMP 和动态回环端口。

| 验收 | 实际观察 |
|---|---|
| RV-01 | ISO 周年、上海周一零点、当前周截止和补跑定位通过。12 个来源分区区分周内变更、当前状态和独立读取失败。受限会议及其派生 Wiki 的标题、ID、Raw/会议/Wiki/Prompt 正文、Prompt 反馈原话和客户业务正文均未进入周报或模型输入。旧周期查询三项原测试通过，真实浏览器按原日期范围返回成功。 |
| RV-02 | 伪造 refs、非法 JSON、缺字段和密钥输出均整份拒绝，事实保留。AI 关闭和未配置时请求为 0。模型完成前人工新版本受到保护，已编辑或归档的周报不被自动覆盖。基于旧 revision 的更新返回 409；显式重生成需要版本与确认。周报备份恢复后逐字节相同。 |
| RV-03 | 定向测试覆盖定时及手动重生成、自动化上下文调用正式 Wiki 写入返回 403。真实运行前后 8 份正式/业务文件（Wiki 含索引、Raw、Prompt、工单）的 SHA-256 清单一致。 |
| RV-04 | 对照合成 2026-W46 周报，范围为上海 11 月 9 日至 16 日（终点不含）。先核对假请求中的字段、四个业务标题、数值、受限来源隐藏计数和系统提示，再由隔离服务对同份夹具副本发送真实请求。请求摘要 `40d1bd4794c6aa0b1a127d7f194aabb5e589590992de658ee78de796abe83969`，运行 `598e0865-7883-4327-b0e1-687be3e294c2` 成功，aiStatus=ready。请求 1、输入 1,938 token、输出 1,092 token、未知用量 0。 |
| RV-05 | Edge 157.0.4341.60，在 1440×900 和 390×844 切换实时/周报，加载事实及草稿、点击事实依据打开对应 Wiki，人工保存、处理陈旧版本冲突、归档、下载 Markdown、从运行详情打开正确周报。两尺寸均保留了未保存输入，下载含事实、AI 原文和最新人工备注。8 张截图均通过水平溢出检查。每种尺寸故意制造一次 409，浏览器各记录一次预期 HTTP 冲突；其他控制台错误和页面异常均为 0。 |

### 真实草稿事实复核

逐条核对全部 highlights、risksAndBlockers 的文本及引用。Wiki 新增 2 篇，其中 1 篇受限只计数；可见标题与 11 月 12 日日期正确。Prompt 反馈 1 条且为 helpful。两项工作均在本周新建，关闭 0；生成时未结 2、到期 1、待处理 0。周内可用资讯和确认入库为 0；Lint 各项变化和最近问题数均为 0。两次自动化运行分别为每日资讯和知识库结构巡检，均成功。风险引用定位到到期且 waiting 的客户事项。未发现编造的数字，两个下周关注项均标注 AI 建议、待确认。

### 实测命令及证据

- `node --import tsx --test tests/review01.test.ts tests/lifeos-l6-review.test.ts`，9/9。
- `node --import tsx tests/acceptance/review01-review-provider.mjs fake`，退出 0；人工检查实际投影和对应来源。
- `node --import tsx tests/acceptance/review01-review-browser.mjs`，退出 0。独验夹具先重建合成 Wiki 索引后取 SHA 基线；浏览器引用断言验证实际跳到目标 Wiki 的 GET 请求。
- `node --import tsx tests/acceptance/review01-review-provider.mjs real <预审夹具TEMP目录> 40d1bd4794c6aa0b1a127d7f194aabb5e589590992de658ee78de796abe83969`，退出 0。守卫限定目的地、模型路径、消息内容摘要、周键及用途，遇到隐私哨兵或内容不匹配即阻止；真实尝试文件禁止覆盖。

[真实账本](REVIEW01-20261121-review-evidence/real-result.json) · [真实周报与引用快照](REVIEW01-20261121-review-evidence/real-weekly.json) · [Markdown 导出](REVIEW01-20261121-review-evidence/real-export.md) · [浏览器记录与截图](REVIEW01-20261121-review-evidence/)

### 返修与回放独验

**本轮返修通过。** 旧的 standard-extract 恢复夹具最初包含了新增的 weeklyReview 阈值，导致合成历史记录与生产按旧链计算的阈值摘要不一致。受验恢复测试 Git blob 为 `34f4a5e5a3f8243c3a779c38f90f17546140f2dc`，评估入口为 `c7a08370da4ad1075439643519e3602fa0de709f`。测试按旧链计算摘要，只排除周报专用阈值；改变旧链 factRecallPerCase 后，恢复在发送请求前拒绝。恢复正路径、受限请求次数和一次性许可均复验通过。

在独立 TEMP 源码副本中运行 `node --import tsx --test tests/eval01-live.test.ts`，2/2。首个副本缺少评估器读取的 Git HEAD，补入同一基线的只读 Git 元数据后完成。随后使用 `node --import tsx scripts/eval/run.mjs --chain <链名> --mode replay --recording <录制名>` 分别验证 standard-extract / live-20261115-baseline 8/8（事实 21/21）、news-relevance / synthetic-v1 12/12、weekly-review / synthetic-v1 4/4。四个周报样例覆盖活跃周、风险周、受限来源和空周；全部引用合法，禁编断言命中 0。[周报回放逐案评分](REVIEW01-20261121-review-evidence/weekly-replay.json)

**本地批次结论**　RV-01–05 与 RV-06 的本地门禁通过。主线程于修后在 TEMP 隔离副本以四核 Windows Node 22.23.5 运行 `npm run check`，类型检查、998/998 项测试及生产构建通过。三链离线回放通过 8/8、12/12 和 4/4。Windows Node 22/24 的远程结论以最终提交的 GitHub Actions 记录为准。
