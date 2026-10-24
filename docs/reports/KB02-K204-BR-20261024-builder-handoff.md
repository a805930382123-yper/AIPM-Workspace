# K204 BR 隔离接线修复交接

施工及自查完成，待 Astra 独立工程复审。**新增模型0、配置读取0；原真实session没有写入。** 知识226/500、Prompt15/24保持，C未进入；没有签阶段B或KB02通过。卡SHA `a5116f4081abaf1ba927b59d10b4111cf684a6276c29784b1e60128ada4a4bbe`，基线 `c35a35009b7be2afc8159f14a10787428d16dae8`、产品60f83ad。原B实际FAIL和旧工程PASS、自动主题FAIL原样保留。

## 最小实际变更

仅新增三个BR模块与本前缀证据：

- server：固定原session/Raw/draft，直接注册现行生产 `registerKnowledgeRoutes` 的真实duplicates/decision及 `registerB04Routes` 的人工草稿/审查/确认。入口白名单仅允许当前draft编辑、review、confirm和create/defer decision；模型路由无条件409，旧arm不存在。Provider回调固定抛错；不导入/调用配置加载器或Provider构造器、不创建ExtractionRunner/LLMService、不启动或reconcile原job，不调用WikiStore初始化/提交恢复。
- cli：inspect/serve/status/export/stop/selftest。独立BR sidecar持久记录受控root文件集、草稿revision/hash和逐次变化；响应前保存sidecar，重开必须完全吻合当前受控文件集。CLI真实serve只能绑定原root，无自选root/real开关。API/UI端口独立；UI使用当前app，Vite `configFile:false,envFile:false`，显式空闲端口，避免读.env及回退5173。
- selftest：原结果副本+实际DraftReviewPage/jsdom/localhost调用链，不跑提取fake或旧整链。独立相似Wiki副本验证真实非空候选，不返回伪造空数组。

实际生产模块会间接加载provider.ts的现有校验/清洗函数；新BR代码没有导入构造器、没有实例化Provider或加载配置。运行中所有受测模型路径均在handler前拒绝，固定provider回调触发0；网络只允许登记localhost。计数与spy是本进程证据，不宣称全进程遥测。

[冻结](KB02-K204-BR-20261024-freeze.json)共207项，SHA **`a6345e9dbcd1742515c88662f0ab03765a4b485364be86b5f1151f672d2d1da6`**。包含原B202冻结、原B freeze、新BR卡和三模块，最终逐文件核无漂移。

| 模块 | SHA256 |
|---|---|
| cli | `aa2215e9457e7e151a97f412372e9cd50c5f411c8b8f5c2528592d23ddbd6fd4` |
| selftest | `6264a9dcd6caf3f895efb8dc16cf7b3c07f620d3d0c64de325a46dd7d5b1c7dd` |
| server | `0f0b073c9bc132ed7742c796795ac16781a1b4ed8ffe23fac6a50e1b4295e137` |

产品、旧A/B/PREP冻结、配置、正式workspace、主/Astra资产及外部AGENTS/.agents/AGENT-ROUTER均未修改，未执行Git。自查所有写入发生在 `.scratch-KB02-K204-BR-20261024-copy-*`，原 `.scratch-KB02-K204-B-20261024-J5hCNy` 始终只读。

## 实测命令与结果

