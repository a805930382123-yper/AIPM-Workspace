# 快消 AI 产品经理工作台 MVP

请帮我制作一个可以真实操作的「快消 AI 产品经理工作台」。

请直接完成可以运行的产品，不要只输出设计方案、页面图片或功能清单。

完成后，我需要能够真正打开页面并完成以下核心操作：

1. 导入行业文章、会议纪要、业务资料等原始材料；
2. 使用 LLM 将原始资料整理为结构化 Wiki 知识；
3. 对 AI 建议生成的知识进行人工审核后再正式入库；
4. 浏览、搜索、编辑、关联和维护个人快消行业知识库；
5. 对错误或不准确的 AI 知识提交纠错，并保留处理记录；
6. 对知识库运行基本健康检查；
7. 保存、分类、搜索和复用日常工作 Prompt；
8. 用自然语言描述工作任务，让 AI 帮助生成结构化 Prompt；
9. 对已有 Prompt 进行简单检查和优化。

第一版只做两个核心模块：

- LLM + Wiki 业务知识库；
- Prompt 工作台。

其中 Prompt 工作台包括：

- Prompt Library；
- Prompt Generator；
- 简单 Prompt Optimizer。

第一版不要加入复杂项目管理、CRM、PRD自动生成、竞品分析、多Agent、GraphRAG、复杂知识图谱、Prompt自动执行、多模型A/B测试等功能。

---

# 一、产品定位

产品名称：

**快消 AI 产品经理工作台**

英文：

**FMCG AI PM Workspace**

主要面向：

- 刚从其他行业进入快消行业的 AI 产品经理；
- AI解决方案人员；
- AI售前；
- 企业内部业务AI化人员；
- 需要快速学习快消行业和业务流程的相关岗位。

产品核心目标不是简单“存笔记”或“存提示词”，而是：

> 将每天接触的微信文章、行业报告、公司资料、客户沟通、会议纪要和个人学习内容，通过 LLM 持续加工成一个结构化、可关联、可追溯、可纠错、不断积累的个人业务 Wiki。

同时把用户日常的 AI 工作方法沉淀成可复用 Prompt，并通过 Prompt Generator 帮助用户：

> 从“我知道自己想让 AI 做什么，但不知道该怎么写 Prompt”，逐渐变成“能够形成稳定、结构化、可复用的 AI 工作方法”。

最终产品应该接近：

> **个人快消行业 Wiki + AI 产品经理 Prompt 工作台**

而不是普通聊天机器人。

---

# 二、整体产品结构

左侧导航第一版只保留：

- 首页；
- 知识库；
- Raw 原始资料；
- Prompt 工作台；
- 设置。

Prompt 工作台内部包含：

- Prompt Library；
- Prompt Generator；
- Prompt Optimizer。

不要第一版加入大量没有实际能力的菜单。

---

# 三、开源能力复用要求

本项目的 LLM + Wiki 模块不要从零重新设计。

优先参考和复用以下两个开源项目的成熟设计。

## 1. `chengjialu8888/LLM-Wiki-KB`

重点复用：

- Raw → Wiki → Schema 三层知识结构；
- Raw 原始资料不可被 AI 修改的原则；
- Wiki Markdown 文件结构；
- Wiki Index；
- Wiki Log；
- YAML Frontmatter；
- Wikilink；
- Source / Concept / Entity / Synthesis 页面思想；
- `wiki_init.py` 初始化逻辑；
- `wiki_ingest.py` 中原始资料机械入库部分；
- `wiki_search.py` 搜索思想；
- `wiki_lint.py` Wiki健康检查逻辑；
- Schema Template；
- Page Templates。

不要直接照搬：

- Marp；
- Chart；
- Canvas；
- 飞书导出；
- 与本产品无关的平台 Adapter；
- 非必要 Output 能力。

## 2. `lewislulu/llm-wiki-skill`

重点复用：

- Wiki文章拆分规则；
- 一个 Concept 尽量对应一个明确知识主题；
- 避免生成超长巨型 Wiki；
- Wiki 冲突处理规则；
- Audit 人工纠错机制；
- Audit open / resolved 生命周期；
- Audit anchor 思想；
- `audit_review.py`；
- `lint_wiki.py` 中 Audit 相关校验；
- `audit-shared` 中 anchor / schema / id / serialize 的设计思想；
- 操作日志设计。

