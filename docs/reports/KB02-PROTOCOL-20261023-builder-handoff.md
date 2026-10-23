# 固定协议实验执行器施工交接

施工完成、停写，交 Astra 独立复核。此为执行器工程交接，不是缺陷关闭、产品语义成功或 KB02 批次通过。当前实际 HEAD `13e4104e63150c10ec74b2ef2be36ae56c206fb2`，产品基线 `bb0f814`；未提交，由主 Agent 统一处理 Git。

仅新增本 PROTOCOL 前缀 runner、自查、默认关闭授权及本报告/指纹。冻结对象固定为 Astra 的 `KB02-PROTOCOL-AUDIT-20261023-experiment.json`，SHA `b8f28bdab8f9b3408703bd1201a2f7b613b34b7fb56bf2b874162438269d6ace`。原 REPLAN 前 8 请求不变，第 5 人工归属对照固定为第 9/10 请求。未改产品、原样本/oracle、历史报告、配置或状态文件。

执行器只序列化 `requests[].request`。硬绑定当前端点 `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions`、GLM-5.3-Flash、temperature 0、stream false、low、json_object；使用产品只读配置加载器，发前校验配置身份、冻结文件/逐请求/system/user/hash及产品调用基线。只读配置核对未暴露密钥。实际 Provider 在拦截 fake 下重构的 10 份 wire 与冻结请求逐字一致。

授权文件四项审批默认全 false。永久 started 标记采用排他创建；发前追加账本并 fsync，再核持久行。固定序列 210–219，从 209 起最多 10，累计不得超过 219/500。失败/网络未知结果均占一次，无重试、恢复重抽或首响应覆盖。普通 HTTP/JSON/schema/语义失败继续固定矩阵；凭证、配置、秘密、尺寸、预算和存储安全异常立即停。60 秒超时、192KiB 请求/输入、2MiB 响应上限；禁止重定向。安全合规完整响应按原始字节保存，秘密或超限体不保存片段。超时晚到不得落盘。

A 按当前 schema 及页覆盖、已知 unit、引用唯一、pass/OK、本页 fact、非空 reason 跨字段校验；B 仅允许 decisions 并检查精确页数。没有修补或提取 JSON 片段。输出只生成结构结果和事前 oracle 的初步逐页比较；Astra 必须结合完整原文、候选和原始响应独立核语义，不能机械按 bool 签验收。

实际有限自查命令：

```powershell
node --import tsx tests/acceptance/KB02-PROTOCOL-20261023-selfcheck.mjs
```

最终 exit 0，20/20（此前一轮 18/18，随后增加现行 Provider 精确重构及孤立账本防重两项），详见 `KB02-PROTOCOL-20261023-selfcheck.json`。包括精确发送/零 oracle、串行预记账、防重/未知结果、漂移/预算/预记账失败拒发、非法 JSON/schema/语义错误不修补、HTTP500继续/401停止、超时晚到、尺寸及原文/转义/百分号编码秘密。全部使用内存 fake，无服务器、套接字、产品或浏览器启动。3851 个产品/历史/规则/测试等保护文件及 63 个本机配置/正式 workspace 文件前后 SHA 一致（并行主 Agent status/control、本 PROTOCOL 与 Astra AUDIT 前缀按所有权排除）。本轮真实调用 0；累计 209/500，Prompt 15/24。

首失败记录如实保留于交接：第一次命令因 `/u` 正则非法转义 SyntaxError，未进入测试/外发；修正后第二次因沙箱禁止 Node spawnSync git EPERM，改为纯文件系统保护检查；第三次已跑完自查但 Node 新建仓库报告出现 EPERM，未获得可落盘结果。后续自查直接将证据写入 TEMP，最终目录 `C:\Users\DAVID~1.CHE\AppData\Local\Temp\KB02-PROTOCOL-20261023-S158kD` 保留全部 fake 证据；PowerShell Copy-Item 同样无权新建仓库报告，因此使用文件补丁工具保存原报告，源/目标 SHA 均为 `b23c2c45a1cc1bf920a269ea52329d8aa69d27b07337e40fa003e9ffd17afc19`，无结果改写。没有自动批准审查拒绝。

剩余执行条件：本沙箱普通 Node 进程无法新建仓库报告文件，Astra 应在独立检查并获主 Agent 工程放行后，通过有本仓库写权限的工具执行真实 runner；若持久化仍失败，runner 在任何发送前安全停止。不要迁移/删除 started 或账本来恢复已开始运行。真实入口（本施工未运行）：

```powershell
node --import tsx tests/acceptance/KB02-PROTOCOL-20261023-runner.mjs
```

授权文件四项开关仅由 Astra 在独立复核及主 Agent 放行后开启。自查工程合格不证明模型语义正确、统计可靠或产品修复有效；本 runner 没有提取/规划/草稿/正式确认链，不代替后续产品验收。施工现在停止写入，Astra 接管授权及真实运行产物。
