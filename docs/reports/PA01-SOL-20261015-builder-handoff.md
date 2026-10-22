# PA01 R1 Sol High 施工交接

2026-10-15。施工模型：GPT-6.1 Sol / High。**施工与受控自测完成，待用户指定的新窗口 Astra Medium 独立审查；本文不签批次 PASS，也不关闭原 FAIL。**

范围为 F-PA01-01–06。未读取/输出真实凭证正文，未真实外发。Prompt 真实账本仍为 **0/24**，KB02 仍为 **40/40**。未修改实际配置、正式 workspace、依赖/lock、ACL、全局 Git；未停用户服务、提交或部署。

## 接手基线与本轮实际改动

接手记录 [baseline](PA01-SOL-20261015-builder-baseline.json)：96 产品文件、56 默认测试文件、1732 既有保护文件。基线包含此前 Luna 未提交的实现；没有用全局 Git diff 归算本轮范围，没有回滚这些改动。

本轮相对基线仅修改以下 7 个产品文件，并新增 1 个默认测试文件；无产品/默认测试删除。精确逐文件 before/after SHA-256 在 [scope](PA01-SOL-20261015-builder-scope.json)。

| 文件 | 本轮新增修复 |
|---|---|
| app/pages/PromptAiWorkbench.tsx | 恢复目标缺失/版本冲突显示 alert 并阻断旧重写和保存；预览编辑不能清掉目标绑定；恢复使在途检查响应失效；返回原文或补充优化必须重新检查；显示已保留内容与中文下一步 |
| services/wiki/drafts.ts | 实际 DraftStore get/list 接入共享严格读盘校验；损坏 get 明确抛错，list 保留正常邻居并登记坏项 |
| services/storage/record-validators.ts | 新增 extraction draft 嵌套结构校验；兼容真实产品手工重定位证据的 chunkIndex=-1 哨兵值 |
| services/storage/recovery.ts | Prompt/知识草稿扫描复用实际 store 校验；深层结构坏项不会被浅扫描误清；完整复扫确认文件已不存在后清除旧观察问题 |
| services/prompt-ai/service.ts | 导出同一存储 validator；生成器草稿 Brief 也按共同契约验结构；Brief/generate 持久化安全调用诊断；schema 失败保留原调用 ID/时间/类型路径，rewrite 继续保存失败元信息；消费底层响应诊断；清理未使用导入 |
| services/prompt-ai/contract.ts | 非空白、名称单行、标签修剪后唯一、动态分类合法示例与渲染预算/规范化说明进入同源契约 |
| services/llm/provider.ts | 畸形 envelope、截断、空响应附安全响应元信息；finishReason 白名单与有限非负 usage；不改变调用能力策略/阶段预算 |
| tests/pa01-sol-recovery.test.ts | 3 个默认回归：坏草稿与健康邻居/手工证据、深层 Prompt 坏结构持续可见、文件移除后复扫清除 |

## 六项返修映射：接手已通过与本轮新修分列

| 项 | 接手已有且已保留的实现 | 本轮补齐与自测 |
|---|---|---|
| F-01 恢复快照/秘密 | schemaVersion=2、输入/检查/规则/目标关联/Provider 绑定、当前凭证 get/list/rewrite/replay/confirm 门禁；接手服务26/26及旧边界29/29已通过 | 生成器存储 Brief 严格性；扫描与同一存储 validator 接线。最终 F03–F06、H05/H06、E01–E05/E17/E18 全通过，嵌套/键/转义/短凭证、ready/replay/confirm 零外发/坏字节不改 |
| F-02 执行前读盘门禁 | commits/raw-state/jobs/workflows 已有共享校验、坏清单不执行；真实 R02 已修正确 | 发现 DraftStore 漏迁移，补 get/list 与嵌套结构验证；新默认测试、E19 正常邻居/坏 get，以及 R02/E08/E11/E12 实际恢复器均通过；未改提交事务或 KB02 算法 |
| F-03 编辑/恢复隔离 | 原文/补充/目标修改失效、双恢复乱序、手动 Wiki 选择及迟到保存收据已有实现 | 修 C15 实际 UI 门禁；补缺失目标、ready 预览编辑、在途 check→restore、返回重检、卸载隔离。组件15/15、扩展5/5 |
| F-04 持续有界告警 | 实际 wiki-commits/knowledge-commits 路径、健康 job id、根绑定去重、启动/运行发现、文件/字节/观察队列预算已有实现 | 修浅扫描误清深层坏草稿和已移除文件残留观察。F08–F13、R01/R03、E07/E09/E10/E13/E20 与3个默认测试通过；大记录/10001文件诚实 partial/overflow |
| F-05 安全错误 | 用户400/模型502、各类稳定 details、断连取消与检查保留已有实现；旧 E06 以现行实物复测已通过 | 补 Brief/generate 调用记录、schema失败元信息、底层截断/空/非法 envelope 诊断、UI保留内容/下一步。最终HTTP8/8、E06/E21/E22；六链62/62 |
| F-06 同源契约 | Brief/content/check 共同结构、B07 limits、动态枚举、确定性渲染与受控关联已有实现 | 补空白/单行/去重、动态合法例子和业务说明。E14–E16/E23/E24 覆盖九个Brief字段/总量、content字段/渲染总量/数组数量、checks/improvement字段类型长度/业务限制及三种合法示例 |

协议沿用 provider wire `version:1`/`pa01-1`、优化草稿 `schemaVersion:2`、B07 confirm 与旧完整草稿显式兼容。本轮未增加协议版本、自动重试或真实调用。

## 实际测试与构建

以下均为施工自测。localhost fake 和 jsdom 不能代表真实模型质量或真实浏览器。