不要直接照搬：

- 独立 Web Viewer；
- Obsidian Audit Plugin；
- 独立 Obsidian UI；
- 与本工作台重复的界面层。

如果实际复制上述项目代码，应保留原项目许可证和必要版权声明。

---

# 四、非常重要的架构原则

不要让工作台运行时依赖：

- Codex；
- Claude Code；
- Obsidian；
- 外部 Agent CLI。

这些工具可以辅助开发，但最终产品自己必须可以运行。

GitHub Skill 在本项目中的作用是：

> **知识管理规则和成熟实现参考。**

产品内部应该拆为四层。

## 规则层

保存：

- FMCG Wiki Schema；
- Wiki 页面模板；
- 知识写作规范；
- Audit规范；
- Prompt生成规范；
- Prompt质量检查规范。

## 工具层

负责：

- 初始化；
- 文件读写；
- 搜索；
- Lint；
- Audit；
- Markdown生成；
- Prompt保存和版本管理。

## LLM能力层

负责：

- 文档理解；
- 知识拆解；
- 分类；
- 去重建议；
- 关联建议；
- Wiki更新建议；
- Audit修改建议；
- Prompt需求理解；
- Prompt生成；
- Prompt优化。

## UI层

负责：

- 用户导入；
- 预览；
- 确认；
- 编辑；
- 搜索；
- 阅读；
- 纠错；
- Prompt创建；
- Prompt生成；
- Prompt复制。

不要让 LLM 直接绕过 UI 修改正式 Wiki。

---

# 五、知识库底层原则

知识库必须保留：

> **Raw → Wiki → Synthesis**

三层逻辑。

---

# 六、Raw 原始资料

Raw 是整个知识库的事实来源。

Raw 一旦保存：

> AI 不得修改正文。

用户可以手动删除或重新导入，但 AI 不得为了“整理得更漂亮”而修改 Raw 原始材料。

目录逻辑建议：

```text
knowledge/
├── raw/
│   ├── articles/
│   ├── reports/
│   ├── meetings/
│   ├── company/
│   ├── customer/
│   ├── notes/
│   └── assets/
```

Raw 来源类型包括：

- 微信文章；
- 网页文章；
- 行业报告；
- 公司资料；
- 客户资料；
- 会议纪要；
- 个人笔记；
- 其他。

每条 Raw 至少记录：

- ID；
- 标题；
- 来源类型；
- 来源名称；
- 作者，可为空；
- 原发布时间，可为空；
- 导入时间；
- 原始链接，可为空；
- 标签；
- 正文；
- 处理状态。

处理状态：

- 未处理；
- AI处理中；
- 待人工确认；
- 已生成知识；
- 处理失败。

---

# 七、资料导入

第一版支持：

## 1. 粘贴文本

用户填写：

- 标题；
- 来源；
- 链接；
- 标签；
- 正文。

适合：

> 微信搜一搜文章直接复制全文。

第一版不要开发自动抓取微信公众号文章。

## 2. 上传文件

优先支持：

- Markdown；
- TXT；
- DOCX；
- PDF。

如果解析失败：

明确提示失败。

不要假装成功。

---

# 八、Raw 入库逻辑的开源复用

可以参考 `wiki_ingest.py` 的：

- 文件放入 Raw；
- URL / 文件元数据整理；
- 文件命名；
- Markdown落盘；
- assets管理；
- 返回统一结果；

等机械逻辑。

但不要照搬：

> “生成 instruction 后让 Codex / Claude 继续完成 Wiki”。

本产品需要自己实现 LLM 调用。

也就是说：

```text
Raw
↓
工作台 LLM Service
↓
结构化知识 JSON
↓
用户审核
↓
Wiki Writer
```

---

# 九、LLM 知识整理

Raw 页面提供：

**AI整理知识**

点击后调用配置好的 LLM。

LLM不要直接返回自由 Markdown。

必须优先返回结构化 JSON。

建议格式：

```json
{
  "document": {
    "title": "",
    "main_topic": "",
    "summary": ""
  },

  "suggested_pages": [
    {
      "title": "",
      "type": "concept",
      "category": "",
      "one_line_definition": "",
      "source_facts": [],
      "ai_organized": [],
      "ai_inferences": [],
      "related_pages": [],
      "open_questions": [],
      "source_evidence": []
    }
  ]
}
```

其中必须严格区分：

