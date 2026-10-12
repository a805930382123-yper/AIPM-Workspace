---
id: 808b55e6-8bb1-4f7c-b6a6-ca687e17f289
name: B07浏览器模板甲
category: business_analysis
categoryLabel: 业务分析
scenario: 关联失效后仍可保存其他字段
variables:
  - 客户名称
  - 业务流程
tags:
  - 浏览器
  - 中文标签
favorite: true
source: manual
version: 7
createdAt: '2026-10-07T08:43:13.427Z'
updatedAt: '2026-10-07T11:34:14.302Z'
relatedWiki:
  - id: 3e08a9b3-2030-4b25-ac57-37504b3fb78b
    title: null
    status: missing
---

# B07浏览器模板甲

## 场景

关联失效后仍可保存其他字段

## 输入要求

甲输入：销售材料

## 输出要求

甲输出：行动清单

## 示例

甲示例：铺货与回访

## 相关 Wiki

- （关联已失效） — 3e08a9b3-2030-4b25-ac57-37504b3fb78b（missing）

## Prompt 正文

 首行
请为 {{客户名称}} 制定 {{业务流程}}；重复客户 {{ 客户名称 }}。
尾部 
