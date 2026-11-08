# HOMEUI01 施工记录

基线 `7998f27d9b885fd275b77d0bbf29dbbbb3a000ee`；施工实例 `/root/qaui_builder`（Terra High）。任务卡已冻结方案，子代理按该方案执行，无需再次访谈；独立浏览器验收另行裁决。

首页四入口之后为左侧主任务和右侧到期跟进、每日资讯；窄屏依次排列。保留现有 NewsHome 单次挂载及调用逻辑，最近内容和统计下移；底部保留四项非重复工具。审核筛选后 Audit 统计入口清除筛选；首次任务读取失败不再显示正在读取，仍可手动刷新。

最终 SHA256：

- `app/pages/HomePage.tsx`：`A0E8D46020D3E8114A8870D40C8CB08A3FD4BFA211DBC8D5AE89ADD5B45E72E3`
- `app/home.css`：`CA57178935BF9B073049D96395E118B1D3622FA38A9E23066C524991B58E474B`
- `tests/homeui01-ui.test.tsx`：`C518A888F8BFE59C1163F931360424FB6033EF51CDF8AD162C986CBC951368CC`

验证：

1. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lifeos-l3-home-ui.test.tsx tests/lifeos-l3-actions.test.ts tests/lifeos-l3-navigation.test.tsx tests/homeui01-ui.test.tsx`，TEMP/TMP 指向 `node_modules/.cache/homeui01-temp`：8/8 通过。新测试覆盖首次失败、刷新恢复、Audit 解除筛选及底部入口去重；既有测试覆盖分源失败、版本预检等。
2. `npx tsc -b` 原工作树因七个既有二进制损坏测试报错。复制源码到 `node_modules/.cache/homeui01-type`，仅在副本从 HEAD 恢复 `tests/acceptance/AUTO01-review-actions.test.ts`、`tests/kb03-review-ui.test.tsx`、`tests/lw01-raw-ui.test.tsx`、`tests/rawzh01-http.test.ts`、`tests/rawzh01-ui.test.tsx`、`tests/support/compat01-maintenance-reply.ts`、`tests/ui-b04.test.tsx`，运行 `node ../../typescript/bin/tsc -b` 通过；原文件未改。
3. Vite `build({configFile:false,root,envDir,plugins:[react()],build:{outDir}})`，空 envDir `node_modules/.cache/homeui01-env-iXv4wn`、隔离输出 `node_modules/.cache/homeui01-out-zWfZ7b`：232 模块通过，只有常规大 chunk 提示。构建和类型副本包含当时共享工作树中并行文件，未修改其内容。
4. `impeccable.cmd detect --json app/pages/HomePage.tsx app/home.css` 返回 `[]`；`git diff --check -- app/pages/HomePage.tsx app/home.css tests/homeui01-ui.test.tsx` 通过，只有 Git 行尾提示。

命令沙箱启动器发生 `setup refresh` 错误，上述命令在授权环境运行。未访问真实数据、配置、资讯服务或模型；未启动用户服务、未提交。真实视口、焦点及长内容截图交独立验收，不将静态检查当作整批 PASS。