### source_facts

原文明确支持。

### ai_organized

只是对原文重新整理。

### ai_inferences

原文没有明确说，是模型推断。

### open_questions

当前材料无法确认。

---

# 十、知识整理结果必须先预览

LLM返回结果后，不允许立即写入 Wiki。

进入：

**AI知识整理预览**

显示：

- 原始资料；
- AI建议知识条目；
- 条目类型；
- 摘要；
- 来源事实；
- AI整理；
- AI推断；
- 待确认问题；
- 相关知识建议。

用户可以：

- 选择部分知识；
- 全选；
- 修改标题；
- 修改内容；
- 修改分类；
- 删除建议；
- 合并建议；
- 放弃处理；
- 确认创建 Wiki。

只有点击：

**确认写入 Wiki**

才能创建或更新正式知识。

---

# 十一、FMCG Wiki Schema

基于开源 Schema 改造成：

**FMCG AI Product Manager Wiki Schema**

第一版 Wiki 类型只保留：

```text
source
concept
entity
business_process
metric
synthesis
```

不要增加十几种 Page Type。

---

# 十二、Source 页面

代表一份 Raw 来源的结构化摘要。

包含：

- 来源标题；
- 来源类型；
- 作者；
- 日期；
- 原链接；
- 摘要；
- Key Takeaways；
- 涉及概念；
- 涉及实体；
- 涉及业务流程；
- 涉及指标；
- 重要观点；
- 待验证内容；
- Raw链接。

Source 页面不是原文副本。

Raw 才保存全文。

---

# 十三、Concept 页面

适合：

- 快消；
- SKU；
- 动销；
- 铺货；
- KA；
- GT；
- Sell-in；
- Sell-out；
- 安全库存等。

统一结构：

```text
标题

一句话解释

定义

为什么重要

在业务中的位置

关键特征

常见分类

与其他概念关系

常见业务场景

待确认问题

来源
```

没有来源支持的部分不要强行填写。

---

# 十四、Entity 页面

Entity 用于明确的业务实体，例如：

- 企业；
- 品牌；
- 产品；
- 平台；
- 系统；
- 客户；
- 机构。

统一结构：

```text
名称

一句话说明

基本信息

在当前业务中的角色

相关业务

相关概念

相关流程

来源
```

---

# 十五、Business Process 页面

适用于：

- 经销商订货流程；
- 门店补货流程；
- 门店巡店流程；
- 促销执行流程；
- 库存管理流程。

结构：

```text
流程名称

业务目标

涉及角色

触发条件

输入

完整流程

输出

使用系统

关键规则

人工判断点

异常情况

痛点

可能的 AI 机会

相关指标

相关知识

来源
```

AI机会必须标记为：

> 分析建议

不能冒充来源事实。

---

# 十六、Metric 页面

例如：

- 动销率；
- 库存周转率；
- 缺货率；
- 覆盖率；
- Sell-in；
- Sell-out。

结构：

```text
指标名称

定义

业务含义

计算方式

适用范围

数据来源

如何解读

常见误区

相关指标

来源
```

如果不同来源公式不同：

同时保留不同定义。

---

# 十七、Synthesis 页面

Synthesis 用于综合多个来源。

例如：

> 快消行业渠道体系

可能综合：

- 微信文章；
- 行业报告；
- 公司内部资料；
- 客户访谈；
- 用户笔记。

Synthesis必须：

- 列出所有主要来源；
- 标出一致观点；
- 标出冲突；
- 标出用户仍需要确认的问题。

---

# 十八、Wiki Frontmatter

所有 Wiki 页面必须有统一 YAML。

建议：

```yaml
---
id:
title:
type:
domain: fmcg
category:
created:
updated:

sources:
tags:

knowledge_status:
confidence:
source_level:

review_status:
---
```

`knowledge_status`：

```text
verified
source_supported
ai_organized
inferred
needs_verification
```

`confidence`：

```text
high
medium
low
```

`source_level`：

```text
A
B
C
D
```

---

# 十九、来源等级

### A级

- 公司正式资料；
- 客户明确确认；
- 业务系统数据；
- 政府；
- 行业协会；
- 权威机构。

### B级

- 专业研究机构；
- 主流行业媒体；
- 有明确行业履历的专家。

### C级

- 普通公众号；
- 普通个人文章；
- 普通网络内容。

### D级

