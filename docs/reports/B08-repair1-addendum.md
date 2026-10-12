# B08 返修中追加边界缺陷

## F08-04 / P2：Wiki 多段拼接超出字符预算

独立 API 探针（施工返修未冻结时）创建五页，每页100段，段落含 Brief.goal，并生成成功。返回 usedChars=3002/3002/3002/2995/0、总12001，超过冻结单页3000/总12000。原因是 services/prompt-ai/service.ts context() room 未扣除拼接 `\n\n`。单段初始检查不足以覆盖此边界。

[原始实测](B08-repair1-context-boundary-pre-freeze-probe.json)，knowledge SHA 不变，隔离服务已关闭。前一次在途探针因施工中分类 schema 对象/ID转换尚未完成，合法 fixture 被502拒绝；该记录保留为在途观察，不算额外已交付缺陷。当前追加缺陷已交同一 Luna 修复，最终冻结后用 b08-context-boundary.mjs 重测。

要求分隔符计入单页与总硬预算，不足容纳分隔符/文本时停止，不出现超限、负数或错误空分隔。保留各页 used/source/truncated 反馈、只采用已选背景与知识隔离。B09未授权。
