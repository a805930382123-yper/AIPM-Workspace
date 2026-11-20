# REVIEW01 施工报告

基于 `75363cd2b71ae4041e3f6a60542f7c8f9d3686da` 的工作树完成 RV1–RV6。Astra Medium 冻结计划与验收口径，评分 1/2/2/0 = 5，采用 B 模式。Sol High 审查计划后施工，RV4 由同型号施工子 Agent 实现并验证。

## 交付内容

- 上海周一 09:00 默认汇总上一完整 ISO 周。补跑按原触发时点确定目标周。当前周截到生成时刻，拒绝未来周。期间数据与生成时点的待办、提醒和最新结构检查分别展示。
- 快照复用 L6 的 Wiki 新增、Prompt 使用反馈和待办来源，同时读取事项历史、资讯、巡检与账本。资讯确认量按收据实际保存日期统计。结构问题增减限定本周，最新结构总量按生成时点统计。无法核实的来源逐栏目提示，受限和未核实标题只留下统计量。
- 按周原子落盘事实后再调用模型。外发仅含许可标题、日期、状态、计数和引用键。整份模型结果通过严格结构和逐引用校验后才保存。无模型、关闭或空周均可读取事实。自动执行保护人工编辑和归档，显式重生成在开始、事实写回和模型写回校验各自版本。
- 首页保留 L6 实时查询，周报视图支持事实、AI 引用、备注、归档、重生成和 Markdown 导出。运行详情可直达对应周报。Wiki、事项和运行使用原入口，Prompt 使用对应记录的精确详情接口。
- 经主线程批准，调度器、类型和账本增加周报运行链接、触发时刻及区间读取。工作事项目录增加共用校验的只读投影，资讯保存收据增加区间计数，App 和首页负责最小导航接线。

## 施工验证

| 命令或证据 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=4 tests/review01.test.ts tests/lifeos-l6-review.test.ts tests/lifeos-l6-review-ui.test.tsx tests/run01-core.test.ts tests/run01-ui.test.tsx tests/news12-overflow.test.ts` | Windows Node 22.23.5，24/24 通过，其中本批 6 项。 |
| `npm run eval -- --chain weekly-review --mode replay` | 4/4，覆盖活跃周、逾期与失败、隐私投影和空周。 |
| `npm run eval -- --chain standard-extract --mode replay --recording live-20261115-baseline` | 8/8，事实 21/21。 |
| `npm run eval -- --chain news-relevance --mode replay --recording synthetic-v1` | 12/12。 |
| `git diff --check`（本批已跟踪文件） | 通过 |
| 隔离 Vite 构建及 Edge 界面自查 | 249 模块，保留已有体积警告。1440×900 与 390×844 均通过，横向溢出与意外控制台错误为 0。预期的 409 保留未保存备注。合成接口结果与截图位于 `%TEMP%/review01-ui-9PaHRS/`。 |

定向测试在临时目录核对 ISO 周边界、坏来源降级、假模型实际收到的最小字段及密钥拒绝。保存事实后制造一次人工版本竞争，模型返回时保留已审阅的人工结果。验证普通与显式重生成结束后 Wiki、Raw、Prompt 和工作事项 SHA 清单一致，自动化正式 Wiki 写入返回 403，备份恢复后的周报一致。假模型成功样例记账 1 次、80 输入 Token、24 输出 Token、未知用量 0。

施工只使用合成数据和假模型。真实 Provider、连接实际隔离产品服务的双尺寸验收、全量回归和远程 Windows Node 22/24 CI 由相应验收环节记录。

## EVAL01 恢复夹具返修

隔离全量首次运行时，EVAL01 合成恢复来源把新增的 `weeklyReview` 阈值一并写入 `thresholdHash`。标准提取运行器按链提取原有阈值，因此在来源摘要校验报 `Incompatible resume source`，夹具未到达原定的 `Product fingerprint mismatch` 断言。`tests/eval01-live.test.ts` 改用标准提取阈值生成合成摘要，并验证临时副本的标准提取阈值发生真实变化时仍在调用 Provider 前拒绝。生产检查和原有负例保留。

当前标准提取阈值投影与新增字段前的规范 SHA-256 相同，为 `6ea41141949c4d658ecfdf17fb7fd6ae5c0422f4a42502deb68374e2fb236e89`。原四份受保护录制的文件 SHA-256 均与冻结值一致。旧运行结果 JSON 当前未在原路径找到，来源文件的冻结 SHA 保留；本次未执行真实续跑。

Windows Node 22.23.5 执行 `node --import tsx --test tests/eval01-live.test.ts`，2/2 通过。标准提取、资讯相关性、周报三链离线回放分别 8/8、12/12、4/4，类型和差异检查通过。
