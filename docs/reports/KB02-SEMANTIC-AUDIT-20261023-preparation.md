# 独立验收准备（尚未执行门禁）

沿用B1和冻结fixtures；真实203/500、Prompt15/24未变化。authorization.json中工程与真实门禁均false，阶段6/20/4分别审批。prepare实际exit0，保护3543路径（历史证据、验收脚本、正式workspace/config及.env内容仅取SHA）；产品/defaulttests正由Sol施工，待停写冻结后另取全量SHA，不能把当前中间态作冻结结果。主Agentstatus/control与双方本轮独占前缀排除保护。

已准备本前缀脚本：

- run：显式工程放行后核builder逐文件冻结，再按实际全部产品/tests及根构建文件独立记录SHA、同字节隔离副本，全默认0skip、tsc/Vite、Node24.19相关/SR01。独立语义和历史case清单尚待实际冻结接口绑定，engineering-extra.reviewed=false会在任何工程执行前拒绝；不盲拷旧“两次调用”的fake断言。
- trace-hook：每次真实外发前串行持久记账，起seq204，累计上限500、本轮30、分阶段6/20/4；attempt与完整请求/响应按stage保存。无自动重试，审核调用同样计费。真实授权未开。
- lab：独立临时数据目录/自有API与UI，只读已有Provider配置，显式关闭与脱敏日志；仅复制准备，未启动。
- real-http：直接使用冻结fixture正文，五种样本独立started标记防重抽，创建Raw及jobID立即落盘，readback仅GET原job；无固定页面数量/模型ID。仅新explicit-metric-target要求metric，原混合不强制。实际源码范围断言与独立语义裁定分开。
- browser：实际Chrome命令化审核/逐页截图/创建/人工备注/候选预览/确认/刷新；generic与metric分开保存实物。创建前核独立draft审查SHA，确认前核workflow sections审查SHA，不把新审核器pass当人工语义通过。Chrome可执行路径存在与否未探测，更未实跑。两链持久回读与幂等探针将在生成实际目标/flow后绑定，禁止HTTP替代UI闭环。
- integrity：核历史/正式数据及fixture哈希，输出独立时间戳证据。

node --check 已对run、real-http、trace-hook、browser语法检查exit0；这不是工程或浏览器验收。准备期间产品服务/浏览器/真实Provider均0。没有使用旧SHORT的Missing metric断言、固定14页或旧seq183/200预算。原始错误和自动issues后续均保留，不为exit0改语义oracle。

已独立复核旧完成Draft兼容接线：jobs原有settlement用当前rulesVersion临时验证旧cp，最低attempts不能无条件+2。允许在已找到且关联一致的完成Draft验证中保留原revision下界；新revision12有效plan仍+2，旧未完成仍409。不得让普通pipeline恢复获得绕过入口，不改旧版本/attempts，Raw/来源/秘密/覆盖和draft.callCount关联校验保留。实际实现及正负例留待冻结后审查。

等待Sol停写冻结及主Agent工程放行。无预先工程执行，无真实调用；独立资产均本前缀，未覆盖历史报告或施工代码。

## 冻结前补充准备

已据实际接口新增boundary.test.mjs：原seq202拒绝/不确定/假pass三对照；新revision不可能plan账本与剩1零外发；schema页索引/已知及本页fact引用/decision-code约束；同候选不可变和不同候选必再调用；旧完成Draft恢复与伪造新revision低账本恢复对照。假pass刻意保留原坏AI页，用来说明机械通过不证明质量。只准备未运行。

历史FINAL/SOURCE/EDGE的测试目标分别是更新目标绑定、固定unit投影、规划前拒绝，不经过新增审核，原脚本保留执行。FIELDS/REGION的合法完整pipeline路径在本轮新副本增加一个受控审核响应及一次调用，非法schema/秘密/旧revision的早退计数保持原样；记录见history-adaptation.json。原脚本未改。engineering-extra清单已按实际接口审阅，但工程授权仍false，最终冻结后再次核接口未漂移。

新增边界脚本首次node --check发现少一个对象闭括号（Unexpected token），只修本探针后单独node --check exit0；两份历史适配副本语法检查通过。此为准备探针语法修正，未运行任何产品测试，不声称工程通过。隔离runner现复制docs供实际默认测试读取历史证据，并对所用输入证据另记SHA。
