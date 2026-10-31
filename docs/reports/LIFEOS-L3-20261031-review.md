# LIFEOS L3 独立验收（2026-10-31）

**本轮 F3-01–05 均已关闭；L3-01–04 本批整体 PASS。** 结论限首页行动事项，不代表全产品或真实模型质量通过。主线程可提交同步后停止，不启动阶段 4。

## 版本与准入

基线 HEAD `806b27096dce32d6ab5ddae5c590a7d31523a3cd`。评分 0/2/1/0=3，A 标准；Astra Medium `/root/lifeos_planner` 规划，Sol High `/root/lifeos_reviewer` 先审准入，Terra High `/root/lifeos_builder` 施工，原 Sol 实例独立验收。先审卡 SHA256 `9744558CE47FDCDB3E1C9271DF273733B3EF9C3A1D42FCA796D10C75FD96ED57`；已核现有 validator、只读扫描信号、缺目录/已知引用和精确 Audit 导航可实现，准入通过后才施工。

验收者未改产品或施工测试，仅写独立浏览器脚本及本报告；缺陷由 Terra 修复，停写后复验。独立核 11 份施工文件 SHA 与最终交接一致，完整清单见[施工报告](LIFEOS-L3-20261031-builder.md)。关键最终 SHA256：

| 文件 | SHA256 |
| --- | --- |
| app/pages/HomePage.tsx | 3DE6567711F43DCB32DD15D604E48AE5644DB979206B3E3104DF21931FC76822 |
| app/styles.css | 713B987B061D4B47AB5445627FE0FCD721FAB8DF4EC92F872EDD21D914F71987 |
| services/home/actions.ts | 296541D32E6026E2D11DA600CCF82A213EA36AB8BADB43D3EF1EC9F69D45ABF7 |
| tests/lifeos-l3-actions.test.ts | 270F90ECFFC2BDD900637E9D22B6D5AB5F92AD03715EDA002A7F217983244D40 |
| tests/acceptance/lifeos-l3-browser.mjs | D8E5D427508C2263CF440FCC642591F04A27EAFEA05C4034D9FC2FFC425780D9 |

原四份共享修改前后 SHA 一致，排除本次提交。最终提交/远端一致性由主线程交付消息绑定；验收者未提交推送。

## 四项裁决

| ID | 结论及对应证据 |
| --- | --- |
| L3-01 | PASS：真实隔离记录保留同 Raw 两独立草稿、workflow、Audit及当前任务；不以 Raw 合并不同 kind/ID，历史失败不重复纳入。服务定向核排序、缺引用、目录及扫描预算错误；三项独立反例修复后不再漏报或连带吞掉可读草稿。 |
| L3-02 | PASS：实际 Chrome 点击四类入口，真实预检/详情 GET 核 Raw/job ID、draft/workflow ID与revision、Wiki/Audit ID与revision；删除410、旧版本409及刷新后新版本、迟到Audit预检隔离均通过。额外实际补验：列表加载后移除关联 Wiki，点击 Audit 得410和明确提示，未打开其他对象。 |
| L3-03 | PASS：四源分别坏JSON均只显示相应来源失败，其余源可读；ENOTDIR、扫描partial/overflow及合法缺目录有定向证据。Chrome核来源错误/恢复、真空状态、实际拒绝Audit后返回首页移除；补验 stats 网络失败时仍有5条真实行动事项。1440/1024长标题换行、按钮、来源/状态、焦点经实际截图核看，未把同名草稿当作重复。 |
| L3-04 | PASS：首页GET、逐事项预检GET及浏览器刷新前后，五个业务根共35文件的集合及字节SHA完全一致，Provider计数0→0；坏来源读取和合法空状态也独立拍快照比较。初始化、故障准备及用户显式拒绝Audit的写入均在只读测量外，不冒称全生命周期零写。配置加载器未接入隔离入口，未读.env或正式workspace，不把固定config=0字段冒充真实配置调用探针。 |

## 缺陷与复验

| ID | 初验实际失败 | 最小修复及结论 |
| --- | --- | --- |
| F3-01 | RawState坏JSON导致raw-task与draft同时error，合法草稿被隐藏。 | draft自身扫描与RawState依赖诊断区分；独立反例复验draft保持ok/3条，CLOSED。 |
| F3-02 | processing引用不存在job，源ok但事项消失。 | 保留明确缺失目标项；实际复验target.missing=true，CLOSED。 |
| F3-03 | 内存pending recovery缺磁盘job时同样漏项。 | 沿已知恢复引用显示失效项；实际复验不再消失，CLOSED。 |
| F3-04 | 1024实际scrollWidth=1299，最近导入长标题横溢，行动按钮被挤成多行。 | 首页局部尺寸/换行约束及按钮不收缩；最终截图实宽1024、无横溢/重叠，CLOSED。 |
| F3-05 | Audit status=['open']被String转换接受，源ok却0项。 | 新增边界要求合法字符串；独立实际反例仅audit源error，另三源ok，CLOSED。 |

## 实际命令与结果

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-actions.test.ts tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l3-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx
```

初验实际11/11 PASS（4.214秒）；F3-01–04返修后同命令12/12 PASS（2.207秒）。最后仅Audit类型边界变化，独立执行 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-actions.test.ts`，5/5 PASS（0.588秒）；未受影响导航/UI复用前轮本次记录。施工同版Wiki/Audit回归、tsc与空envDir构建复用施工报告，非验收者重复运行。

最终 `node --check tests/acceptance/lifeos-l3-browser.mjs` 与 `git diff --check` exit0，后者仅CRLF提示。未扩大全仓测试。

实际 Chrome 156.0.8078.76，完整React App/真实本机API/stores/runner，仅Provider为fake；外部网络被阻断。最终命令：

```text
node tests/acceptance/lifeos-l3-browser.mjs C:/Users/80593/AppData/Local/Temp/kb03-r4-cyN20b/isolated-session.json
```

**exit0，5.916秒，20组检查/7张截图，success=true**；pageerror与外发均0，最终provider/config记录0/0。随后PowerShell here-string经`node`加载同Playwright/Chrome，实际阻断stats网络请求，再建立虚构Audit、加载列表、移除关联Wiki后点击；两项补验exit0（2.614秒）、supplement-evidence.json pass=true。原Wiki字节恢复，额外Audit已移除。

最终证据目录：`C:/Users/80593/AppData/Local/Temp/kb03-r4-cyN20b/lifeos-l3-browser-evidence/`，含 evidence.json、audit-shape-fixed.json、supplement-evidence.json及01–09截图。验收者实际查看1024和分源错误图，主线程也完成视觉核对。此前 nZOMna 的原失败图/三项反例、QG8OoU 的修复反例及数组形状失败均保留。

一次中途 `/__control/empty` 返回500：浏览器删除场景误选恢复任务绑定草稿，使后续测试准备的显式reconcile冲突。此为验收脚本选错fixture，未计产品空状态FAIL；改为删除独立待审草稿后fresh最终整程通过，未删除失败记录或反复运行无关服务。

本轮真实Provider请求、配置读取、正式workspace访问均0，历史预算不变。主线程已确认最终服务PID18972及包装5500/11192退出、5173/51092无监听，TEMP证据保留；此清理由主线程执行。KB03限定范围PASS、会议上传UI独立BLOCKED、原4收据缺口及非阻断不足保持，均非L3关闭对象。实际子Agent token计量不可得。
