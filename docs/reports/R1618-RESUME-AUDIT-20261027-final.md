# R1618 F04 续接独立增量验收

2026-10-27；独立审查 `r1618_final_audit`。Sol `r1618_entry_finish` 明确交接停写后，读取现行闭环、当前任务卡、旧独立验收、施工诊断与实际差异。受测基线提交 `a6c1f6d1de7b97772cdf0ea1fcb91e7cc04b91be` 加本次 lab 差异；最终交付提交由主 Agent 的 Git 记录关联。

**局部入口修复未完全解决，F04 阻塞待验证，R1618-FIELDS 本轮整体未通过。** 本轮未执行实际 Chrome 字段编辑、刷新、审批失效、重审和正式 Wiki 保存回读，因此不能签人工闭环通过。旧 F01/F02/F03 服务工程与 F05 通过证据保持；自动逐字段质量缺证、R18 历史自动 FAIL 及 R16/R18/B09 整体未通过保持。

## 实际差异与保留判断

产品 app/services 无新增差异，browser.tsx 未变；唯一工程变化为 lab Vite 配置三项及说明注释。独立认为三项均可保留，未发现超出当前入口修复范围的变更：

- `resolve.preserveSymlinks: true` 限于隔离 Vite 实例。安装版 Vite 的 `getRealPath` 确实在该项为 false 时才调用 `safeRealpathSync`，可避开已观察到的 Windows 探测路径。但不证明整个超时由该探测导致，也不验证产品通用软链接部署。
- `cacheDir: path.join(root, 'vite-cache')` 将依赖缓存置于本 lab 的受限 TEMP root，避免重优化触及其他服务共享缓存，属于必要隔离改进。无共享缓存删除命令或产品运行配置变更。
- `optimizeDeps.entries` 指向实际隔离 browser.tsx。自定义 HTML 与项目 index.html 入口不同，纠正扫描目标有依据；安装版 Vite 明确优先使用 entries，且裸依赖解析等待 `scanProcessing`。最后一次验证已纠正目标但仍超时，故不能将这项配置称为完整根因修复。

`configFile: false`、`envDir: root`、Provider 返回 undefined、127.0.0.1 监听及原 8 秒请求期限保持；没有预填字段、自动审批、篡改产品或放宽测试门槛。语法有效只证明可解析，不证明入口功能通过。

## 命令、版本与证据

本独立实例实际执行：

| 命令/读取 | 结果 |
| --- | --- |
| `git rev-parse HEAD` | 上述 a6c1f6d 完整提交 |
| `git diff -- tests/acceptance/R1618-FIELDS-20261026-lab.mjs tests/acceptance/R1618-FIELDS-20261026-browser.tsx` | 仅上述三配置与注释，browser 无差异 |
| `git diff --name-only -- app services tests` | 仅该 lab 文件 |
| `node --check tests/acceptance/R1618-FIELDS-20261026-lab.mjs` | 退出 0 |
| `Get-FileHash` 对 lab/browser，SHA256 | lab `AE9341E108CD559700EA72072C9718C39734DADDDE67077C814334478C64E2FF`；browser `CFB4424620555BF8E38C94FFC1A3ED468C7D5CD4639CC3AE27D3747CDB100D84`；与停写交接一致 |
| 只读安装版 Vite `dep-Dm0c1Wj2.js` 的 getRealPath、computeEntries、tryOptimizedResolve | 上述配置/等待行为与源码相符 |

复用而非本实例重新运行的证据：[施工诊断](R1618-RESUME-20261027-builder-entry-diagnosis.md)记录四次 `node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --smoke`。最终提升权限 session 91777 退出 1：shell 200，扫描目标已为隔离入口，browser transform 12409.47ms，原请求 TimeoutError。后续关闭引起 request outdated 不可误判为产品模板字段缺陷。此前默认沙箱 esbuild spawn EPERM 与无 EPERM 下的慢加载区分记录，底层延迟原因仍未确定。

施工最终只读清理核验退出 0，5176/65113 无监听且无 lab 进程；本实例复用该证据，没有再次启动或清理服务。最终 TEMP `C:/Users/David.chen/AppData/Local/Temp/r1618-fields-lab-B1Ga0o` 保留，manifest URL 仅失败运行记录，不是活动验收入口。

旧 11 文件同 SHA 和 7 项独立服务测试按主 Agent 交接及[旧报告](R1618-FIELDS-AUDIT-20261026-final.md)复用，本实例未重跑，未将旧计数当本轮新增结果。没有完整浏览器 export/AX/截图及正式 Wiki 落盘链可审，故 Raw/事实证据保真、字段标签、预览与正式正文一致、approval 版本等 F04 UI 结果本轮均 NOT_RUN，不能用服务测试代替。

## 边界及后续

真实模型调用保持 0，知识244/500、Prompt15/24保持。当前代码静态边界为 Provider 禁用和 TEMP envDir；lab 硬编码 `realCalls/configReads` 不是监控证据，旧 baseline 439ae52 元数据不代表本轮代码版本。此前默认 envDir 可能读取项目配置的历史偏差继续保留，不能追溯声明整轮配置零读取已证明。

建议保留三项隔离配置，封存本轮阻塞，停止无新证据的参数实验。下一步仅针对底层扫描、文件加载及 React 依赖解析耗时建立可区分的诊断，先明确延迟来源再提最小修复；不能直接归因产品、靠延长超时签通过或启动自动质量抽样。入口可用后才补原 F04 实际 Chrome 闭环。当前不推进 R22 或其他批次。

本实例仅新增本报告及只读核验，没有修改产品、测试、正式 workspace、外部 AGENTS/.agents 工作或执行 Git 写操作。
