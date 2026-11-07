# WORK04A 施工交接

施工实例 `/root/work04a_builder`（GPT-6.1 Sol High）。冻结基线 `0daba4b8e445be6fd37765cc80e82c6dcdec5cf8`，交接时仓库 HEAD `d0a35cb9041f3d17265fbebef566ec7dfa69e78d`，下列产品文件以未提交工作树 SHA-256 标识。施工自查通过，批次结论由独立验收裁决。范围见[任务卡](../handoffs/WORK04-20261107-task.md)。

- v1、v2 已完成轮次可从详情预览并主动检查。请求使用目标轮原发送视图和原草稿，当前 Raw 仅参与发送门禁。复核意见逐项标记依据状态，附原文引文和定位，阶段成果继续沿原编辑保存入口。
- 每次尝试原子写入独立记录。无参重复返回已有状态，失败或中断须提交最新尝试编号方可重试。中断由未结算记录在读取时判定，备份和恢复沿已有递归白名单。复核损坏提示恢复，原草稿仍可查看。

实际命令在 `node_modules/.cache/work04a-builder-source` 隔离源码执行。

| 命令 | 结果 |
|---|---|
| `node --import tsx tests/acceptance/work04a-builder.mjs` | 退出 0。真实 `server/index.ts`、本机 HTTP fake 共 12 次（含 3 次原分析），模型配置由 `work04-original` 切至 `work04-review`。Chrome 1440/390px、页面错误 0、预览原稿定位、精确快照、未保存编辑、带入及刷新读回通过。实际 HTTP 拒绝跨事项、未完成、缺失/受限/不可读继承来源、凭证、超限、无效配置和不可读复核，覆盖并发、快失败、陈旧重试、服务中断、备份回读与五类无效结果。脚本以空 `envDir` 构建 231 模块，出现 Vite 大包体积提示。截图在副本内 `node_modules/.cache/work04a-builder/check-nKxYg9`。 |
| `node ../../typescript/bin/tsc --noEmit --pretty false` | 退出 0。工作区直接运行提示七份历史测试为二进制，仅在隔离副本用冻结 HEAD 正文补齐。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/work01-http.test.ts tests/app-navigation.test.tsx tests/lifeos-l3-home-ui.test.tsx` | 4/4。首次在默认沙箱中实际 HTTP 无法连通，获准本机回环后通过。 |
| `git diff --check -- services/work-items app/api.ts app/pages/WorkAnalysisPanel.tsx app/styles.css server/work-items-api.ts` | 退出 0。 |

交付文件与验证副本 SHA-256 一致。

| 文件 | SHA-256 |
|---|---|
| `services/work-items/analysis-runs.ts` | `C282C0C5620DC91BF962C44E79BAE8E27738837A4845DE0E06B43582B17AA0B4` |
| `services/work-items/basis-review.ts` | `94E50278149C44DBC04FC149DEC16126B6940AC8D746CB0F08FDF06642A673BB` |
| `services/work-items/types.ts` | `18E9C9658FC071A1A151EB89D25C742C4DA190F1C3CE3CCBE13FE484E3BE596E` |
| `server/work-items-api.ts` | `9830C962CA5456DF35A981473A2FD72D95EFA8354D9B22C35EBC33571E5E9C84` |
| `app/api.ts` | `70DABEF5D22B0EA6C5ABEF2A605CB315B05096BE78B00DADBC864B4523C0C1B0` |
| `app/pages/WorkAnalysisPanel.tsx` | `23302AD71B660CE4F314BC0F144629EC3C0B626B6ED792CF62FB05FA58DB79AD` |
| `app/styles.css` | `23C744F7DBA568F19B928FE1E6F43EA5BD00D9B7DBF0D7AAC26BEC062E3B5EC2` |
| `tests/acceptance/work04a-builder.mjs` | `C49A3F12893548E87CCECBFB181D06AB7D217C6CBD89C8624086F75A2FE52E9B` |

正式资料、用户配置和用户服务未用于验证，自有服务均已关闭。真实模型请求 0，真实复核质量 `NOT_RUN`，B 延期。施工停写，提交及同步由主线程处理。
