# Q02 施工校准记录

所有时间和命令原结果保留，不把后续通过改作首跑通过。真实Provider新增0。

1. `node --import tsx tests/acceptance/kb02-r2-q02-20261018-builder-provenance.mjs --create` 默认sandbox首败：`SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM`，Node v25.2.1，未进入夹具创建。随后完全相同命令通过工具`require_escalated`获准执行，完成只读旧隔离Raw/脱敏轨迹的校验与复制。该直接调用首败见本记录；成功的逐值与SHA256证据见fixture-provenance.json。
2. targeted-command第1次：sandbox的tsx初始化失败，5测试文件均未启动；见targeted-1.log/json。第2次获准同命令运行27项，25通过/2失败；新增夹具按第二个业务fragment的起始文字匹配定位错误，实际得到1片，原“两片且均fragment”断言保持。改用原文的精确512字符切片匹配，未修改产品以适应夹具；第3次27/27，0skip。见targeted-2/3.log/json。
3. http/standards-probes/security各自command-1均为默认sandbox的tsx初始化ENOMEM；各自command-2为获准同命令执行，结果分别5/5、2/2、28/28。原脚本未改，新前缀副本保留全部断言，HTTP另外增加旧revision4原六块/11条非业务事实及三文件不变场景。
4. 首冻结完整suite默认sandbox首败：tsx初始化ENOMEM，40个文件子进程失败，非skip；见fullsuite-command-1及tests-writable-copy-sandbox-initial.log/json。同命令获准后首冻结完整265/265、0skip；见fullsuite-command-2和pretype-tests-writable-copy.log/json。
5. build-command-1在首冻结同字节副本tsc失败：新增测试中持久字段atomId的类型为string|undefined，Set.has未先收窄。见pretype-build.json、pretype-tsc.log和build-command-1。补充`atomId!==undefined`断言，未降低分类/互斥断言；重新冻结后同字节完整265/265、0skip，见fullsuite-command-3及最终tests-writable-copy.log/json。首冻结main-frozen/scope保存在pretype-*。
6. 最终冻结默认build-command-2：tsc通过，Vite读取临时副本配置AccessDenied；见build-sandbox-initial.json、vite-sandbox-initial.log。同命令获准执行build-command-3，tsc/Vite均通过，未修改ACL、依赖或配置。
7. integrity首检产品/tests/夹具/10脚本/config/正式workspace无变化，但保护文件`docs/reports/PA01-R1-20261015-baseline.json`相对本轮接手基线hash不同。见main-integrity-first.json、historical-drift.json及当前字节快照historical-drift-current.json。原因未知，不恢复、不归因，不把保护检查标全PASS；既往PA01历史异常同样不被本轮追溯消除。

产品/tests及10份本轮验收脚本最终冻结于2026-10-18T13:48:46.209Z（北京时间21:48:46），之后停止对该范围写入。后续只有只读验证、同字节临时副本运行以及本轮报告整理。
