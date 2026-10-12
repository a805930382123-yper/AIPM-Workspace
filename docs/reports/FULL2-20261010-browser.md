# 第二轮实际浏览器观察（2026-10-10至11）

使用 CUA 操作隔离 localhost 产品、明确标记的本地 fake Provider。以下均为实际界面观察，不是 jsdom；不代表真实模型质量。

2026-10-10 四条机械链路已观察通过：
1. 首页导入「第二轮验收：订货流程」，正文31字符带换行，Raw ID f6d355b3-e276-4879-8f22-709dc1ab0c90。AI整理→继续审核，来源事实/整理/推断/问题分区可见，默认不选中。全选并明确确认，提交26c1f28c-bec9-47d2-99f2-79f18a97ced6显示五阶段done，Source与业务流程Wiki各1页。
2. 选择业务流程Wiki 516282c9-b1aa-4e85-8960-10abfdea7866，提交整页Audit→生成建议。人工改为「第二轮人工确认：先核对库存，再由负责人确认。」后接受，Wiki第2版、Audit resolved rev3。首页Raw1/Wiki2/本周3/pending0/Open0/Prompt0及实际知识日志可见。
3. 首页Generator→自然语言任务→Brief。人工修改目标，勾选该Wiki，预览显示22/12000背景字符且含所选Wiki正文。复制按钮后真实剪贴板读回含人工目标和所选背景。明确保存「第二轮访谈Prompt」第1版，Library1条。原剪贴板为空，已恢复空文本（空items数组不能直接write，随后writeText空串成功）。
4. Library变量{{客户名称}}填「隔离客户甲」，最终正文替换正确、原模板变量保留。Optimizer选择原模板，输入补充要求，原文快照/九维检查/改进点/优化版可见。保存第2版后同ID c5ba21b0-3a73-4dce-936d-9ae7f73b4f84，Library仍1条，历史同时显示AI生成v1和AI优化保存v2。

以上持久化到当时临时目录，但跨回合恢复时该临时目录已不存在。10/11启动前[目录快照](FULL2-20261010-browser-before-restart.json)四根均空。因此不能将旧四链路的重启持久化签PASS，也不据此认定产品删除了数据。旧runtime在进程终止前未写回完整HTTP记录；上述观察来源是本聊天实际CUA返回，不伪造缺失网络日志。本轮未重新操作文件上传、原生下载或全部异常UI。

10/11补测：在同一隔离服务新建「第二轮持久化复核」，ID171d7f6f-2856-4b1c-9cf6-c547b4cd7050，29字符正文含中文变量/换行。受控同目录API重启，knowledge/prompts/drafts/state文件集合与SHA全相等；页面reload后首页Prompt1、Library同ID同正文与v1仍在。[磁盘及统计证据](FULL2-20261010-browser-resumed-files.json)，[截图](FULL2-20261010-browser-persistence.jpg)。这是新手动Prompt的重启验证，不补签丢失临时夹具的四条旧链路。

首次搜索不存在的「AI 整理」按钮超时，实际标签为「AI 整理知识」，重新观察后继续；以及跨回合旧标签/端口失效，是定位/环境恢复记录，不计产品FAIL。初次沙盒服务因Temp rename EPERM退出；相同代码正常本机权限启动后运行。无用户workspace操作，无真实凭证使用。
