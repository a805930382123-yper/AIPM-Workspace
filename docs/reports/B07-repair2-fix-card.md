# B07 第三次返修卡（2026-10-07）

第二次返修独立验收 **FAIL**，但原 F07-01–06 全部 CLOSED；仅新发现 F07-07 OPEN。[本轮报告](B07-repair2-acceptance.md)。冻结 [B07 范围](../handoffs/B07-deepseek-prompt.md) 不变，本次只修一个 UI 选择/历史加载原因，不扩展 B08、不改 Raw/Wiki/后端存储。

## F07-07 / P2：重复选择当前模板使历史列表永久为空

- 文件：`app/pages/PromptLibraryPage.tsx:96–107`（selectId）、`:150–161`（详情/历史 effect）。
- 原因：同 id 重复选择仍清空 versions 并使旧请求代次失效，但 selectedId/reloadToken 均不变化，因此读取 effect 不会再次运行。
- 最小实际复现：乙→甲，等待甲第 3/2/1 版正常显示→再点已选中的甲→历史变为“0／正在读取版本…”且持续不恢复。甲的 API/JSON 仍有三版；切乙再回甲可恢复，再点甲又清空。无需故障、代理或重启。[截图](B07-repair2-acceptance-reselect-history-missing.png)；JSON `F07-07-reselect-current-loses-history` 含前后与稍后复查状态。
- 修复要求：同一选择的清理和读取触发一致。可使真正无变化的重复选择保持有效状态，或明确触发新读取；保留从历史/编辑/生成上下文返回当前的正确语义。不要只隐藏加载文字或恢复旧数组来掩盖异步身份问题。不得破坏已关闭的 render/history/requestId/busy 守卫。
- 关闭标准：已有 2+ 版本的模板，重复点击当前行仍能查看完整历史；初次详情/历史在途时重复点当前行，也可最终加载；历史页点该模板返回当前、编辑页选择、甲乙往返与刷新/重启均正确，无串页/旧错误/丢版本。版本查看只读，整个 Prompt/knowledge 文件集合 SHA 不变。
- 增加针对同 id 的回归测试，覆盖已有历史与在途读取两个顺序；原 144 项断言保留。独立复验将重复实际浏览器复现，并重点回归 F07-04/05，不能只靠 self-test 签 CLOSED。

## 交付

- 写 `docs/reports/B07-repair3-build.md`：改动文件/SHA、命令/结果、每项自测、未测项、知识/正式数据不变量及进程清理。
- build/test；保护两份会被 test 重写的 B04 原件，另存本轮后恢复。历史报告/卡、冻结交接、`tests/acceptance/**` 与正式数据不改。
- 产品保持仅 UI 改动时，可复用上一轮后端 11/11 HTTP 与四类损坏记录证据；如实区分本轮运行与复用。原 F07-01–06 保持 CLOSED，本卡只剩 F07-07。验收方独立裁决 B07，当前不进入 B08。