- 来源未知；
- 营销软文；
- AI生成但未经核验内容。

用户可以修改 AI 的判断。

---

# 二十、知识拆分规则

参考 `article-guide.md` 的 Divide & Conquer 原则。

核心规则：

> 一个 Wiki 尽量解决一个明确知识问题。

禁止生成：

> 《快消行业完整知识大全.md》

这种超长页面。

一篇文章如果同时介绍：

- 快消定义；
- 品类；
- 渠道；
- KA；
- GT；
- 经销商；

应该拆成多个知识页。

第一版不要设置死板字数限制。

原则是：

> 知识粒度清晰优先。

---

# 二十一、知识关联

使用 Wiki Link 思想。

例如：

`[[动销]]`

可以关联：

- [[铺货]]
- [[库存]]
- [[补货]]
- [[Sell-in]]
- [[Sell-out]]

第一版不实现复杂图数据库。

---

# 二十二、避免重复 Wiki

LLM提出新 Wiki 之前必须检查已有 Wiki。

至少检查：

- 标题；
- 别名；
- 分类；
- 相关标签；
- 内容相似度。

如果发现可能重复：

显示：

> 发现可能重复知识。

用户选择：

- 更新已有；
- 创建新 Wiki；
- 暂不处理。

禁止 AI 自动覆盖。

---

# 二十三、已有 Wiki 更新

新资料可能补充已有知识。

AI应该生成：

**Wiki更新建议**

显示：

- 现有内容；
- 新来源内容；
- 建议增加；
- 可能冲突；
- AI推断。

用户确认后才更新。

---

# 二十四、知识冲突

如果来源A和来源B存在不同表述：

不要让模型偷偷选一个。

Wiki明确显示：

```text
来源A观点

来源B观点

当前状态：
存在冲突，待验证
```

并进入待确认问题。

---

# 二十五、Audit 人工纠错

复用 `lewislulu/llm-wiki-skill` 的 Audit 思想。

Wiki页面提供：

**纠错**

用户可以对整页或某段内容提出：

- 错误；
- 警告；
- 建议；
- 补充信息。

后台至少记录：

```text
audit id
target page
target text
context before
context after
severity
comment
created
status
```

状态：

```text
open
resolved
```

---

# 二十六、Audit 处理流程

```text
读取 Wiki
↓
读取对应 Raw
↓
读取用户反馈
↓
定位目标内容
↓
判断是否接受
↓
生成修改建议
↓
用户确认
↓
更新 Wiki
↓
Audit → resolved
```

允许：

- accepted；
- partial；
- rejected；
- deferred。

Rejected 也必须保留记录。

---

# 二十七、Audit Anchor

不要只保存行号。

同时保存：

```text
anchor_before
anchor_text
anchor_after
```

保证 Wiki 后续修改以后仍然尽量能够定位原内容。

---

# 二十八、Wiki Log

只记录知识相关操作。

例如：

```text
2026-10-08

13:20 ingest
导入《快消行业渠道基础》

13:23 create
创建 [[KA渠道]]

13:23 update
更新 [[快消行业渠道体系]]

15:12 audit
修正 [[KA渠道]] 一处定义
```

首页“最近变更”读取这些记录。

---

# 二十九、Wiki Lint

提供：

**检查知识库**

第一版检查：

- Broken Wiki Link；
- Orphan Wiki；
- Index 缺失；
- Frontmatter 缺失；
- Source 缺失；
- knowledge_status 缺失；
- confidence 缺失；
- source_level 缺失；
- 无来源事实；
- 未处理 Audit；
- 疑似重复标题。

不要让 Lint 自动修改知识。

---

# 三十、知识搜索

搜索范围：

- Wiki标题；
- 别名；
- 标签；
- 正文；
- 分类。

必须适配中文。

第一版不要让 qmd 成为强制依赖。

如果存在 qmd：

可以作为可选增强。

没有 qmd：

工作台仍然必须正常搜索。

---

# 三十一、首页 Dashboard

首页显示真实统计：

- Raw数量；
- Wiki数量；
- 本周新增；
- 待确认知识；
- Open Audit；
- Prompt数量。

快捷操作：

- 导入资料；
- 新建 Wiki；
- 生成 Prompt；
- 新建 Prompt；
- 检查知识库。

---

# 三十二、学习地图

第一版不开发复杂知识图谱。

