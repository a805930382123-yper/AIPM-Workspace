# OPENAI-CONNECT 独立验收

2026-10-29。Astra规划/独立验收实例，未参与产品施工。按冻结任务卡B模式0/2/2/1=5验收；Sol已交接停写。受测提交基线5f135a62689cc70e5529409c7c83fc1c3db51814加施工六文件差异；交付提交由主线程统一记录。

**本轮接入两缺陷修复通过，C01–04 PASS。R16/R18、B09整批仍未通过，既有O失败/Q未执行保持。** 无返修项，不放行下一批。

| 项目 | 独立核查及结论 |
|---|---|
| C01 PASS | 读取实际Provider diff及定向断言：精确api.openai.com/gpt-6.1-terra三purpose均省略temperature，保留默认推理；其他host/model保持0，原GLM分支不变。 |
| C02 PASS | 读取完整启动脚本及测试：环境优先、已启用系统代理回退、无端口硬编码；能力检查在启动前，普通dev及engines不变。离线真实Node子进程与主线程真实脚本执行提供实际启动证据。旧Node仅模拟help能力，未安装旧版本实测；无参dev/UI未实际启动，不宣称UI已验收。 |
| C03 PASS | 独立读取临时probe源码及main/result：直接实例化交付OpenAiCompatibleProvider，仅一次complete，无fetch替换/请求手工patch/自动重试。交付脚本实际执行exit0，响应OK、stop、v24.18.0、4762ms、usage26/4，工具墙钟5.4499398秒。未读取密钥。 |
| C04 PASS | 本轮独立Get-FileHash核六文件SHA256与施工表逐项完全一致；读取测试断言与实际diff后复用同版施工7/7和build exit0记录，不重复运行矩阵。 |

实测/复用区分：本验收执行git diff及Get-FileHash（均exit0）并读取脚本、测试、probe和安全结果；不再次调用模型。复用施工命令 `node --import tsx --test tests/provider-knowledge-reasoning.test.ts tests/proxy-startup.test.ts`（7/7、exit0、4811.0912ms），`npm run build`（tsc及Vite exit0）和diff --check exit0。文件指纹原表见[施工报告](OPENAI-CONNECT-20261029-builder.md)，本轮六项独立核对一致。

真实命令为 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx "E:\AI\Work\AIPM Workspace\.scratch-OPENAI-CONNECT-20261029\probe.mjs"`；证据见[主线程记录](OPENAI-CONNECT-20261029-main.md)及[安全结果](OPENAI-CONNECT-20261029-result.json)。主线程实际请求1/配置读取1，验收实例请求0/配置读取0。此前排障不冒充本次交付验证；本次固定连接探针不证明业务输出质量，知识254/500、Prompt15/24账本不变。

没有扩大schema或提示工作，Raw/正式知识写入未涉及。运行工作台应使用新增 `npm run dev:proxy`；本批未重启既有服务。无新增用户决策事项。验收结束停写，由主线程更新状态并提交同步本批文件。
