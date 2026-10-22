# M05 Meeting Hub 整合独立验收

2026-10-12施工与实测，2026-10-13最终签收：**M05本机阶段PASS**。用户授权GPT-6 Luna High施工，主Agent独立验收；F05-01、F05-02、F05-03全部CLOSED。Meeting Hub M01–M05本机建设完成。本结论不覆盖原全项目S-03/S-04 FAIL和真实Provider36项BLOCKED。13日收尾复核指纹与最终冻结一致，证据文件保留20261012前缀，没有倒称重跑无变更测试。

[任务卡](../batches/M05.md)、[实际MH01–MH48矩阵](M05-20261012-spec-matrix.md)、[接口交接](../meeting-hub/M05-interface.md)、[使用说明](../meeting-hub/M05-usage.md)、[施工记录](M05-build.md)。主Agent没有改产品或单测，产品与定向测试由Luna施工并停写后签收。

## 版本与所有权

起始[baseline](M05-20261012-baseline.json)与[最终frozen](M05-20261012-frozen.json)是实际SHA清单，无Git元数据/旧完整源码，未冒称行级diff。4产品文件变化：App、MeetingPage、MeetingRawLinks、RawPage；新增2定向测试：app-m05-raw-navigation、meeting-integration-m05。服务端、rules、scripts及依赖未改，62个非App产品文件SHA不变。

最终82产品/49测试与冻结一致；正式workspace3文件和1165受保护历史/规划/验收文件与起始字节一致。完整测试生成的旧B04输出另存本轮generated副本后恢复原字节；测试中途保护检查曾看到该预期覆盖，完成restore后全部通过。见[integrity](M05-20261012-integrity.json)。没有正式数据迁移、配置密钥更改或部署。

## 必选门禁与实际证据

| 门禁/检查 | 实际结果 | 证据 |
|---|---|---|
| G05-01完整本机闭环 | 8/8，含实际multipart/BOM/CRLF、原件/副本/双Raw、同根重启、实际CLI恢复、并发撤权、分别解除/清空/删Raw/删档案 | [scenario](M05-20261012-scenario.json) |
| G05-02 App整合/选择 | 10/10，真实App React+产品HTTP，非浏览器；含重连、缺失目标、旧列表迟到及部分成功真实计数 | [App组件](M05-20261012-app-component.json) |
| G05-03权限/恢复 | Meeting Raw HTTP21/21、来源/恢复11/11、基础API23/23、旧Meeting真实HTTP组件7/7 | [HTTP](M05-20261012-http.json)、[deep](M05-20261012-deep.json)、[API](M05-20261012-api-regression.json)、[组件](M05-20261012-component.json) |
| G05-04旧链/后台任务 | 旧Raw/Wiki/手动Prompt/显式demo7/7、Workflow11/11、Audit15/15；真实普通Raw任务+实际轮询1/1 | [旧链](M05-20261012-legacy-http.json)、[B05](M05-20261012-b05-regression.json)、[B06](M05-20261012-b06-regression.json)、[任务组件](M05-20261012-app-job-component.json) |
| G05-05实际用户操作 | 9/9 IAB真实浏览器，桌面及390×844基本窄屏；真实建档/筛选/授权/危险Markdown/编辑/双Raw定位/解除/双确认删除/受限综合拒绝 | [browser](M05-20261012-browser.json)、[实际trace与关闭记录](M05-20261012-browser-lab-final.json) |
| G05-06交付映射 | MH01–MH48各有具体结果/证据/限制；旧安全FAIL、真实AI BLOCKED单列 | [48项矩阵](M05-20261012-spec-matrix.md) |
| G05-07质量/保护/审查 | 完整build PASS、201/201测试，无失败/跳过/取消；Standards和Spec最终复核PASS；17/17证据核对 | [quality](M05-20261012-quality.json)、[测试日志](M05-20261012-tests.log)、[两轴](M05-20261012-axes.json)、[evidence](M05-20261012-evidence.json) |
| 实际备份与保护 | 5/5组：新旧归档/运行读回、9恶意归档、Windows junction、非空目标与源保护 | [backup](M05-20261012-backup.json) |

合计119项本轮服务/API/组件/旧链/备份检查组通过，另有9项真实浏览器。最终tsc5971ms、Vite1911ms、完整测试进程18974ms（Node测试日志18811.8304ms）。Vite主chunk仍大于500kB，构建退出码0，不将大小提示当行为PASS依据。子Agent实际token计量不可得。

