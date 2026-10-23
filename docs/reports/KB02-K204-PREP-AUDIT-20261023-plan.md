# K204-PREP 独立验收计划（施工冻结前）

本文件仅定义检查方法，不是执行结果。Astra medium独立验收子Agent；Sol正在施工，尚未执行其runner或签P01–P06。任务卡/spec冻结不改；当前真实授权0、知识219/500、Prompt15/24。主Agent放行冻结后才开展以下检查。

## 冻结与独立性

核实Sol交接逐文件SHA及HEAD/产品版本，查真实新增diff和import闭包，再复制同字节受测文件到独立隔离目录；记录实际命令、Node及前后指纹。主Agent PREP-MAIN保护基线独立保留，不把其运行冒称本子Agent实测。只写PREP-AUDIT前缀；不改Sol脚本、产品或旧报告。产品未变不重复445全量/build。

## P01–P06 独立检验

| ID | 独立判据 | 防止错误通过 |
|---|---|---|
| P01 | 用实际chunkText/rules复算4样本SHA、1/1/1/14块及2+2+1+2+15=22，核spec与卡SHA；原文与oracle分离 | 原文件hash不符立即失败；未来planning/update动态请求未出现前不得称其字节已冻结；22仅计划，五阶段均未批准 |
| P02 | 检查并重跑真实localhost HTTP与KnowledgeWorkflowPage事件：decision清审→重审整输入→一次fake update→输出未审→编辑失效→独立审查→确认→刷新/持久回读/幂等 | 不能只用service helper绕过UI；不能mock掉实际API/store；核Raw/ID及旧文/人工备注/20与30分源；保存busy/旧revision必须真实等待，不减断言 |
| P03 | 空新job/checkpoint起步，实际ExtractionRunner14块fake+1规划、全14主体日期/数值/未知未来核对；人审前零正式写，所有实际页审后才写 | 旧完成cp重放只能单列；不可硬编码55/101当新输出真值；每个实际已提取ID完整唯一之外还需逐Raw查业务遗漏 |
| P04 | 从入口到import闭包检查无真实配置加载/Provider实例化；错误flag/env/approved篡改不得启外发；runtime网络只允许自有loopback | 不能仅宣称fake而保留真实调用分支；不得以http外发守卫漏掉https/其它客户端；任何未拦截非loopback路径为失败，不做真实探测 |
| P05 | 审查独立fake门禁测试并重跑：账本写失败→0send；预算耗尽→0新send；两在途中一失败→另一计账/结果保留、无第三请求；重启不发；无阶段许可不得进入 | 不能把失败只记成功；记录须先于send；模拟批准不能转成真实执行能力；不以产品最大累计32作为本卡15次可重试额度 |
| P06 | 核所有权、保护SHA与报告原始失败、0外发、清理；复跑同字节必要链，检查监听服务退出和隔离数据根 | 不提交scratch/依赖/数据，不覆盖AGENTS/.agents外部工作；默认/审批后失败分开保留；双层结论不混淆 |

## 定向复跑策略

先审Sol实际脚本结构，再选择公开入口作为黑盒独立执行；核心有效测试结果和原日志可复用，但独立复跑至少包含完整离线metric/update组件链、长文新链与外发/预算门禁。若Sol脚本对验收关键信息仅自述，无可核实际证据，再新增最小独立探针；不为计数堆重复测试。遇产品缺陷将最小复现交主Agent，独立验收不自行施工。

最终分别裁定准备工具PASS/FAIL/BLOCKED与KB02整体（真实质量仍NOT_RUN/BLOCKED）；准备PASS绝不自动批准22真实请求。明确实际组件而非Chrome的环境限制。收尾交主Agent统一台账/Git并停止。
