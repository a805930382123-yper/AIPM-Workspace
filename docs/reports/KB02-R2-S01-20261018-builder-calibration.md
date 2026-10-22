# S01 施工验证：首轮保留与复跑

本轮只修规划重试累计预算拒绝路径。所有数据和凭证均虚构，Provider 均 localhost fake，真实新增调用 0。产品和默认 tests 自 2026-10-18 10:48:34（Asia/Shanghai）冻结后未写入。

## 默认沙箱限制

| 实际命令 | 首轮结果 | 相同命令按工具权限流程升级后的结果 |
|---|---|---|
| `node --import tsx --test tests/kb02-planning-budget.test.ts tests/kb02-r2.test.ts tests/kb02-pipeline.test.ts` | 13项，5通过/8失败；8项均 Temp 原子 rename EPERM，包含新2项与既有6项 | 13/13，0skip，852.924ms；[日志](KB02-R2-S01-20261018-builder-targeted.log) |
| `node --import tsx tests/acceptance/kb02-r2-s01-20261018-builder-standards-probes.mjs` | 隔离服务初始化 wiki/index.md 原子 rename EPERM，业务断言未运行 | S01/S02 2/2；[首轮](KB02-R2-S01-20261018-builder-standards-probes-sandbox-initial.json)、[最终](KB02-R2-S01-20261018-builder-standards-probes.json) |
| `node --import tsx tests/acceptance/kb02-r2-s01-20261018-builder-http.mjs` | 同一初始化 rename EPERM，0项运行 | 4/4；[首轮](KB02-R2-S01-20261018-builder-http-sandbox-initial.json)、[最终](KB02-R2-S01-20261018-builder-http-initial.json) |
| `node --import tsx tests/acceptance/kb02-r2-s01-20261018-builder-security.mjs` | 长/短凭证两组 setup 均同一 rename EPERM | 28/28；[首轮](KB02-R2-S01-20261018-builder-security-sandbox-initial.json)、[最终](KB02-R2-S01-20261018-builder-security.json) |
| `node tests/acceptance/kb02-r2-s01-20261018-builder-fullsuite.mjs` | 在复制源码后创建 node_modules junction 时 EPERM，未启动 suite | 见下方完整首轮与复跑记录 |
| `node tests/acceptance/kb02-r2-s01-20261018-builder-build.mjs` | tsc 通过；Vite 无法解析临时副本 `react/jsx-runtime` | tsc/Vite 通过；[首轮](KB02-R2-S01-20261018-builder-build-sandbox-initial.json)、[Vite首轮日志](KB02-R2-S01-20261018-builder-vite-sandbox-initial.log)、[最终](KB02-R2-S01-20261018-builder-build.json) |

代表性首次定向失败：`EPERM: operation not permitted, rename ...\AC\Temp\kb02-budget-*\knowledge\raw\reports\.<id>.<uuid>.tmp -> ...\<id>.md`；既有 KB02-R2 checkpoint 写入也同样失败。没有通过更换数据目录、修改 ACL 或产品逻辑规避限制。Standards/HTTP 首轮 JSON 为 finally 写出的未运行快照，rename 原因来自本轮工具原始错误输出；安全首轮 JSON 包含完整 setup 异常。

## 完整默认 suite 首轮与最终

默认沙箱 junction 失败后，相同 fullsuite 脚本升级执行。每次从相同冻结生成新的可写临时副本，97 产品/60 默认测试均逐字节匹配。未在源树运行会覆盖 B04 旧报告的整套测试。

1. 首个可执行副本 `...\fmcg-kb02-r2-astra-fullsuite-jcGVQZ`：251项，250通过/1失败，0skip，19.823秒。失败是既有 `llm-flow.test.ts` E04-05 的 `assert.ok(draft2)`，即第二次普通提取未得到草稿。该路径没有设置 planningRetry，未进入新增前置预算分支。保留[完整首轮结果](KB02-R2-S01-20261018-builder-tests-writable-copy-first.json)和[完整日志](KB02-R2-S01-20261018-builder-tests-writable-copy-first.log)。本轮未捕获当次 second.finished 的具体错误，不能唯一归因或断言根因已经修复。
2. 产品/tests无任何修改，相同脚本再次执行，副本 `...\fmcg-kb02-r2-astra-fullsuite-fLroiy`：**251/251、0skip，17.711秒**；[最终结果](KB02-R2-S01-20261018-builder-tests-writable-copy.json)、[完整日志](KB02-R2-S01-20261018-builder-tests-writable-copy.log)。未删除、skip或放松原断言。

历史 PA01 交接也记录过 E04-05 的 draft2 缺失，只作为历史观察，不据此推定本轮原因。新窗口如再复现，应先捕获 job 的实际失败信息，不扩大 S01 施工范围进行无证据的幂等改造。

构建在第1个同字节副本上完成：tsc 3.326秒、Vite 1.758秒均 exit0；该副本和最终完整测试副本匹配同一冻结。未无理由再跑已通过构建。所有测试子进程及本轮自有 HTTP 服务已关闭。
