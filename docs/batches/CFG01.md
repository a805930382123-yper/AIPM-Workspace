# CFG01：通用产品 Provider 配置入口

2026-10-14 用户续授权：GPT-6 Luna Max 子 Agent 完成剩余配置施工，当前主 Agent 独立审查验收。第二轮返修范围见 docs/reports/CFG01-20261014-repair2.md。原2026-10-13任务边界继续有效。用户已选择「尚未选定，先做通用配置入口」。主Agent独立验收。状态 PASS（2026-10-14，本机fake门禁C01-C07完成；真实Provider阶段除外）。

## 现状与目标

先读status、此卡，再按需读架构、product-spec §48/49。当前已有单一OpenAI-compatible Chat Completions非流式适配器、环境变量优先于项目.env.local、只读GET配置摘要及设置说明。设置页不能保存或测试；`server/index.ts`的refreshProvider实际只在启动执行，注释声称每请求刷新不成立，必须在本批修复。

交付一个完整本机闭环：设置页填写API Base URL、模型ID、password输入的新API Key→显式保存→只读回掩码→点击连接测试→成功/明确失败→页面刷新/同目录重启后可读；可修改地址/模型而保留旧Key、明确清除本机配置。不选择具体厂家、不增加多Provider管理器。

## 固定接口及行为

1. 配置仍存服务端项目根 `.env.local`，保持环境变量三字段优先规则，保留其它配置行/注释；不写workspace，不进业务备份/导出或版本库。仅服务端允许 `FMCG_LLM_CONFIG_FILE` 覆盖路径用于隔离测试/本机高级运行；HTTP客户端不能指定文件路径。未获授权不得改实际.env.local或真实凭证。
2. 新增窄小配置模块，集中校验、安全摘要、串行原子更新/清除、revision门禁及连接测试。读取失败（除ENOENT）明确报错，不能假装文件缺失再覆盖；写/rename失败保留旧文件且不报告保存成功，不输出文件正文/Key/系统原始错误。不改通用业务存储模块。临时文件不残留密钥；可用0600模式，不把Windows chmod称为完整ACL保护或加密。
3. `GET /api/llm/config` 保留旧摘要字段，增加可编辑的安全 `baseUrl`、opaque `revision`、用于写入/测试的 `writeToken`、`environmentLocked`。只返回安全地址/模型及固定Key掩码和是否存在；不返回旧Key或Key长度/首尾字符，不暴露秘密文件的裸SHA。revision可采用每进程随机HMAC，外部改文件/多页旧revision提交返回409；server重启后的旧revision亦冲突。
4. `PUT /api/llm/config` `{revision,baseUrl,model,apiKey?}`：省略apiKey表示保留现有本机Key，首次必须提供非空Key；显式空字符串拒绝。保存成功200安全摘要，无Provider调用；重复提交旧revision409。出现任一非空FMCG_LLM环境覆盖时配置编辑只读，写/清除拒绝为409并解释先在启动环境移除覆盖（页面不能改进程环境）；已生效环境配置仍可显式连接测试。不伪报本机保存已生效。
5. `DELETE /api/llm/config` `{revision,confirm:true}`：用户明确确认后仅删除三项本机配置，其它.env行/注释保持；无Provider调用。取消零请求。清除不能清掉环境变量，env覆盖时拒绝。回读无Key、AI明确未配置、手动功能可用。
6. `POST /api/llm/config/test` `{revision,confirm:true}`：仅测试已保存的有效配置；使用固定非业务探针、一条受超时（最多15秒）和响应体预算限制的请求。不发送Raw/Wiki/Prompt/Meeting或草稿，不写业务资产；不返回Provider原响应/Key/鉴权头，只给安全结果及耗时。鉴权、429、网络、超时、非法/空响应与凭证回显明确失败；用既有脱敏/非空凭证检查。连接可用不证明业务JSON/语义质量或36项真实AI已通过。测试前页面说明会向该Provider发送固定消息、可能产生少量API费用。
7. URL只接受无userinfo/query/hash/控制字符的HTTPS地址，HTTP仅loopback（127.0.0.1/localhost/[::1]）供本地模型与fake；禁止非http协议/完整chat/completions误填，支持自定义API路径与尾斜杠规范化。模型ID/Key有合理长度上限，拒绝换行/注入。地址/模型若包含新或保留Key应拒绝，不把Key变成可读字段。异常配置文件/环境摘要不得泄漏已知凭证。
8. 新管理路由仅接受本机可信Host/Origin、JSON与有效writeToken（自定义header `X-FMCG-Config-Token`），拒绝跨站Origin/null Origin/cross-site和伪Host；缺/错token403。不给跨站CORS授权。默认受信前端http://127.0.0.1:5173/localhost:5173及本机API同源；服务端可用`FMCG_UI_ORIGIN`指定隔离浏览器端口，不能由HTTP输入指定。无Origin的本机CLI可携带token操作；连接测试也受相同门禁。确保Vite代理Host/Origin真实浏览器可用。
9. 新AI请求使用此请求的有效配置快照，旧任务持有启动时Provider，不被之后配置修改串线；修复现有只在startup加载的问题。可用AsyncLocalStorage作窄请求上下文，让既有provider闭包读请求快照；不要全局currentProvider并发交换冒充请求隔离。不重写六链算法或S-03/S-04门禁。没有有效配置时只拒绝AI操作，配置页/手动功能仍可使用。