Node v25.2.1 / Windows：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-BR-20261024-cli.mjs selftest
```

最终 [05-44-26-044Z自查](KB02-K204-BR-20261024-selftest-2026-10-24T05-44-26-044Z.json) exit0，11组，modelCalls0/configAttempts0，受测freeze与上表一致。自查约4秒；没有build/445/B提取fake/A整链。实际组件是jsdom，不能冒称Chrome。

- BR-E01：原16文件和卡列5个SHA、固定session/Raw/candidate/账本核实；错root/候选字节拒绝；启动/GET副本业务文件无变，重复服务拒绝。
- BR-E02：两页真实duplicates无候选返回200；另一个副本先创建相似正式Wiki，生产接口返回实际匹配且score≥0.35。create/defer保存正确、选中标记正确、旧revision拒绝，decision清全审。
- BR-E03：提取、update/synthesis、配置探测、prompt、job取消、旧arm、update decision、flag/env均拒绝；providerCallbacks0。fs.readFile/open及同步readFile配置访问spy0；未登记localhost实际sink命中0。
- BR-E04：实际DraftReviewPage在查询失败时显示错误，确认无正式写；恢复正常后加载→两页查询→人工标题编辑→保存→全页清审→两页明确审查→确认→正式回读通过。正常服务记录10次duplicates请求；5个原unit全对象不变。正式Source+metric2条，未选页仍经审查。原同confirm再调用reused:true，副本全文件SHA不变。重开服务回读相同，不自动修改；未知后续草稿字节漂移拒绝。
- BR-E05：原真实root16文件最终逐字节SHA与开始一致，原202及本次207冻结无漂移。export只选择Raw/draft/Wiki/受控变化及不变资产的hash，不读取或输出private响应、request header或配置。

真实原root的HUMAN修改/确认仍未实施。组件中人工操作和直接HTTP幂等仅发生在副本，不能替代后续主Agent Chrome验收。

首失败与处理均保留：

| 记录 | 处理 |
|---|---|
| 05:41:02自查 | localhost EACCES，2项/0模型/0配置；获本机权限后同字节重测。 |
| selftest-first-ui-failure | 保存按钮文案变“正在保存…”时，旧every(empty)使测试过早继续；另发现React act thenable无.catch，清理未完成。中断自有进程，改为必须找到且启用真实保存按钮，并在try/catch中await清理。未改产品/断言目标。 |
| 05:42:08自查 | 保留上述提前点击的实际DOM失败证据，0模型；报告已正确保存。 |
| 05:42:45自查 | 11项通过，随后仅CLI空闲UI端口修复，因此此轮不冒称最终字节结果。 |
| ui-first-failure | UI-only端口0被Vite解释成默认5173而冲突；改为先取得空闲端口再strictPort指定，envFile/configFile仍关闭。未启动原root服务。 |
| 05:44:26自查 | 最终字节11项通过。 |

[最终UI smoke](KB02-K204-BR-20261024-ui-smoke.json)：UI-only `http://127.0.0.1:54839` 的HTML和转换 `/app/main.tsx` 均200；API proxy未使用，未启动原session恢复服务，envFile/configFile均false。该UI已关闭，自查服务全部关闭，失败未结束进程已中断；当前没有BR API/UI服务交接。

## 工程签收后主 Agent 的准确接口

先运行只读inspect；独立工程PASS后再serve，不需要也没有模型release：

```powershell
node --import tsx tests/acceptance/KB02-K204-BR-20261024-cli.mjs inspect
node --import tsx tests/acceptance/KB02-K204-BR-20261024-cli.mjs serve
node --import tsx tests/acceptance/KB02-K204-BR-20261024-cli.mjs status
node --import tsx tests/acceptance/KB02-K204-BR-20261024-cli.mjs export
node --import tsx tests/acceptance/KB02-K204-BR-20261024-cli.mjs stop
```

serve固定root `E:\AI\Work\AIPM Workspace\.scratch-KB02-K204-B-20261024-J5hCNy`，session `0fb85966-323f-4cd8-a68e-040c8b573aa2`，Raw `3942d90b-0d66-4196-82bb-0acfdd14904a`，draft `4c2d4689-7827-4bec-a9d2-92517f12e3f4`。初次要求卡列初始v1、awaiting_review原session、225/226账本和原candidate精确匹配；不改旧B状态、metadata或release。

serve输出实际API/UI端口并保存BR `lab.json`；BR `control.json`指向独立 `.scratch-KB02-K204-BR-20261024-control-*` sidecar，不写旧session控制状态。sidecar `server.lock`拒绝重复进程；`control.json`保存完整业务文件hash集、最新草稿版本及每个受控操作的变化路径。实际Chrome保存/审查/confirm响应前才更新该摘要；原Raw/candidate/session/marker/账本/request/result/private/job/cp不能变。允许变化仅固定draft、对应raw-processing、Wiki/Source/index、commit/operation及Wiki log。

停止后重开仍运行同一serve：保留BR control/sidecar，服务读取最新受控版本，拒绝未知字节漂移；不重置v1、不自动审查或确认、不reconcile提交。若摘要或原始证据不符，停止并报告，不删除控制文件绕过。启动/GET文件无变化的副本证据见最终自查；主Agent启动原root后应再独立核对一次。

主Agent Chrome查看全部候选，按已批准HUMAN规则显式整理第二页、必要保存create/defer、保存后逐页审整份，选择正式创建页并明确确认，再刷新/重开。原事实/unit不改；原自动主题质量与人工组织选择分开记录。所有模型按钮即使被点击也被服务拒绝。

export采用当前受控文件集验证，生成BR export JSON和SHA，private响应/配置排除；不会为了导出加载配置。真实Chrome后独立审查可从sidecar逐版本变化及磁盘commit核对，再执行原同一次confirm幂等。原B工程FAIL不能仅凭本次HTTP200关闭阶段；真实全过程须独立裁定。

剩余：Astra尚需独立工程检查与主Agent实际Chrome/正式回读，当前不签本轮缺陷或阶段B最终PASS。若新失败出现，保留现场停止，不能再发模型或扩大产品修改。token计量不可得。

本报告落盘后停止BR源码及报告写入，交 Astra 独立复审。
