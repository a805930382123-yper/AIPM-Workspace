# SYN01 受控真实入口施工交接

2026-10-25，Sol High。施工完成、停写，交 Astra 独立核验新增接线；不自签验收。基线 `9bd732c0f7355447b067a471571819f732aa2844`，产品仍 `60f83ad`。只新增4个本轮工具源码及本轮报告；旧冻结、产品、配置、依赖不改，主 Agent 统一 Git。

已应用本轮明确要求的 Stop That Shit Skill：沿现有生产接口装配，没有重跑旧11+6、445或build，也未增加故障矩阵。主 Agent 报告 Chrome 工具初始化阻塞；本施工未排查浏览器工具，**真实调用0、配置读取0，知识241/500、Prompt15/24保持。** 真实SYN01/Chrome和全产品仍未通过。

## 新接线与自查

`core.mjs`：固定双Raw隔离prepare、源码/输入冻结、唯一主Agentrelease、不可变 `attempt-242.json` 的 exclusive+fsync 先落pending，再配置读取/一次Provider请求。只要attempt存在，pending/completed/failed及重启一律不能再次请求。`result-242.json` 分别保存产品结构验证成功或失败；无自动重试。失败也占242。fake分支不进入配置加载。真实分支只沿已有 `loadLlmConfig(.env.local)` 与 `OpenAiCompatibleProvider`，仅主 Agent 在工程通过后启动/放行。

`server.mjs`：只接受固定两个Raw的公开synthesis POST，顺序可不同；生产 `KnowledgeWorkflowStore.createSynthesis` 保持不变。其余生产工作流审查、patch、confirm、列表/回读直接复用 `registerKnowledgeRoutes`；装配实际App需要的Raw/processing/stats/recovery/draft/Wiki/schema/references只读路由。其他模型/写入口拒绝。Provider原始completion私有保存在隔离目录，原始合法草稿单独保存 `candidate-original.json`，不被后续人工编辑覆盖。导出不含鉴权，按当前Provider秘密扫描后才输出，编码/JSON包裹的秘密拒绝导出；重启丢失秘密扫描上下文时拒绝导出真实私有response，不为导出额外读取配置。

`cli.mjs`：prepare、serve（API+Vite真实App）、bindings、arm、status、export、stop。Vite `configFile:false,envFile:false`，不加载本地配置，代理/API与实际App同源。持久控制文件同session重启时替换地址，无自动外发；默认未武装。

最小 smoke 实际运行：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-REAL-20261025-cli.mjs smoke
```

最终exit0，19.18秒；[最终JSON](SYN01-REAL-20261025-smoke-1792935723154.json) SHA256 `d514139d15df59cdbc5cade261a26b87c4c626b085361c59b1f498c13b29debc`。3个顺序断言组：Vite实际main/App和proxy、未arm拒绝且0调用、绑定release；实际App从Raw选择→综合→明确审查/保存/确认→Wiki，Raw/Wiki/schema/references/export实读且Raw不变，再请求拒绝；重建服务后attempt242仍在、无再派发/配置读取。仅1次内存fake，无真实请求。WikiPage/AuditPanel迟到异步更新有React act提示；无断言失败，组件及Vite/API均已关闭。

首个同窄smoke成功报告保留；随后修正持久serve控制文件重启替换，并补导出秘密扫描断言，故用同一smoke复跑最终冻结。不混计为两套业务场景，不追加旧矩阵。pending/failed与completed共用同一不可变attempt存在性判断；独立者可不发fake请求，另用临时fixture断言这两个状态。

## 精确操作

在仓库根运行，依赖沿用现有安装。下面真实prepare/serve/arm仅供主 Agent 工程放行后执行；本施工未执行它们。

```powershell
# 生成新真实会话：打印 manifest、sessionId、root；此步不读配置/不调用模型
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs prepare

# 用刚才返回的manifest；打印 controlFile、api、url（Chrome使用url）
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs serve <manifest>

node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs bindings <controlFile>
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs status <controlFile>

# 主Agent按下述结构写唯一release，并取实际文件SHA256后arm
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs arm <controlFile> <releaseFile> <exactSHA256>

# 主AgentChrome在url里：Raw→多来源综合→选两条→生成；只允许一次
# 读取原稿、来源定位与分栏；质量可继续才进行明确审查/保存/确认/刷新回读
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs status <controlFile>
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs export <controlFile>
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs stop <controlFile>
```

唯一release JSON结构如下；bindings整对象精确复制bindings命令输出，不用手写Raw/冻结值：

```json
{
  "released": true,
  "issuedBy": "main",
  "issuedAt": "实际ISO时间",
  "mode": "real",
  "sessionId": "prepare返回ID",
  "sequence": 242,
  "maxCalls": 1,
  "bindings": { "samples": [], "freezeSha256": "实际值", "cardSha256": "实际值" }
}
```

本交接没有签发实际release。Chrome受阻时不要arm或触发；真实首个超时/schema/来源/质量失败保存证据并停止，不换样本/补调用。私有响应、attempt/request/result和原稿在`.scratch-SYN01-REAL-20261025-*`，被现有gitignore忽略。export保存新本轮报告，遇秘密则拒绝，不输出私有response。关闭可用stop或Ctrl+C；重启使用同manifest，attempt仍占用242，不清除账本或reset。进程异常留下lease时，重启只在原PID不存在时移除；活PID拒绝重复服务。

独立复跑只fake，输出自有报告前缀：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --input-type=module -e "const {smoke}=await import('./tests/acceptance/SYN01-REAL-20261025-smoke.mjs'); await smoke({reportPrefix:'SYN01-REAL-AUDIT-20261025-'});"
```

本机localhost连接需要已授权 `require_escalated`；不改变fake模式来处理沙箱限制。

## 冻结与剩余项

最终JSON包含107项源码/fixture/卡/依赖指纹，aggregate `f6455c07eb2150260f15165ea9c22be2901dcd76a6620007e02087ec9f249df0`，运行前后相同。受测工具如下：

| 文件（tests/acceptance/） | SHA256 |
|---|---|
| SYN01-REAL-20261025-core.mjs | 46364a4e23d1e22bcb08bc1e5eba8a35e70290afa9caf670ab5d99e724d41f7f |
| SYN01-REAL-20261025-server.mjs | b2fc8e3c817c508d1808638341bfb0fd4d022ea8b88d24ad305e45e29172013d |
| SYN01-REAL-20261025-cli.mjs | 530b6cf15ba25bd1e0c229746ddc4a50cc134162846b92f694ba01051d3077f8 |
| SYN01-REAL-20261025-smoke.mjs | b563d70b446cda274b9a52ed7a655ccfa8f75cdf9cdca2ac5305c4880f68363f |

`git diff --check -- tests/acceptance/SYN01-REAL-20261025-*` exit0。未发现产品缺陷。R01/R02新增接线待独立裁定；R03真实质量、R04 Chrome、R05实际调用收尾受浏览器工具阻塞未执行，不能以fake通过关闭。原SP01–06/H09工程及旧幂等证据复用，不冒称重跑；A18/R20/R07真实缺证、全产品/B09结论保持。当前全部自有服务关闭、源码停写，不进行Git或真实放行。
