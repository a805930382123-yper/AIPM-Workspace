# SYN01 零真实调用工程施工交接

2026-10-25，Sol High 施工。**施工自查完成，待 Astra 独立复审；此文不签批次验收。** 基线 `ba2d8541d061f06cca27ff7dc729d984472b0854`，产品 `60f83adba102d887fcd925df13a8021ff7669de1`。仅新增本轮 tests/acceptance 与报告前缀；产品、旧测试、依赖、配置、旧证据未改。AGENTS.md、.agents/、AGENT-ROUTER 和主 Agent 文件保留，由主 Agent 统一提交。

## 实际交付和验证

固定双 Raw 与原提议卡逐字核对；普通 report 来源、独立 UUID，未做提取。A 正文 SHA256 `9b9315e337c79270e472d4fc2084c776a7259dfee9cb633fe6ce337d3da476d7`，B 正文 SHA256 `2bb56ff5456c3b0d35a3634f0ddcaac2e1ddd805620396bcb5019e1c6444bfb4`。输入和 oracle 沿原卡，不改旧卡。

生产 `registerKnowledgeRoutes` / `KnowledgeWorkflowStore.createSynthesis`、实际 React `RawPage` / `KnowledgeWorkflowPage` 和实际 localhost HTTP/隔离文件均已运行。没有手写替代页面或通过 HTTP200 推定成功。新增 server 只装配本轮所需知识工作流和只读 Raw/Wiki 路由；内存 fake 只接受固定两个来源的 synthesis 请求，不装配配置加载器、Provider 实例、提取、更新、Audit 或 Prompt 模型路由。

最终命令：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-PREP-20261025-engineering.mjs
```

退出 0；11 组施工自查成功，脚本计时 1229ms（命令总耗时约 2.46s）。[最终 JSON](SYN01-PREP-20261025-engineering-2026-10-25T13-12-20-133Z-0122ed80.json) SHA256 `46812e0bf09e959238bbfbf0aa8abb04a5a14c01e9c6e2e7df959df98a9656c6`。其中有逐项结果、102 项受测源码/fixture/依赖锁/任务卡指纹、输入 UUID、operationId 和隔离路径，运行前后冻结不变。源码 aggregate SHA256 `141c302d43fe0b2a7b0ff81b7df73f23c08dfad348f7caa7b0ee8eed70ef1985`。

| 任务 | 已实际验证的施工证据 |
|---|---|
| SP01 | 固定 title/body 与旧卡精确匹配；独立 ID、正文 SHA、Raw 文件 SHA；无 extraction/draft。 |
| SP02 | RawPage 查看 Raw→多来源选择（不足两条按钮禁用）→真实公开 synthesis POST→新未审草稿；实际工作流组件查看来源、分栏、定位→保存/审查/确认；正式 Source×2+synthesis×1、版本1、来源列表、Raw references、日志3条及文件正文回读。 |
| SP03 | 同一 Raw 去重不足2=400；真实会议 origin=403；故意破坏隔离 Raw 正文摘要=409，均在 fake 调用前拒绝。schema、未知 rawId、坏 quote、坏 index 各502，保留 request/response，无草稿/正式写入。未审/未解决/陈旧revision拒绝；组件修改标题保存后 approval 清空，原11个 unit 不变，必须重审。卸载重挂载保持已审状态后明确确认。捕获相同revision/key重复确认 reused:true，23个隔离文件全部字节不变，日志/版本不增。完成后重启回读及重复确认零新fake调用。另注入第2个正式写入失败，生产提交清单保留，重启1→3页恢复，同键幂等且无新fake调用。 |
| SP04 | default=fake；offline 等同纯fake。real/未知模式及 Provider、transport、readConfig、releaseFile 参数拒绝；全部非本轮模型入口403。进程守卫拒绝真实配置/正式workspace读取、任意外网、其他网络transport及fetch dispatcher。仅精确自有loopback origin可访问且不跟随redirect。没有可武装的真实通道，没有实际release。 |
| SP05 | 默认/直接入口、独立reportPrefix、持久serve、restart/close及冻结见下。所有自有服务已关闭，未启Chrome。 |
| SP06 | 仅工程自查；真实质量/Chrome NOT_RUN，A18/R20/R07缺证不关闭，全产品/B09未通过。R12、模板/来源等级、四链集成不在本轮。 |

最终共6次纯内存 fake：4个非法响应负例、1次实际组件生成、1次故障恢复样本。**新增真实调用0，成功配置读取0，知识241/500、Prompt15/24保持。** Raw 故障测试曾显式追加虚构破坏正文，finally 恢复原字节；正常生成、审查、确认、恢复及幂等期间 Raw 均字节不变。保留所有失败和最终成功记录，不把故障注入或 fake 输出当真实模型结果。

## 运行、复跑与关闭

工作目录固定为仓库根，使用已有 node_modules；不安装、不构建，不配置密钥。

```powershell
# 同一最终窄测试，默认 selftest；每次创建新隔离目录和带时间戳JSON，不覆盖证据
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-PREP-20261025-cli.mjs