| 检查 | 最终结果 | 证据 |
|---|---|---|
| 完整默认 suite | **237/237、0 skip**；20.272秒 | [结果](PA01-SOL-20261015-builder-main-tests-writable-copy.json)、[日志](PA01-SOL-20261015-builder-main-tests-writable-copy.log) |
| tsc + Vite | **通过**，3.710秒 / 1.863秒 | [结果](PA01-SOL-20261015-builder-build.json)、[tsc](PA01-SOL-20261015-builder-tsc.log)、[Vite](PA01-SOL-20261015-builder-vite.log) |
| 服务探针 | 26/26 | [结果](PA01-SOL-20261015-builder-preflight3-probes.json) |
| 实际 HTTP | 8/8 | [结果](PA01-SOL-20261015-builder-preflight3-http.json) |
| React + HTTP / jsdom | 15/15 | [结果](PA01-SOL-20261015-builder-preflight3-component.json) |
| 扩展恢复组件 | 5/5 | [结果](PA01-SOL-20261015-builder-component-extended.json) |
| 边界 | 35/35 组，E24另含逐字段正反例 | [结果](PA01-SOL-20261015-builder-preflight-edges.json) |
| 真实存储执行器/去重/根隔离 | 3/3 | [结果](PA01-SOL-20261015-builder-preflight-storage-supplement.json) |
| 六链凭证 / Meeting 来源回归 | 62/62 | [结果](PA01-SOL-20261015-builder-security.json) |

完整 suite 与构建在 `C:/Users/80593/AppData/Local/Temp/fmcg-pa01-sol-builder-fullsuite-Uwa1jA` 执行，产品96文件与默认测试57文件对最终冻结逐字节核对 `copyMismatches=[]`。副本保留供独审核查，原目录完整 suite 未执行，B04 历史报告未覆盖。构建由 process.execPath 启动 tsc/Vite，未用 npm.cmd。

复验入口（在仓库根运行）：

```text
node tests/acceptance/pa01-sol-20261015-builder-integrity.mjs verify
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-probes.mjs
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-http.mjs
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-component.mjs
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-component-extended.mjs
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-edges.mjs
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-storage.mjs
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/pa01-sol-20261015-builder-security.mjs
node tests/acceptance/pa01-sol-20261015-builder-fullsuite.mjs
node tests/acceptance/pa01-sol-20261015-builder-build.mjs
```

独立审查宜使用审查者自己的证据前缀；上列 builder 工具会重写同名 builder 自测输出。历史 main 脚本/报告原件只读保留。

## 失败保留与校准

- 旧脚本仅复制至 `pa01-sol-20261015-builder-*`，替换报告输出前缀，不删除或放松原断言。原 E06 当前实物29组首跑即通过；不是以 HTTP 单项代替边界。
- 组件接手旧 C15 timeout 是真实缺口。本轮初修后门禁已阻断，但 alert 文案未含原断言所需“版本/变化/过期/冲突”，自测仍14/15；[首轮](PA01-SOL-20261015-builder-component-initial.json)保留，改成明确“版本冲突”后15/15，未降低断言。
- 完整 suite [首轮232/234](PA01-SOL-20261015-builder-tests-initial.json)与[日志](PA01-SOL-20261015-builder-tests-initial.log)保留。审核编辑失败确认为严格校验漏兼容实际手工证据的 `chunkIndex=-1`；修 validator 而非业务编辑语义。并发/幂等首次失败仅能确定没有拿到第二份草稿，原输出不足以唯一归因；增强错误上下文的复制脚本保留全部原断言，定点两项2/2，后续两次完整237/237，不抹去首轮失败或伪造根因。
- 新增默认测试先实测2/3，抓到“观察队列已登记坏文件在删除后仍告警”；修复只在非partial完整扫描且 stat 确认 ENOENT 后清除。最终3/3包含在完整237项中。
- 构建第一次默认环境发现 `CONTENT_CONTRACT` 未使用（TS6133），[初始结果](PA01-SOL-20261015-builder-build-initial.json)/[日志](PA01-SOL-20261015-builder-tsc-initial.log)保留。仅删无用导入后刷新冻结并重新完整测试，最终237/237为该新冻结。
- 工具最初以 require_escalated 请求构建时等待授权约528秒并被主协调打断，未返回进程 session_id，不能冒称当时已开始构建。随后默认环境实际 tsc通过、Vite/esbuild因临时目录祖先读取 Access denied失败；按权限工具流程同命令授权重跑，最终两步通过。没有改ACL/换目录/换配置绕过权限。

## 冻结、保护与遗留

最终 [冻结清单](PA01-SOL-20261015-builder-main-frozen.json)、[相对接手差异](PA01-SOL-20261015-builder-scope.json)、[完整性](PA01-SOL-20261015-builder-main-integrity.json)。1732 个既有保护文件均不变，正式 workspace 未增加文件，实际配置哈希一致，冻结产品/默认测试不再变化。主协调额外新增审查入口 `docs/handoffs/PA01-astra-review.md`，不属于接手时既有保护清单；未因此排除任何既有文件。

自有 HTTP/fake harness 均按报告 finally 关闭；测试/构建子进程均退出。只读全局进程查询被系统拒绝，未据此声称枚举全机进程或终止任何未知服务。

真实 Provider、真实浏览器、其他操作系统未在本轮施工实测；本轮未改 ACL，未新造 OS 级 EACCES 文件夹具，不把目录/读取失败与预算测试冒称为该权限实测。既有 FULL3/KB02/PA01 独立 FAIL 不被施工自测覆盖；批次结果、真实质量及是否关闭六项由新窗口独立裁决。

**交接后停止产品与 tests 写入。未自动启动 Astra 审查、真实调用或下一批。**
