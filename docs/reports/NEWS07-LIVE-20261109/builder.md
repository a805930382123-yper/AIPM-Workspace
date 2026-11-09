# NEWS07-LIVE 操作交接

操作实例 news07_build（Terra High），基线 HEAD `234b5222eada2b8fe83ba8dbd515f12f18b6be84`；运行 `node --import tsx tests/acceptance/news07-live-20261109.mjs`，上海时间 2026-11-09 17:37:18–17:37:36。真实 NewsService/适配器，两轮各一次，模型调用 0，未改产品或正式数据。

第一轮快消5、AI5，耗时10089ms；Worldpanel/NIQ/AIHOT均ok。首轮5条快消构造成明确标记的2026-11-08隔离历史；第二轮快消2、AI5，耗时7804ms，Worldpanel空、NIQ/AIHOT ok；输出两条新NIQ，历史规范URL/标题未出现在结果，首轮历史URL没有第二轮详情请求。实际未补满5；原因含历史排除、候选不足和NIQ PDF预算。两轮各AI顺序、标题、链接、摘要与对应API响应前5一致；这不是对AIHOT原报道的核验。

同一实例同日第二次ensure前后请求数13→13，edition内容相同。两轮共21请求（13+8），全部HTTP 200；额外核对请求0，详情与PDF请求见 evidence.json。第一轮三家实际样本用本地完整结果和已采响应快照核对：Worldpanel目录标题/日期和正文摘录匹配；NIQ目录标题/日期、详情PDF链接和第10页摘录匹配；AIHOT对应API标题/链接/摘要匹配。请求与响应时间、状态、大小、SHA、各条标题/日期/链接、摘录长度及SHA和样本核对结果见 [证据](evidence.json)，完整响应留 ignored `node_modules/.cache/news07-live-20261109/`，不提交全文。

执行脚本当时使用固定隔离目录而非mkdtemp，未预先记录不存在；目录创建时间17:37:18、首轮状态文件创建17:37:29且首轮确发13请求，支持此次首次创建，但不能倒推证明运行前目录绝对不存在。实采快照 clone 当时未设置单独读取上限；实际最大PDF 6,583,033字节、HTML/JSON均低于2MiB，产品读取上限未修改。事后脚本改用mkdtemp与快照读取上限，**修改后未再运行或重抓**；最终脚本 SHA256 `EDFBA7CEDEA87373247DC1397293B8C8A1972652BC70C49F040097770EE80E24`。

新闻产品运行前SHA见 evidence.json；共享工作区另有PDF任务的package、lock、Raw、provider、server及UI等未提交修改，非本操作修改。未运行浏览器、真实模型或正式Raw；独立验收未执行。本轮实采成功不证明未来来源可用，第二轮未证明补足5。交接后停写。

可提交 evidence.json 已移除全部条目摘录正文，保留字符数、SHA256及 ignored 本地响应路径；原始核对基于本地完整结果及响应快照，没有额外网络请求。证据 SHA256 `3E73BCEB74E7E5D7BD03747C6B24F719FA46BB8BF4661508C78A68CD30BEF5F7`。