只提供分类视图：

```text
行业基础
品类
渠道
销售
门店
经销商
供应链
商品
数据指标
AI应用
公司业务
客户
其他
```

显示分类和 Wiki 数量。

---

# 三十三、Prompt 工作台定位

Prompt 模块不要只是一个“提示词收藏夹”。

它需要解决三个问题：

### Prompt Library

> 我以前有哪些已经验证过、可以继续使用的 Prompt？

### Prompt Generator

> 我知道自己想让 AI 完成什么工作，但不知道应该怎么写 Prompt。

### Prompt Optimizer

> 我已经有一个 Prompt，但不知道它是否完整、是否需要优化。

第一版实现：

> Library + Generator + 简单 Optimizer。

---

# 三十四、Prompt Library

支持：

- 新建；
- 编辑；
- 删除；
- 搜索；
- 分类；
- 标签；
- 收藏；
- 复制；
- 变量填写；
- 简单版本记录。

默认分类：

### 行业学习

- 快消术语解释；
- 行业文章学习；
- 行业结构拆解；
- 商业模式分析。

### 业务分析

- 业务流程拆解；
- AS-IS；
- TO-BE；
- AI机会识别。

### 客户

- 客户访谈；
- 客户需求整理；
- 会前Brief；
- 会议总结。

### 产品

- 需求分析；
- AI方案；
- 需求优先级；
- PRD；
- Eval。

### AI

- Prompt；
- Agent；
- RAG；
- 模型选择；
- 测试。

### 日常办公

- 会议纪要；
- 周报；
- 汇报；
- 邮件；
- 文档总结。

---

# 三十五、Prompt 数据结构

至少包含：

```text
id

名称

分类

使用场景

Prompt正文

变量

输入要求

输出要求

相关Wiki

示例

标签

收藏状态

创建时间

修改时间

版本

来源：
manual | ai_generated | optimized
```

Prompt可以支持：

```text
{{行业术语}}
{{客户名称}}
{{业务流程}}
{{产品名称}}
```

等变量。

---

# 三十六、Prompt Generator

Prompt 工作台提供主要入口：

**AI生成 Prompt**

它不是普通聊天页面。

用户首先只需要回答：

> **你想让 AI 帮你完成什么工作？**

例如：

> 我要第一次和经销商负责人访谈，希望了解他们现在的订货业务流程，并判断哪些地方未来可能适合 AI。

用户不需要一开始填写十几个字段。

---

# 三十七、Prompt Generator 工作流程

完整流程：

```text
用户自然语言描述任务
↓
AI理解任务
↓
AI生成 Prompt Brief
↓
用户检查和修改 Brief
↓
可选择相关 Wiki
↓
AI生成正式 Prompt
↓
Prompt Preview
↓
用户编辑
↓
复制 / 保存到 Prompt Library
```

禁止：

> 用户输入一句话后，系统立刻生成并自动保存大量 Prompt。

所有生成内容先预览。

---

# 三十八、Prompt Brief

AI首先把用户需求结构化为：

```text
任务名称

任务类型

Role

Goal

Context

Input

Tasks

Constraints

Output

相关Wiki
```

其中核心结构是：

### Role

AI需要扮演什么角色。

### Goal

最终解决什么问题。

### Context

当前业务背景。

### Input

用户会提供什么材料。

### Tasks

AI具体应该完成哪些步骤。

### Constraints

AI不能做什么，或者需要注意什么。

### Output

最终交付格式。

---

# 三十九、Prompt Brief 示例

用户输入：

> 帮我分析一个快消企业门店巡检流程，看哪些环节适合AI。

系统可以生成：

```text
任务名称：
门店巡检AI机会分析

Role：
快消行业AI产品经理

Goal：
分析现有门店巡检流程并识别AI机会

Context：
企业存在线下门店和巡检人员，需要了解当前人工流程

Input：
客户会议纪要、业务流程说明、相关Wiki

Tasks：
1. 还原AS-IS流程
2. 识别角色
3. 识别数据
4. 找出人工痛点
5. 区分传统自动化和AI
6. 判断AI适配性
7. 输出TO-BE建议

Constraints：
- 不虚构企业数据
- 资料不足必须明确标注
- 不把AI建议写成业务事实

Output：
- 业务流程
- 痛点清单
- AI机会表
- 待确认问题
```

用户可以修改后：

点击：

