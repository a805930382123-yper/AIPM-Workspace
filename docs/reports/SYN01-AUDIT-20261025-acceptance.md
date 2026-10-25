# SYN01 零调用工程准备独立验收

2026-10-25。独立审查角色：主 Agent 指派 Astra medium；按 agent-router 执行入口与 SP01–06，在 Sol 明确停写并经主 Agent 通知后开始正式验收。未施工产品、未修改旧证据、未提交 Git。

**本轮工程准备 SP01–06：PASS。SYN01 真实样本综合闭环：BLOCKED / NOT_RUN，尚未获得真实调用授权。全产品/B09：未通过，既有缺口保持。** 本轮未发现需要产品返修的缺陷；工程通过不关闭 A18/R20/R07 真实综合缺证，不覆盖 R12、模板字段/来源等级或四链桌面集成。

## 受测版本与实际命令

- 基线 HEAD `ba2d8541d061f06cca27ff7dc729d984472b0854`；产品 `60f83adba102d887fcd925df13a8021ff7669de1`。本轮只读 Git 差异证明 app/services/server/rules/package/lock 对产品提交无变更。
- Sol 最终工程 JSON SHA256 `46812e0bf09e959238bbfbf0aa8abb04a5a14c01e9c6e2e7df959df98a9656c6` 已实核。源码、fixture、任务卡及依赖冻结102项 aggregate `141c302d43fe0b2a7b0ff81b7df73f23c08dfad348f7caa7b0ee8eed70ef1985`，独立运行前后零漂移。
- 独立读取原提议卡、SP01–06、生产 createSynthesis/confirm/review、公开 knowledge routes、RawPage/KnowledgeWorkflowPage/API、全部5个新增施工文件及交接。实际组件依赖由生产实现导入，Raw/Wiki只读 adapter 调用生产 Store；未导入 server/index，也没有实例化真实 Provider 或调用配置加载器。

