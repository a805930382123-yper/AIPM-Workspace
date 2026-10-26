# SYN01-FIX 独立验收

主Agent交付关联：上述受测产品、测试及本轮证据已保存于提交 `d055316`。下文HEAD是执行时基线，SHA是实际受测文件；本附注仅关联提交，不改变验收结论。

2026-10-26，Astra medium，B模式。**本轮F01–F05工程返修通过；SYN01整体仍未通过：R03旧真实FAIL、R04真实NOT_RUN；全产品/B09未通过。** 本轮关闭的是新综合请求的结构、分类和引用生成契约缺陷，不是把seq242原稿改成成功。真实调用0、实际配置/私有response读取0，知识242/500、Prompt15/24不变。

受测基线/HEAD `c59c6fbc17af6b5c14cca7fc1d3f31162b591485`，本次产品是该提交上未提交工作树，下列SHA为实际受测版本。主Agent后续统一提交；本报告不冒称已有新提交。施工交接SHA `5b16792f5b997a7ab86207af72594647afc7d8e48d5882da090158f084a8af8d`；冻结任务卡SHA `5caac7e5350aeef71a6797353df9cd6fb98f20e618e9fb236f493b31e633f0e9`。

## 独立检查及结论

已读取实际产品diff、四默认测试diff、两新增施工测试完整内容；核对七文件SHA与交接一致。产品只改 knowledge-workflows.ts 的 synthesis 和共享call必要分支，更新协议仍走原evidence-id分支；默认桩迁移保留原业务断言，新增存储字段断言。未发现越界产品修改或待返修缺陷。

| 验收项 | 独立证据及结论 |
|---|---|
| F01 | 原seq242 response.text原样回放被拒绝且无新增workflow；脱敏导出SHA保持 `17b8eb6db27db107f01cca85addbf56c7f476d977a44682530b1beffeca21978`。旧失败未改写。通过。 |
| F02 | 新请求含数值版本1、13分类、完整Raw及目录；4条合成证据保存为既有字段。重复句取指定第二锚点[3,514)，emoji锚点[514,520)，slice相等。独立另写probe验证同正文不同Raw的ID仍不同、输入次序反转仍正确、跨Raw重放拒绝、实际变更正文及SHA后旧ID拒绝。通过。 |
| F03 | 独立复跑28条技术负例记录：结构/ID21、截断1、响应/派生秘密2、调用前门禁4；拒绝无新增workflow，4项前置异常零Provider请求。源码核八必填字段、条目字段白名单、分类id、Raw+正文SHA绑定、范围与slice、派生秘密检查；没有默认补字段、quote搜索、end修正或旧响应fallback。通过。 |
| F04 | 独立运行实际registerKnowledgeRoutes+Store的隔离HTTP：新综合未审拒绝、显式审查确认、两Source+综合落盘及回读、Raw不变。旧合成持久记录读取不重写，显式审查后确认，无Provider重建。13项受影响默认测试同时涵盖update对照、人审未解决项、旧事务与深层损坏。通过。 |
| F05 | 独立定向脚本、13tests、TypeScript检查完成，七项冻结无漂移；没有跑445、旧11+6、Vite或Chrome。通过。 |

上述33条施工脚本技术记录、13个默认test、3项独立probe是不同层级，不合并为业务场景总数。复跑脚本仍保留其原名 `SYNTHETIC_SELF_CHECK_NOT_INDEPENDENT_ACCEPTANCE`；本报告的独立结论基于我实际执行、源码审查及独立probe，并非转述Sol自查。

## 实际命令与结果

Node v24.20.0，Windows PowerShell。

```text
node --import tsx tests/acceptance/SYN01-FIX-20261026-selfcheck.mjs
node --import tsx --test --test-name-pattern 'B05 synthesis|B05 非法综合|B05 Raw正文|B05 重启|B05 更新' tests/b05.test.ts
node --import tsx --test --test-name-pattern 'FINAL-02 synthesis|FINAL-02 request|HUMAN synthesis|PA01 R01' tests/kb02-final-agreement.test.ts tests/kb02-human-review.test.ts tests/pa01-r01-r02.test.ts
npx tsc -b
node --import tsx tests/acceptance/SYN01-FIX-AUDIT-20261026-probe.mjs
git diff --check
```

- 自查复跑exit0，33条记录，内部745ms/工具2.194秒；本机HTTP在finally关闭、自有TEMP清理，guard configReadsDenied=0/networkDenied=0。
- 默认两组最终exit0，5/5（runner949.69ms）及8/8（runner1390.09ms）。首次两组被沙箱spawn EPERM阻断，用例未执行；按授权执行权限重跑后通过，不计作产品失败或成功用例。
- tsc首次因写tsconfig.tsbuildinfo被沙箱拒绝而exit1；执行权限重跑session88673最终exit0。未记录完整总墙钟，不虚报编译耗时。
- 独立probe exit0，工具1.386秒，三项绑定核验通过，内存save仅正例1次、两负例不增加，真实0、guard两计数0。
- diff --check exit0，仅既有LF/CRLF提示。没有自动审批拒绝或未解决权限事项。

## 受测冻结

以下七项逐一实测，与施工交接一致；独立者未改产品或施工测试。

| 文件 | SHA256 |
|---|---|
| services/wiki/knowledge-workflows.ts | b3269a215ed042b6822a2b77320d3cd2be60d0c40797b7cce50794e8047efbc9 |
| tests/b05.test.ts | 14bf48d5aa5b614707f046997664cfd8b5f98a33642de2420151fcc065dfa7a8 |
| tests/kb02-final-agreement.test.ts | 1f79cb8e45bf3c8ed575566346547eea7238568e719ee75868e72203af0869ad |
| tests/kb02-human-review.test.ts | d8191d11d357b9301bea640d8d6e7a1bae827159ae2765eb89a5decd4dc885dc |
| tests/pa01-r01-r02.test.ts | 7748a7db55706d3485b81c7224c16bedcd939f5595de1b87d7f87bd2a6c8d208 |
| tests/acceptance/SYN01-FIX-20261026-fake.ts | 9d702b2f1774ffc21d60b5a354a65b11e2dbe6e98a36629d5cfc8e8df8b66278 |
| tests/acceptance/SYN01-FIX-20261026-selfcheck.mjs | fe85fb2eb44468796f18235b2b9de8c54f1257c831b6e1186858caa1b915e2b1 |

## 局限、下一步与停止

512字符锚点可能包含多个断言或本短样本整个Raw。通过表示证据可精确定位、身份不可串用，不证明共同命题或冲突文字的语义充分性。合成内容由测试作者有意保留100、20%/30%、未知与未来，不能当作新协议的真实模型遵从率。每Raw256目录上限与正文+目录输入长度限制如实保留；旧响应不兼容，新请求严格v1，旧持久数据兼容。

HTTP是实际生产知识路由/Store，Wiki读取为测试只读接线，不是完整App/Chrome；UI及持久结构未改，按卡无需新增浏览器验收。历史R03失败和R04未运行仍阻止SYN01整体通过；其它全产品缺口未处理。下一最小建议为另获明确真实预算并建立新冻结后，最多一次新协议综合及成功时人审保存回读；当前授权0，不得重启或解锁旧242入口。

必要验收已满足，独立者停止产品/tests写入及追加测试；交主Agent更新状态、统一提交并核远端。不自动推进下一批。平台未暴露子Agent token计量，记不可得。