**生成 Prompt**

---

# 四十、Prompt Generator 场景模板

第一版只提供六类模板：

```text
行业学习
业务流程分析
客户访谈
需求分析
AI方案设计
会议资料整理
```

用户也可以选择：

> 自定义任务。

模板只是帮助 AI 确定结构。

不要把模板做成固定死表单。

---

# 四十一、Prompt Generator 与 Wiki 的关系

Prompt Generator 可以关联 Wiki。

例如：

生成：

> 门店动销问题分析 Prompt

系统建议：

```text
相关知识：

[[动销]]
[[铺货]]
[[Sell-in]]
[[Sell-out]]
[[库存周转]]
```

用户可以勾选或取消。

LLM生成 Prompt 时可以读取这些 Wiki 作为背景知识。

但是：

> 不要默认把整个 Wiki 正文全部塞进最终 Prompt。

只提取真正需要的背景。

---

# 四十二、Prompt Preview

正式 Prompt 生成后进入预览。

页面显示：

- Prompt名称；
- 分类；
- 使用场景；
- Prompt正文；
- Prompt变量；
- 相关Wiki；
- 输入要求；
- 输出要求。

提供：

- 编辑；
- 复制；
- 保存到 Prompt Library；
- 重新生成；
- 返回修改 Brief。

AI生成的 Prompt 不得自动进入正式 Library。

---

# 四十三、Prompt Optimizer

提供：

**优化已有 Prompt**

用户粘贴已有 Prompt。

例如：

> 帮我分析一下这个业务流程，看哪里能用AI。

AI不要简单重写。

先检查以下维度：

```text
任务目标是否明确

角色是否明确

业务背景是否足够

输入资料是否说明

执行步骤是否明确

约束条件是否明确

输出格式是否明确

是否要求区分事实与推断

是否有防止虚构的要求
```

---

# 四十四、Prompt Optimizer 输出

显示：

### 原 Prompt

原始内容。

### 可改进点

只指出实际存在的问题。

例如：

```text
缺少业务背景

没有规定输出格式

没有要求资料不足时明确说明

没有区分普通自动化和LLM能力
```

### 优化后 Prompt

给出完整优化版本。

提供：

- 复制；
- 编辑；
- 保存为新 Prompt；
- 保存为原 Prompt 新版本。

---

# 四十五、Prompt质量检查

不要输出：

> Prompt评分：92分。

第一版不做虚假的综合打分。

只显示检查结果，例如：

```text
任务目标        已明确
角色            已明确
业务背景        待补充
输入资料        已明确
任务步骤        已明确
约束条件        待补充
输出格式        已明确
事实约束        待补充
```

用户可以选择：

> 补充缺失内容后重新优化。

---

# 四十六、Prompt版本

同一个 Prompt 可以保存：

```text
v1
v2
v3
```

至少记录：

- 版本号；
- 修改时间；
- Prompt正文；
- 修改来源。

例如：

```text
manual
ai_optimized
```

第一版不需要复杂 Diff。

---

# 四十七、Prompt与Wiki保持松耦合

Wiki 是：

> 业务知识。

Prompt Library 是：

> 工作方法。

不要把 Prompt 直接存进 Wiki。

目录保持：

```text
workspace/
├── knowledge/
└── prompts/
```

Prompt 可以关联 Wiki。

Wiki 不需要依赖 Prompt 才能成立。

---

# 四十八、LLM配置

本产品没有 Coze 工作流。

彻底删除：

- Coze ID；
- PAT；
- Coze连接；
- Coze工作流状态。

Wiki知识整理、Prompt生成、Prompt优化：

统一通过同一个独立 LLM Service。

例如：

```text
services/
└── llm/
    ├── wiki_extract
    ├── wiki_update
    ├── audit_resolve
    ├── prompt_brief
    ├── prompt_generate
    └── prompt_optimize
```

第一版只要求支持一种稳定的 LLM Provider。

不要把 Provider 调用写死在 UI 中。

API Key：

- 不写入源码；
- 不展示完整值；
- 不进入 Wiki；
- 不进入 Prompt；
- 不进入 Raw；
- 不输出到普通日志。

---

# 四十九、建议项目结构

建议保持以下职责边界：

