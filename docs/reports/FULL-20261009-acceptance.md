# B01–B09 全项目检查验收（2026-10-09）

结论：**FAIL，当前不能宣告全项目验收通过。** 当前版本存在 2 项已复现的产品缺陷（高 1、中 1），另有交付文档证据引用问题；真实 Provider 成功与内容质量仍 BLOCKED。本轮浏览器工具初始化失败，新的真实浏览器操作 NOT_RUN。历史 PASS 不抵消新发现。

本次是整体检查验收，未修改产品代码、未部署。主 Agent 负责构建、测试、安全配置核对、复现和总判定；既有 builder 承担 Standards 只读审查，acceptance_monitor 承担 Spec 独立验收及矩阵核对。没有 Git 元数据，使用文件 SHA-256 冻结版本。

## 已确认问题

| ID / 严重度 | 触发与实际结果 | 影响 / 处理验收标准 |
|---|---|---|
| S-01 / 高 | Audit Provider 的合法成功 JSON 中含其已知测试密钥时，`POST /api/audits/:id/propose` 返回 201，HTTP 响应及持久化 Audit 草稿均包含完整测试密钥。 | 违反凭证不得进入内容/普通界面的约定（R41）。修复后须拒绝或安全处理回显；replacement、rationale、evidence 各字段都需验证，不创建含密钥草稿，不将密钥返回客户端。 |
| S-02 / 中 | 外部修改磁盘 Raw 正文但保留 frontmatter 的 bodySha256 后，RawStore 仍返回被改正文，B04 首次提取将其传给提取服务。 | 输入完整性/损坏检测缺口。不是“AI 改写 Raw”的证据。修复后应在消费资料前校验实际摘要，不一致时给明确错误，不按旧摘要继续生成。 |
| D-01 / 低 | 交付矩阵多项 B03 PASS 引用的是初次 FAIL 报告；验收规约仍将 B02 停止作为当前授权。 | 文档追溯与状态过期，不能因此反判 B03 功能失败。应引用 B03 返修 PASS 及当前完整验收结论，保留历史记录。 |

定位：S-01 为 [services/audit/service.ts](../../services/audit/service.ts) 第 98–115 行（成功输出未检查 secrets）；S-02 为 [services/raw/store.ts](../../services/raw/store.ts) 第 36–43、84–101 行及 [services/llm/jobs.ts](../../services/llm/jobs.ts) 第 94–96、135–158 行。D-01 的逐项映射见本次 Spec 报告及矩阵。

证据：
- [Standards 独立审查](FULL-20261009-standards.md)。两个服务级复现由主 Agent 再运行确认：[Audit](fixtures/full-standards-20261009/audit-secret-echo.root-recheck.json)、[Raw](fixtures/full-standards-20261009/raw-integrity-extraction.root-recheck.json)。
- [S-01 实际 HTTP 复核](FULL-20261009-audit-secret-http.json)：真实产品服务、真实 Provider 适配器、本地 fake HTTP 返回；实际发起一次已鉴权请求，响应与磁盘均命中虚构测试密钥，Raw 未变化，服务已关闭。没有调用真实 AI，没有使用或泄漏真实凭证。

## 本轮新执行

| 检查 | 结果 | 证据 / 限制 |
|---|---|---|
| 完整构建 | PASS | [构建日志](FULL-20261009-build.log)：TypeScript 与 Vite，45 modules，Vite 1.05s。 |
| 完整自动化测试 | 152/152 PASS | [测试日志](FULL-20261009-tests.log)，17.735s；包括服务与 jsdom 交互，不是实际浏览器。不能覆盖掉新增缺陷。 |
| B09 演示/手动链/恢复 HTTP | 7/7 PASS | [HTTP 证据](FULL-20261009-spec-http.json)。 |
| B05 提取、更新、综合、冲突/恢复 HTTP | 11/11 PASS | [知识链证据](FULL-20261009-spec-knowledge.json)。 |
| B06 Audit、Lint、版本与故障恢复 HTTP | 15/15 PASS | [Audit/Lint 证据](FULL-20261009-spec-audit-lint.json)；新增 S-01 不在旧回归用例覆盖内。 |
| B08 Prompt 生成、优化、确认/版本/错误恢复 HTTP | 15/15 PASS | [Prompt AI 证据](FULL-20261009-spec-prompt-ai.json)。 |
| 备份恢复 | 3/3 检查组 PASS | [备份证据](FULL-20261009-spec-backup.json)，含 18 个恶意归档拒绝用例、数据字节恢复及非空目标/符号链接保护。 |
| 前后端服务可达 | 4/4 PASS | [HTTP serving](FULL-20261009-web-serving.json)，页面 HTML、健康、统计、配置均 200；不代表浏览器交互已跑。 |
| 已安装依赖 | PASS | [npm ls](FULL-20261009-dependencies.json)，退出码 0。环境 Node v25.2.1 / npm 11.6.2 / Windows；未执行全新安装、跨系统或其它 Node 版本验证。 |

上述 AI 机械链路只用明确标记的本地 fake。实跑脚本、临时数据根和结果在各 JSON/Spec 报告中，可追溯至当前产品文件。解析格式能力、旧浏览器操作等未全部重新执行的范围以 Spec 报告明确列出的版本匹配历史证据为准，不冒称全部从零复测。

## 阻塞及交付边界

- [安全配置核对](FULL-20261009-config.json)：source=none，地址、模型、API Key 三项均缺。真实 Provider 成功、语义质量、真实模型长文覆盖仍未完成；开发协作模型并非产品 Provider。
- [浏览器执行阻塞](FULL-20261009-browser-blocker.json)：CUA 两次初始化失败，重置后仍是 `helper_unknown_error: setup refresh had errors`。本次没有新的页面点击、布局、剪贴板及原生下载验收。HTTP 与 jsdom 不能代替这些检查。
- 本轮不测试未承诺的 OCR、云部署、多租户、超出文档上限的数据量或其它操作系统。
- 修复 S-01/S-02 后需定向复验并回归关联知识/Prompt 链；之后配置产品 Provider，用合成资料补齐真实 AI 门禁。浏览器环境恢复后补跑实际桌面链路。

## 数据及证据保护

[基线](FULL-20261009-baseline.json)记录 72 个产品/运行文档文件、2 个用户数据文件及 688 个历史报告/fixture 文件。`npm test` 会覆盖两份 B04 历史输出，本轮已保存新输出并恢复旧文件。最终核对见 [完整性报告](FULL-20261009-integrity.json)。产品代码及用户数据保持原样；新增报告和复现脚本独立保存，旧报告不重写。各隔离服务运行后关闭，没有发布或配置后台监控。

## 109 项判据汇总

[本次独立 Spec 矩阵](FULL-20261009-spec-matrix.md)及[版本/映射核对](FULL-20261009-spec-mapping.json)：71 个核心产品文件与 B09 最终冻结版本完全一致，支持限定范围的历史证据复用。

- DOC（文档/静态符合性）：107 PASS、2 FAIL。
- RUN 汇总（本轮实测 + 明确标记的历史复用）：72 PASS、1 FAIL、36 BLOCKED。
- R41 的密钥保护为 FAIL；R46 是文档交付项，以 DOC=FAIL 判定。S-02 是补充工程完整性缺陷，不能把它误写为“已证实 AI 改写 Raw”。
- 上述 72 项不是“本轮全部重新操作通过”；逐行已标明新实测、历史复用及 fake 能力边界。新浏览器操作没有 PASS。

独立需求轴的完整判定、复用边界和检查耗时见 [Spec 验收报告](FULL-20261009-spec.md)。
