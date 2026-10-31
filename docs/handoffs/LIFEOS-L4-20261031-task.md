# LIFEOS L4：快消场景模板填写引导（2026-10-31）

## 授权、版本与角色

用户明确授权阶段4，通过后提交同步即停，不推进阶段5。[正式方案](../batches/LIFEOS-optimization-plan-20261031.md)阶段4为依据；基线 `223f1cc0245121bc14aa93514cc2d570f8ec27f3`。[状态](../status.md)最新L3整体独立PASS，KB03限定范围PASS及会议UI/旧收据独立遗留保持。

评分需求0/耦合1/风险1/历史失败0=2，A标准：四场景映射和填写引导清楚；工作台表单、既有请求链及定向验证；风险在于引导误当业务事实或误改变发送内容，不改数据写入/服务协议。Astra规划、Terra High施工、另一个Sol High实例独立验收。规划者只写本卡；本卡冻结不授权真实模型调用。

真实Provider/config/.env/正式workspace访问0，隔离虚构数据+fake Provider验证。历史知识287/500、Prompt20/24、KB03 24/30沿既有报告，不核账、不消耗余量。本轮仍可交付工程和界面质量，但不得声称真实模型输出质量已验证。

## 实际盘点及是否改变模型提示

`services/prompt-ai/service.ts:14–18`现7模板：industry_learning行业学习、business_process业务流程分析、customer_interview客户访谈、requirements需求分析、ai_solution AI方案设计、meeting_notes会议资料整理、custom自定义任务。前三种业务与requirements能够承载本轮四场景，其余三种保持原样；不新增模板ID或改原标签。

重要边界：service.ts的brief方法把 `{task,template,templates:TEMPLATES}` 发给Provider，故给服务TEMPLATES增加guidance字段也会改变模型提示；generate把用户Brief和显选Wiki用于生成。`PromptAiWorkbench.tsx`已有手动Brief初始值、逐字段编辑、生成预览、显式保存。当前缺口是用户不知道各场景需提供什么及怎样表达产出和未知信息，不需新增生成器。

本轮选择**前端可见填写引导**：在模板选择附近及对应Brief字段旁显示帮助，不自动填入、改写或拼接task/Brief/请求。服务TEMPLATES、system提示、contract、模型调用payload构造保持原样。相同用户输入/相同选择的新旧请求必须相同。用户根据帮助自行修改输入属于显式用户输入，提示文字不隐式发送。不得以按钮“应用场景”把整段指导写入Brief，或更改现有手动默认值后仍声称未改模型提示。

因此本卡L4-03的“改动模型提示”条件不触发，按条件项不适用记录，真实质量未测，不写真实质量PASS。若实施中认为需要自动预填、服务元数据扩展或模型提示调整，先告知主线程必要性及最小变更，重新冻结真实样本/判定/目的地/有限累计预算并取得单独授权；先完成独立可做的界面工作，不能直接发请求或用fake替代真实质量。

## 四场景与字段指导冻结

| 场景与复用ID | 输入引导（context/input） | 目标/步骤/输出引导（goal/tasks/output） | 事实与未知约束（constraints） |
|---|---|---|---|
| 经销商访谈准备 → customer_interview | 对象岗位/渠道、区域、访谈目标、已知订货补货流程、已有资料和待核假设 | 按订货、补货、异常处理组织开放问题与追问；产出分主题访谈提纲和待核实清单 | 未访谈内容是问题或假设，不写成受访者结论；缺对象/背景写待用户补充 |
| 门店补货流程梳理 → business_process | 门店/渠道、参与角色、触发条件、现有步骤、数据/系统边界及异常样例 | 梳理步骤、输入输出、责任角色和异常分支；产出流程列表与待确认责任/接口 | 区分已提供流程与改进建议；未知负责人/系统能力不得补造 |
| 业务问题转AI需求访谈 → requirements | 业务问题、目标用户、现有流程、影响、数据来源、约束和成功标准 | 从问题/用户/流程/数据/验证逐项追问；产出需求访谈提纲、边界和验证问题 | AI只是候选方案；不虚构可行性、上线状态、收益；缺指标与证据标待确认 |
| 材料阅读与问题整理 → industry_learning | 材料范围/来源、阅读目标、已有背景、希望回答的问题及证据要求 | 摘要核心观点、整理关系与问题；产出要点、出处线索、疑点和待确认问题 | 区分原文事实、整理、推断；没有原文或定位不得伪造引用，不补造缺页/图片 |

角色字段提示用户填写实际需要的专业角色，不自动假定职位；场景标题是该模板的示例用途，不把通用模板限制为仅此场景。输入指引不是新增必填校验，用户仍可使用原自由文本。指标口径场景本轮不做（选四项符合3–5范围），未来有需求再映射，不塞入custom形成第五套隐性模板。

## 交互和设计

保留现有模板select与七个选项；选四个ID时，在select紧邻位置直接显示表格中的具体场景名称（如“经销商访谈准备”）及“填写建议”，与当前模板同步，不能只藏在不易发现的位置；下列输入、预期产出、事实约束三组简短信息随之更新。进入手动Brief或生成Brief后，对已有七字段展示相关简短帮助，确保goal/context/input/tasks/constraints/output覆盖表格口径；角色只提示，不修改值。可用小型披露区减少占屏，但关键事实/未知约束应可见，不能仅藏在placeholder。已有值、光标编辑、用户任务及Wiki勾选不因选模板或展开帮助自动改变；模板改变沿已有edit取消迟到请求语义，不新增后台生成。其余三个模板维持现有通用编辑体验。

