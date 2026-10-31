# LIFEOS L3 首页行动事项施工交接（2026-10-31）

基线 `806b27096dce32d6ab5ddae5c590a7d31523a3cd`。新增四来源只读扫描及来源完整性信号，按 kind + ID 标识事项；首页独立读取并显示来源失败、显式刷新，点击先核当前版本和依赖。Raw、草稿、工作流及 Audit 复用既有导航；Audit 增加初始目标与版本核对。未改存储恢复、写入、模型或统计服务。施工自查不代替独立验收，L3 整体待实际浏览器与独立裁决。

## 施工指纹 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| app/pages/HomePage.tsx | `78E857BFAC907CB044D90065465B3BB8C868D157ED3A8415A1B93B531A23FE93` |
| app/App.tsx | `B6DB5BC91AA08FDC4F76C40CF8ECF68F2FD015E7AD4BB21C103CDE6965EF4608` |
| app/pages/WikiPage.tsx | `D6E54CA42A2906735277D12AA77113BB86D6F4D24D72F7D7B56B90734827B6B9` |
| app/styles.css | `F3532E2FB7198A6930643F56D96FB68FC43FE4A3E1D4FDF34D17DD92C64FABD0` |
| server/index.ts | `CDE1F8A87D3E1C38AD0FBF82B23E0AACF0F31EEB260E6CE03198F54CC46539F2` |
| server/home-api.ts | `4708310F4806FDB9F2DBF23F6A4C5D59EC0BF43A11E9119A4EEBE050F13EEB7A` |
| services/home/actions.ts | `3779DB226B57B57984A7CC2673C0AAD313A3BAC01E38B19A1A8532AA74BCE838` |
| tests/lifeos-l3-actions.test.ts | `249DDFADCA153E060A9B5644A0F57D3F13775A07DB25CB6E8F308F13FD22AB45` |
| tests/lifeos-l3-home-ui.test.tsx | `E123DDED00CBA675EDD648389C2088B976797EF015A9D23EECFBD4C5D345597E` |
| tests/lifeos-l3-navigation.test.tsx | `0638E25ED0E6D28A13938F52441C46F18505515691BC70695E18E24BA86023A4` |
| scripts/lifeos-l3-isolated.ts | `1A66A4B5F0662FEB93F688C8D84E5ED0AFFE55624E975E858AB231889F558931` |

四个共享文件施工前后 SHA 一致：AGENTS `5647F001E492A5A8C63C8D9A2F47C762CB65B29B04C6FD81699D19E8C34EB9D3`；B04 JSON `8A64E61CDDD469825203ACF8F7320636057F0D2B6DA13D9D3C3A15C4F48352DD`；KB02 JSON `3431B7E96047CFF493B7A70B011D893E9E502622BE4440E5581DB8FF6FCC49F0`；包装报告 `AC1AA7F6503BC81F18C3219FF706CAF383637E6C4A509F3B467C07B309BA7D90`。

## 验证与会话

`node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-actions.test.ts tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l3-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx tests/wiki-selection.test.tsx tests/audit.test.ts`：26/26 通过。包含同 Raw 独立草稿、落盘 running/实际 settled、未落盘 recovery、缺引用、ENOTDIR、扫描预算截断、版本变化和现有导航回归。新增 ENOTDIR fixture 首次误对目录写文件失败，改为隔离目录重命名后重测通过。

`npx tsc -b` 通过；Vite 程序化构建使用空 envDir `C:/Users/80593/AppData/Local/Temp/l3-env-bveByl`、临时 outDir `C:/Users/80593/AppData/Local/Temp/l3-build-BofErG`，217 模块通过，保留现有 chunk 大小警告。`git diff --check` 和每个新增文件的 `git diff --no-index --check` 通过，只有 Git 换行提示。`impeccable detect` 静态扫描报既有 styles.css 第 62 行 side-tab，非本次新增；未运行解析页面的视觉规则，不代替浏览器验收。

完整 App + 真实隔离 API/stores/runner 的 fresh 会话 `C:/Users/80593/AppData/Local/Temp/kb03-r4-nZOMna/isolated-session.json`，UI 5173、API 60995、PID 20288；会话包含实际事项 ID、token、虚构样例和控制信息。Provider 是显式 fake；计数在 seed 完成后读取，配置加载器未接入。控制端点的源故障、版本变更及空状态是测试准备，不能计为只读测量阶段。此前自建会话 PID 13396、27792 已关闭；最终会话保留供独立验收。真实 Provider、产品配置及正式 workspace 访问 0，未提交；主线程负责最终版本绑定和同步。

## 独立初验返修

F3-01：Raw 状态扫描失败时，草稿来源继续返回自身可读记录；只有状态源可完整读取时才用其引用判定缺失草稿。F3-02/03：processing 状态引用缺失 job、或 runner 内存 recovery 的 job 丢失时，保留明确失效事项，不静默丢弃。F3-04：首页最近记录列允许收缩和长文换行，行动按钮固定自身宽度；每行增加来源及更新时间。新的文件 SHA：HomePage `3DE6567711F43DCB32DD15D604E48AE5644DB979206B3E3104DF21931FC76822`；styles `713B987B061D4B47AB5445627FE0FCD721FAB8DF4EC92F872EDD21D914F71987`；actions `33C5E9B2C0F121B5DD48F4E8FCAA569AF92FB27E1B33F7E1DB38A42C6938A348`；actions 测试 `4ACFF4A9DDD833853E0B054B9295D3CFCDD557C7837976325A05C455DE8A2066`，其余文件沿用上表。

返修后 `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-actions.test.ts tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l3-navigation.test.tsx tests/app-m05-raw-navigation.test.tsx` 12/12；初次因返修代码缺括号导致两个测试文件未加载，修正后全过。`npx tsc -b` 通过；空 envDir `C:/Users/80593/AppData/Local/Temp/l3-final-env-HSRL7P` 构建通过，保留 chunk 大小警告。静态 detect 仍只报既有 styles 第 62 行 side-tab；`git diff --check` 通过。最终 fresh 隔离会话 `C:/Users/80593/AppData/Local/Temp/kb03-r4-QG8OoU/isolated-session.json`（PID 10516、UI 5173、API 56480），旧 PID 20288 已关闭；独立浏览器复验将确认实际布局与四项缺陷，整体仍待裁决。

## F3-05 返修

独立复验发现 Audit 状态数组 `['open']` 经字符串转换被误视为合法，导致该源假空。现只在首页聚合边界要求状态必须是 `open` 或 `resolved` 字符串；新反例断言数组使 Audit 源 error。`node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-actions.test.ts` 5/5，`npx tsc -b` 和新增文件/差异空白检查通过；不改 Audit 服务。新 SHA：actions `296541D32E6026E2D11DA600CCF82A213EA36AB8BADB43D3EF1EC9F69D45ABF7`；actions 测试 `270F90ECFFC2BDD900637E9D22B6D5AB5F92AD03715EDA002A7F217983244D40`。fresh 会话 `C:/Users/80593/AppData/Local/Temp/kb03-r4-cyN20b/isolated-session.json`（PID 18972、UI 5173、API 51092），旧 PID 10516 已关闭。整体仍待独立最终复验。
