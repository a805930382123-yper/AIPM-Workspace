# 开源复用记录

2026-10-29续接：本轮修复仅修改自有模板更新UI、Prompt上下文选段及隔离验收入口，未新增上游代码复制或依赖；既有逐文件复用与许可证记录继续适用。真实Provider当前证据见[集成报告](reports/B09-INTEGRATION-AUDIT-20261029-stages.md)，下方旧日期的BLOCKED记录保留其历史范围。

截至 2026-10-07 的早期核验记录：对下列项目只采用设计思想与数据模型思路，以 TypeScript 独立实现，没有复制其源代码。这里的 B01–B06 说明仅记录截至该日的实现边界和上游版本核验，不表示 B07–B09 尚未实现；后续批次状态见本文后续章节和交付报告。真实 Provider 成功与质量仍需独立验收。

## 已核验来源

- [LLM-Wiki-KB](https://github.com/chengjialu8888/LLM-Wiki-KB)：读取 README、scripts 目录、wiki_init.py、wiki_ingest.py 和 LICENSE。许可证为 MIT，版权原文 `Copyright (c) 2026`。
- [wiki_init.py](https://github.com/chengjialu8888/LLM-Wiki-KB/blob/main/scripts/wiki_init.py)：已读取 blob SHA `683f6fbd240d5aa1de36dd7557f527781d8ce524`。初始化检查存在性后创建目录与文件。
- [wiki_ingest.py](https://github.com/chengjialu8888/LLM-Wiki-KB/blob/main/scripts/wiki_ingest.py)：已读取 blob SHA `55f65da6e0ec403d6e8cbd5ec62211893b76c6da`。机械导入整理路径/元数据后向外部Agent返回指令。
- [llm-wiki-skill](https://github.com/lewislulu/llm-wiki-skill)：已读 README、[article-guide](https://github.com/lewislulu/llm-wiki-skill/blob/main/llm-wiki/references/article-guide.md)、[audit-guide](https://github.com/lewislulu/llm-wiki-skill/blob/main/llm-wiki/references/audit-guide.md)。README 声明 MIT；复制前仍须保存实际 LICENSE 和精确版本。

## 对应与改造

| 上游文件/逻辑 | 本地落点 | 差异 | 状态 |
|---|---|---|---|
| LLM-Wiki-KB/wiki_init.py：幂等初始化 | services/raw；workspace/knowledge | 按FMCG来源分类，保留prompts独立；不生成output/slides/charts、不依赖Obsidian | B01思想参考，独立实现 |
| LLM-Wiki-KB/wiki_ingest.py：Raw放置与来源元数据 | services/raw | 标题slug改UUID；原文字节内容保留与SHA256；无网页抓取/图片替换，无llm_instruction交给CLI | B01思想参考，独立实现 |
| references/schema-template.md、页面模板、Index/Log | rules/fmcg-schema.yaml、page-templates.yaml、services/wiki/store.ts | 六种页面类型，增加可信度/来源等级/审核字段，人工确认写入 | B02规则结构改编已实现；B04 的 AI 草稿、审核与显式确认路径已实现并通过确定性独立验收；真实 Provider 成功与质量仍 BLOCKED |
| scripts/wiki_search.py | services/wiki/store.ts内list/中文归一化 | 独立TS中文五字段检索，Unicode归一化；无qmd/Python依赖；排除index/回收文件 | B02思想参考，独立实现并实测 |
| scripts/wiki_lint.py | services/audit/lint.ts | 独立 TypeScript 只读扫描；冻结 11 类 findings，直接读取 Markdown 与 Raw，不自动修复或重建 Index | B06思想参考，独立实现 |
| llm-wiki/references/article-guide.md | services/wiki/store.ts、rules/page-templates.yaml | 沿用一个主题一页；按用户需求取消上游硬字数上限 | 已用于规划；B04实现；本地没有单独的 article-guide 文件 |
| llm-wiki/references/audit-guide.md | services/audit/service.ts、services/audit/lint.ts | 保留三段anchor与决议；AI仅提议，用户确认；deferred保持open | 已用于规划；B06实现；本地没有单独的 audit-guide 文件 |
| audit-shared/src/{anchor,schema,id,serialize}.ts | services/audit/service.ts | 独立 TypeScript anchor、schema 校验、UUID 与 JSON 持久化；支持本地版本门禁、Raw 引文校验和可恢复操作 | B06思想参考，独立实现 |
| llm-wiki/scripts/audit_review.py、lint_wiki.py | scripts/audit_review.ts、scripts/wiki_lint.ts | 以 Node/tsx 提供独立可运行的只读报告入口，不复制 Python 脚本，不依赖 Obsidian/Agent CLI | B06思想参考，独立实现 |

以后每批更新这张表，准确区分“代码复制”“规则改编”“思想参考”“未实现”。若复制/翻译改编实质代码，保存上游许可证到 THIRD_PARTY_LICENSES，源文件标注来源、版本、改动，不以“独立实现”掩盖复制。

协作方法参考官方 [OpenAI multi-agent 文档](https://developers.openai.com/api/docs/guides/agents-api/multi-agent)：独立子任务需清晰输入与返回结果，共享文件写入需要协调。实际模型参数以本次 Codex 调度工具支持的枚举为准，不把产品 API 模型列表混作开发 Agent 配置。

## B02逐文件核验

2026-10-03读取上游原文，blob SHA固定所读版本：

- [schema-template.md](https://github.com/chengjialu8888/LLM-Wiki-KB/blob/main/references/schema-template.md)：`e39ca15e47ae2c65db5fa82990d7e9648f8189da`。采用Raw不可变、Markdown事实源、索引/日志分离；改为用户确认的服务端写入、UUID和本项目六类页面。
- [page-templates.md](https://github.com/chengjialu8888/LLM-Wiki-KB/blob/main/references/page-templates.md)：`5d658e3268464fc229e456edb99b51a227773d40`。借鉴Source摘要/主张/连接、Synthesis证据/反证/待确认结构，中文字段与正文按本项目PRD；上游comparison不进入本产品。
- [wiki_search.py](https://github.com/chengjialu8888/LLM-Wiki-KB/blob/main/scripts/wiki_search.py)：`a42adf56dade3e2a56413acfa32aacf26d62c0f2`。借鉴可独立运行的全文检索回退思路，产品TS实现独立编写，不调用上游Python/qmd。
- LICENSE blob `14fac913ccf80234b1848540089a3bbcb6e5283d`；完整MIT文本保存于`THIRD_PARTY_LICENSES/LLM-Wiki-KB-MIT.txt`。规则采用结构改编归属；代码不宣称复制上游实现。

实际落点已核对，B02后端与浏览器证据见docs/reports/B02-acceptance.md；不将上游提供外部Agent指令的工作流等同为本产品的运行时LLM能力。

## B06 上游核验（2026-10-07）

- 仓库：[llm-wiki-skill](https://github.com/lewislulu/llm-wiki-skill)，检查的 `main` 分支网页/文件快照；GitHub 返回内容没有可固定的 commit SHA，因此不声称有不可变提交版本。
- 检查文件：`audit-shared/src/anchor.ts`、`schema.ts`、`serialize.ts`、`llm-wiki/scripts/audit_review.py`、`lint_wiki.py`、`llm-wiki/references/audit-guide.md`。仓库树中可见 `id.ts`，但本次对其原文读取未得到可验证内容，故不基于它复用实现。
- README 将项目声明为 MIT，但仓库中本次未能找到/读取实际 `LICENSE` 文件（raw LICENSE URL 返回 404）。声明不是已核验的许可证文件，不据此复制或翻译改编源代码。
- 本地未复制上述实现。采用的仅是 anchor、人工决议、只读 lint 的通用设计思想；本地代码按本项目的 Audit revision、整页 SHA、Raw snapshot、B04/B05 证据格式、串行 Wiki writer 和可恢复 operation contract 独立实现。未将 README 的 MIT 声明作为代码复用许可凭据。
- 精确核验对象、代码差异与未测真实 Provider 边界另见 [B06-build.md](reports/B06-build.md)。

## B09 最终复用边界

B09 没有复制两个上游仓库的产品源代码，也没有新增需要保留版权头的代码。B09 新增的演示 manifest、首页入口和归档 CLI 是本项目按冻结契约独立编写；不构成上游代码复用。

| 上游及固定版本证据 | 本地实际落点 | 参考逻辑与本地改动 | 未复用范围 / 许可边界 |
|---|---|---|---|
| `chengjialu8888/LLM-Wiki-KB`：已读 `scripts/wiki_init.py`（blob `683f6fbd240d5aa1de36dd7557f527781d8ce524`）、`scripts/wiki_ingest.py`（`55f65da6e0ec403d6e8cbd5ec62211893b76c6da`）、`references/schema-template.md`（`e39ca15e47ae2c65db5fa82990d7e9648f8189da`）、`references/page-templates.md`（`5d658e3268464fc229e456edb99b51a227773d40`）、`scripts/wiki_search.py`（`a42adf56dade3e2a56413acfa32aacf26d62c0f2`），并读取 LICENSE blob `14fac913ccf80234b1848540089a3bbcb6e5283d`。 | 初始化/Raw：`services/raw/store.ts`、`services/raw/assets.ts`；Schema/模板：`rules/fmcg-schema.yaml`、`rules/page-templates.yaml`、`services/wiki/store.ts`；搜索：`services/wiki/store.ts`；Lint：`services/audit/lint.ts`、`scripts/wiki_lint.ts`。 | 采用 Markdown 事实源、初始化幂等、来源元数据、知识模板、搜索与检查的设计思路；本地改为 TypeScript、UUID、本地串行写入、FMCG 六类型、Raw 不可变、人工确认、审计和本地数据目录。 | 未复制其 Python 脚本、`output/slides/charts`、外部 Agent 指令、自动抓取/联网研究或 Obsidian 工作流。MIT LICENSE 原文位于 `THIRD_PARTY_LICENSES/LLM-Wiki-KB-MIT.txt`；本地实现未因思想参考而引入代码许可义务。 |
| `lewislulu/llm-wiki-skill`：读取 `main` 分支网页/文件快照，没有可验证 commit SHA；读 `audit-shared/src/anchor.ts`、`schema.ts`、`serialize.ts`、`llm-wiki/scripts/audit_review.py`、`lint_wiki.py`、`llm-wiki/references/article-guide.md`、`audit-guide.md`。README 声明 MIT，但本次没有读到 LICENSE 文件，不能据 README 声明推定代码许可。 | Audit：`services/audit/service.ts`；Lint：`services/audit/lint.ts`；CLI：`scripts/audit_review.ts`、`scripts/wiki_lint.ts`。本地没有单独的 `article-guide`/`audit-guide` 文件。 | 仅参考三段 anchor、人工决议、只读检查和“一个主题一页”思想；本地按 revision、整页 SHA、Raw 引文、Wiki 写入队列及可恢复操作协议独立实现。 | 未复制或翻译上游 TS/Python 实现，不依赖 Python、Obsidian 或外部 Agent CLI。未读取上游 LICENSE，故不将 MIT 声明表述为已核验许可。 |

更细的文件证据和早期核验日期保留在本文件的 B02/B06 章节及 [B02-acceptance.md](reports/B02-acceptance.md)、[B06-build.md](reports/B06-build.md)。第二个仓库的 `main` 是活动分支快照，不能表述为固定版本；没有代码复制时也不把 MIT 文本列为新增许可证。
