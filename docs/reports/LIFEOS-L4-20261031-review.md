# LIFEOS L4 独立验收（2026-10-31）

**本轮 F4-01 已关闭；L4 本批工程与界面范围 PASS。** L4-03的真实质量触发条件未发生，条件项 **N/A**；真实模型质量 **NOT_RUN／未测**，不称质量PASS。不启动阶段5。

## 版本和范围

基线 `223f1cc0245121bc14aa93514cc2d570f8ec27f3`；[冻结卡](../handoffs/LIFEOS-L4-20261031-task.md) 先审/冻结时SHA256 `0581191F0ACE3664599AAB554BDB716D079B788F507B45316C0E1E69059FEB01`；主线程归档仅去EOF额外空行，最终SHA `C767D7F3BB92D1E8F049B8C76C0152D9D2BAC4AAD4B21CF93CED9962DD2CAB44`，标准与正文未变。评分0/1/1/0=2，A标准；Astra Medium规划、Terra High `/root/lifeos_builder` 施工、Sol High `/root/lifeos_reviewer` 独立验收。施工者与验收者是不同实例，验收者仅写独立脚本及本报告，缺陷由Terra返修。

最终六份施工文件指纹与[施工报告](LIFEOS-L4-20261031-builder.md)一致；其中CSS使用返修后版本：

| 文件 | 最终SHA256 |
| --- | --- |
| app/pages/PromptAiWorkbench.tsx | EDC584775B3A939BA720EA890CD6FC3867BA23C366DB941BAA4E3A399A169993 |
| app/prompt.css | 2568E7F9564138B64A13C375D33F16F68D9AF52271A0771713266C2CD3502581 |
| app/prompt-scenario-guidance.ts | CB480EDA69C9129FF8A534C21CCEA5834DB9AF1EF0D7549134457B6C9E80894E |
| tests/lifeos-l4-guidance-ui.test.tsx | 415152D1AA3F83A3A851C476A24DB1EA0F8DE515995D4E18AADEFC511D78186E |
| tests/lifeos-l4-flow.test.ts | 9A3732AB1126FC4BDE8BE3C4D613006E6106D11780020F8B07BEFC2CF3DC0BD2 |
| scripts/lifeos-l4-isolated.ts | CF9057CF4F6A71F14C9E5F78E107DB77B02C71DEE81C8E56390C58E60EBC4A4B |
| tests/acceptance/lifeos-l4-browser.mjs（独立） | F86899888A8C0E30DE8A3A0C3A7BD9FE98DE97D7F5314D69DB2FB95C8413C317 |

四份他人文件前后SHA一致，排除本次提交。最终提交/远端同步由主线程交付消息绑定；验收者未提交推送。

## L4-01–03结论

| ID | 结论与实证 |
| --- | --- |
| L4-01 | PASS：四既有ID的输入/产出/事实未知指导及七字段帮助匹配任务卡；原七选项和三通用场景保留，Optimizer无行业帮助。实际Chrome查看四场景及通用模板，手动默认值与基线完全一致；切换指导后九字段和Wiki勾选不变，Provider仍0。最终1440/1024分组、12px帮助、换行与焦点正常，无横溢。 |
| L4-02 | PASS：完整App/真实API/PromptStore/PromptAiService，仅Provider fake。实际手动编辑→显选一Wiki→生成预览→编辑正文→明确保存→Library读回v1/favorite=false；保存前无新增正式Prompt。未选Wiki正文不发送，受限Meeting Wiki实际403/MEETING_SOURCE_RESTRICTED且fake计数不增。旧Prompt历史只读与Optimizer入口实看通过，迟到Brief取消由本轮组件实测覆盖。 |
| L4-03 | 条件未触发，N/A；真实质量未测。`git diff --name-only -- services server rules`为空，TEMPLATES/contract/system/wire构造未改。实际API body逐字段等于用户编辑Brief和显选ID；Provider generate payload只含该Brief、所选背景及原categories。原AI Brief请求严格为task/template，Provider仍收到原七项id/label，无guidance字段或隐藏追加。故本轮没有模型提示调整，不能把fake输出当真实质量证据。 |

## 缺陷与验证

F4-01 CLOSED：初验实际computed style显示新帮助容器被既有`.field > span`覆盖成block，标题与三组small同行拼接、字号偏小。Terra只改Prompt局部CSS优先级和字号；最终Chrome实测flex分组，各组top/bottom不重叠，帮助及七字段提示均12px，1440/1024宽scrollWidth等于视口。独立验收者与主线程均实际查看最终图。

独立命令：

```text
node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l4-guidance-ui.test.tsx tests/lifeos-l4-flow.test.ts tests/prompt-ai.test.ts
```

14/14 PASS、exit0、1.517秒，含完整手动请求体、迟到结果、预览/确认/版本与显选背景。施工27项及最终tsc、空envDir构建复用同版报告。返修仅CSS，未重跑已过行为；`git diff --check`和独立浏览器脚本`node --check`最终exit0，仅Git换行提示。

实际Chrome 156.0.8078.76：

```text
node tests/acceptance/lifeos-l4-browser.mjs C:/Users/80593/AppData/Local/Temp/lifeos-l4-FBB5Me/isolated-session.json
```

整程exit0、3.158秒、11组检查/7图、success=true。仅三次显式fake complete：手动生成一次、原AI Brief及其预览各一次；确认保存、指导查看/编辑、来源拒绝均未新增模型调用。Knowledge全树文件集合/字节SHA不变；pageerror与外发0。

最终CSS后仅用PowerShell here-string经`node`加载同Playwright/Chrome补1440/1024视觉：exit0、2.022秒，final-visual-evidence.json pass=true，fake3→3；其余五施工文件未变，复用前述11组行为结果。证据位于 `C:/Users/80593/AppData/Local/Temp/lifeos-l4-FBB5Me/lifeos-l4-browser-evidence/`，包含evidence.json、03未保存预览、04正式Library、07来源拒绝及08-final-guidance-1440/1024图。

首次浏览器脚本在填写任务后使用旧嵌套textarea的精确label定位而超时，尚无模型调用或保存；修正独立选择器后同隔离根整程通过。失败工具记录及failure-observation.png保留，不计作产品失败，也不把首次退出写成成功。

本轮真实Provider、正式配置/.env及正式workspace访问0；配置加载器未接入harness，不把`not-connected`字段冒充配置运行探针。历史知识287/500、Prompt20/24、KB03 24/30保持，未重新核账或消耗余量。主线程已确认11728及包装16324/2444退出，5173/61226无监听，TEMP保留。

本轮缺陷关闭与L4界面引导工程整体通过分别成立，无待返修项。真实模型质量未测；KB03限定范围PASS、会议上传UI独立BLOCKED、原收据缺口及非阻断不足保持。主线程提交同步后停止；阶段5未启动。实际子Agent token计量不可得。
