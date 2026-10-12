# B03 独立浏览器证据（2026-10-05）

执行者：主 Agent。结论：实际浏览器链路部分通过，发现 F03-03、F03-04，B03 不可标 PASS。未修改产品代码或正式用户数据。

## 环境与版本

- Windows、Node 25.2.1；隔离 API `127.0.0.1:4323`、Vite `127.0.0.1:5183`，启动为隐藏进程。
- 数据目录：`docs/reports/fixtures/B03-browser-independent-20261005`。通过 CUA 的 IAB 浏览器实际操作，文件通过真实 filechooser 选择。
- 版本以 `B03-independent-http-2026-10-05T09-01-35.890Z.json` 的 version 为准；全部产品指纹在浏览器检查结束后比对一致。
- 主 Agent 独立运行 `npm.cmd test`：34/34 PASS；默认沙箱构建 realpath EPERM，获自动批准后 `npm.cmd run build` PASS，36 模块。环境限制不判为产品缺陷。
- 初次 filechooser 超时、原标签 CDP 焦点超时；按工具文档新建同一浏览器标签并通过实际 file input 重试，文件选择恢复。不是产品 FAIL；恢复后 DOCX、伪 PDF、真实 PDF 均实际选择并上传。

## 实测场景

| 场景 | 操作与实际结果 | 结论 |
|---|---|---|
| UI03-01 粘贴回归 | 从首页进入导入；填写标题、来源、两个逗号分隔标签和16字符正文；保存后真实列表/详情显示；旧Raw ID `5df045b1-ebc8-49bc-959e-e273a03051a3`，原标签为两项 | PASS |
| UI03-02 重导入 | 点击重新导入，不修改标签，只填写新正文；新ID `2e4f8030-8575-4272-a344-7150a562a10c`、旧记录正文/标签不变，但新记录把两个标签合成一项 | FAIL F03-03 |
| UI03-03 DOCX上传 | 真实选择 `tests/fixtures/b03/zh-report.docx`，标题/来源自动填充；201后成功面板显示103字符及原件SHA；点击查看后列表/详情显示中文正文和原件关联 | PASS |
| UI03-04 失败与补救 | 真实上传 `fake-pdf.pdf`；显示 FORMAT_MISMATCH、原件已保留及asset ID/SHA，不增Raw；点击粘贴补救保留元数据，填写正文后保存成功 | PASS |
| UI03-05 删除前检查 | 补救Raw点击删除；无引用时先显示检查结果与不可恢复说明，可取消；未执行最终确认删除 | PASS（确认面板子行为） |
| UI03-06 被引用阻止删除 | 用公开API准备隔离Source页，sources指向DOCX Raw；真实UI点击删除，列出该Wiki标题/ID，确认删除按钮禁用（isEnabled=false）；原Raw保留 | PASS |
| UI03-07 PDF上传后关闭 | 真实选择 `zh-report.pdf`，上传标题“B03独立浏览器-PDF关闭后刷新”；成功面板96字符、原件hash正确；点结果面板关闭后列表仍4条、找不到新页，首页Raw仍4；API已5条、stats.rawCount=5 | FAIL F03-04 |
| UI03-08 刷新持久化 | reload后首页Raw=5；进入Raw找到刚导入PDF，中文正文/原件关联正确；旧资料仍在 | PASS |

无引用的最终浏览器确认删除、前端超限文件拦截本轮 NOT_RUN，未用HTTP通过冒充UI通过；对应公开HTTP行为已由独立验收Agent实测。当前存在可复现FAIL，留待返修复验补齐这些UI项。

## F03-03：重新导入改变标签数组

预期：重导入预填元数据，用户未编辑的两个标签保持两项。

实际：旧 `tags=["渠道","库存"]`，预填输入显示 `渠道、库存`；仅填新正文保存后，新 `tags=["渠道、库存"]`。根因：`app/pages/RawPage.tsx:71` 使用 `join('、')`，第8行仅按中英文逗号split。UI提示示例也使用顿号。

证据：`B03-browser-reimport-tags.jpg`、`B03-browser-raw-snapshot.json`、`B03-browser-persisted-evidence.json`。最小修复：统一预填、输入示例与分隔符规则；复验两标签重导入与用户输入中英文分隔符，旧资料不变。

## F03-04：导入完成后关闭结果不刷新列表/统计

预期：成功提交文件后，无论点查看、关闭、右上角关闭或继续导入，已提交Raw应及时进入父组件列表与统计；不能依赖用户选择查看才同步。

实际：PDF Raw `35021656-f283-4d5b-9368-39e1ce907e7d` 已落盘；结果面板关闭后 `.raw-list` 仍4条，新标题按钮count=0，首页rawCount=4；API及磁盘实际Raw=5。reload后才出现。

根因：`ImportDialog.submit` 文件分支仅setResult；`ResultPanel` 仅“查看这条资料”触发onCreated，而关闭仅onClose，继续导入仅清本地状态。与粘贴分支即时通知父组件不同。

证据：`B03-browser-stale-list.jpg`、`B03-browser-stale-stats.jpg`、`B03-browser-pdf-after-reload.jpg`、`B03-browser-persisted-evidence.json`。最小修复：将导入提交后的数据同步与结果展示/导航分离，避免重复添加；复验关闭、查看、继续导入、重导入及首页计数。

## 文件/截图证据

- `B03-browser-docx-success.jpg`：DOCX成功面板。
- `B03-browser-parse-failure.jpg`：伪PDF拒绝、原件保留、补救入口。
- `B03-browser-referenced-block.jpg`：正式Wiki引用及禁用确认删除。
- `B03-browser-reference-fixture.json`：仅隔离API生成的Source fixture。
- `B03-browser-persisted-evidence.json`：真实浏览器操作后的公开HTTP Raw/资产/统计快照。
- `B03-browser-reimport-tags.jpg`、`B03-browser-stale-list.jpg`、`B03-browser-stale-stats.jpg`、`B03-browser-pdf-after-reload.jpg`：两项UI缺陷证据。

全部测试资料均为隔离fixture，未进入正式workspace。隔离服务进程记录与日志位于 `docs/reports/runtime/B03-independent-browser-*`；结束时仅关闭本次已核实身份的进程。
