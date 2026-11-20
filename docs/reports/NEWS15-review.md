# NEWS15 独立验收

本轮缺陷已修复，PASS。修复前独立启动资讯 HTTP 路由，读取正式 2026-11-20 期返回 409，11-10 期返回 200。修复后同一请求分别返回 200 和 200。11-20 的快消英敏特条目返回 saved，Raw ID 为 99ff3c57-c1e1-4823-b688-2d4b264e02c2。11-10 的已保存列表为空。

NEWS15 任务卡整体 PASS。正式数据只读，写操作在隔离测试目录完成。验证范围为当前资讯保存链路。

| 验证 | 结果 |
| --- | --- |
| 正式数据、真实 Express 路由与 React NewsPage | jsdom 点击两栏，快消有一个“查看 Raw”和四个“保存到 Raw”，AIHOT 展开组的五条均有保存按钮，两栏均无整期保存状态提示。 |
| 单项错误与重试 | 收据损坏、Raw 完整性错误以及 pending 内容冲突能定位条目，其他条目仍可查看或保存。整期状态请求失败后，点击重读恢复。无当日期刊时两栏均无误报。 |
| 重复保存、原文件 | 隔离数据上编辑后重复保存返回原 ID 和 created=false，Raw、历史正文及收据保留。正式英敏特正文文件 SHA-256 前后均为 9273F91DE54329B309C443881BDFA9E13CA6AF20C39E0F4676F62B327FCBD70B，两份正式收据的 SHA-256 前后一致。 |

实际命令

- 本机独立只读检查脚本（缓存目录）：`node --import tsx --import ./tests/support/css-stub.mjs node_modules/.cache/news15-independent.mjs`。固定业务日期为 2026-11-20，仅 GET，修复前断言失败，修复后退出 0。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news02.test.ts tests/news02-ui.test.tsx tests/news03-repair.test.ts`。30 通过，0 失败，0 跳过。
- `Get-FileHash workspace/knowledge/raw/articles/99ff*.md,workspace/state/news-saves/*.json`。前后核对原始文件。
- 受验版本为基线 `bb407a3903695765a109876740ed848f088e1090` 加本轮工作树。产品文件 SHA-256 前 16 位为 `services/news/raw-save.ts 1D2D44636840426A`、`services/news/types.ts B1C30A50D6552BED`、`app/pages/NewsPage.tsx 97C24590833304BB`。
# 工程交付记录

对应提交 `4591801`。主会话在正式服务重启后复核两个日期接口，均返回 200。

