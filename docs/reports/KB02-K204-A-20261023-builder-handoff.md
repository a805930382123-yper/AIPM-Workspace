# K204 阶段A接线施工交接

2026-10-23；HEAD `41ee7862305f71ae9a35c26b84a8db58dcc747c3`，产品 `60f83adba102d887fcd925df13a8021ff7669de1`。按 [A卡](../handoffs/KB02-K204-A-20261023-task.md) 施工。**施工完成、待Astra独立工程复审。真实0，知识219/500、Prompt15/24不变。A1/A2/A3至多5次只是用户范围；工程/逐段release尚未真实放行，B/C禁止，KB02仍BLOCKED。**

## 实物与边界

新增四个A前缀模块：core（持久release/状态/锁/账本/生产Provider出口）、server（隔离生产stores、B04/knowledge与必要HTTP路由）、cli（初始化/持久服务/状态/逐段arm/导出/停服）、selftest（显式fake注入与本地fixture）。产品、依赖、rules、实际配置、正式workspace及全部PREP旧资产不改。Sol没有读取真实.env、Provider探测、真实调用或Git操作。

正常真实路径使用现行OpenAiCompatibleProvider，不复刻发送器。complete参数与生产最终wire双层核对；实际fetch前核release/SHA、当前来源版本、请求顺序、序号和配额，保存无header的原请求body/hash及持久Raw/job/cp或inputDraft/target快照，fsync pending账本后唯一发送。请求头/Key不写证据；private response先保存至忽略的session根，已知秘密扫描通过才写可导出的result。秘密回显只保留hash/withheld结果并stop。生产结构/来源失败也从settlement或A3路由写永久stop，不能因HTTP200继续。配置身份hash仅保存在私有session，安全摘要只返回host/model；wrapper透传name/model/cacheIdentity/secrets。

实际fetch固定精确Provider目标、POST与生产wire并拒绝redirect；其它fetch只支持登记的127.0.0.1及窄init；http只支持URL[,callback]、私有Agent，拒绝二次options/customtransport/https。不把wrapper统计当全进程网络遥测。两个本地服务的sink0及源码一起作为边界证据。

真实入口没有单一--real开关；env不能把fake转换real。prepare不加载配置，serve/GET/刷新不外发；只在有效release、输入绑定与running状态之后构造生产Provider。每阶段一次开始、单独人工操作，不脚本自动审查/正式确认真实候选；A1 metric目标还追溯到真实A1原始候选及completed commit的page映射，不能造旧目标或人工改type凑证。A2/A3目标必须保留固定memo；A3绑定整个A2审批摘要、revision/digest与选中页决策，输入或目标编辑后旧release不能重绑定。

## 实际命令与结果