主要命令为`node tests/acceptance/m05-{quality,scenario,http,deep,api-regression,backup,b05-regression,b06-regression,legacy-http}.mjs`；`app-component/app-job-component/component`加`--import tsx --import ./tests/support/css-stub.mjs`。主Agent在正常本机Node环境独立运行完整测试，没有使用施工方定向测试中的os.userInfo替代预加载。Luna因其测试宿主限制使用的兼容预加载仅证明其定向结果，不替代本报告实测。

## 缺陷闭环与交付行为

- **F05-01 CLOSED**：指定Raw缺失不回退成另一条；请求等待期间用户改选不被旧响应覆盖；指定意图持续到重连和同页刷新。AC07/08/10独立实测通过。首轮App误展示另一场原文及追加重连失败证据保留在[initial](M05-20261012-initial-app-component.json)、[reconnect-failure](M05-20261012-reconnect-failure-app-component.json)。
- **F05-02 CLOSED**：使用说明区分取消/写入前拒绝与Raw已写但收据提交失败。AC09实际linked提交EIO保留pending+真实Raw，首页统计如实增加；原“所有失败不增加数量”的错误承诺已移除，不诱导新建请求。
- **F05-03 CLOSED**：旧普通Raw任务轮询结束调用旧render刷新，曾把用户从C改选的B切回C。独立真实任务/HTTP/poll复现保留在[job-selection-failure](M05-20261012-job-selection-failure.json)。最终无参刷新从当前选择ref取ID，AJ01复验仍留B；没有禁用轮询或改变旧任务算法。

登记成功后App刷新真实Raw/统计，跨页不需reload；linked项显示真实ID“查看 Raw”，失效来源没有假入口。原件与工作副本分开，旧版本仍能准确定位；缺失指定目标有可读提示。原来源门禁、固定ID与原件不可改写约定保持。

## 两轴、复用与未测范围

初次Standards与Spec辅助只读审查分别指出F05-01/02，主Agent已运行复现并闭环。末次辅助模型返回容量不足，没有冒称其最后一轮完成PASS；主Agent保留两个轴，复核最终所有权/源代码/说明与G05/MH48契约，并通过实际App、HTTP和任务回归闭环。见两轴记录。

服务端/备份/旧链在本轮实际重跑后未再改变，末次仅App当前选择ref与定向测试，因此复用已通过的服务端证据；M04旧高修订收据、Raw重放/删除边界5/5是明确的历史复用。M02历史多组合筛选/排序与外链、M03格式/大记录/安全阅读分别标识，不倒称本轮全量重跑。没有再跑原45MB大归档；解码模块SHA未变。

9项实际浏览器完成于最后的普通任务选择ref修复前；末次没有DOM/样式/服务变化，当前App10项与真实普通任务AJ01在最终冻结后重跑。该修复不影响上述基本用户流程，浏览器结果按此边界复用，没有伪造最终源码下的新截图。桌面/窄屏截图分别见[desktop](M05-20261012-browser-desktop.jpg)、[narrow](M05-20261012-browser-narrow.jpg)。

早期AC05只找“来源已删除”，实际文案“Raw已删除”，校正选择器；AC07最初直接打印jsdom节点导致断言错误输出分配失败，改为布尔断言，真实错误原文证据保留。浏览器一次getByLabel选择器无匹配、一次未绑定browser变量读取能力失败，随后按实际DOM/同浏览器能力完成，不计产品缺陷。自有viewport已reset、临时标签已关闭，65454/65460/65461实际ECONNREFUSED。

会议场景与浏览器Provider0；deep总fake1是正常Prompt预览准备，受限确认新增调用0；AJ01总fake1是明确普通Raw任务，非会议AI。B05/B06为普通fake机械回归。浏览器只增加预期2个会议Raw，既有knowledge字节不变，prompts/drafts/state不变，不误称零knowledge写入。真实外部Provider未调用。

仅Windows/Node25.2.1；未代签最低Node、其它OS、飞书登录/远端权限、所有设备、真实AI质量或企业DLP/防磁盘篡改。MH36/MH37仍携带旧安全FAIL和真实AI BLOCKED。**Meeting Hub M01–M05本机建设完成；全项目仍不能签PASS。**