实际执行：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/SYN01-AUDIT-20261025-run.mjs
git diff --check -- tests/acceptance/SYN01-AUDIT-20261025-*
```

独立 runner 经自动审批允许本机隔离 HTTP 后执行，exit0，总命令约2.65秒。复跑已审查的冻结工程11组全部通过；额外自有6组通过（版本/188项历史冻结、原输入、模式/root拒绝、独立复跑、公开list/commit/export/references、重开全目录稳定）。两种计数有层级重叠，不合称17个独立业务场景。工程内部计时1167ms；本轮不重跑完整445/build，无产品变更且定点测试无未解决失败。

独立证据：

| 文件 | SHA256 |
|---|---|
| [自有运行及断言](SYN01-AUDIT-20261025-execution-2026-10-25T13-14-46-953Z.json) | `79011f10a11c6cc42caa99e29cb13f108be702c498bbdc57c168988e59a8820b` |
| [独立冻结工程复跑](SYN01-AUDIT-20261025-engineering-2026-10-25T13-14-47-846Z-f2dc6c9c.json) | `41ae98603f2e99c97cad945db3cb6b238c7b06d9d0da5d290e0ead131c0a9469` |

## SP01–06 裁决

| 标准 | 结论与实际证据 |
|---|---|
| SP01 | PASS。两份普通 report 的标题/全文与原卡精确匹配，独立UUID；A正文SHA `9b9315e337c79270e472d4fc2084c776a7259dfee9cb633fe6ce337d3da476d7`，B正文SHA `2bb56ff5456c3b0d35a3634f0ddcaac2e1ddd805620396bcb5019e1c6444bfb4`。初始无提取草稿、零调用。未读正式workspace。 |
| SP02 | PASS（fake工程）。实际 RawPage 查看原文、选择双来源后调用公开POST，生产 createSynthesis 单次fake生成新未审草稿；实际 KnowledgeWorkflowPage 展示分栏/来源/定位，事件执行移动、保存、审查、确认。最终2 Source+1 synthesis，均v1、来源对应、3条同operation日志。独立再开服务查询workflow list、commit完成/3个writtenIds，全部3页详情、export、references可用，Markdown与生产Store逐字相同。 |
| SP03 | PASS。同Raw去重400、会议origin403、坏正文hash409且fake为0；schema、未知Raw、quote、index各502，失败响应保留，无草稿或正式写入。未审、未解决、陈旧revision阻断；标题实改保存使approval失效，11个原unit不变，重审后才可确认。8处证据都符合所属Raw的UTF-16区间及quote。捕获revision6/key重复确认复用operation，23文件字节、3条日志及v1不增。已完成重启重复确认零fake；第2页写入故障产生WORKFLOW_COMMIT_PENDING，重启由1页恢复3页且同键幂等、零新fake。 |
| SP04 | PASS。本轮运行6次内存fake，真实0；知识241/500、Prompt15/24不变。默认fake/offline；real/未知、Provider/transport/config/release参数拒绝；提取/更新/Prompt/Audit/设置测试/arm入口403。进程守卫实测拒绝配置与正式数据路径2次、网络/transport/dispatcher4次；这些是拦截前拒绝，未读取实际内容。静态确认没有真实装配或release。 |
| SP05 | PASS。交接明确默认/direct/独立前缀/serve/重启/Ctrl+C命令；独立运行结果另存本前缀，未覆盖施工记录。正常、负例、实际组件、重启和故障恢复均运行；全部服务finally关闭，两个独立root的server.lock事后均不存在。API serve不含静态UI/Chrome入口，交接已披露；未来Chrome真实阶段需另卡装配。 |
| SP06 | PASS。工程与真实样本/全产品结论分开；真实质量和Chrome均NOT_RUN，无新真实放行，无真实账本消耗。H09/445历史证据只能说明同冻结工程，不能签当前真实质量。 |

独立主样本 workflow `cce9a9f7-d29e-4262-b561-92c4223ea7b3`，synthesis `e103e4f6-0d35-4b75-9415-2bc614636cf2`，operation `ac674623-cc0d-41d0-8f68-2e44836de640`；详细UUID/key/文件哈希在独立JSON。主样本位于忽略的 `.scratch-SYN01-PREP-K7I0sK`，恢复样本 `.scratch-SYN01-PREP-xpUN00`。只在故意破坏hash负例期间修改隔离Raw后finally恢复；生成/审核/确认/恢复/幂等均保全双Raw原字节，不能把故障注入描述为AI改写原文。

## 历史、失败与边界

历史HUMAN engineering188项逐文件SHA本轮独立核对一致；复用 [H09与445/build](KB02-HUMAN-CLOSE-20261023-acceptance.md) 的同产品冻结结果。没有再次运行历史整套测试，不把历史KB02未通过表述替换当前C已完成后的KB02结论。主 Agent 的C213/正式workspace保护检查属于主 Agent 证据，本报告不冒称自己执行。

施工保留的前期守卫过严、沙箱EACCES及恢复用例误期望HTTP200（实际201）均为工程脚本/环境失败，最终冻结独立实跑通过才签本轮工程PASS。独立正式测试首跑通过，无产品FAIL；只读准备时曾查询不存在的独立runbook/template文件，确认所有运行与未来说明已经合并于handoff，并未据此假称存在额外文件。

实际使用React/jsdom事件、localhost HTTP与隔离磁盘。**未启动Chrome，未做真实模型生成或质量验收。** fake是预置oracle，事实/冲突数值保全断言只验证接线和持久化；不证明模型能生成这些内容。人工标题编辑与原候选分别保留；未来须单列真实原稿质量与人工审查结果。未测试未知恶意插件/系统级网络绕过，不将本测试进程的守卫包装为全系统沙箱保证。

本轮范围内工程缺陷已无待修复项；SYN01真实样本仍缺真实产出、质量逐项核验及Chrome明确审查/正式回读；全产品还保留原缺口。下一步仅建议后续新卡：另获真实调用授权后，主 Agent 冻结唯一release和至多1次请求账本，再交付受控真实与Chrome入口。当前不能用旧额度自动调用。验收已停写，由主 Agent统一提交、核对远端并关联交付提交；无自动推进下一批。token计量不可得。
