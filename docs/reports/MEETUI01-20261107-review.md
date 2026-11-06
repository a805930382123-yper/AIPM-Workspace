# MEETUI01 独立验收

本轮两项界面问题修复通过。删除全部本地纪要的按钮在禁用时可读，上传、粘贴或编辑纪要后可从底部保存并获得反馈。MEETUI01 的 M01–M05 整体通过，无待返修项。

任务基线 `c31aa22`。冻结时仓库 HEAD `ab45c5e` 包含并行的 WORK03–05 文档更新。受验产品提交 `03f5839bf333278ca8e0ba678ad5843b528268e1`，三个产品文件与受验工作树的 Git 差异为空。规划 `/root/qaui_plan`（Astra Medium），施工 `/root/qaui_builder`（Terra High），独立验收 `/root/qaui_review`（Sol High）。评分 0/1/1/0=2，A 标准。[冻结任务卡](../handoffs/MEETUI01-20261107-task.md) · [施工记录](MEETUI01-20261107-builder.md)

| 最终产品文件 | 独验 SHA256 |
|---|---|
| `app/MeetingMinutes.tsx` | `0B8C11B5FB9F65432A176D823FDA0A53A7D59F65B49C596566072C5700C27B49` |
| `app/pages/MeetingPage.tsx` | `6ECB2451FA6327CC22C3D30E9D0544FA96F8DC9076E81A4F84B26B4ABD51B64C` |
| `app/meeting.css` | `532B200B5EFCAD2543641C43A258880119D5BF500E6FF7C07E9532394AC97089` |

| 验收项 | Chrome 156.0.8078.80 独立实测 |
|---|---|
| M01 可读性与位置 | 1440px 和 390px 的纪要底部均显示保存栏，位于删除确认区之后，无横向溢出。删除按钮与保存操作视觉可区分，键盘焦点可见。未确认及实际等待删除响应时文字对比度均为 6.81:1，已确认的观测值为 6.91–8.23:1，均超过任务阈值 4.5:1。 |
| M02 上传保存 | Chrome 选择 DOCX 本身没有写入请求。底部保存实际执行 multipart POST，文件名、解析正文及原文件 SHA256 读回一致。成功显示“纪要已保存”，清空原生文件控件；再次选择同一文件可操作。新增版本确认后保存粘贴内容，形成第二个版本。无改动时点击禁用按钮没有请求。 |
| M03 编辑保存 | 存在待导入的粘贴时不能进入工作副本编辑，原输入保留。工作副本编辑时新增版本入口禁用。取消编辑无写入。底部保存实际执行 PATCH，处理中编辑输入、取消及重复提交均禁用。工作副本成功读回，原始正文及版本数保持。 |
| M04 失败与边界 | 隔离上传一次返回 503，文件和待保存内容保留，无成功提示；明确重试使用同一个请求标识。另行更新合成会议版本触发真实 PATCH 409，草稿保留，经重载和明确重试可保存。历史版本只读，Restricted 会议无可用导入或保存。未确认的删除无请求；勾选后真实 DELETE 清空合成纪要并保留会议记录。 |
| M05 会议信息与回归 | 编辑弹窗底部“保存会议档案”实际 PATCH 会议信息，反馈“会议信息已保存”。刷新可读回会议信息和修改后的纪要，原纪要版本保持。Chrome 页面异常 0，独立定向用例 7/7。 |

独立执行 `node tests/acceptance/meetui01-review.mjs`，退出 0。脚本启动 `node --import tsx scripts/ui04-isolated.ts`，复用真实会议路由和独立本地合成数据，浏览器完成后关闭服务。首轮 Chrome 已通过上传失败及重试写入，普通网络事件未返回第一个 multipart 请求体。修正脚本为透传观测后完整复跑通过，原轮证据保留在本机 `node_modules/.cache/meetui01-review/first-review-*`。[独验脚本](../../tests/acceptance/meetui01-review.mjs) · [操作与对比度证据](MEETUI01-20261107-evidence/review-browser.json)

独立执行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/meeting-minutes.test.ts tests/meeting-ui.test.tsx tests/meeting-integration-m05.test.tsx tests/meetui01-ui.test.tsx`，7/7。默认沙箱中首轮既有六例的本地 HTTP 用例连接回环地址被拒，换授权环境复跑通过。使用同版本施工的隔离 `node ../../typescript/bin/tsc -b` 和空 envDir Vite 生产构建证据，均退出 0，构建 229 模块。七个既有受损测试仅在隔离源码副本用 HEAD 正文恢复，清单见施工记录。

会议验收期间模型调用 0。复用脚本初始化非会议样本时使用本地 fake，真实模型请求 0。正式工作区资料、用户配置与用户正在使用的服务均未用于验收，隔离 Raw 清单一致。

[桌面禁用删除与底部保存](MEETUI01-20261107-evidence/review-disabled-1440.png) · [手机确认态与键盘焦点](MEETUI01-20261107-evidence/review-confirmed-390.png) · [手机处理中](MEETUI01-20261107-evidence/review-delete-processing-390.png)