Node v25.2.1；完整离线命令：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-A-20261023-cli.mjs selftest
```

| UTC运行 | 结果和处理 |
|---|---|
| 12:47:37 | 沙箱exit1，正常localhost fetch遭connect EACCES，0fake/0real。原报告保留；自动审批允许后同字节隔离本地重测 |
| 12:47:49 | exit0，首版7组检查含正常2+2+1fake、schema失败stop、pending重启0send等 |
| 12:52:23 | exit1，并发双击测试假设首个promise必为202，实际胜者可相反；未发现双job。修正为核对恰有202与409 |
| 12:53:02 | exit1，模型fake及产品job已完成，但适配器session原子rename瞬时EPERM使完成捕获失败；工具诚实stop。按现有storage同样方式对**同一rename**作有界EPERM/EACCES/EBUSY重试，不重发任何请求 |
| 12:53:41 | **exit0，16组必要自查**，约5.80秒。正常5fake；三个A3输入/目标变更拒绝且loader/send0；提取/规划/来源/A2/A3非法和假秘密回显停止；账本失败0send；pending崩溃恢复stop且0send/0loader；请求前pending与双击/双进程锁等 |

见 [最终整轮自查](KB02-K204-A-20261023-selftest-2026-10-23T12-53-41-961Z.json)，所有历史时间戳失败保留。正常5fake与各负面fixture的fake次数在rows中分开；并非本轮总fake只有5。所有为本机synthetic配置/localhost HTTP，真实始终0。

另有 [timeout定向](KB02-K204-A-20261023-timeout-targeted.json)：fake-only直接complete使用20ms测试timeout对100ms本机fixture，1次pending后LLM_TIMEOUT并永久stop，后续Provider拒绝；没有改变真实产品提取60秒/600秒/2MiB、update90秒/256000字节限制。其命令为Node inline调用startFake→arm A1→begin A1→生产Provider.complete（既有正常提取wire）→断言LLM_TIMEOUT/attempt1/stopped。

**整轮pass之后的最后修改与验证分开：** server.close在在途阶段先永久stop并cancel，防停服等待期间启动规划；CLI改为显式选择空闲端口传Vite strictPort，fake重启归档旧metadata，关闭报告区分fake/real次数。对应 [shutdown定向](KB02-K204-A-20261023-shutdown-targeted.json) exit0：在途1fake后停服、attempt1、无规划；并实际启动了最终字节fake API/Vite独立端口。没有把12:53:41旧字节结果称作最终整套复跑；最终四模块完整selftest留Astra独立运行。

## 当前fake服务（不是真实执行）

最终字节服务保持运行供主AgentChrome/Astra复审：API `http://127.0.0.1:54806`，UI `http://127.0.0.1:54807`；精确root/sessionId/pid见 [fake-lab.json](KB02-K204-A-20261023-fake-lab.json)。仅合成arm A1，未提取、无真实配置。旧5173 fake服务已关闭；主Agent此前Chrome仅打开首页及固定208字Raw，此操作不冒称真实阶段质量验收。此最终服务由主Agent接管，Sol不在冻结后自动关闭它。

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-A-20261023-cli.mjs fake-serve
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs status fake
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs stop fake
```

fake-serve创建新合成session，先归档已有fake metadata；旧隔离root保留，不重写失败。真实serve重用同一prepare session；活pid的server.lock拒绝第二服务，死pid旧lease可清理但running/pending会永久stop，不恢复请求。自查fixture服务均已关闭，失败session/root保留审查。

## 真实使用接口（仅供主Agent/Astra工程PASS后）

```powershell
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs prepare
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs serve
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs status
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs bindings A1
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs arm A1 <release文件绝对路径> <该文件精确SHA256>
```

prepare使用wx，不覆盖既有真实session；生成三个released:false模板。serve不自动开始，实际URL/端口见新lab.json。arm只消费指定阶段，不发请求；主Agent/Astra随后通过UI固定Raw“生成草稿”或对应POST `/api/raw/<固定rawId>/extract`空对象启动A1/A2。重试/restart/planningRetry、其它Raw、B/C/all、重复段拒绝。A3只解锁合法绑定的POST `/api/knowledge/updates`，浏览器“生成旧Wiki更新预览”才发送一次。

真实release格式如下；**Sol未创建有效真实release**：

```json
{
  "sessionId": "prepare生成的id",
  "stage": "A1",
  "released": true,
  "issuedAt": "ISO时间",
  "allowedSequences": [220, 221],
  "maxCalls": 2,
  "cardSha256": "cf647671ee3ebd01fddd38f13ca83789fdde775bed7fa69be4df57ddf2b5658f",
  "adapterFreezeSha256": "本轮freeze.json完整文件SHA256",
  "previousEvidence": {
    "path": "docs/reports/KB02-K204-A-AUDIT-20261023-engineering.json",
    "sha256": "该独立JSON文件SHA256"
  },
  "bindings": {"rawId": "固定A1 Raw id", "rawSha256": "固定A1 body SHA"}
}
```

previousEvidence必须在Astra AUDIT前缀，JSON实际包含`stage:"engineering",pass:true`；A2/A3分别要求`stage:"A1"`/`"A2"`和pass:true。其余独立证据字段可保留。模板released:false或任意内容/哈希漂移均拒绝，且验证先于配置加载。release绑定当前完整freeze及源码指纹，提供SHA后不能再改其字节。

A2先在实际UI完整审A1、确认创建原生metric、通过Wiki编辑保存固定humanMemo并回读，再运行`bindings A2 <targetId>`；把原样JSON放入bindings，A2序号[222,223]/maxCalls2，前序A1独立PASS。A3先UI保存A2 update目标/决策、重审整个A2后运行`bindings A3 <targetId> <pageId>`；绑定rawId/rawSha、target{id,revision,bodySha256}、draftId/revision/reviewContentDigest/approvalSha256/pageId；A3序号[224]/maxCalls1，前序A2独立PASS。字段顺序及值使用bindings实际输出，不人工猜ID/摘要。每段返回awaiting_review，主Agent据独立证据签下一段；不会自动推进。

```powershell
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs export
node --import tsx tests/acceptance/KB02-K204-A-20261023-cli.mjs stop
```

export从当前服务内存已知secret集合扫描后输出A前缀报告，排除private response。若真实服务刚重启、没有本次进程的secret扫描上下文，则导出拒绝而非读取配置或假称已扫；普通状态/来源/草稿/正式回读仍可用，可由独立审查保留证据并核密钥后归档。停服期间如仍有在途调用会stop/cancel，不再调度新请求。

## 冻结和剩余风险

[freeze.json](KB02-K204-A-20261023-freeze.json)的files是四模块及188既有源码/配置/测试指纹，供真实release逐次核验；immutableEvidence另列本轮报告指纹。live lab/session metadata、真实release及私有.scratch不作为不可变源码，明确排除。未修改外部AGENTS/.agents/AGENT-ROUTER及主Agent/Astra资产。

接线仍须Astra检查实际差异、最终完整自查及独立边界；主AgentChrome只读接线证据不等于A1/A2/A3真实审查。实际Provider配置/模型可用性和真实输出质量未验证；任何实际失败停止并报告，不改产品或自动追加请求。只完成A也不能结KB02，B/C NOT_RUN。token计量不可得。
