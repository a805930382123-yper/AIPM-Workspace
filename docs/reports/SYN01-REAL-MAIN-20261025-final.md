# SYN01 真实尝试主Agent收尾

2026-10-25，B模式续接。受测工程提交d09fd7b16bb26c36c4d2d066d1eb683c6f21a4ba，产品60f83adba102d887fcd925df13a8021ff7669de1。用户“继续”延续最多一次真实综合及Chrome验收授权。无需新增授权；不增加旧回归。

浏览器工具恢复：CUA getState成功，Chrome浏览器3，新建自有tab115183548。实际App首页显示Raw2/Wiki0。Raw→多来源综合→两条固定来源checked→仅单击一次“生成 Synthesis 草稿”。随后页面显示LLM_SCHEMA_INVALID，未进入草稿审查；截图SYN01-REAL-MAIN-20261025-chrome-failure.png。无人工编辑、确认或正式写入，不能宣称R04通过。

实际命令（仓库根）：
```powershell
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs prepare
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs serve docs/reports/SYN01-REAL-20261025-session-08b79756-cdb8-4b91-88a6-1dedb5804126.json
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs bindings docs/reports/SYN01-REAL-20261025-lab-08b79756-cdb8-4b91-88a6-1dedb5804126.json
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs arm docs/reports/SYN01-REAL-20261025-lab-08b79756-cdb8-4b91-88a6-1dedb5804126.json docs/reports/SYN01-REAL-MAIN-20261025-release-242.json 38cbb6199ce12faf3b6c9b4d9b7162a675b206f585fc3663fcd718f5ef0013ac
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs status docs/reports/SYN01-REAL-20261025-lab-08b79756-cdb8-4b91-88a6-1dedb5804126.json
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs export docs/reports/SYN01-REAL-20261025-lab-08b79756-cdb8-4b91-88a6-1dedb5804126.json
node --import tsx tests/acceptance/SYN01-REAL-20261025-cli.mjs stop docs/reports/SYN01-REAL-20261025-lab-08b79756-cdb8-4b91-88a6-1dedb5804126.json
```

prepare/arm/export/stop命令exit0；arm返回armed true sequence242；serve使用API64511/Vite5173。status确认真实sentThisProcess1/configReads1/fake0，Provider open.bigmodel.cn / GLM-5.3-Flash。脱敏export中result failed/LLM_SCHEMA_INVALID；attempt的pending-counts-if-unknown为不可变额度预留记录，最终结果应读result，不代表仍在请求。stop返回closing true，服务会话73976终止exit0；自有Chrome tab已关闭。

本轮真实1，知识242/500，Prompt15/24；额度已封账，新增调用授权0。未改变90秒/256KB限制，无重试/诊断外发。私有原始响应留在被忽略的隔离目录，只有经现有秘密扫描通过的export进入报告。release/session/control仅记录隔离绑定与本机地址，服务已停。

独立Astra依据脱敏export及生产校验定位：缺suggestedAdditions是直接结构拒绝原因；8个引用end均少1（左闭右开），是另一个真实质量缺陷。共同100/20与30冲突/未知负责人和采样日/未来AI语义保留；语义部分正确不等于R03通过。原稿无修改、candidate不存在、Wiki空；两Raw与固定fixture一致。详见SYN01-REAL-AUDIT-20261025-final.md。

结论：既有R01/R02工程PASS保持，R03 FAIL、R04 NOT_RUN、SYN01整体未通过；全产品/B09未通过，KB02既有HUMAN PASS不改变。本次没有修产品，只完成授权真实尝试、失败裁决及收尾。无需为失败扩大测试，未重跑旧11+6/445/build。下一步建议B模式零调用修结构/引用契约，以本次脱敏响应为固定回放；不自动启动修复或增加真实额度。

Git仅同步本轮session/control/release/export/截图/最终报告及三个状态入口；保留不提交外部AGENTS.md、.agents/和AGENT-ROUTER报告。实际交付提交与实时远端核验在聊天交付中报告，避免为记录自身提交反复生成提交。