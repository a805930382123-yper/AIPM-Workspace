# STARTUP01 本机启动故障独立验收

本轮启动故障修复通过。真实工作台重启后，恢复检查和 B04 对账没有重现原报错，首页 Raw 整理和草稿来源恢复可读。损坏记录的原始业务内容未能完整恢复，不判定为全量数据恢复通过。WORK01 原验收结论沿用。

受验代码 `7165978d29898a46206f67131417b699295130a8`，产品代码无变更。依照任务卡，由 `/root/startup_repair` 施工、`/root/startup_review` 独立验收，两者为独立 Sol High 实例。[任务卡](../handoffs/STARTUP01-20261107-task.md)

修复前将本机数据复制到隔离目录，执行 `node node_modules/.cache/startup01-independent/boot.mjs before`，退出 0。使用实际 `server/index.ts` 和空模型配置启动，复现启动时报告四项 JSON 解析问题、B04 对账中止。HTTP 恢复检查随后返回五项，含运行时读取发现的一项。首页 `raw-task` 和 `draft` 来源报错，`audit` 和 `workflow` 仍可读。文件检查共发现六份无法解析的 JSON。完整写入史和损坏原因无法从这些字节确定。

施工先验证隔离副本，再核实并重启本项目的 `npm run dev` 服务。无法取得可信原件的六个文件转存到本机忽略目录，其中一份仍在使用的 Raw 状态重建为 `failed`，带明确 `STORAGE_CORRUPT` 说明。它列出的五页均由现存 Wiki、同一操作的写入日志和 Raw 引用证明。日志早于事务结束记录，只证明页面写入，不能证明剩余审核或整个事务完成。重建状态没有挂接缺失的草稿、原提交或历史作业。已删除 Raw 未复建。

独立验收以实际本机服务为准，执行下列命令，退出 0。

```powershell
node node_modules/.cache/startup01-independent/verify.mjs node_modules/.cache/startup01-repair/quarantine node_modules/.cache/startup01-repair/dev-out.log node_modules/.cache/startup01-repair/dev-err.log
```

- 逐字节对比修复前独立快照。六份原件在 `node_modules/.cache/startup01-repair/quarantine/` 保留原相对路径，105 份未损坏文件内容一致。
- 检查真实 API 4317 的新启动日志和健康接口。原两条启动错误未出现。前端 5173 返回页面，前端代理转发健康请求成功。
- 从真实服务读取恢复检查、首页、Raw、Wiki 和草稿接口。恢复问题为 0，首页四个来源均可读。修复状态与 API 一致，五页均返回成功并引用同一 Raw。

没有找回一份草稿、两份旧 Raw 状态的历史、一份提交清单、一份失败提取检查点和一份问答记录的原始有效内容。隔离副本和真实服务检查均未发起模型调用。本机原件和日志不纳入 Git。
