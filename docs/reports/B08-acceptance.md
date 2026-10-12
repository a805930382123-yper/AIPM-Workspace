# B08 独立验收报告

日期：2026-10-08。施工及两次返修均由实际 GPT-6 Luna High 子 Agent `/root/b08_builder` 完成，当前主 Agent 独立验收，未改产品代码。子 Agent token 计量平台未提供，记不可得。

**结论：确定性实现与返修复验 PASS；B08 整批 BLOCKED。** 既有产品 Provider 配置不存在，真实 AI 成功与内容质量没有实测，不能用 fake 代签。B04–B06 的同类阻塞保留；B09 未授权、未开始。

## 交付与版本

交付自然语言任务→结构化 Brief→人工编辑→选择 Wiki 背景→完整预览→编辑/复制/显式保存，以及原 Prompt→九维检查/改进点→优化预览→保存新项或原项新版本。包含六模板及自定义、必要背景提取与硬预算、错误边界、草稿持久化、幂等确认和部分提交恢复。使用已有服务端 LlmProvider；开发子 Agent/harness 不进入运行时。

原始施工七个产品路径新增/修改；第一次返修只改 PromptAiWorkbench、PromptLibraryPage、prompt-ai service；最后一次只改 app/api.ts 的来源类型和标签。完整产品集合68文件，最终指纹见 [冻结版本](B08-repair2-acceptance-frozen.json)。初次19份、首次返修5份及末次2份施工 SHA 均独立匹配；首次返修 SHA 的大小写比较错误及规范化核对分别保留，未发生产品变更。

施工报告：[初始](B08-build.md)、[首次返修](B08-repair1-build.md)、[标签补齐](B08-repair2-build.md)。历史验收：[首次 FAIL](B08-initial-acceptance.md)、[首次返修 FAIL](B08-repair1-acceptance.md)。原 FAIL 和无效 fixture/断言观察均保留。

## 缺陷关闭

| 缺陷 | 修复后独立证据 | 状态 |
|---|---|---|
| F08-01 Provider 无效分类/元数据也成功预览 | 12类错误在生成、优化两路径均502且无新增草稿；复用B07校验 | CLOSED |
| F08-02 保存后原文比较被替换、同一草稿误标下一版 | 新项/原项保存保留本轮原文，确认后锁定且移除保存按钮；重优化使用最新目标版本 | CLOSED |
| F08-03 迟到保存成功不刷新 Library | 迟到201保留新任务且新行/数量同步，当前详情历史更新；真实部分提交错误也刷新，200同内容重试无重复 | CLOSED |
| F08-04 多段背景漏计分隔符超预算 | 五页多段实测3000/3000/3000/3000/0，总12000，知识目录不变 | CLOSED |
| F08-05 ai_generated 历史修改来源空白 | 生成历史行/详情显示AI生成，manual人工保存与ai_optimized文案均回归 | CLOSED |

## 实测及复用边界

- 完整实现返修后的独立 `npm run build` PASS（45 modules，0.915秒），`npm test` 152/152 PASS（16.493秒），零失败/跳过。最后只补 app/api.ts 标签/联合类型，另独立 build PASS（0.936秒）及受影响UI15/15 PASS（10.394秒）；未冒称末次再次运行全量152项。
- [B08公开HTTP](B08-acceptance-http-repair1.json) 15/15场景 PASS，覆盖七模板、编辑Brief及勾选取消Wiki、预算/失效关联、用户字段/变量/来源保存、弱与完整fixture、优化新项及原项、并发幂等、真实409/EIO、部分提交/重启恢复、鉴权/429/网络断开/JSON/空/截断/schema、来源伪造、导出/统计、无Key手动Library。
- [多段硬预算](B08-repair1-context-boundary-final.json) PASS。API及Provider代码末次没有变化，以上HTTP无需重复；B07后端/存储冻结保持一致，复用本次初始独立[B07 HTTP11/11](B08-acceptance-b07-http.json)及[四类损坏与重启](B08-acceptance-b07-damaged.json)，未复用B07旧FAIL冒充通过。
- [实际超时](B08-final-timeout.json) PASS：本地fake持续不回包，真实B08调用60.029秒后504/LLM_TIMEOUT；整个prompts/drafts/knowledge均不变，自有隔离服务关闭。没有修改生产超时常量或用无Key错误替代超时。
- 实际浏览器由主Agent在隔离数据操作：[初次](B08-acceptance-browser.json)20观察18PASS/2FAIL，[首次返修](B08-repair1-acceptance-browser.json)16有效观察15PASS/1FAIL，另1个超代理租期断言无效后重测PASS；[末次](B08-repair2-acceptance-browser.json)6/6 PASS。通过覆盖任务/Brief编辑、Wiki选择与取消、返回/重生成不自动保存、所有字段显式保存、真实按钮复制到普通textarea粘贴且保留首尾/换行、优化原文/九维/改进/版本、历史、迟到成功与429、重叠请求busy、真实EIO对账及稳定重试、刷新/同目录重启、三类来源标签。
- 首次HTTP旧优化fixture未保持目标Wiki ID，被服务端正确拒绝，记INVALID_FIXTURE并修正；首轮返修的JSON包裹结构、空过滤URL以及代理租期断言问题保留记录并校正，不计产品缺陷。末次在只读历史视图寻找当前历史列表按钮超时，按实际入口返回当前版本后完成标签验证；历史上下文保留符合要求。

## 验收标准映射

| 条目 | 当前可签状态 |
|---|---|
| A44/A46/A47/A49/A50/A51/A52/A56，R34/R37/R39 | 输入、请求接线、人工控制、复制保存、来源/版本/读取等确定性子条件PASS；凡要求真实Provider产出的部分仍BLOCKED |
| A45/A48/A53/A54/A55，R35/R38 | 结构/UI/契约与fake弱/完整样本PASS；真实生成成功、实际缺项/建议/正文质量BLOCKED，整项不签PASS |
| R36 | 只发已选必要片段、单页/总硬预算与截取提示PASS；真实模型利用背景质量BLOCKED |
| A60，E08-09 | 错误不新增正式资产、无假成功、稳定重试以及真实60秒超时PASS；真实供应商成功与质量另BLOCKED |
| A57/A61 | 本批Prompt保存/重启、无Provider手动Library子条件PASS；跨批整项不提前补签 |
| E08-01–11 | 确定性实现按上述API/磁盘/浏览器证据通过，真实成功/质量子条件单列BLOCKED |
| E08-12 | 如实分离fake与真实Provider；配置缺失证据见[B08配置检查](B08-acceptance-config.json) |

## 数据保护与收尾

[最后完整性](B08-repair2-acceptance-final-integrity.json)：68产品文件在末次验收期间集合/SHA不变；正式workspace全部两文件、457旧历史及49份前期B08证据保持原样。两份B04测试输出的新结果按阶段另存B08前缀，旧原件恢复并校验。

隔离Raw/Wiki/Index/Log全程不变，整套Prompt重启SHA一致；主Agent没有改正式资产或密钥。各轮自有API/UI/proxy/fake及测试标签均关闭，复制测试结束恢复原空剪贴板为为空文本。末次[清理与来源实物](B08-repair2-acceptance-final-checks.json)和[界面截图](B08-repair2-acceptance-browser-generated-history.png)可核对。

真实Provider须由用户在既有服务端配置中提供可用供应商/模型及密钥，随后独立验证真实经销商访谈生成、修改Brief/Wiki作用、弱/完整Prompt的实际九维判断及建议质量。本报告不要求用户把密钥发入聊天，不改变已有供应商配置。B08整批在此之前保持BLOCKED。
