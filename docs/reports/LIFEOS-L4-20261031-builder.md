# LIFEOS L4 场景填写引导施工交接（2026-10-31）

基线 `223f1cc0245121bc14aa93514cc2d570f8ec27f3`。新增前端静态填写建议：`customer_interview` 经销商访谈、`business_process` 门店补货、`requirements` AI 需求访谈、`industry_learning` 材料阅读；沿用原七模板 ID 和标签。模板切换仅改变可见帮助，保留手动 Brief 内容和 Wiki 选择；角色及其余六字段分别提示，默认 Brief 和请求构造不改。Optimizer 无行业帮助。

## 施工文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| app/pages/PromptAiWorkbench.tsx | `EDC584775B3A939BA720EA890CD6FC3867BA23C366DB941BAA4E3A399A169993` |
| app/prompt.css | `C8067CEF9FD3D5CB743A11F0A7E060A70AC1BA1069DD5E09FBB9570A8892B9DE` |
| app/prompt-scenario-guidance.ts | `CB480EDA69C9129FF8A534C21CCEA5834DB9AF1EF0D7549134457B6C9E80894E` |
| tests/lifeos-l4-guidance-ui.test.tsx | `415152D1AA3F83A3A851C476A24DB1EA0F8DE515995D4E18AADEFC511D78186E` |
| tests/lifeos-l4-flow.test.ts | `9A3732AB1126FC4BDE8BE3C4D613006E6106D11780020F8B07BEFC2CF3DC0BD2` |
| scripts/lifeos-l4-isolated.ts | `CF9057CF4F6A71F14C9E5F78E107DB77B02C71DEE81C8E56390C58E60EBC4A4B` |

四共享文件施工前后 SHA 一致：AGENTS `5647F001E492A5A8C63C8D9A2F47C762CB65B29B04C6FD81699D19E8C34EB9D3`；B04 JSON `8A64E61CDDD469825203ACF8F7320636057F0D2B6DA13D9D3C3A15C4F48352DD`；KB02 JSON `3431B7E96047CFF493B7A70B011D893E9E502622BE4440E5581DB8FF6FCC49F0`；包装报告 `AC1AA7F6503BC81F18C3219FF706CAF383637E6C4A509F3B467C07B309BA7D90`。

## 自查与未测

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l4-guidance-ui.test.tsx tests/lifeos-l4-flow.test.ts tests/prompt-ai.test.ts tests/meeting-raw-m04.test.ts`：27/27。之后加强完整原协议请求体断言，单独重跑 `tests/lifeos-l4-guidance-ui.test.tsx` 2/2。测试覆盖四映射与三个未增强模板、默认值、模板切换保留编辑及 Wiki、迟到 Brief、完整手动请求体；隔离真实服务 fake 验证原七模板元数据、显选 Wiki、未选排除、Meeting 来源拒绝且 fake 调用不增、确认前零正式 Prompt 与保存后版本 1 / favorite false。

`npx tsc -b` 通过；空 envDir `C:/Users/80593/AppData/Local/Temp/l4-env-KwKOr8` 的程序化 Vite build 218 模块通过，保留既有 chunk 大小警告。`git diff --check` 及新增文件 no-index 空白检查通过；`git diff -- services server rules` 无差异，服务模板、合同、system 与 wire 构造未改。静态 `impeccable detect` 对三个界面文件无发现，但仅正则扫描，不代替实际浏览器。

完整 App、真实 Prompt API/Store/PromptAiService 的 fresh 隔离会话 `C:/Users/80593/AppData/Local/Temp/lifeos-l4-FBB5Me/isolated-session.json`，PID 11728、UI 5173、API 61226；提供所选/未选/受限 Wiki、既有 Prompt、fake Provider 完整 system/user 日志和实时 complete 计数，支持 hold/release 与同根重启。先前另一个会话曾通过实际 HTTP 调用 fake 两次验证路由，PID 26032 已关闭；最终 fresh 会话初始计数 0。未接入配置加载器，未访问正式 workspace/.env/真实 Provider；历史调用账本未动。施工自查不代替 Sol 实际浏览器与独立裁决；真实模型质量未测，不称质量 PASS。未提交，主线程统一版本绑定。

## F4-01 样式返修

独立 Chrome 发现 `.field > span` 覆盖帮助区 flex，三组提示连成一段。仅改 `app/prompt.css`，用局部选择器恢复分组纵向排列，并将帮助与字段提示设为 12px、避免嵌套 small 再缩小；文字与请求未变。新 CSS SHA `2568E7F9564138B64A13C375D33F16F68D9AF52271A0771713266C2CD3502581`，取代上表 CSS 指纹。`git diff --check` 通过；`impeccable detect app/prompt.css` 静态扫描无发现，不代替 Chrome 复验。沿用现有隔离会话，真实 Provider/配置/正式 workspace 仍为 0；独立视觉和整体结论待复验。
