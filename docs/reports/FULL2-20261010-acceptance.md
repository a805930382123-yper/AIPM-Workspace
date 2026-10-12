# 第二次全项目审查验收

2026-10-10开始，2026-10-11收尾。**整体FAIL：第一次报告的S-01/S-02和文档问题已修复，但新增S-03/S-04仍未关闭。** 本轮只审查，不修改产品代码。

## 主要发现与修复验收标准

| 项目 | 结论与证据 | 后续复验要求 |
|---|---|---|
| 原S-01 Audit凭证成功回显 | CLOSED。已知长/短、多枚凭证、JSON键/值/转义均拒绝，旧草稿保留且无失败写入。 | 保持现有保护。 |
| 原S-02 Raw正文摘要门禁 | CLOSED。正文/摘要损坏409，提取前拒绝；恢复遇坏来源保留conflict，不自动提交。 | 保持Raw不改写及恢复门禁。 |
| 原D-01/02 文档证据及状态 | CLOSED。B03最终引用正确，旧状态明确历史。 | 新结论以本次报告为准。 |
| S-03 / 高 | B05知识更新/综合共用成功输出函数未扫描已知凭证。实际综合HTTP201，长测试密钥进入响应和草稿。 | 所有输出字段在返回/写盘前检查；更新、综合分别覆盖键/值/转义、多密钥及失败不改资产。 |
| S-04 / 高（短Key条件） | Prompt与首次提取过滤器忽略长度小于6的已知密钥。5字符配置Key在Brief201及提取completed路径均进入响应和草稿。 | 不跳过已配置短凭证；覆盖Brief/生成/优化/提取及合法输出正常通过，不把条件扩为普通文本误杀。 |

代码定位：S-03 [knowledge-workflows.ts](../../services/wiki/knowledge-workflows.ts)84–109行；S-04 [prompt-ai/service.ts](../../services/prompt-ai/service.ts)93–94行及[llm/jobs.ts](../../services/llm/jobs.ts)27–31、152行。三条失败均经实际产品HTTP、真实适配器和本地fake验证，鉴权匹配，使用虚构Key，未泄漏真实凭证。[脱敏HTTP证据](FULL2-20261010-spec-secret-http.json)。综合已直接验证；更新共用函数的影响来自静态审查，未冒称更新泄漏也实跑。

独立两轴：[Standards报告](FULL2-20261010-standards.md)、[Spec报告](FULL2-20261010-spec.md)。

## 本次实测和范围

- [构建](FULL2-20261010-build.log) PASS，45模块，Vite997ms；[全套测试](FULL2-20261010-tests.log)155/155 PASS，19.113秒。
- 50/50既定HTTP/磁盘场景、6/6多密钥服务场景、备份3/3组通过（含18个恶意归档子案例）；另外3个新增凭证探针FAIL，不能被正常测试抵消。逐项文件及范围见Spec报告。
- [实际浏览器](FULL2-20261010-browser.md)完成四条fake机械链路、中文变量、剪贴板读回和版本观察。跨回合旧临时目录消失，原四链路重启未补签；新手动Prompt受控API重启+刷新通过，[文件字节核验](FULL2-20261010-browser-resumed-files.json)。本轮未重跑上传、原生下载和全部异常UI，相应不变模块按明确历史证据复用。
- 初次沙盒build realpath及test/service rename遇EPERM，保留[构建原日志](FULL2-20261010-build-sandbox.log)、[测试原日志](FULL2-20261010-tests-sandbox.log)。仅停止确认属于本轮的挂起测试树，同代码正常本机权限重测通过，不当作产品缺陷或删除失败记录。

[109项矩阵](FULL2-20261010-spec-matrix.md)：DOC108 PASS/1 FAIL；RUN汇总72 PASS/1 FAIL/36 BLOCKED，R41凭证保护FAIL。包含新实测及明确历史复用，不代表109项全部重新操作。旧修复的PASS不等于全产品凭证保护PASS。

[当前产品配置](FULL2-20261010-config.json)仍缺地址/模型/API Key，source=none；真实Provider成功、语义质量和长文效果36项仍BLOCKED。fake证明接线和门禁，不证明真实AI能力。其它Node版本、跨平台和超出既定容量未实测。

## 保护与交付

[版本和数据完整性](FULL2-20261010-integrity.json)：本轮72产品文件、2正式用户文件、746份受保护旧报告/fixture摘要不变。npm test会改写的两份B04原证据已恢复，新输出独立保存。无产品修改、部署或后台监控。新问题的可复现材料与修复验收标准均已归档；应修复S-03/S-04后定向回归，再补真实Provider验收。