复用前端局部静态guidance常量，不读取服务配置，不建立持久化场景偏好。若提取为文件，是复用跨模板/逐字段渲染的有名数据，不抽象通用表单引擎。UI沿用现有Operate风格、字段标签、按钮和prompt.css；不重排全工作台、不影响Optimizer。impeccable上下文已加载，不再初始化；编辑前读craft-floor，完成一次detect，实际1440/1024宽检查帮助换行、字段与按钮可见和键盘焦点。

用户链路保持：任务/模板→生成Brief或手动填写→编辑Brief→显选Wiki→生成预览→预览编辑→显式保存；模板选择/手动编辑/查看帮助不触发模型或保存。默认不收藏；Wiki不默认选中，Meeting等来源门禁沿实际服务检查。预览只在用户明确保存后进入Library；旧版本和Optimizer不改变。

## 文件所有权

Terra：`app/pages/PromptAiWorkbench.tsx`、必要的`app/prompt.css`局部规则、可选新增`app/prompt-scenario-guidance.ts`静态映射；新增`tests/lifeos-l4-guidance-ui.test.tsx`、`tests/lifeos-l4-flow.test.ts`、`scripts/lifeos-l4-isolated.ts`、`docs/reports/LIFEOS-L4-20261031-builder.md`。不改services/server/rules及现有测试的行为断言；如确需调整旧文本定位测试，列证据请主线程确认最小范围。

Sol独占`tests/acceptance/lifeos-l4-browser.mjs`及`docs/reports/LIFEOS-L4-20261031-review.md`。harness沿用L3的完整App/真实API/真实PromptStore与PromptAiService，只Provider为fake，明确无配置加载器、空envDir，输出url/api/root/fixtures/request计数，支持保留root读取已保存版本，不造独立假工作台。

保护他人四文件且前后SHA不变：AGENTS.md、docs/reports/B04-http-evidence.json、docs/reports/KB02-R1-20261015-builder-merge.json、docs/reports/AGENT-ROUTER-20261023-packaging.md。多人共享工作区，不覆盖或回退他人内容。主线程负责状态/版本绑定和统一提交同步。

## 冻结验收 L4-01–03

- **L4-01 映射与引导**：四映射ID准确、无新增/重复ID，原7选项兼容；逐场景断言输入、产出、事实/未知约束与表格一致，缺材料/角色/负责人等提示保留待确认，不把示例当事实。手动Brief初始值与基线相同，字段值可修改、帮助展开/选择模板不暗改用户文本。对三个未增强ID检查旧通用体验，Optimizer不显示行业指导。组件覆盖四场景，实际Chrome至少查看四场景和一次未增强模板及Optimizer，1440/1024实看。
- **L4-02 完整链路与来源**：真实App/API fake链路覆盖手动Brief编辑→显选一页Wiki→生成预览→编辑→明确保存→Library读回版本1及favorite=false；保存前无正式Prompt新增，未选Wiki不进入fake请求，所选Wiki受既有来源门禁；用受限Meeting关联Wiki明确选择后应拒绝且fake请求不增。另走一次原“生成Brief”路径，断言task/template及后续preview契约与基线兼容；旧已有Prompt/版本可读，Optimizer既有入口可用。组件测慢请求后编辑/切换不会被迟到结果覆盖；浏览器实际完成至少一条手动生成保存链及显选Wiki，来源拒绝由真实服务集成可补。只统计真实fake Provider complete调用，不以浏览器POST数冒充模型数。
- **L4-03 提示边界及真实质量条件**：静态diff证明服务TEMPLATES、contract、system/wire构造未改；同一固定task/template与Brief/selectedWiki输入，对新UI拦截实际API body并断言等于基线协议输入，guidance内容未追加到任何隐藏字段；实际fake Provider捕获brief请求中的templates仍仅原id/label，generate收到的是用户编辑后的原Brief值和显选背景，无UI帮助文本注入。查看/选择/手动编辑指导前后请求计数不增。由独立验收裁定“未改变模型提示，条件项不适用；真实模型质量未测”；若不满足此边界，不能仍按本卡整体PASS，必须追加获批真实质量门禁后才能签该扩大范围通过。

必要命令建议（先核fixture隔离）：

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l4-guidance-ui.test.tsx tests/lifeos-l4-flow.test.ts tests/prompt-ai.test.ts
npx tsc -b
```

来源拒绝可定向复用tests/meeting-raw-m04.test.ts现有Prompt背景拒绝用例；不直接复用沿旧契约且可能进入默认配置的旧prompt-ai-http.mjs。按受影响链补最小PA01来源/恢复/版本回归，交接列实际文件，不跑无关全仓。构建使用空envDir的Vite程序化build。Sol使用已验证bundled Playwright+实际Chrome运行隔离完整App；JSDOM不替代浏览器，实际截图/操作与请求记录绑定文件SHA。测试脚本准备错误保留，最终实际结果如实报告。

## 交接与结束

施工交接差异、四场景映射、实际命令/结果、产品SHA、真实/config/正式数据访问0、模型提示边界证据、他人四文件SHA及未测项后停写。Sol独立核原标准和交付物，分别裁决本轮缺陷关闭与L4整体（仅本卡界面引导工程范围）；不把fake通过称真实模型质量PASS，不以查看文本替代实际完整链路。

若提示变更触发真实质量门禁，先交具体样本/判定/所需调用建议及必要性给主线程，由用户另行授权；当前预算不自动沿用。全部本卡必选项满足后主线程提交并核远端一致，停止，不推进使用反馈阶段5。