```text
workspace/

├── app/
│   └── UI
│
├── knowledge/
│   ├── raw/
│   ├── wiki/
│   ├── audit/
│   └── logs/
│
├── prompts/
│
├── rules/
│   ├── fmcg-schema.md
│   ├── page-templates.md
│   ├── article-guide.md
│   ├── audit-guide.md
│   ├── source-policy.md
│   └── prompt-guide.md
│
├── services/
│   ├── llm/
│   ├── wiki/
│   ├── search/
│   ├── audit/
│   └── prompt/
│
└── scripts/
    ├── wiki_init
    ├── wiki_ingest
    ├── wiki_search
    ├── wiki_lint
    └── audit_review
```

Markdown 是长期知识资产。

如果需要 SQLite：

可以保存：

- UI状态；
- 搜索索引；
- Prompt metadata；
- 缓存；
- 部分配置。

但 Wiki 必须可以单独导出为 Markdown。

---

# 五十、首页工作闭环

整个产品希望逐渐形成：

```text
外部资料
↓
Raw
↓
LLM知识整理
↓
Wiki
↓
业务知识积累
↓
Prompt Generator
↓
形成工作Prompt
↓
实际工作
↓
验证好用
↓
Prompt Library
```

这条闭环是产品的核心价值。

---

# 五十一、第一版明确不做

暂不实现：

- GraphRAG；
- 图数据库；
- 自动复杂知识图谱；
- Multi-Agent；
- Agent自动执行工作；
- 自动爬微信公众号；
- 通用网页爬虫系统；
- 自动互联网研究；
- SaaS多租户；
- 权限系统；
- CRM；
- 复杂项目管理；
- 飞书导出；
- Marp；
- Chart生成；
- Canvas；
- Obsidian插件；
- 独立Web Viewer；
- Prompt自动执行；
- 多模型Prompt对比；
- Prompt A/B Test；
- Prompt Marketplace；
- 自动Prompt评分；
- 自动Prompt Eval；
- 强制 qmd；
- 大模型自动修改所有旧Wiki。

---

# 五十二、核心链路一：知识入库

```text
微信文章 / 报告 / 会议纪要
↓
导入 Raw
↓
Raw 永久保留
↓
AI整理知识
↓
结构化 JSON
↓
知识预览
↓
重复检测
↓
用户确认
↓
创建 / 更新 Wiki
↓
建立 Source / Wikilink
↓
记录 Log
```

---

# 五十三、核心链路二：知识纠错

```text
阅读 Wiki
↓
发现问题
↓
提交 Audit
↓
Open
↓
AI读取 Raw + Wiki + Feedback
↓
提出修订建议
↓
用户确认
↓
Wiki更新
↓
Resolved
↓
记录 Log
```

---

# 五十四、核心链路三：Prompt生成

```text
描述想完成的任务
↓
AI生成 Prompt Brief
↓
用户检查 / 修改
↓
选择相关 Wiki
↓
生成正式 Prompt
↓
Preview
↓
编辑
↓
复制
或
保存到 Prompt Library
```

---

# 五十五、核心链路四：Prompt优化

```text
粘贴已有 Prompt
↓
AI检查缺失
↓
显示改进点
↓
生成优化版本
↓
用户编辑
↓
复制
或
保存为新版本
```

---

# 五十六、默认演示数据

提供少量虚构教学数据。

Raw：

《快消行业基础知识示例》

Wiki：

- 快速消费品 FMCG；
- 动销；
- 快消行业渠道体系；
- 门店补货流程；
- 库存周转率。

Prompt：

- 快消术语学习；
- 业务流程拆解；
- 客户会议总结；
- AI机会识别。

Prompt Generator 示例任务：

> 第一次访谈经销商负责人，了解订货流程和AI机会。

全部标注：

> 演示数据。

不要冒充真实公司资料。

---

# 五十七、视觉风格

专业、安静、长期工作型。

参考：

- Notion；
- Obsidian；
- Linear。

避免：

- 营销首页；
- 大渐变；
- 发光；
- 玻璃拟态；
- 巨型标题；
- 聊天气泡；
- 复杂装饰。

桌面优先。

---

# 五十八、MVP验收标准

知识库至少实际验证：

