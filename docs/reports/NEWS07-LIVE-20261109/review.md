# NEWS07-LIVE 独立验收

**真实采集与本次验证范围整体 PASS。** Worldpanel、NIQ 和 AIHOT 都取得可核对的真实内容，未发现违反冻结标准的产品行为。本次验证没有产品返修项，原 NEWS07 验收结论继续有效。

2026-11-09，上海时间 17:37:18–17:37:36。评分 0/1/0/0＝1，真实采集与持久化按 A 标准。Astra Medium 规划，Terra High news07_build 实采，Sol High news07_review 独立核查。受验提交为 `234b5222eada2b8fe83ba8dbd515f12f18b6be84`。逐项核对六个新闻产品文件与实采指纹一致。[任务卡](../../handoffs/NEWS07-LIVE-20261109-task.md) · [操作交接](builder.md) · [请求与结果证据](evidence.json)

## 两轮实采

| 操作 | 快消 | AIHOT | 真实请求与耗时 |
|---|---|---|---|
| 首次生成 | 5 条，Worldpanel 3、NIQ 2 | 5 条 | 13 次，均 HTTP 200，10.089 秒 |
| 同实例同日再次确保 | 首轮期刊与结果相同 | 首轮期刊与结果相同 | 累计请求数 13→13 |
| 复制首轮 5 条快消为前一天隔离历史，再生成 | 2 条，均为新入选 NIQ 研报 | 5 条 | 8 次，均 HTTP 200，7.804 秒 |

在第二轮真实目录中找到首轮全部 5 条的规范 URL 或标题，详情请求为 0。Worldpanel 目录可访问，排除历史后无快消条目。NIQ 请求 3 个详情页和 2 份 PDF，取得两条新内容。第三个详情页仍含公开 PDF 链接，当轮已经用完两份 PDF 的读取预算。短缺说明与日志相符，实测补位两条，未测得补足 5 条。首轮同日复用检查比较完整期刊对象及请求数，并核对最终持久化期刊与操作输出一致。

## 原文和状态核查

- 逐个重算 21 个 HTTP 响应快照的 SHA256，核对状态、请求时序及大小。HTML/JSON 均低于 2 MiB，最大 PDF 6,583,033 字节，低于 10 MiB。两轮目录和详情链均在既有三个来源内。
- Worldpanel 三条的目录标题、目录日期与详情页段落相符。2026 年前三季度样本的目录日期为 11 月 3 日，抓取时间为 11 月 9 日，两者各自来自对应记录。[Worldpanel 样本](https://worldpanelbynumerator.com/insights/china-fmcg-retail-market-q3-2026)
- NIQ 四条均有同轮官方详情链接和实际 PDF。独立重读首轮第 10、6 页和第二轮第 5、2 页，确认摘录来自对应页。第二轮包含商超渠道与春节消费研究，部分图表文字线性提取后顺序零散，产品已有材料等级提示。所有七条快消的自动数据期均为空，来源原文中的统计或预测仍可读。[NIQ 即时零售](https://nielseniq.cn/global/zh/insights/analysis/2026/2026-white-paper-on-moment-based-operations-in-instant-retail/) · [NIQ 春节消费](https://nielseniq.cn/global/zh/insights/analysis/2026/path-to-2027-a-forward-look-at-key-chinese-new-year-consumer-trends-2/)
- 两轮分别对照各自 AIHOT API 快照，全部五条的顺序、标题、外链、日期和摘要匹配。核验的是 AIHOT 摘要与 API 响应，原报道没有另行核验。[AIHOT API](https://aihot.news/api/v1/items?mode=selected&window=24h&limit=5)

## 复现与边界

实际实采命令 `node --import tsx tests/acceptance/news07-live-20261109.mjs`。独立执行 `node --import tsx docs/reports/NEWS07-LIVE-20261109/review-check.mjs`，退出 0，使用本机 git 忽略目录 `node_modules/.cache/news07-live-20261109` 的 21 个快照和 `result.json`，新增外部请求 0。原始 result SHA256 为 `0B518BE9E61748728034E55F5F63115A85DE32E4ACAF9F85795F848E1A3E744C`，独立脚本 SHA256 为 `6AED2984FC1A1C2DA487F16DC97F0AEC2F669973246DBF6385ED23D9C5BF8BB3`。产品文件指纹见请求证据。

提交证据 SHA256 为 `3E73BCEB74E7E5D7BD03747C6B24F719FA46BB8BF4661508C78A68CD30BEF5F7`。独立确认 17 条记录均只保留摘录长度和 SHA256，逐条与本地完整结果一致。

实际实采使用固定隔离目录。其创建时间与本次启动吻合，首个期刊在首轮请求结束时创建。执行前没有记录目录不存在。实采时的快照副本未单独限制读取大小，独立核对本次全部实际响应均低于产品上限。操作方随后为复现脚本补入随机隔离目录及快照上限，本次未用修改后的脚本重发请求。正式数据与配置未使用，产品模型调用 0。浏览器、真实模型质量和真实源故障情境不在本次实测证据中。共享工作区其他改动独立于本次验证。
