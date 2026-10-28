# R16/R18 修复后复验准备：施工交接

2026-10-28。施工实例 `r1618_retest_build`，实际角色 GPT-6.1 Sol High；基线 `eb93a30c4559800dd143e13a055834727100facd` 加本报告所列未提交差异。依照 [任务卡](../handoffs/R1618-RETEST-20261028-task.md) 和 [Astra 已审方案](R1618-RETEST-AUDIT-20261028-plan.md)，B模式评分0/2/2/1=5。本报告是施工自查交接，不代签独立验收。

## 实际修改

只修改既有 `tests/acceptance/R1618-QUALITY-20261027-run.mjs` 的9行：CARD绑定本轮卡、PREFIX改本轮隔离前缀、SEQUENCES改247/248，session创建及校验knowledgeBefore改246，成功/失败result累计基数改246，smoke未放行attempt和最终列表改247/248。fixture、产品、fakeReply、质量oracle、重试和超时未改；最多2请求及Prompt15沿用既有约束。

旧245/246证据与报告未改；外部AGENTS及AGENT-ROUTER打包报告保留排除。主Agent负责统一提交，本施工实例没有Git写操作。

## 实际命令与结果

工作目录均为 `E:\AI\Work\AIPM Workspace`。

| 命令/检查 | 实际结果 |
|---|---|
| `node --check tests/acceptance/R1618-QUALITY-20261027-run.mjs` | exit0，语法检查完成 |
| `git diff --check -- tests/acceptance/R1618-QUALITY-20261027-run.mjs` | exit0；仅Git的LF未来转CRLF提示，无空白错误 |
| `git diff -- tests/acceptance/R1618-QUALITY-20261027-run.mjs` | exit0，只有上述9行常量差异 |
| `rg -n "244\|245\|246\|247\|248\|knowledgeBefore\|knowledgeUsed\|promptUsed\|SEQUENCES\|CARD\|PREFIX\|loadLlmConfig\|complete" tests/acceptance/R1618-QUALITY-20261027-run.mjs`（实际使用正则竖线） | 常量静态核对：无旧244/245；246仅作起账；247/248为新序号；Prompt15；两处result一致 |
| `Get-FileHash` fixture、入口、本轮卡，`git rev-parse HEAD`、`git status --short` | exit0，摘要及基线见下 |
| `node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs prepare real`（沙箱内首次） | exit1，`{"code":"EPERM","noAutomaticRetry":true}`；随后目录枚举未发现本轮scratch目录。未创建会话、未进入Provider |
| 同一prepare命令，经主Agent确认且`require_escalated`执行 | exit0，0.691秒；仅成功创建一次会话，完整返回值如下；不是Provider重试 |
| 只读Node冻结核对（`node --input-type=module`，逐freeze.files重新readFile/SHA256，聚合hash(JSON.stringify(files))，readdir核禁止文件） | exit0，0.419秒；64项、drift=[]、aggregateMatches=true、forbiddenEntries=[] |

源码阅读确认：prepare只读固定fixture并创建隔离Raw/冻结清单；未调用run。`loadLlmConfig`及实际Provider.complete只在run内真实complete分支、release验证与attempt预占后执行。provider.ts引用config.ts的校验函数，config.ts无顶层实际配置读取。未读取`.env.local`或实际配置值；真实调用0、实际配置读取0。未运行smoke、tsc、全矩阵、产品服务或浏览器；唯一一轮fake smoke由Astra独立执行。

## 新会话与冻结

成功prepare完整返回值：

```json
{
  "session": {
    "id": "1c6e1881-32c3-468a-8376-d69cd385d8f6",
    "root": "E:\\AI\\Work\\AIPM Workspace\\.scratch-R1618-RETEST-20261028-iMU5d1",
    "mode": "real",
    "rawId": "ebc9af92-1789-4a24-8a60-8cdf8bc744e7",
    "rawSha256": "a64ef3745784ea68ceadb7e62d841f537727fcf505a79f918f43507665cb74ef",
    "rawFileSha256": "6666d1e1965dd230139c71924829ca94dfd6240443b7666b3216784b1a4786c1",
    "fixtureSha256": "9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7",
    "freezeSha256": "04605166c39856458c169667f33d17fff0b14bdc5f66a033d5bd4db23dd22f4c",
    "knowledgeBefore": 246,
    "sequences": [247, 248],
    "maxCalls": 2,
    "promptUsed": 15
  },
  "releaseTemplate": {
    "released": false,
    "budgetApproved": false,
    "issuedBy": "main",
    "issuedAt": null,
    "sessionId": "1c6e1881-32c3-468a-8376-d69cd385d8f6",
    "mode": "real",
    "maxCalls": 2,
    "sequences": [247, 248],
    "rawId": "ebc9af92-1789-4a24-8a60-8cdf8bc744e7",
    "rawSha256": "a64ef3745784ea68ceadb7e62d841f537727fcf505a79f918f43507665cb74ef",
    "fixtureSha256": "9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7",
    "freezeSha256": "04605166c39856458c169667f33d17fff0b14bdc5f66a033d5bd4db23dd22f4c"
  }
}
```

完整本机输出目录：`E:\AI\Work\AIPM Workspace\.scratch-R1618-RETEST-20261028-iMU5d1`。持久证据是该目录的`session.json`、`freeze.json`及`knowledge/raw/notes/ebc9af92-1789-4a24-8a60-8cdf8bc744e7.md`。根目录仅有drafts、freeze.json、knowledge、prompts、session.json；没有release、attempt、run-started或result。releaseTemplate仅为stdout返回的未批准模板，没有写release文件。

| 冻结项 | SHA256 |
|---|---|
| 64项聚合 | `04605166c39856458c169667f33d17fff0b14bdc5f66a033d5bd4db23dd22f4c` |
| 入口 | `df369f3e7cc25cbe9a9f3c53f6916ccd286f0e9b49afc8ce9b8cbc6075cff9c4` |
| 本轮任务卡 | `87990467e8744dda1b70f1ead2c85fb9bd6f470153a6fa12078f2e6a00a74864` |
| fixture（原六句逐字保留） | `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7` |
| services/llm/rules.ts（revision14） | `59b4b29ef044c50269e03a7e66b2b5d6344aabfe620e1b96499d78d7705b6dd6` |
| services/llm/knowledge-planning.ts | `ed7e3e9b3cbdd0aa6e8f8ad56e4364b39d6787017853e73458f3c3150a072a0d` |

冻结后入口及本卡未再修改；后续若改变被冻结文件，必须重新处理冻结，不能继续声称本会话有效。Git换行转换也须在正式放行前核实实文件SHA。

## 交回独立验收与剩余门禁

施工修改与静态检查完成，停写交Astra独立复审；P01–03尚待独立裁决。独立者仅运行一次既有fake smoke并核会话/冻结，不创建真实release。

后续预算仅为提案：最多2次实际请求247抽取、248规划，知识累计246→最高248/500；失败/超时/未知均计入、首失败停、无重试。Prompt15/24不变。用户明确预算前不得签release或运行真实命令。获授权且主Agent签绑定release后最短入口（本轮未执行）为：

```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run "E:\AI\Work\AIPM Workspace\.scratch-R1618-RETEST-20261028-iMU5d1" "<主Agent批准的release文件绝对路径>" "<该release原始字节SHA256>"
```

旧seq246 Q02真实FAIL、Q03 NOT_RUN、Concept覆盖缺证及R16/R18/B09整体未通过保持。revision14提示工程PASS是历史独立证据，本轮没有证明真实语义修复。当前没有新增需要用户选择的实现事项；真实调用预算仍待用户明确。