1. 能初始化个人知识库；
2. 能创建 Raw；
3. 能粘贴长文章；
4. 能上传 Markdown/TXT；
5. DOCX/PDF支持情况必须实际测试；
6. Raw保存后不会被AI修改；
7. 刷新后 Raw仍存在；
8. 能点击AI整理；
9. AI返回结构化知识；
10. 能区分来源事实、AI整理、AI推断；
11. AI不会直接写入正式 Wiki；
12. 用户可以预览；
13. 用户可以选择部分知识入库；
14. 能创建 Concept；
15. 能创建 Entity；
16. 能创建 Business Process；
17. 能创建 Metric；
18. 能创建 Synthesis；
19. Wiki有统一 Frontmatter；
20. Wiki能返回 Raw 来源；
21. Wiki能关联其他 Wiki；
22. 创建前能检查潜在重复；
23. 更新旧 Wiki 前必须预览；
24. 冲突来源不会被AI静默合并；
25. 能提交 Audit；
26. Audit能够区分 Open / Resolved；
27. Audit能定位被反馈内容；
28. AI可以提出 Audit 修改建议；
29. 用户确认后才能修改 Wiki；
30. 能运行 Lint；
31. Lint能检查坏链；
32. Lint能检查孤儿页面；
33. Lint能检查缺失 Frontmatter；
34. Lint能检查缺失来源和可信度；
35. 能中文搜索 Wiki；
36. 没有 qmd 时搜索仍然可用。

Prompt 模块至少实际验证：

37. 能创建 Prompt；
38. 能编辑 Prompt；
39. 能删除 Prompt；
40. 能搜索 Prompt；
41. 能按分类查看 Prompt；
42. Prompt变量可以填写；
43. 能复制最终 Prompt；
44. 能通过自然语言描述一个任务；
45. AI能生成结构化 Prompt Brief；
46. 用户能修改 Brief；
47. 能选择相关 Wiki；
48. 能基于 Brief 生成正式 Prompt；
49. AI生成 Prompt 不会直接进入 Library；
50. 用户可以编辑生成结果；
51. 能把生成结果保存到 Library；
52. 能粘贴已有 Prompt；
53. AI能检查 Prompt 缺失项；
54. 能显示具体改进建议；
55. 能生成优化版本；
56. 优化结果可以保存为新版本；
57. Prompt和Wiki刷新后仍然存在；
58. 能导出 Wiki Markdown；
59. 能导出 Prompt Markdown；
60. AI失败时不会写入虚假知识或空 Prompt；
61. 没有配置LLM时，Raw/Wiki/Prompt手动功能仍可使用；
62. 演示数据明确标识；
63. 电脑端可以完整完成核心流程。

---

# 五十九、开源能力复用验收

开发完成后，请单独说明：

## 来自 LLM-Wiki-KB

实际复用了哪些：

- 架构；
- Schema；
- 页面模板；
- init；
- ingest；
- search；
- lint；

以及哪些代码进行了修改。

## 来自 lewislulu/llm-wiki-skill

实际复用了哪些：

- article guide；
- audit protocol；
- anchor；
- audit review；
- lint；

以及哪些代码进行了修改。

不要只说：

> “参考了开源项目。”

需要明确到：

> **文件 / 逻辑 / 修改内容。**

---

# 六十、最终汇报要求

完成后告诉我：

## 已完成

真正完成的功能。

## 如何运行

- 如何启动；
- 如何打开；
- 数据保存在哪里。

## 开源复用

哪些代码或规则来自两个 LLM Wiki 项目。

## 测试

你实际执行过哪些验收操作。

## 未完成

明确指出。

## 已知风险

包括：

- PDF解析；
- DOCX解析；
- LLM输出格式；
- 中文搜索；
- 重复知识判断；
- 长文处理；
- API错误；
- Prompt生成质量；
- Wiki上下文过长；
- Prompt与Wiki关联不准确。

不要把未经实际验证的功能说成已经完成。

---

# 最核心开发原则

第一版成功不等于功能多。

第一版必须首先跑通两条主线。

## 知识主线

**Raw可靠保存**

↓

**LLM结构化知识提取**

↓

**人工审核**

↓

**Wiki创建与更新**

↓

**来源追溯**

↓

**搜索**

↓

**Lint**

↓

**Audit纠错**

## Prompt主线

**描述工作任务**

↓

**Prompt Brief**

↓

**生成 Prompt**

↓

**人工编辑**

↓

**保存到 Prompt Library**

↓

**长期复用**

同时支持：

**已有 Prompt → 检查 → 优化 → 新版本**

任何不能直接服务这两条主线的功能，第一版都不要增加。