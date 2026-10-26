# SYN01-VERIFY 独立工程验收

2026-10-26，Astra medium。**V01–V02新增入口工程通过；可由主Agent按已授权卡准备新真实会话并放行唯一244。V03原稿质量及V04实际Chrome正式闭环尚NOT_RUN，SYN01整体及全产品未通过保持。** 独立工程fake1/real0/config0，知识243/500、Prompt15/24不变。

受测基线 `fcd0e23953e872d3f2bf733ef6d71617b7c98045`，产品SHA `eab0d663fb83835474f65fbaecd26df1a503d773dd26f2a7138c8dc7635a2032`。新增四工具为未提交工作树，108项冻结 **`0abd0b2cf140a3a0f0c8e44daa23346ae420373a18cc5e83a387822f5bf51a3f`**。施工交接SHA `98e8509db1142849fd632370f0bd722773cfbcc52b09923eac96027eefa58bca`，任务卡SHA `51cff955a0eef264f1cf87fa819877d5c4e804a726583c0d0f7aba024ee54d3b`。

## 实际审查

独立读取当前core/cli/精简smoke、施工交接及本卡；对core/server/cli用独立Node断言比较RECHECK原件，严格替换 `SYN01-RECHECK→SYN01-VERIFY`、`__syn01-recheck→__syn01-verify`、243→244及242→243后与新文件逐字相等，exit0。没有新增真实调度机制、配置捷径或放宽原稿导出。

固定sequence244/maxCalls1/knowledgeBefore243，旧根前缀拒绝；release绑定固定双Raw/SHA、会话、当前冻结，唯一attempt通过wx+sync先预占后读实际配置并外发；已有attempt无论结果均拒绝派发。原稿/请求/候选导出及秘密扫描沿用原机制。没有重开242/243，也没有245/246自动执行/预签release。

只复跑新增精简smoke一次：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs --input-type=module -e "const {smoke}=await import('./tests/acceptance/SYN01-VERIFY-20261026-smoke.mjs'); await smoke({reportPrefix:'SYN01-VERIFY-AUDIT-20261026-'});"
```

Node v24.20.0，Windows；执行权限用于本机Vite/API及子进程。session59642最终exit0，报告内耗时47842ms。独立[JSON](SYN01-VERIFY-AUDIT-20261026-smoke-1793002988310.json) SHA `399ebb4fea27d8a6c10792e52c3028a13fc6de04eb23673cc0cbf8a31ed03d91`。两个顺序组通过：

1. 当前产品/卡/新入口冻结、旧根拒绝、唯一244起243、未arm零调用、匹配release、实际Vite main/App/API可用。
2. 实际App在jsdom固定双Raw生成，捕获当前SEM提示/v1；fake1/config0，已有attempt拒第二次。明确审查/保存后GET候选和export可用，approval1、pending_confirmation，确认按钮可用，正式Wiki0，Raw文件不变。

完成后独立只读运行freeze()、重算报告SHA并对照固定aggregate，exit0；108项当前实物与施工、独立运行前后完全一致。产品及四工具SHA见冻结JSON，不依赖施工自述裁决。

completed/pending/failed重启不重派和正式确认路由复用RECHECK独立证据及本次精确源码等价，未冒称重跑。未跑SEM、旧2/13/33/3、tsc、全量、Vite构建、Chrome或真实Provider。既有5173占用，新Vite选5174；未触碰旧服务，自有Vite/API/DOM全部关闭，fake隔离数据保留gitignore根。

## 放行边界及续接

没有新工程缺陷，必要验收已满足。主Agent先确认Chrome可用，按交接VERIFY CLI执行prepare→serve新manifest→bindings/status；status必须attempt=null、knowledgeUsed243/configReads0，固定双Raw和上述108冻结一致。主Agent签sequence244/maxCalls1/mode=real的唯一release并arm，实际Chrome只生成一次，立即export原稿供独立质量裁定。

只有原稿质量通过才实际人审保存、确认并刷新回读两Source/综合页、来源/日志及Raw不变；原稿与人工修改分开。失败立即停；同语义核心再现不得加提示用245/246抽签。首成功完成闭环即足够，245–246仅为已授权但未安排使用的余量。最终export/status/stop并关闭自有标签。

本报告只签新增接线工程；新提示真实遵从及SYN01整体须由实际原稿和Chrome证据另判。独立者未读取实际配置/私有response、签真实release或修改产品，现停止追加工程检查。
