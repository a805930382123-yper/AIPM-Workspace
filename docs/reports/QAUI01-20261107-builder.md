# QAUI01 施工记录

基线 `9cc9e1add6861f6ef1355d4b0d3ca04b7bd8b3e2`，施工实例 `/root/qaui_builder`（Terra High）。主线程在独验完成后提交产品为 `fe7aca01deb7af3c85362bdffae389cd4caf09ea`。本记录为施工交接，不代替独立验收。

- `app/components/WikiQuestionPanel.tsx`：左侧提问与状态、右侧回答和保存操作；依据单独分区，正文同一引用按 `answer.citations` 顺序显示短编号，锚点定位依据，依据按钮仍调用 `openCitation`；显示原有引用摘录。保留 `answerText` 的文字序列、`data-answer-section` 与 `data-answer-citations` 排除逻辑。
- `app/wiki.css`：桌面 280–320px 输入栏、右侧自适应阅读区；900px 以下上下排列。正文 16px/1.75，来源区浅紫底与边界区分。
- 最终 SHA256：`WikiQuestionPanel.tsx` `ADAC6FDA7824C91BD8CBB7FB115F28EA4E5D65F683D4E4851511F7683EC4B18E`；`wiki.css` `9A6A775D358213630537B01C2626CC6C6952C33EEA50AA592134D9C20D8579C0`。

验证：

1. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/lw02-main.test.ts tests/lw02-boundaries.test.ts`：默认沙箱 TEMP 下 15 项均因临时文件 rename `EPERM` 失败；设置 `TEMP`、`TMP` 为 `node_modules/.cache/qaui01-temp` 后同命令 15/15 通过。
2. `npx tsc -b`：原工作树七个既有二进制损坏测试报 TS1490。复制源码至 `node_modules/.cache/qaui01-type2`，仅在副本以 HEAD 正文替换 `tests/acceptance/AUTO01-review-actions.test.ts`、`tests/kb03-review-ui.test.tsx`、`tests/lw01-raw-ui.test.tsx`、`tests/rawzh01-http.test.ts`、`tests/rawzh01-ui.test.tsx`、`tests/support/compat01-maintenance-reply.ts`、`tests/ui-b04.test.tsx`，复制 scripts 后运行 `node ../../typescript/bin/tsc -b`，通过。原文件未改。
3. Vite `build({configFile:false,root,envDir,plugins:[react()],build:{outDir}})` 使用新建空 envDir 和独立 outDir：229 模块构建通过。初次沙箱运行 realpath `EPERM`，授权环境重跑通过，Vite 提示常规大 chunk 警告。
4. `node --import tsx scripts/lw02-isolated.ts` 使用独立临时目录、真实 App/API 和本地 fake，Chrome 目视检查桌面空态和合成回答态：左窄右宽、分类正文和编号、引用摘录与操作可见；未保存截图。自有服务已关闭。真实模型请求 0，不涉及真实配置和正式数据。
5. `git diff --check -- app/components/WikiQuestionPanel.tsx app/wiki.css` 通过（仅 Git 行尾提示）。

交接后按协调者检查修订 CSS：问答区域边线统一使用现有 `--line`；引用目标和键盘焦点使用紫色轮廓。重启本地 fake 隔离服务后，Chrome 点击正文编号 2，实际定位并聚焦对应依据，截图目视可见轮廓和分区线；`git diff --check -- app/wiki.css` 通过。仅 CSS 改动，未重跑类型及后端测试；隔离服务已关闭。

独验 390px 压力图发现来源编号和收起按钮被挤换行，现仅对这两处设为不收缩、不换行；`git diff --check -- app/wiki.css` 通过。最终移动端视觉复核交由独验。

浏览器宽窄视口、引用跳转、失效引用及跨段选区等冻结项交由独立验收，施工记录不宣称整批通过。未提交或推送。