## 设置页

沿用已有Settings布局/样式；增加三输入及保存、测试、清除操作，不另起设计系统。API Key是空password输入、不提供显示旧Key或存localStorage/sessionStorage/URL；保存/清除后清空输入。已配置且输入为空时说明保留原Key。环境覆盖显示只读原因及原终端配置帮助。

页面加载/重新读取/保存/清除不自动测试；有未保存编辑时要求先保存再测。清除须confirm。busy防重复提交，卸载/迟到请求和输入变更后不显示旧成功，失败保留合理可重试信息；保存成功与连接测试成功分开表达。只读GET不把配置齐全写成“连接已验证”。操作不触发演示导入，原演示与备份说明保持。

## 文件所有权

- Luna：`services/llm/config.ts`及必要新`services/llm/config-manager.ts`、`server/llm-config-api.ts`、`server/index.ts`、`server/llm-api.ts`（仅原GET配置路由移交/装配）、`app/api.ts`、`app/pages/SettingsPage.tsx`、已有样式的局部设置页规则、`.env.example`；新增`tests/provider-config.test.ts`和`tests/provider-config-ui.test.tsx`；仅新增施工报告`docs/reports/CFG01-20261013-builder.md`。若需其它产品文件先给主Agent具体证据。
- 主Agent：本卡/status、architecture/README/usage及当前交付说明、独立`tests/acceptance/cfg01-20261013-*`和`docs/reports/CFG01-20261013-*`。
- 不得改旧报告/旧验收脚本/旧测试保护断言、正式workspace、实际.env.local、密钥/依赖、会议策略、备份资产白名单。不得完整npm test（会覆盖旧B04报告）；builder仅定向tests+build。主Agent保存并恢复旧输出后跑完整test。

## 独立验收门禁

| ID | 实测完成标准 |
|---|---|
| C01 | 实际HTTP空配置/首次保存/保留Key改地址模型/替换Key/清除/同根重启；有效生效，非LLM配置行字节保留，配置不进入业务备份 |
| C02 | 直接API校验/旧revision/外部改文件/env覆盖/read与rename故障/并发写；无假成功、无旧文件或业务资产破坏、无临时密钥残留 |
| C03 | 实际adapter→本地fake连接测试成功及401/429/超时/网络/无效/空响应/凭证回显；固定请求无业务正文，零业务写入；非测试操作零Provider |
| C04 | Host/Origin/token/content-type门禁真实请求；响应/错误/日志/前端状态不泄漏已知长短Key；S03/S04与Raw/Meeting来源保护回归 |
| C05 | 实际浏览器保存/password清空/刷新/测试/清除取消确认/env只读/迟到隔离，桌面及基本窄屏；jsdom组件补充异常边界不替代浏览器 |
| C06 | 新AI请求配置热生效、旧任务配置隔离；正常Brief/提取机械链路可运行，不签真实语义质量 |
| C07 | 独立build+完整tests、冻结/正式数据/实际本机配置/历史报告保护、自有服务关闭；Standards/Spec两轴和文档交接一致 |

## 排除与结束条件

不录入/寻找真实密钥，不替用户选择/购买Provider，不实现其它协议、多Provider切换、自动获取模型清单、自动探测或定时测试、36项真实AI补验、历史草稿清洗、云发布。fake及本机功能全部门禁PASS才签本批；未实测不得签PASS。Luna交接后停写，主Agent冻结独立验收；发现问题返回同Luna返修。用户之后在本机填写实际配置并明确点击测试，才能进入真实Provider阶段。


## 2026-10-14 最终签收

同一GPT-6 Luna Max施工与窄屏返修，主Agent独立签CFG01本机PASS，C01-C07、Standards/Spec通过。最新报告[CFG01-20261014-acceptance](../reports/CFG01-20261014-acceptance.md)。本轮报告/验收脚本使用20261014前缀，原20261013历史保持。完整测试215/215在字节相同的可写临时副本完成；原workspace因ACL产生EPERM未通过，未改ACL。真实Provider/36项语义门禁未验收、不部署。
