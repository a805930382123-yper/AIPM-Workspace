# 会议备注及本地纪要上传施工记录（2026-10-30）

代码基线 d3d3caae8f879b20c178aa4c094551c771badd8e，加本轮未提交差异；Windows Node v24.18.0、npm 11.16.0。施工自查，不代替独立验收，B09 历史109项未重跑。

备注只放行换行、回车、TAB，保留其他字段限制和读取验证。新建提供分步上传入口，保存后进入同一会议；文件上传复用格式检测和解析，MD/TXT保留BOM与换行，所有新文件的原始字节、格式及摘要与正文同一JSON保存，可下载原文件，原有正文摘要与幂等算法保持；普通详情不返回附件字节。无权限不解析/保存；不自动创建Raw或调用Provider。

- `node --import tsx --test tests/MEETING-INPUT-20261030.test.ts`：1/1 PASS；四格式上传、原件下载、MD BOM/CRLF、三行备注读回、控制字符拒绝、敏感会议拒绝、损坏 PDF 不改变版本、编辑不变原件、备份新根恢复四文件哈希一致。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/meeting.test.ts tests/meeting-minutes.test.ts tests/meeting-minutes-backup.test.ts tests/meeting-raw-m04.test.ts tests/meeting-ui.test.tsx tests/meeting-integration-m05.test.tsx tests/meeting-raw-ui-m04.test.tsx`：39/39 PASS；随后只修改 Raw 关联响应的附件隐藏和补充新测试。
- `npm run build`：exit 0；Vite 提示大于500KB的既有包大小警告。

UI 实际操作由主线程执行并另行记录；本报告不签 MI02/MI07 UI 通过。未触碰正式workspace或真实配置，真实API 0。独立 UI 使用 5198/64320、临时根，主线程负责关闭该验收服务。新测试并非覆盖所有 MI06 情况，需独立验收。修改 app/MeetingMinutes.tsx、app/pages/MeetingPage.tsx、server/meeting-api.ts、services/meeting/{policy,store,types}.ts、docs/meeting-hub/M05-interface.md，新增 tests/MEETING-INPUT-20261030.test.ts 与本报告。

独立验收返修：Raw 关联 POST/DELETE 响应统一通过 `expose` 隐藏原文件 Base64；补充带原文件版本的注册与解除关联 HTTP 断言。`node --import tsx --test tests/meeting-raw-m04.test.ts` 13/13 PASS；清除 store.ts 行尾空格，`git diff --check` 通过（Git 换行提示不影响结果）。
