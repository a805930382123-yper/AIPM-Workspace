# 本机试用交接独立验收（2026-10-30）

本轮交接：**PASS**。README、delivery、B09任务卡区分当前109 PASS与历史阻塞；隔离无Provider手工HTTP创建/读取、同根重启、停服备份/新空根恢复及正文和引用回读通过。发现的备份路径文档缺陷由Terra返修后独立复核关闭，无遗留本轮缺陷。

B09整体：沿用2026-10-29既有 **109 PASS / 0 FAIL / 0 WAIT**，不作为本轮重新运行109项的结论。历史模型失败及输出质量限制保留；本轮未重验真实模型、浏览器操作、最低Node或跨平台，不新增这些方面的通过声明。依据 `docs/status.md` 顶部、`B09-RESUME-20261029-matrix.md` 及R13报告。产品基线 `53c16918a9c284a1c18fd7e47f468d9b960a1c89`；验收时HEAD `648872f99f0e4c0dbceefedf400d2f6f0bf5bce0` 加本轮未提交文档与脚本。实际差异无产品修改，AGENTS及AGENT-ROUTER包装报告不属于本轮验收产物。

验收者与施工者为不同Agent实例。读取AGENTS、coordination现行规则、agent-router Skill、status、B09卡、相关验收依据、施工报告、check脚本、harness及实际git diff；只新增本报告，不修改施工产物、不提交。

## 实测命令与结果

环境命令 `node --version` / `npm --version`：v24.18.0 / 11.16.0，Windows。

1. `node docs/reports/LOCAL-HANDOVER-20261030-check.mjs`：exit 0，约4.49秒；createRead、restartRead、backupRestore、restoredRead均PASS，6文件SHA快照一致；本次末次API端口53494，Vite5199首页HTTP可访问。
2. 为独立核实Wiki和Prompt正文，以下在内存中添加断言并从stdin执行，未修改原脚本。exit 0，约8.58秒（包含清理查询），末次API端口59164，四项仍PASS、6文件一致。三次verify分别在创建后、同根重启后、新根恢复启动后执行，均核对Raw正文、Wiki正文/标题/Raw来源、Prompt正文/名称/已解析Wiki引用。

```powershell
$handoverReviewSource = Get-Content docs/reports/LOCAL-HANDOVER-20261030-check.mjs -Raw
$handoverReviewSource = $handoverReviewSource.Replace("'../../tests/b07-harness.mjs'", "'./tests/b07-harness.mjs'").Replace("assert.equal(w.title,'试用知识');", "assert.equal(w.title,'试用知识'); assert.equal(w.body,'手工知识内容。');").Replace("assert.equal(p.prompt.name,'试用模板');", "assert.equal(p.prompt.name,'试用模板'); assert.equal(p.prompt.body,promptInput().body);")
$handoverReviewSource | node --input-type=module
```

原脚本仅直接断言Raw正文、Wiki标题/来源、Prompt名称/引用；其快照比较证明备份文件字节一致。上述补充断言提供Wiki/Prompt正文的HTTP读取证据，不将快照比较冒称页面操作。

脚本内部实际执行 `node --import tsx scripts/backup_workspace.ts export --data-root <TEMP源> --output <TEMP归档>` 和 `restore --input <TEMP归档> --data-root <TEMP新根>`，均exit 0。恢复目标初始不存在，停服后导出；逐相对路径比较全部6文件SHA-256，然后从恢复根启动API读取内容和引用。

3. `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check -- README.md docs/delivery.md docs/batches/B09.md`：exit 0，无差异空白错误，仅Git的LF/CRLF提示。同时读取实际diff与package/vite启动配置，运行入口、默认数据根和端口说明一致。未因文档变更重跑全量测试或build。
4. `Get-NetTCPConnection -LocalPort 53494,59164,5199 -ErrorAction SilentlyContinue` 无输出；`Get-CimInstance Win32_Process` 过滤 `server/index.ts|node_modules/vite/bin/vite.js` 无输出；`Get-ChildItem $env:TEMP -Directory -Filter fmcg-handover-*` 无输出。两次实跑的自有服务及临时数据已清理，未停止其他Node进程。

## 隔离与未测边界

检查脚本、harness和server入口确认数据根显式指向新建TEMP目录，配置路径显式指向其中不存在的absent.env，Provider三项环境变量清空；仅调用手工Raw/Wiki/Prompt及健康接口。备份CLI只操作显式TEMP源/目标，正式workspace不作为输入或输出。本轮真实API调用0，真实配置读取0，未触及正式workspace；该判断依据隔离参数及执行路径，不声称做过正式资料全库前后SHA扫描。

Vite首页HTTP 200只证明HTTP启动；浏览器UI实际操作 **NOT_RUN**。本轮未执行npm install（依赖已存在），未部署，也未调用真实AI；产品四链浏览器及模型历史证据仍按原矩阵的版本和适用边界引用。

## 发现与返修复核

初验发现delivery顶部建议试用根 `D:\FMCG-Trial`，却引导照抄下方 `--data-root .\workspace` 备份命令，可能备份错误数据根。交Terra做范围内文档返修，停写后独立复核：现明确 `--data-root` 必须使用实际根，示例改为 `D:\FMCG-Trial`，默认根另有说明，恢复仍指向新空根 `D:\FMCG-Restored`。问题 **CLOSED**。仅文档变化，复用已通过的运行验证，不重复启动服务。

最终文件SHA-256：

| 文件 | SHA-256 |
|---|---|
| README.md | 9EF6F48E073F34A8191E94DF1E27E3739F3E27B1036B61B2D99E1660B606CE28 |
| docs/delivery.md | 024EB1EF6ADF3E67EEB3A1EDB1DD49E36651A8FABE445A0A8D634B605D4716BC |
| docs/batches/B09.md | 79D0F176E461E607D2BE20535FCF3BCF1F1C797D42924775580640C4482B9E6B |
| LOCAL-HANDOVER-20261030-check.mjs | A687F3B797B44D92072285CD6D6F791314A29DF3D578EF69F8D8F40DD4B0F2AD |

主Agent可按已有授权提交本轮产物并验证远端同步；本验收者未执行提交推送。未启动下一批次。子Agent实际token计量不可得。
