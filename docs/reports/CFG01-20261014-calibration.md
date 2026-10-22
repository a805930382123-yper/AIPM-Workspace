# CFG01 2026-10-14 校准与限制

原始失败证据全部保留，不用新PASS覆盖原FAIL。

- Host夹具：Node24 fetch的自定义Host未送达，旧Host失败不能证明产品放行。host-calibration.json比较真实wire；改原生node:http后Host攻击实测拒绝，HTTP最终27/27。
- HTTP第一轮24/27：原生DELETE默认未带Content-Length，body未发出造成confirm失败/后续ECONNRESET。补齐传输头再测；http-initial.json/log保留。storage断言使用产品loadLlmConfig读回，新base64编码不应要求原文子串出现。
- edges第一轮8/9：外部编辑测试曾以原始文件包含模型原文判断成功，编码后的语义应读回；edges-initial.json保留。实际外部更改保护最终PASS。
- 原工作区完整测试213/215及Audit重试EPERM：继承ACL含Everyone Deny DeleteSubdirectoriesAndFiles，影响目录内rename。没有修改ACL/产品/测试断言。最终84产品+52测试逐文件SHA一致拷入OS临时目录，执行相同完整测试命令，215/215，copyMismatches为空。初始tests/audit-retry日志保留；原地npm test并非PASS。
- 浏览器鼠标触发原生confirm时IAB CDP超时且自动确认，早期操作不能计为取消PASS；Chrome连接失败。改用已支持的locator.press Enter并等待真实getJsDialog：dismiss后零DELETE，accept后DELETE成功。browser-trace保留早期操作。
- 窄屏首次document scroll674/client375是真实FAIL，根因是演示备份命令pre溢出。原截图narrow-before.jpg保留；同Luna最小局部CSS返修后真实375/375。其余代码未变，随后重新冻结并build及完整副本215/215。
- browser-lab-final.json的servicesClosed=false是夹具仅检查ui.exitCode，kill使用signal时exitCode为null。保留原值；实验进程正常退出，cleanup.json通过Windows进程及端口只读核验所有自有服务已关闭。
- 实际环境Windows/Node v24.20.0。没有实际外部Provider/真实凭证、其它OS或最低Node验证。Vite536.08kB chunk警告仍在。配置编码只解决无损存储，并非加密；Windows0600不是完整ACL保证。