# 独立审查输出到 Astra 自有前缀
node --import tsx --import ./tests/support/css-stub.mjs --input-type=module -e "const {selftest}=await import('./tests/acceptance/SYN01-PREP-20261025-engineering.mjs'); await selftest({reportPrefix:'SYN01-AUDIT-20261025-'});"

# 仅本机fake API持久运行；stdout打印base/root，没有UI静态资产/真实通道
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-PREP-20261025-cli.mjs serve

# Ctrl+C关闭后，用刚才stdout的root恢复；不能选正式workspace或其他前缀
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-PREP-20261025-cli.mjs serve --root .scratch-SYN01-PREP-RIOJzx
```

selftest 的 finally 关闭每个 HTTP server、卸载组件、恢复进程守卫、移除自有 server.lock；fixture/失败输出留在被忽略 `.scratch-SYN01-PREP-*`。持久 serve 已实际启动于127.0.0.1:55954，随后 Ctrl+C；server.lock 不存在、监听端口已无记录（Windows终端退出码为Ctrl+C信号 `-1073741510`）。强制杀进程可能留下lock，下次启动只在原PID不存在时移除；活PID则拒绝重复服务。启动/恢复发现坏fixture或symlink拒绝，不清洗坏数据。

如果本机执行器拒绝 localhost（本轮实际 `EACCES connect 127.0.0.1:<自有端口>`），只能按授权申请沙箱外执行同一命令，不改变安全模式或网络边界。本轮获自动审批后已实际运行成功。第一次自查是守卫过严导致的工具失败；守卫改为精确自有端口。第三次自查已完成9组后，仅恢复样本创建接口预期误写200，修正为生产201后通过。所有原报告保留，均非产品失败。CLI 后置检查：`selftest --mode real`、`selftest --mode unknown` 均exit1/`REAL_OR_UNKNOWN_MODE_DENIED`；`selftest --real` exit1/`UNSUPPORTED_ARGUMENT`。

## 冻结、复用和限制

| 新文件 | SHA256 |
|---|---|
| tests/acceptance/SYN01-PREP-20261025-cli.mjs | ec84ed6d15c14ccf9132bca55c1e86919c5778ff6f36635483d09fc1dd770acd |
| tests/acceptance/SYN01-PREP-20261025-core.mjs | 193b7d6c5cca9db990702231a4afbc8726a29e4a7686226527e87b2ea7397a77 |
| tests/acceptance/SYN01-PREP-20261025-engineering.mjs | 1ede1c8323c508a8cca9c86a51cacdadb1acc77c38eb7168a1d0c132b6bb3251 |
| tests/acceptance/SYN01-PREP-20261025-fixtures.json | 74dd299b67656cba7d48c0b542bcc625d10f283b8a53d16b0970f4d73d95bd38 |
| tests/acceptance/SYN01-PREP-20261025-server.mjs | c38d7ea2d6697296f6329a1b52d34903c20078ba333b56b91837cb01faf49b59 |

已逐文件核对HUMAN历史188项指纹一致，历史engineering JSON SHA `73e85e39539c0064751a380ebcbbe7b349a38342777721782b22dcb57178aa53`；复用H09旧综合/迁移工程、历史445/build，不声称本轮重跑。`git diff --name-only 60f83adba102d887fcd925df13a8021ff7669de1 -- app services server rules package.json package-lock.json` 实际空输出；C213及正式workspace保护由主 Agent 基线负责，不代称施工测试。`git diff --check -- tests/acceptance/SYN01-PREP-20261025-* docs/reports/SYN01-PREP-20261025-*` exit0。

工程里没有真实Provider配置和外发实现，因此本轮没有需要签发的release模板或真实台账；未来要执行真实样本，须另获用户授权、独立工程放行及主 Agent 冻结唯一release/最多1请求账本后，由后续新卡另行交付真实入口。不得直接用本fake输出充作质量证据，也不得用组件JSDOM冒充Chrome视觉/质量验收。当前无发现需产品返修的缺陷；token计量工具未提供，不估算。

施工交接后停写，等待 Astra 对实际冻结源码、原卡及窄复跑独立裁定；主 Agent 统一提交与同步。
