# B04 第三次返修独立验收（2026-10-06）

**确定性复验 PASS，F04-11 CLOSED，累计11项产品缺陷全部关闭。B04整批仍为 BLOCKED：缺用户配置的真实产品 Provider，真实成功与语义质量尚未实测。** fake不替代真实AI成功；本轮不签整批PASS，不进入未授权的B05。

独立验收实例 GPT-6.1 Sol High，依据 [冻结契约](../handoffs/B04-deepseek-prompt.md)、[第三返修卡](B04-recheck2-fix-card.md)、[施工第三返修报告](B04-repair3-build.md)。范围仅F04-11共享对象/证据引用残留和直接回归，验收方没有修改产品、status、批次卡或旧报告/证据。已合并 [主Agent独立构建与自测](B04-recheck3-main-checks.json)。报告日期按用户当前Asia/Shanghai日期2026-10-06；原始JSON文件名/时间为UTC2026-10-05T16点，两者一致。

## 实际结果与计数

| 组 | 结果 | 证据 / 范围 |
|---|---|---|
| 独立公开HTTP/文件业务 | **4/4 PASS** | 下表四场景；[首跑](B04-recheck3-http-2026-10-05T16-10-44.777Z.json)取3个有效PASS，[定点补跑](B04-recheck3-http-2026-10-05T16-11-22.996Z.json)取无重名对照。 |
| 产品运行冻结 | **PASS** | 47产品文件；两次均frozenChanged空，两个运行为同一版本。 |
| 施工产品指纹 | **PASS** | LLM service/commits/drafts/README四个声明完整SHA全部一致；前轮README文档差异已更正。 |
| 独立build / 自测 | **PASS** | 主Agent build 39 modules；101/101自测，20.312秒，stdout归档；不代替独立HTTP判断。 |
| 本轮真实浏览器 | **NOT_RERUN** | UI源码没变，[UI指纹](B04-recheck3-ui-fingerprint.json)与上一轮相同；保留[上一轮真实浏览器结果](B04-recheck2-browser.md)，不冒称本轮重新实操。 |
| 真实Provider | **BLOCKED** | [存在性记录](B04-recheck3-config-presence.json)为未配置，零真实调用，未读取真实Key。 |
| 施工证据文档SHA核对 | **DOC_HASH_MISMATCH** | 施工merge-payload声明与交付实物不符，单列文档证据差异，非产品功能缺陷；详见下述。 |

有效业务去重为4；另有产品冻结和产品指纹两个检查，因此本轮有效确定性检查为 **6/6 PASS**，不把DOC证据差异或真实Provider门禁混入该计数。两次脚本累计3.764秒，实际执行5次业务，但无重名对照重复执行只算1个有效场景。首跑对照的 `Cannot access 'formal' before initialization` 来自验收脚本局部结果变量遮蔽formal()函数，属于**验收脚本错误**；仅修脚本并重跑这一个场景。原JSON的FAIL原样保留、明确排除，未作为产品缺陷，也没有将整份首跑改成PASS。

汇总与完整指纹见 [独立JSON](B04-recheck3-independent-review.json)；生成器 [b04-recheck3-report.mjs](../../tests/acceptance/b04-recheck3-report.mjs)只整理已存在的独立记录，没有额外产品运行。

## F04-11 定点关闭证据

| 业务场景 | 实际输入/调用 | 独立断言与正式确认结果 |
|---|---|---|
| 同标题、同e1，有hint长文 | 112,012 JS字符；中文、空白、CRLF、emoji；15块、16次调用（含1次额外汇总） | 覆盖从0到全文末尾，块≤8,000、连续覆盖、并发≤2。实际汇总含15份独立块结构，每份3页、每个事实1条证据，共45引用全部带正确rawId/quote/全局位置；0 unresolved。聚合后3页证据ID唯一、所有fact引用有效、末尾证据保留；正式Source1＋页3、Log4行，所有引文/ID/位置与草稿一致。 |
| 同标题、同e1，无hint原失败请求 | 27,200字符；4块、5次调用 | quote-only证据经产品唯一定位；汇总12引用全带规范化位置，与最终草稿逐字段一致，0 unresolved。每块仍e1且chunkIndex对应本块，未被聚合改名/追加；正式Source1＋页3、Log4行，证据完整。 |
| 无重复标题、无hint对照 | 同样4块，12页、5次调用 | 每块快照独立，汇总12引用全部有效；12条建议完整保留并确认，正式Source1＋页12、Log13行。 |
| 普通单块 | 39字符，含CRLF/emoji；1次调用 | 无额外汇总，正常3页草稿、引用有效；确认Source1＋页3、Log4行。 |

