# COVER真实执行记录

2026-10-28用户“同意并开始”，授权现有配置最多4请求，基线d6cbb73ad690a071b94b9f6cfd88c03be54b7213。执行前逐会话核66项SHA与freeze一致、无release/attempt/run-started，按session绑定profile/序号/Raw/fixture/freeze签release。C独立通过后才签P，无重试。

实际均使用require_escalated执行：
```powershell
node --import tsx tests/acceptance/R1618-QUALITY-20261027-run.mjs run $taskRoot $taskPath $taskHash
```
变量taskRoot为下表绝对会话目录，taskPath为其release.json，taskHash为该文件Get-FileHash SHA256小写；公开证据中的release/session/freeze可复核精确绑定。

|样本|taskRoot（仓库根E:\AI\Work\AIPM Workspace下）|实际结果|
|---|---|---|
|C|.scratch-R1618-COVER-20261028-DzxR8N|session19142 exit0，249–250，reserved/sent/realCalls2，configReads1，知识250|
|P|.scratch-R1618-COVER-20261028-Gjkejk|session19739 exit0，251–252，reserved/sent/realCalls2，configReads1，知识252|

C完成后Astra独立确认C01/共同标准和Draft渲染通过，主Agent随后放行P，无额外用户授权要求。合计真实4、配置读取2，Prompt15/24保持；均成功捕获原稿不等于整体质量通过。未重跑工程测试/浏览器/正式提交；产品、固定资料、冻结标准未改。各会话根非private公开JSON原样复制至R1618-COVER-20261028-real-evidence/concept及process，入口已对请求/响应/原稿执行已知秘密检查，无实际配置和private响应归档。

独立质量裁定见[R1618-COVER-AUDIT-20261028-real.md](R1618-COVER-AUDIT-20261028-real.md)。P原稿省略outputs，依冻结计划不能签其真实措辞改善通过。预算用完即停，不补稿或重试。旧FAIL保留，外部AGENTS及AGENT-ROUTER报告排除。