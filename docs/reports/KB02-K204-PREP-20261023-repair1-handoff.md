# K204-PREP P04 repair1 施工交接

2026-10-23。按主Agent批准，仅修复离线工具网络guard及本轮回归。**施工定向自查完成，等待Astra独立复审；真实0、219/500、Prompt15/24不变。KB02仍BLOCKED，真实质量NOT_RUN。** 不自行宣布准备工具或批次验收通过。

Astra已实证原guard缺陷：[独立失败证据](KB02-K204-PREP-AUDIT-20261023-network-permitted.json)。已登记localhost A的fetch 302会自动转到未登记localhost B；http.request(URL,options)会用二次port/path覆盖实际目的地址。原externalSent固定0不能证明外发限制。此次不改写旧报告、旧freeze、卡或spec；原P04通过自查已被上述独立失败推翻，不能继续引用它代表最终有效防护。

实际只修改 [support.mjs](../../tests/acceptance/KB02-K204-PREP-20261023-support.mjs) 的guardNetwork：

- fetch只接收string/URL；拒绝Request对象及未知init字段/accessor，仅复制method/headers/body/signal这些已需字段。禁止dispatcher、redirect参数及init URL/host覆盖。固定manual重定向，收到3xx即取消响应体并拒绝，不发第二跳。
- http.request/get只支持URL[,callback]；拒绝options-only和二次options，因此host/port/protocol/path、socketPath、lookup、agent/createConnection无法覆盖。标准HTTP使用私有Agent，避免globalAgent自定义transport；https仍拒绝。
- 删除externalSent常量。保留的blocked/localRequests等仅是wrapper记录，**不是全进程网络遥测**；实际未登记sink命中以两个本地服务的独立计数证明。不扩为通用防火墙，也不声称抵挡任意进程内代码改写或其它网络库。

新增 [repair1-network.mjs](../../tests/acceptance/KB02-K204-PREP-20261023-repair1-network.mjs) 复现两项独立失败并覆盖必要变体。只使用两个127.0.0.1 fixture服务，没有真实Provider或外部主机请求。运行命令：

```powershell
node --import tsx tests/acceptance/KB02-K204-PREP-20261023-repair1-network.mjs
```

Node v25.2.1；首次沙箱运行exit1，正常localhost fetch失败，实际A/B命中均0、尚未进入绕过用例，见[原记录](KB02-K204-PREP-20261023-repair1-network-2026-10-23T12-25-09-634Z.json)。自动审批允许本地验证后，同字节脚本exit0，约0.60秒：**20项通过，已登记A实际命中5、未登记B sink命中0、自定义transport调用0、重定向阻断1**，见[通过记录](KB02-K204-PREP-20261023-repair1-network-2026-10-23T12-25-21-482Z.json)。正常fetch GET/POST和http.request/get URL[,callback]均可用；全部自有HTTP服务已关闭。

未重复完整22fake链；run/gates及其数据构造未改。最终完整入口留给Astra复验：

```powershell
node --import tsx --import ./tests/support/css-stub.mjs tests/acceptance/KB02-K204-PREP-20261023-run.mjs
```

最终有效冻结为 [repair1-freeze.json](KB02-K204-PREP-20261023-repair1-freeze.json)，包含support/run/gates及repair1回归脚本、修复交接与完整历史自查资产；[旧freeze](KB02-K204-PREP-20261023-freeze.json)作为不可变历史保留，其旧support指纹不代表修复后版本。产品/规则/默认tests/锁文件/正式workspace不动；188历史源指纹仍匹配，外部AGENTS/.agents/AGENT-ROUTER及主Agent/Astra文件保留。Sol冻结后停写，无Git提交。