四个场景都通过公开API启动实际产品提取、读取job/draft、明确调用confirm、再读取正式Wiki。所有事实仍引用有效证据，草稿及正式页的来源事实/证据保持完整；不以施工payload签PASS。所有多块场景都捕获到**实际产品适配器发往独立fake的汇总HTTP请求**，验证每块title/type/category/definition/facts/organized/inferences/questions/related字段保留，各块摘要与该块对应。

每块fact仍仅包含该块自己的原始e1证据，证据ID没有被改为e1-c2等，chunkIndex也未混入其它块；聚合页则允许按块重命名ID，但必须唯一且事实引用可解析。服务端规范化证据均满足 `Raw.body.slice(start,end) === quote`；汇总与草稿通过rawId/quote/start/end/chunkIndex逐字段核对。首块不再被后续块聚合污染，后续块也不再出现旧引用找不到新ID的 `resolved:false`。

四条有效链路均在提取前后对比Raw文件SHA相同，正式Source/Wiki/Index/Log零未经确认变化；确认后再次对比Raw文件SHA与公开API全文不变。正式页逐条核对fact文本、引用ID和原文引文/全局区间，数量及Log行数分别精确一致。测试的27次有效产品LLM调用全部是明确fake，不证明真实模型语义正确。

静态根因核对：`services/llm/service.ts` 的clonePage独立复制facts/evidence/文本数组/provenance，聚合仅改副本；第270行开始使用副本，第285行同时重映射该副本fact引用；第314行校验聚合引用。第357–361行汇总读取原块规范化快照，缺失引用明确抛LLM_MERGE_FAILED，已去掉成功继续的resolved:false兜底。上述正常有/无hint及聚合确认路径由独立HTTP证明；内部不可达缺引用保护分支为静态核对，不冒称独立HTTP注入过该内部故障。

**裁决：F04-11 CLOSED。** F04-01–10沿用 [第二返修独立关闭证据](B04-recheck2-acceptance.md)，本轮只新增关闭最后F04-11，没有将历史检查计数冒充本轮重测。累计11项产品缺陷全部CLOSED，当前确定性复验PASS。

## 独立版本与施工文档差异

运行脚本 [b04-recheck3-http.mjs](../../tests/acceptance/b04-recheck3-http.mjs)只import Node builtin，不import产品模块。新TEMP隔离目录、随机闲置localhost端口、自建独立fake和随机无效测试Key；启动真实产品服务，通过公开HTTP验收。鉴于历史已验证的沙箱rename/fetch权限限制，本轮使用批准的escalation；不把权限环境错误当产品FAIL。旧脚本/JSON/报告未覆盖。

47产品文件完整SHA在两个独立JSON与汇总中，运行前后无变化。施工四个产品声明均一致，包括LLM service `61e92017b99f4c8285e8301a160a60ed8f0a4bf52d1f5d0038519eb3cb8f05f8` 与README `6c371e193056c0ad92118b6a6dc3a1d9ef28f2b04e89e3d37d2d16116d62a9c0`；commits/drafts保持第二次返修版本。前轮README过期声明不再出现在本轮产品指纹。

主Agent在npm test前归档了两份会被自测重写的施工交付证据，并在main-checks记录副作用：

- [施工HTTP原件](B04-recheck3-builder-http-evidence.json)：SHA `68bfc519c95eba73c40a474ebf3705fbda4da5c6dc4a18b70219ff35393adbf4`。
- [施工汇总payload原件](B04-recheck3-builder-merge-payload.json)：实际SHA `5b2467777df3553e703497629932f131894d70d4ffc66d51790107db1299c519`；施工报告声明为 `f4976863160f4b662aa5837fffac8bb6ed04456b4da0ff466f93cfb533857f94`，不一致，原因未确定。

本实例对上述归档件重新读取字节核对SHA，见独立汇总；自测重写件单独保存。此DOC证据SHA差异透明保留，不称施工证据完全一致，不推断为产品缺陷，不改变基于自有HTTP的F04-11关闭判断。

## 未测边界与清理

没有重复UI、完整B02/B03、60秒超时/10分钟期限、全部错误/预算、取消/删除竞争和磁盘恢复矩阵；这些无变化边界保留历次独立证据。101项自测为主Agent本轮独立运行，已读取stdout位置与结果，但不等同本实例重新跑全矩阵。没有读取真实密钥或复用开发工具凭证。真实产品Provider成功、真实长文与语义质量仍BLOCKED，必须有用户用于产品的配置后才能实测；整批不能签PASS。

本轮5个自有产品进程实例与2个fake监听全部关闭；隔离TEMP fixtures、PID/端口、日志、前后文件SHA和HTTP证据保留于各JSON，正式workspace数据与他人进程未碰触。UI未启动新的实操服务/标签。验收方不改status/批次卡，B05未授权，止于B04第三返修验收。
