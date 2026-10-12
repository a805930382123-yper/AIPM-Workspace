# B08 第二次最小返修卡

施工仍为同一GPT-6 Luna High，主Agent独立复验。F08-01–04均CLOSED，不重做。唯一F08-05/P2：AI生成记录首版changeSource=ai_generated在真实历史行/详情显示空白。

原因已定位app/api.ts的PromptVersion.changeSource类型和promptChangeSourceLabels未包含ai_generated。只补齐该类型/中文显示标签，必要时最小兼容显示处理；允许修改此共享文件，因为这是B08新来源的接口投影缺口。保留manual及ai_optimized文案，不修改服务端来源、版本或数据。禁止改独立验收、初始/repair1证据或施工报告。

构建及现有受影响UI测试即可，不再重复全量152 tests/HTTP。新写B08-repair2-build.md与B08-repair2-builder-sha256.json，检查完成冻结写入。主Agent将复验生成历史行/详情及manual/ai_optimized原标签，不会用静态检查代替实际浏览器。真实Provider BLOCKED，B09未授权。
