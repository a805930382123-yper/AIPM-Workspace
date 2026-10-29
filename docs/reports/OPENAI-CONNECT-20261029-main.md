# OPENAI-CONNECT 主线程真实连接记录

2026-10-29。基线5f135a62689cc70e5529409c7c83fc1c3db51814加施工六文件差异。用户批准本批两处接入修复与一次真实验证。Sol停写后，通过交付脚本和修改后的Provider执行；未手工设置代理、未拦截fetch或修改请求。

实际命令：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx "E:\AI\Work\AIPM Workspace\.scratch-OPENAI-CONNECT-20261029\probe.mjs"
```
exit0，工具墙钟5.4499398秒。固定非业务消息与设置页连接测试相同，Provider timeout15000/maxOutputBytes4096；本机配置读取1，真实请求1，响应OK/finishReason stop，Node24.18.0，elapsed4762ms，usage prompt26/completion4。只使用已启用系统代理；脚本没有写系统设置。安全结果见OPENAI-CONNECT-20261029-result.json，Key不归档。临时probe仅读取配置、调用一次complete、秘密检查、写安全摘要，无自动重试。

本轮接入探针单列，不占用O/Q业务生成序号；知识254/500、Prompt15/24保持。此前会话排障已发生直连网络失败和代理HTTP400、隔离去温度成功，均不是本次交付验证或新的业务生成证据。本次未启动/重启现有工作台服务，无参dev完整UI未操作；用户后续应使用npm run dev:proxy启动服务。真实连接通过不等于严格schema/OQ/B09整体通过。
